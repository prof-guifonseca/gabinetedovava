import { Hono, type Context } from "hono";
import {
  DIRECTOR_RESPONSE_SCHEMA,
  DEFAULT_LIVE_VOICE,
  FALLBACK_LIVE_VOICE,
  buildDirectorInstructions,
  buildLiveInstructions,
  buildTextInstructions,
  inferMoodFromText,
  type RecentTurn,
} from "../src/shared/persona";
import {
  clamp,
  isDocumentAction,
  sanitizeDirectorPatch,
  type CabinetDocument,
  type DirectorPatch,
  type ScenarioId,
  type SessionLedger,
} from "../src/shared/gameState";
import { SCENARIOS, createInitialLedger } from "../src/shared/scenarios";

type AppEnv = {
  Bindings: Env;
  Variables: {
    rawBodyText?: string;
  };
};

const app = new Hono<AppEnv>();

const MAX_API_BODY_BYTES = 32 * 1024;
const MAX_SDP_LENGTH = 24_000;
const PRESET_LIVE_VOICES = new Set(["tempo", "bossa", "stone", "ripple"]);
const CUSTOM_VOICE_ID_RE = /^voice_[a-zA-Z0-9_-]{8,80}$/;

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}

function stripControlAndNewlines(value: string): string {
  return value
    .replace(/[\r\n\u0000-\u001F\u007F]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripControlCharsKeepNewlines(value: string): string {
  return value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]+/g, "").trim();
}

async function readBodyWithinLimit(
  request: Request,
  maxBytes: number
): Promise<{ ok: true; text: string } | { ok: false }> {
  const body = request.body;
  if (!body) {
    return { ok: true, text: "" };
  }

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false };
      }
      chunks.push(value);
    }
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }

  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(merged) };
}

function parseJsonObjectBody<T extends Record<string, unknown>>(
  c: Context<AppEnv>
): T | null {
  const raw = c.get("rawBodyText") ?? "";
  if (!raw.trim()) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as T;
  } catch {
    return null;
  }
}

// Global security headers + API Cache-Control
app.use("*", async (c, next) => {
  await next();
  const headers = new Headers(c.res.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(self)"
  );
  if (c.req.path.startsWith("/api/")) {
    headers.set("Cache-Control", "no-store");
  }
  c.res = new Response(c.res.body, {
    status: c.res.status,
    statusText: c.res.statusText,
    headers,
  });
});

// Strict POST /api/* origin, content-type, and 32KB body cap middleware
app.use("/api/*", async (c, next) => {
  if (c.req.method === "POST") {
    const origin = c.req.header("Origin");
    if (origin) {
      let reqOrigin = "";
      try {
        reqOrigin = new URL(c.req.url).origin;
      } catch {
        reqOrigin = "";
      }
      if (origin !== reqOrigin) {
        return c.json({ error: "Origem não autorizada." }, 403);
      }
    }

    const contentType = c.req.header("Content-Type") || "";
    if (!contentType.toLowerCase().startsWith("application/json")) {
      return c.json(
        { error: "Content-Type deve ser application/json." },
        415
      );
    }

    const contentLength = c.req.header("Content-Length");
    if (contentLength) {
      const declaredBytes = Number(contentLength);
      if (Number.isFinite(declaredBytes) && declaredBytes > MAX_API_BODY_BYTES) {
        return c.json(
          { error: "Payload excede o limite máximo de 32KB." },
          413
        );
      }
    }

    const bodyResult = await readBodyWithinLimit(c.req.raw, MAX_API_BODY_BYTES);
    if (!bodyResult.ok) {
      return c.json(
        { error: "Payload excede o limite máximo de 32KB." },
        413
      );
    }
    c.set("rawBodyText", bodyResult.text);
  }
  await next();
});

function getClientKey(request: Request, bucket: string): string {
  const ip = request.headers.get("CF-Connecting-IP")?.trim() || "local";
  return `${bucket}:${ip}`;
}

function checkRateLimit(
  request: Request,
  bucket: string,
  limit: number,
  windowMs: number
): { allowed: boolean; retryAfterSec: number } {
  const now = Date.now();
  const key = getClientKey(request, bucket);
  const existing = rateLimitStore.get(key);

  if (!existing || now >= existing.resetAt) {
    rateLimitStore.delete(key);
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    if (rateLimitStore.size > 2000) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (now >= v.resetAt) rateLimitStore.delete(k);
      }
      while (rateLimitStore.size > 2000) {
        const oldestKey = rateLimitStore.keys().next().value;
        if (oldestKey === undefined) break;
        rateLimitStore.delete(oldestKey);
      }
    }
    return { allowed: true, retryAfterSec: 0 };
  }

  if (existing.count >= limit) {
    return {
      allowed: false,
      retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSec: 0 };
}

function isValidLiveVoice(value: unknown): value is string {
  return (
    typeof value === "string" &&
    (PRESET_LIVE_VOICES.has(value) || CUSTOM_VOICE_ID_RE.test(value))
  );
}

export function parseLiveVoice(value: unknown, fallback: string): string {
  if (isValidLiveVoice(value)) {
    return value;
  }
  return isValidLiveVoice(fallback) ? fallback : DEFAULT_LIVE_VOICE;
}

export function formatLiveVoiceParam(voice: string): string | { id: string } {
  return CUSTOM_VOICE_ID_RE.test(voice) ? { id: voice } : voice;
}

async function sha256Bytes(input: string): Promise<Uint8Array<ArrayBuffer>> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

function constantTimeEqual(
  a: Uint8Array<ArrayBuffer>,
  b: Uint8Array<ArrayBuffer>
): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const subtle = crypto.subtle as SubtleCrypto & {
    timingSafeEqual?: (left: BufferSource, right: BufferSource) => boolean;
  };
  if (typeof subtle.timingSafeEqual === "function") {
    return subtle.timingSafeEqual(a, b);
  }
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

async function verifyAccessCode(
  provided: unknown,
  expected: string | undefined
): Promise<boolean> {
  const trimmedExpected = expected?.trim() ?? "";
  if (trimmedExpected === "") {
    return true;
  }
  if (typeof provided !== "string") {
    return false;
  }
  const trimmedProvided = provided.trim();
  if (trimmedProvided.length === 0) {
    return false;
  }
  const [a, b] = await Promise.all([
    sha256Bytes(trimmedProvided),
    sha256Bytes(trimmedExpected),
  ]);
  return constantTimeEqual(a, b);
}

function sanitizeHistory(
  input: unknown,
  limit = 16,
  singleLine = false
): RecentTurn[] {
  if (!Array.isArray(input)) return [];
  const preSliceCount = Math.max(limit * 2, 24);
  return input
    .slice(-preSliceCount)
    .filter(
      (item): item is RecentTurn =>
        typeof item === "object" &&
        item !== null &&
        ((item as RecentTurn).role === "user" ||
          (item as RecentTurn).role === "assistant") &&
        typeof (item as RecentTurn).content === "string" &&
        (item as RecentTurn).content.trim().length > 0
    )
    .slice(-limit)
    .map((item) => ({
      role: item.role,
      content: (singleLine
        ? stripControlAndNewlines(item.content)
        : stripControlCharsKeepNewlines(item.content)
      ).slice(0, 1500),
    }))
    .filter((item) => item.content.length > 0);
}

function sanitizeDocumentsInput(input: unknown): CabinetDocument[] {
  if (!Array.isArray(input)) return [];
  const docs: CabinetDocument[] = [];
  for (const rawItem of input.slice(-12)) {
    if (typeof rawItem !== "object" || rawItem === null) continue;
    const item = rawItem as Record<string, unknown>;
    const cleanPatch = sanitizeDirectorPatch({ action: item.action });
    if (!isDocumentAction(cleanPatch.action)) continue;

    const id =
      typeof item.id === "string" && item.id.trim().length > 0
        ? stripControlAndNewlines(item.id).slice(0, 48)
        : `doc-${docs.length + 1}`;
    const createdAt =
      typeof item.createdAt === "string" && item.createdAt.trim().length > 0
        ? stripControlAndNewlines(item.createdAt).slice(0, 24)
        : "";
    const turn = clamp(Math.round(Number(item.turn) || 1), 1, 200);

    docs.push({
      id,
      createdAt,
      turn,
      action: cleanPatch.action,
    });
  }
  return docs;
}

function sanitizeLedgerInput(input: unknown): SessionLedger | undefined {
  if (typeof input !== "object" || input === null) return undefined;
  const raw = input as Record<string, unknown>;
  const scenarioIdRaw = String(raw.scenarioId || "livre") as ScenarioId;
  const scenarioId: ScenarioId =
    scenarioIdRaw in SCENARIOS ? scenarioIdRaw : "livre";
  const base = createInitialLedger(scenarioId);

  const rawMeters =
    typeof raw.meters === "object" && raw.meters !== null
      ? (raw.meters as Record<string, unknown>)
      : {};

  const actRaw = Number(raw.act);
  const act = actRaw === 2 || actRaw === 3 ? actRaw : 1;

  return {
    ...base,
    turnCount: clamp(Math.round(Number(raw.turnCount) || 0), 0, 200),
    act,
    meters: {
      apoioBase: clamp(
        Math.round(
          typeof rawMeters.apoioBase === "number"
            ? rawMeters.apoioBase
            : base.meters.apoioBase
        ),
        0,
        100
      ),
      riscoCpi: clamp(
        Math.round(
          typeof rawMeters.riscoCpi === "number"
            ? rawMeters.riscoCpi
            : base.meters.riscoCpi
        ),
        0,
        100
      ),
      verbaMilhoes: clamp(
        Math.round(
          typeof rawMeters.verbaMilhoes === "number"
            ? rawMeters.verbaMilhoes
            : base.meters.verbaMilhoes
        ),
        0,
        50
      ),
      paciencia: clamp(
        Math.round(
          typeof rawMeters.paciencia === "number"
            ? rawMeters.paciencia
            : base.meters.paciencia
        ),
        0,
        100
      ),
    },
    facts: Array.isArray(raw.facts)
      ? raw.facts
          .slice(-24)
          .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
          .slice(-10)
          .map((f) => stripControlAndNewlines(f).slice(0, 140))
          .filter(Boolean)
      : [],
    recentTropes: Array.isArray(raw.recentTropes)
      ? raw.recentTropes
          .slice(-20)
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .slice(-8)
          .map((t) => stripControlAndNewlines(t).slice(0, 48))
          .filter(Boolean)
      : [],
    documents: sanitizeDocumentsInput(raw.documents),
  };
}

function extractResponseText(payload: Record<string, unknown>): string {
  if (typeof payload.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  const output = payload.output;
  if (Array.isArray(output)) {
    const chunks: string[] = [];
    for (const item of output) {
      if (
        typeof item === "object" &&
        item !== null &&
        Array.isArray((item as { content?: unknown[] }).content)
      ) {
        for (const part of (item as { content: unknown[] }).content) {
          if (
            typeof part === "object" &&
            part !== null &&
            typeof (part as { text?: unknown }).text === "string"
          ) {
            chunks.push((part as { text: string }).text);
          }
        }
      }
    }
    if (chunks.length > 0) {
      return chunks.join("\n").trim();
    }
  }
  return "";
}

export function buildFallbackDirectorPatch(
  userMessage: string,
  assistantReply: string,
  ledger: SessionLedger
): DirectorPatch {
  const combined = `${userMessage} ${assistantReply}`.toLowerCase();
  const mood = inferMoodFromText(assistantReply, "falando");

  const meterDelta = {
    apoioBase: 0,
    riscoCpi: 0,
    verbaMilhoes: 0,
    paciencia: 0,
  };

  let action: DirectorPatch["action"] = { type: "none" };

  if (/(corta o áudio|taquigrafia|fora do gabinete|encerra)/.test(assistantReply.toLowerCase())) {
    meterDelta.paciencia = -16;
    meterDelta.riscoCpi = 8;
    action = {
      type: "cortar_microfone",
      segundos: 4,
      motivo: "Taquigrafia, corta o áudio por quebra de decoro no gabinete!",
    };
  } else if (/(pela ordem|martelo|urgência urgentíssima|três da manhã)/.test(assistantReply.toLowerCase())) {
    meterDelta.paciencia = -10;
    action = {
      type: "bater_martelo",
      motivo: "Ordem na Mesa Diretora!",
    };
  } else if (/(nomeio|nomear|diário oficial|das-6|comissionado)/.test(assistantReply.toLowerCase()) && ledger.meters.apoioBase >= 45) {
    meterDelta.apoioBase = 12;
    meterDelta.riscoCpi = 6;
    action = {
      type: "nomear_dou",
      nomeado: "Indicado da Base",
      cargo: "Assessor Especial de Composição Regional",
      simbolo: "DAS-6",
      salarioMensal: "R$ 18.420,00",
      justificativa: "Acomodação estratégica de lideranças do gabinete.",
    };
  } else if (/(carimb|emenda|milhões|asfalto|rodeio|viaduto)/.test(assistantReply.toLowerCase()) && /(voto|\bacordo\b|composi|consenso|prefeito|base)/.test(combined)) {
    meterDelta.apoioBase = 10;
    meterDelta.verbaMilhoes = 4;
    meterDelta.riscoCpi = 6;
    action = {
      type: "carimbar_emenda",
      valorMilhoes: 4,
      destino: "Asfalto Eleitoreiro & Rodeio Regional",
      jabutiOculto: "Art. 19-C: Dispensa licitação para a construtora do cunhado com pedágio a cada 4 km.",
      protocolo: `RP9-${Math.floor(1000 + Math.random() * 8999)}/${new Date().getFullYear()}`,
    };
  } else if (mood === "crise") {
    meterDelta.riscoCpi = 12;
    meterDelta.paciencia = -12;
  } else if (mood === "acordo") {
    meterDelta.apoioBase = 10;
    meterDelta.paciencia = 5;
  }

  const usedTropes: string[] = [];
  if (/sobrinho/.test(combined)) usedTropes.push("sobrinho");
  if (/9 anos/.test(combined)) usedTropes.push("maioridade 9 anos");
  if (/restinga/.test(combined)) usedTropes.push("restinga");
  if (/rodeio|sertanejo/.test(combined)) usedTropes.push("rodeio 4 milhões");
  if (/jabuti/.test(combined)) usedTropes.push("jabuti técnico");
  if (/cunhado/.test(combined)) usedTropes.push("empreiteira do cunhado");
  if (/\btcu\b|\bcpi\b/.test(combined)) usedTropes.push("tcu/cpi");
  if (/amante/.test(combined)) usedTropes.push("amante não é parente");

  return {
    mood,
    meterDelta,
    action,
    usedTropes: usedTropes.slice(0, 3),
    newFacts: [],
    suggestedMoves: [],
  };
}

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "gabinetedovava",
    version: "2.0",
    liveModel: c.env.GPT_LIVE_MODEL || "gpt-live-1.1",
    textModel: c.env.OPENAI_TEXT_MODEL || "gpt-6-luna",
    defaultVoice: parseLiveVoice(c.env.DEFAULT_VOICE, DEFAULT_LIVE_VOICE),
    requiresAccessCode: Boolean(c.env.ACCESS_CODE && c.env.ACCESS_CODE.trim() !== ""),
    hasOpenAIKey: Boolean(c.env.OPENAI_API_KEY && c.env.OPENAI_API_KEY.trim() !== ""),
  });
});

app.post("/api/auth/verify", async (c) => {
  const rl = checkRateLimit(c.req.raw, "auth", 15, 5 * 60_000);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSec));
    return c.json(
      { error: "Muitas tentativas na portaria do gabinete. Aguarde um pouco." },
      429
    );
  }

  const body = parseJsonObjectBody<{ accessCode?: unknown }>(c);
  if (!body) {
    return c.json({ error: "Payload JSON inválido." }, 400);
  }

  const authorized = await verifyAccessCode(body.accessCode, c.env.ACCESS_CODE);
  if (!authorized) {
    return c.json({ ok: false, error: "Senha de gabinete inválida." }, 401);
  }
  return c.json({ ok: true });
});

app.post("/api/live/session", async (c) => {
  const rl = checkRateLimit(c.req.raw, "live", 10, 5 * 60_000);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSec));
    return c.json(
      {
        error:
          "Calma lá, nobre colega! Muitas chamadas de voz seguidas — aguarde uns segundos pra abrir nova linha.",
      },
      429
    );
  }

  const body = parseJsonObjectBody<{
    sdp?: unknown;
    voice?: unknown;
    history?: unknown;
    ledger?: unknown;
    accessCode?: unknown;
  }>(c);
  if (!body) {
    return c.json({ error: "Payload JSON inválido." }, 400);
  }

  const authorized = await verifyAccessCode(body.accessCode, c.env.ACCESS_CODE);
  if (!authorized) {
    console.warn(
      JSON.stringify({ event: "live_session_unauthorized", path: "/api/live/session" })
    );
    return c.json({ error: "Senha de gabinete inválida." }, 401);
  }

  if (
    typeof body.sdp !== "string" ||
    body.sdp.length > MAX_SDP_LENGTH ||
    !body.sdp.includes("v=0")
  ) {
    return c.json(
      { error: "SDP offer WebRTC ausente ou inválido." },
      400
    );
  }

  if (!c.env.OPENAI_API_KEY) {
    console.error(
      JSON.stringify({ event: "missing_openai_key", path: "/api/live/session" })
    );
    return c.json(
      { error: "Serviço de voz indisponível no momento." },
      500
    );
  }

  const requestedVoice = parseLiveVoice(
    body.voice,
    c.env.DEFAULT_VOICE || DEFAULT_LIVE_VOICE
  );
  const model = c.env.GPT_LIVE_MODEL || "gpt-live-1.1";
  const recentHistory = sanitizeHistory(body.history, 8, true);
  const ledger = sanitizeLedgerInput(body.ledger);
  const instructions = buildLiveInstructions(recentHistory, ledger);

  console.log(
    JSON.stringify({
      event: "live_session_create_start",
      model,
      voice: requestedVoice,
      recentTurns: recentHistory.length,
      scenarioId: ledger?.scenarioId ?? "livre",
    })
  );

  const createUpstreamSession = async (
    withStandby: boolean,
    selectedVoice: string
  ) => {
    const sessionConfig: Record<string, unknown> = {
      model,
      instructions,
      audio: {
        output: {
          voice: formatLiveVoiceParam(selectedVoice),
        },
      },
    };
    if (withStandby) {
      sessionConfig.wake_policy = { type: "speech" };
      sessionConfig.idle_timeout_s = 20;
    }

    return fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: sessionConfig,
        transport: {
          type: "webrtc",
          sdp: body.sdp,
        },
      }),
      signal: AbortSignal.timeout(20_000),
    });
  };

  try {
    let effectiveVoice = requestedVoice;
    let standbyEnabled = true;

    let upstream = await createUpstreamSession(true, effectiveVoice);
    let rawText = await upstream.text();

    // Graceful fallback if standby fields are rejected by a different live model
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 422)) {
      console.warn(
        JSON.stringify({
          event: "live_session_standby_fallback",
          status: upstream.status,
          detail: rawText.slice(0, 260),
        })
      );
      standbyEnabled = false;
      upstream = await createUpstreamSession(false, effectiveVoice);
      rawText = await upstream.text();
    }

    // Fallback to preset voice if custom voice ID is rejected
    if (
      !upstream.ok &&
      (upstream.status === 400 || upstream.status === 422) &&
      CUSTOM_VOICE_ID_RE.test(effectiveVoice)
    ) {
      console.warn(
        JSON.stringify({
          event: "live_session_voice_fallback",
          status: upstream.status,
          failedVoice: effectiveVoice,
          fallbackVoice: FALLBACK_LIVE_VOICE,
          detail: rawText.slice(0, 260),
        })
      );
      effectiveVoice = FALLBACK_LIVE_VOICE;
      upstream = await createUpstreamSession(false, effectiveVoice);
      rawText = await upstream.text();
    }

    if (!upstream.ok) {
      console.error(
        JSON.stringify({
          event: "live_session_upstream_error",
          status: upstream.status,
          model,
          voice: effectiveVoice,
          detail: rawText.slice(0, 500),
        })
      );
      if (upstream.status === 429) {
        return c.json(
          {
            error:
              "Linha do gabinete congestionada no momento. Aguarde alguns segundos e tente novamente.",
          },
          429
        );
      }
      return c.json(
        {
          error:
            "Não foi possível inicializar a chamada de voz com o gabinete agora. Tente novamente em instantes.",
        },
        502
      );
    }

    const data = JSON.parse(rawText) as {
      session?: { id?: string };
      transport?: { type?: string; sdp?: string };
    };

    console.log(
      JSON.stringify({
        event: "live_session_created",
        sessionId: data.session?.id ?? "unknown",
        model,
        voice: effectiveVoice,
        standbyEnabled,
      })
    );

    return c.json(
      {
        session: data.session,
        transport: data.transport,
        model,
        voice: effectiveVoice,
        standbyEnabled,
      },
      201
    );
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "live_session_exception",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return c.json(
      { error: "Erro interno ao negociar conexão de voz." },
      502
    );
  }
});

app.post("/api/chat", async (c) => {
  const rl = checkRateLimit(c.req.raw, "chat", 30, 60_000);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSec));
    return c.json(
      {
        error:
          "Calma aí, meu caro! Tá mandando ofício rápido demais — segura uns segundos que o cafezinho esfria.",
      },
      429
    );
  }

  const body = parseJsonObjectBody<{
    message?: unknown;
    history?: unknown;
    ledger?: unknown;
    stream?: unknown;
    accessCode?: unknown;
  }>(c);
  if (!body) {
    return c.json({ error: "Payload JSON inválido." }, 400);
  }

  const authorized = await verifyAccessCode(body.accessCode, c.env.ACCESS_CODE);
  if (!authorized) {
    return c.json({ error: "Senha de gabinete inválida." }, 401);
  }

  if (typeof body.message !== "string" || body.message.trim().length === 0) {
    return c.json({ error: "Mensagem vazia." }, 400);
  }

  if (!c.env.OPENAI_API_KEY) {
    console.error(
      JSON.stringify({ event: "missing_openai_key", path: "/api/chat" })
    );
    return c.json(
      { error: "Serviço de atendimento indisponível no momento." },
      500
    );
  }

  const model = c.env.OPENAI_TEXT_MODEL || "gpt-6-luna";
  const history = sanitizeHistory(body.history, 16, false);
  const ledger = sanitizeLedgerInput(body.ledger);
  const userMessage = stripControlCharsKeepNewlines(body.message).slice(0, 1500);
  if (!userMessage) {
    return c.json({ error: "Mensagem vazia." }, 400);
  }
  const wantStream = body.stream === true;

  const inputMessages = [
    ...history.map((turn) => ({
      role: turn.role,
      content: turn.content,
    })),
    {
      role: "user" as const,
      content: userMessage,
    },
  ];

  console.log(
    JSON.stringify({
      event: "text_chat_start",
      model,
      historyLength: history.length,
      stream: wantStream,
      scenarioId: ledger?.scenarioId ?? "livre",
    })
  );

  const upstreamAbort = new AbortController();
  const onClientAbort = () => upstreamAbort.abort();
  c.req.raw.signal.addEventListener("abort", onClientAbort, { once: true });
  const connectTimeout = setTimeout(() => upstreamAbort.abort(), 30_000);

  try {
    const upstream = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        instructions: buildTextInstructions(ledger),
        input: inputMessages,
        max_output_tokens: 700,
        ...(wantStream ? { stream: true } : {}),
      }),
      signal: upstreamAbort.signal,
    });
    clearTimeout(connectTimeout);

    if (!upstream.ok) {
      c.req.raw.signal.removeEventListener("abort", onClientAbort);
      const rawText = await upstream.text();
      console.error(
        JSON.stringify({
          event: "text_chat_upstream_error",
          status: upstream.status,
          detail: rawText.slice(0, 400),
        })
      );
      if (upstream.status === 429) {
        return c.json(
          {
            error:
              "O gabinete está muito movimentado agora. Aguarde alguns segundos e tente novamente.",
          },
          429
        );
      }
      return c.json(
        {
          error: "Falha ao conversar com o Vavá agora. Tente novamente em instantes.",
        },
        502
      );
    }

    if (wantStream && upstream.body) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();

      let closed = false;
      let hadError = false;

      const sseStream = new ReadableStream({
        async start(controller) {
          let buffer = "";
          let fullReply = "";

          const emit = (event: string, data: Record<string, unknown>) => {
            if (closed) return;
            try {
              controller.enqueue(
                encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
              );
            } catch {
              closed = true;
            }
          };

          const closeStream = () => {
            if (closed) return;
            closed = true;
            try {
              controller.close();
            } catch {
              // ignore already closed controller
            }
          };

          const processLines = (lines: string[]) => {
            for (const rawLine of lines) {
              if (closed || hadError) break;
              const line = rawLine.trim();
              if (!line.startsWith("data:")) continue;
              const payloadStr = line.slice(5).trim();
              if (!payloadStr || payloadStr === "[DONE]") continue;

              try {
                const evt = JSON.parse(payloadStr) as Record<string, unknown>;
                const evtType = String(evt.type ?? "");
                if (
                  evtType === "response.output_text.delta" &&
                  typeof evt.delta === "string"
                ) {
                  fullReply += evt.delta;
                  emit("delta", { delta: evt.delta });
                } else if (
                  evtType === "response.output_text.done" &&
                  typeof evt.text === "string" &&
                  !fullReply
                ) {
                  fullReply = evt.text;
                  emit("delta", { delta: evt.text });
                } else if (
                  evtType === "response.failed" ||
                  evtType === "error"
                ) {
                  console.error(
                    JSON.stringify({
                      event: "text_chat_stream_event_error",
                      evtType,
                      detail: JSON.stringify(evt).slice(0, 400),
                    })
                  );
                  hadError = true;
                  emit("error", {
                    error:
                      "Oscilação na linha do gabinete. Tente enviar novamente.",
                  });
                  break;
                }
              } catch {
                // ignore non-JSON SSE chunks
              }
            }
          };

          try {
            while (!closed && !hadError) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer = (buffer + decoder.decode(value, { stream: true }))
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n");

              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";
              processLines(lines);
            }

            if (!closed && !hadError) {
              buffer = (buffer + decoder.decode())
                .replace(/\r\n/g, "\n")
                .replace(/\r/g, "\n");
              if (buffer.trim()) {
                processLines(buffer.split("\n"));
              }
            }
          } catch (err) {
            if (!closed && !upstreamAbort.signal.aborted) {
              console.error(
                JSON.stringify({
                  event: "text_chat_stream_exception",
                  error: err instanceof Error ? err.message : String(err),
                })
              );
              hadError = true;
              emit("error", {
                error: "Oscilação na linha do gabinete. Tente novamente.",
              });
            }
          } finally {
            c.req.raw.signal.removeEventListener("abort", onClientAbort);
            if (hadError || closed || upstreamAbort.signal.aborted) {
              await reader.cancel().catch(() => {});
            } else {
              const finalReply =
                fullReply.trim() ||
                "Veja bem, meu caro, deu uma oscilada no café aqui do gabinete. Pode repetir o que você disse?";
              emit("done", { reply: finalReply, model });
            }
            try {
              reader.releaseLock();
            } catch {
              // ignore
            }
            closeStream();
          }
        },
        cancel() {
          closed = true;
          c.req.raw.signal.removeEventListener("abort", onClientAbort);
          upstreamAbort.abort();
          reader.cancel().catch(() => {});
        },
      });

      return new Response(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-store",
        },
      });
    }

    const rawText = await upstream.text();
    c.req.raw.signal.removeEventListener("abort", onClientAbort);
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const reply =
      extractResponseText(parsed) ||
      "Veja bem, meu caro, deu uma oscilada no café aqui do gabinete. Pode repetir o que você disse?";

    return c.json({
      reply,
      model,
    });
  } catch (err) {
    clearTimeout(connectTimeout);
    c.req.raw.signal.removeEventListener("abort", onClientAbort);
    console.error(
      JSON.stringify({
        event: "text_chat_exception",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return c.json(
      { error: "Erro interno ao conversar com o Vavá." },
      502
    );
  }
});

app.post("/api/director", async (c) => {
  const rl = checkRateLimit(c.req.raw, "director", 40, 60_000);
  if (!rl.allowed) {
    c.header("Retry-After", String(rl.retryAfterSec));
    return c.json({ error: "Diretor ocupado, aguarde alguns segundos." }, 429);
  }

  const body = parseJsonObjectBody<{
    userMessage?: unknown;
    assistantReply?: unknown;
    ledger?: unknown;
    accessCode?: unknown;
  }>(c);
  if (!body) {
    return c.json({ error: "Payload JSON inválido." }, 400);
  }

  const authorized = await verifyAccessCode(body.accessCode, c.env.ACCESS_CODE);
  if (!authorized) {
    return c.json({ error: "Senha de gabinete inválida." }, 401);
  }

  const userMessage =
    typeof body.userMessage === "string"
      ? stripControlAndNewlines(body.userMessage).slice(0, 800)
      : "";
  const assistantReply =
    typeof body.assistantReply === "string"
      ? stripControlAndNewlines(body.assistantReply).slice(0, 1200)
      : "";

  if (!assistantReply) {
    return c.json({ error: "assistantReply obrigatório." }, 400);
  }

  const ledger = sanitizeLedgerInput(body.ledger) ?? createInitialLedger("livre");

  if (!c.env.OPENAI_API_KEY) {
    return c.json({
      patch: buildFallbackDirectorPatch(userMessage, assistantReply, ledger),
      source: "fallback",
    });
  }

  const model =
    c.env.OPENAI_DIRECTOR_MODEL ||
    c.env.OPENAI_TEXT_MODEL ||
    "gpt-6-luna";

  const callDirector = async (reasoningEffort?: "minimal" | "low") => {
    const payload: Record<string, unknown> = {
      model,
      instructions: buildDirectorInstructions(ledger),
      input: [
        {
          role: "user",
          content: `Visitante disse: "${userMessage || "(início / fala por voz)"}"\nVavá respondeu: "${assistantReply}"`,
        },
      ],
      text: {
        format: {
          type: "json_schema",
          name: "cabinet_director_patch",
          strict: true,
          schema: DIRECTOR_RESPONSE_SCHEMA,
        },
      },
      max_output_tokens: 1400,
    };
    if (reasoningEffort) {
      payload.reasoning = { effort: reasoningEffort };
    }
    return fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20_000),
    });
  };

  try {
    let upstream = await callDirector("minimal");
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 422)) {
      await upstream.body?.cancel();
      upstream = await callDirector("low");
    }
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 422)) {
      await upstream.body?.cancel();
      upstream = await callDirector(undefined);
    }

    if (!upstream.ok) {
      const errDetail = await upstream.text();
      console.warn(
        JSON.stringify({
          event: "director_upstream_fallback",
          status: upstream.status,
          detail: errDetail.slice(0, 260),
        })
      );
      return c.json({
        patch: buildFallbackDirectorPatch(userMessage, assistantReply, ledger),
        source: "fallback",
      });
    }

    const parsed = (await upstream.json()) as Record<string, unknown>;
    const jsonText = extractResponseText(parsed);
    const patch = sanitizeDirectorPatch(JSON.parse(jsonText));

    return c.json({
      patch,
      source: "model",
    });
  } catch (err) {
    console.warn(
      JSON.stringify({
        event: "director_exception_fallback",
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return c.json({
      patch: buildFallbackDirectorPatch(userMessage, assistantReply, ledger),
      source: "fallback",
    });
  }
});

app.all("*", (c) => {
  if (c.env.ASSETS) {
    return c.env.ASSETS.fetch(c.req.raw);
  }
  return c.text("Not Found", 404);
});

export default {
  fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
