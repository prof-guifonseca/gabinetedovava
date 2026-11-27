import { timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import {
  DEFAULT_LIVE_VOICE,
  buildLiveInstructions,
  buildTextInstructions,
  type RecentTurn,
} from "../src/shared/persona";

const app = new Hono<{ Bindings: Env }>();

const PRESET_LIVE_VOICES = new Set(["tempo", "bossa", "stone", "ripple"]);
const CUSTOM_VOICE_ID_RE = /^voice_[a-zA-Z0-9_-]{8,80}$/;

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

app.get("/api/health", (c) => {
  return c.json({
    ok: true,
    service: "gabinetedovava",
    liveModel: c.env.GPT_LIVE_MODEL || "gpt-live-1.1",
    textModel: c.env.OPENAI_TEXT_MODEL || "gpt-6-luna",
    defaultVoice: parseLiveVoice(c.env.DEFAULT_VOICE, DEFAULT_LIVE_VOICE),
    requiresAccessCode: Boolean(c.env.ACCESS_CODE && c.env.ACCESS_CODE.trim() !== ""),
    hasOpenAIKey: Boolean(c.env.OPENAI_API_KEY && c.env.OPENAI_API_KEY.trim() !== ""),
  });
});

app.post("/api/live/session", async (c) => {
  let body: {
    sdp?: unknown;
    voice?: unknown;
    history?: unknown;
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
  const recentHistory = sanitizeHistory(body.history, 6);

  console.log(
    JSON.stringify({
      event: "live_session_create_start",
      model,
      voice,
      recentTurns: recentHistory.length,
    })
  );

  try {
    const upstream = await fetch("https://api.openai.com/v1/live/sessions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${c.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          model,
          instructions: buildLiveInstructions(recentHistory),
          audio: {
            output: {
              voice: formatLiveVoiceParam(voice),
            },
          },
        },
        transport: {
          type: "webrtc",
          sdp: body.sdp,
        },
      }),
    });

    const rawText = await upstream.text();

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
      })
    );

    return c.json(
      {
        session: data.session,
        transport: data.transport,
        model,
        voice,
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

app.post("/api/chat", async (c) => {
  let body: {
    message?: unknown;
    history?: unknown;
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
  const userMessage = body.message.trim().slice(0, 1500);

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
        instructions: buildTextInstructions(),
        input: inputMessages,
        max_output_tokens: 900,
      }),
    });

    const rawText = await upstream.text();
    if (!upstream.ok) {
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
