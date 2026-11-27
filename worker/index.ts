import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  DIRECTOR_RESPONSE_SCHEMA,
  DEFAULT_LIVE_VOICE,
  buildDirectorInstructions,
  buildLiveInstructions,
  buildTextInstructions,
  inferMoodFromText,
  type RecentTurn,
} from "../src/shared/persona";
import {
  clamp,
  sanitizeDirectorPatch,
  type DirectorPatch,
  type ScenarioId,
  type SessionLedger,
} from "../src/shared/gameState";
import { SCENARIOS, createInitialLedger } from "../src/shared/scenarios";

const app = new Hono<{ Bindings: Env }>();

const PRESET_LIVE_VOICES = new Set(["tempo", "bossa", "stone", "ripple"]);
const CUSTOM_VOICE_ID_RE = /^voice_[a-zA-Z0-9_-]{8,80}$/;

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();

export function resetRateLimitStore(): void {
  rateLimitStore.clear();
}

function getClientKey(request: Request, bucket: string): string {
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
    "local";
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
    rateLimitStore.set(key, { count: 1, resetAt: now + windowMs });
    if (rateLimitStore.size > 2000) {
      for (const [k, v] of rateLimitStore.entries()) {
        if (now >= v.resetAt) rateLimitStore.delete(k);
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

async function sha256Bytes(input: string): Promise<Uint8Array> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return new Uint8Array(digest);
}

async function verifyAccessCode(
  provided: unknown,
  expected: string | undefined
): Promise<boolean> {
  if (!expected || expected.trim() === "") {
    return true;
  }
  if (typeof provided !== "string" || provided.length === 0) {
    return false;
  }
  const [a, b] = await Promise.all([
    sha256Bytes(provided),
    sha256Bytes(expected),
  ]);
  return timingSafeEqual(a, b);
}

function sanitizeHistory(input: unknown, limit = 16): RecentTurn[] {
  if (!Array.isArray(input)) return [];
  return input
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
      content: item.content.slice(0, 1500),
    }));
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
          .filter((f): f is string => typeof f === "string" && f.trim().length > 0)
          .slice(-10)
          .map((f) => f.slice(0, 140))
      : [],
    recentTropes: Array.isArray(raw.recentTropes)
      ? raw.recentTropes
          .filter((t): t is string => typeof t === "string" && t.trim().length > 0)
          .slice(-8)
          .map((t) => t.slice(0, 48))
      : [],
    documents: Array.isArray(raw.documents)
      ? (raw.documents.slice(-12) as SessionLedger["documents"])
      : [],
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
  } else if (/(carimb|emenda|milhões|asfalto|rodeio|viaduto)/.test(assistantReply.toLowerCase()) && /(voto|acordo|composi|consenso|prefeito|base)/.test(combined)) {
    meterDelta.apoioBase = 10;
    meterDelta.verbaMilhoes = 4;
    meterDelta.riscoCpi = 6;
    action = {
      type: "carimbar_emenda",
      valorMilhoes: 4,
      destino: "Asfalto Eleitoreiro & Rodeio Regional",
      jabutiOculto: "Art. 19-C: Dispensa licitação para a construtora do cunhado com pedágio a cada 4 km.",
      protocolo: `RP9-${Math.floor(1000 + Math.random() * 8999)}/2026`,
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
  if (/tcu|cpi/.test(combined)) usedTropes.push("tcu/cpi");
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

  let body: { accessCode?: unknown };
  try {
    body = await c.req.json();
  } catch {
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

  let body: {
    sdp?: unknown;
    voice?: unknown;
    history?: unknown;
    ledger?: unknown;
    accessCode?: unknown;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Payload JSON inválido." }, 400);
  }

  const authorized = await verifyAccessCode(body.accessCode, c.env.ACCESS_CODE);
  if (!authorized) {
    console.warn(
      JSON.stringify({ event: "live_session_unauthorized", path: "/api/live/session" })
    );
    return c.json({ error: "Senha de gabinete inválida." }, 401);
  }

  if (typeof body.sdp !== "string" || !body.sdp.includes("v=0")) {
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
      { error: "OPENAI_API_KEY não configurada no servidor." },
      500
    );
  }

  const voice = parseLiveVoice(body.voice, c.env.DEFAULT_VOICE || DEFAULT_LIVE_VOICE);
  const model = c.env.GPT_LIVE_MODEL || "gpt-live-1.1";
  const recentHistory = sanitizeHistory(body.history, 8);
  const ledger = sanitizeLedgerInput(body.ledger);
  const instructions = buildLiveInstructions(recentHistory, ledger);

  console.log(
    JSON.stringify({
      event: "live_session_create_start",
      model,
      voice,
      recentTurns: recentHistory.length,
      scenarioId: ledger?.scenarioId ?? "livre",
    })
  );

  const createUpstreamSession = async (withStandby: boolean) => {
    const sessionConfig: Record<string, unknown> = {
      model,
      instructions,
      audio: {
        output: {
          voice: formatLiveVoiceParam(voice),
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
    });
  };

  try {
    let upstream = await createUpstreamSession(true);
    let rawText = await upstream.text();
    let standbyEnabled = true;

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
      upstream = await createUpstreamSession(false);
      rawText = await upstream.text();
    }

    if (!upstream.ok) {
      console.error(
        JSON.stringify({
          event: "live_session_upstream_error",
          status: upstream.status,
          model,
          voice,
          detail: rawText.slice(0, 500),
        })
      );
      return c.json(
        {
          error: "Falha ao inicializar conversa por voz com a OpenAI.",
          status: upstream.status,
          detail: rawText.slice(0, 400),
        },
        upstream.status >= 400 && upstream.status < 600
          ? (upstream.status as 400 | 401 | 403 | 422 | 429 | 500 | 502 | 503)
          : 502
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
        voice,
        standbyEnabled,
      })
    );

    return c.json(
      {
        session: data.session,
        transport: data.transport,
        model,
        voice,
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

  let body: {
    message?: unknown;
    history?: unknown;
    ledger?: unknown;
    stream?: unknown;
    accessCode?: unknown;
  };

  try {
    body = await c.req.json();
  } catch {
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
    return c.json(
      { error: "OPENAI_API_KEY não configurada no servidor." },
      500
    );
  }

  const model = c.env.OPENAI_TEXT_MODEL || "gpt-6-luna";
  const history = sanitizeHistory(body.history, 16);
  const ledger = sanitizeLedgerInput(body.ledger);
  const userMessage = body.message.trim().slice(0, 1500);
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
    });

    if (!upstream.ok) {
      const rawText = await upstream.text();
      console.error(
        JSON.stringify({
          event: "text_chat_upstream_error",
          status: upstream.status,
          detail: rawText.slice(0, 400),
        })
      );
      return c.json(
        {
          error: "Falha ao conversar com o Vavá.",
          detail: rawText.slice(0, 300),
        },
        502
      );
    }

    if (wantStream && upstream.body) {
      const encoder = new TextEncoder();
      const decoder = new TextDecoder();
      const reader = upstream.body.getReader();

      const sseStream = new ReadableStream({
        async start(controller) {
          let buffer = "";
          let fullReply = "";

          const emit = (event: string, data: Record<string, unknown>) => {
            controller.enqueue(
              encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
            );
          };

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const rawLine of lines) {
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
                  }
                } catch {
                  // ignore non-JSON SSE chunks
                }
              }
            }
          } catch (err) {
            emit("error", {
              error: err instanceof Error ? err.message : "Erro de streaming",
            });
          } finally {
            const finalReply =
              fullReply.trim() ||
              "Veja bem, meu caro, deu uma oscilada no café aqui do gabinete. Pode repetir o que você disse?";
            emit("done", { reply: finalReply, model });
            controller.close();
          }
        },
      });

      return new Response(sseStream, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache, no-transform",
          Connection: "keep-alive",
        },
      });
    }

    const rawText = await upstream.text();
    const parsed = JSON.parse(rawText) as Record<string, unknown>;
    const reply =
      extractResponseText(parsed) ||
      "Veja bem, meu caro, deu uma oscilada no café aqui do gabinete. Pode repetir o que você disse?";

    return c.json({
      reply,
      model,
    });
  } catch (err) {
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

  let body: {
    userMessage?: unknown;
    assistantReply?: unknown;
    ledger?: unknown;
    accessCode?: unknown;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Payload JSON inválido." }, 400);
  }

  const authorized = await verifyAccessCode(body.accessCode, c.env.ACCESS_CODE);
  if (!authorized) {
    return c.json({ error: "Senha de gabinete inválida." }, 401);
  }

  const userMessage =
    typeof body.userMessage === "string" ? body.userMessage.trim().slice(0, 800) : "";
  const assistantReply =
    typeof body.assistantReply === "string"
      ? body.assistantReply.trim().slice(0, 1200)
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
    (c.env as unknown as Record<string, string | undefined>).OPENAI_DIRECTOR_MODEL ||
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
    });
  };

  try {
    let upstream = await callDirector("minimal");
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 422)) {
      upstream = await callDirector("low");
    }
    if (!upstream.ok && (upstream.status === 400 || upstream.status === 422)) {
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
