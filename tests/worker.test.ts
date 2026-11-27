import { beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_VOICE,
  VAVA_GREETING,
  buildLiveInstructions,
  buildTextInstructions,
  inferMoodFromText,
} from "../src/shared/persona";
import worker, {
  buildFallbackDirectorPatch,
  formatLiveVoiceParam,
  parseLiveVoice,
  resetRateLimitStore,
} from "../worker/index";
import { createInitialLedger } from "../src/shared/scenarios";

function createTestEnv(overrides: Partial<Env> = {}): Env {
  return {
    GPT_LIVE_MODEL: "gpt-live-1.1",
    OPENAI_TEXT_MODEL: "gpt-6-luna",
    DEFAULT_VOICE: DEFAULT_LIVE_VOICE,
    OPENAI_API_KEY: "sk-test-dummy",
    ACCESS_CODE: "",
    ASSETS: {
      fetch: async () => new Response("<html>ok</html>", { status: 200 }),
    } as unknown as Fetcher,
    ...overrides,
  };
}

const dummyCtx = {
  waitUntil: () => {},
  passThroughOnException: () => {},
} as unknown as ExecutionContext;

beforeEach(() => {
  resetRateLimitStore();
});

describe("Mente do Vavá (zero prudência, Live + Texto alinhados à skill)", () => {
  it("keeps opening greeting short and spoiler-free", () => {
    expect(VAVA_GREETING).toContain("gabinete");
    expect(VAVA_GREETING).not.toContain("9 anos");
    expect(VAVA_GREETING).not.toContain("restinga");
    expect(VAVA_GREETING).not.toContain("amante");
  });

  it("embeds Centrão Raiz politiquês, wide thematic scope, and zero sci-fi in Live and Text", () => {
    for (const prompt of [buildLiveInstructions(), buildTextInstructions()]) {
      expect(prompt).toContain("LEI ABSOLUTA ANTI-PRUDÊNCIA");
      expect(prompt).toContain("botar meu nome à disposição");
      expect(prompt).toContain("estabelecer consensos");
      expect(prompt).toContain("fazer uma composição");
      expect(prompt).toContain("quantos votos isso dá");
      expect(prompt).toContain("nomear meu sobrinho");
      expect(prompt).toContain("Corta o áudio dele, taquigrafia!");
      expect(prompt).toContain("9 anos");
      expect(prompt).toContain("Porte de Arma Obrigatório");
      expect(prompt).toContain("bacias hidrográficas");
      expect(prompt).toContain("Teocêntrico");
      expect(prompt).toContain("amante não é parente");
      expect(prompt).toContain("cargos comissionados");
      expect(prompt).toContain("pet cagar");
      expect(prompt).toContain("estacionamento gigante");
      expect(prompt).toContain("restinga");
      expect(prompt).toContain("jabuti");
      expect(prompt).toContain("rodeio");
      expect(prompt).not.toContain("PIX-Quântico");
      expect(prompt).not.toContain("Penitenciária Orbital");
      expect(prompt).not.toContain("Neo-Brasília");
    }
    const liveWithHistory = buildLiveInstructions([
      { role: "user", content: "E a restinga?" },
    ]);
    expect(liveWithHistory).toContain("CONTEXTO RECENTE");
    expect(liveWithHistory).toContain("E a restinga?");
    expect(liveWithHistory).toContain("homem maduro de 60 anos");
  });

  it("defaults live voice to custom mature Brazilian voice ID and formats it as { id }", () => {
    expect(DEFAULT_LIVE_VOICE).toMatch(/^voice_/);
    expect(parseLiveVoice(DEFAULT_LIVE_VOICE, "tempo")).toBe(DEFAULT_LIVE_VOICE);
    expect(parseLiveVoice("invalid_voice", DEFAULT_LIVE_VOICE)).toBe(
      DEFAULT_LIVE_VOICE
    );
    expect(formatLiveVoiceParam(DEFAULT_LIVE_VOICE)).toEqual({
      id: DEFAULT_LIVE_VOICE,
    });
    expect(formatLiveVoiceParam("tempo")).toBe("tempo");
  });

  it("infers all 6 avatar moods cleanly from complete phrases", () => {
    expect(
      inferMoodFromText("Corta o áudio dele, taquigrafia! Chora na rampa!")
    ).toBe("crise");
    expect(
      inferMoodFromText(
        "Truste familiar no cartório do compadre com os meninos da base"
      )
    ).toBe("acordo");
    expect(inferMoodFromText("Em off aqui entre nós, ninguém ouvindo...")).toBe(
      "sussurro"
    );
    expect(
      inferMoodFromText("Peraí que a Dona Neide tá chamando no interfone!")
    ).toBe("telefone");
    expect(inferMoodFromText("Olha só o que eu penso sobre isso.")).toBe(
      "falando"
    );
  });
});

describe("Gabinete do Vavá 2.0 Worker API", () => {
  it("GET /api/health returns v2.0 live/text models and custom voice without secrets", async () => {
    const req = new Request("https://gabinetedovava.pages.dev/api/health");
    const res = await worker.fetch(req, createTestEnv(), dummyCtx);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.version).toBe("2.0");
    expect(data.service).toBe("gabinetedovava");
    expect(data.liveModel).toBe("gpt-live-1.1");
    expect(data.textModel).toBe("gpt-6-luna");
    expect(data.ttsModel).toBeUndefined();
    expect(data.defaultVoice).toBe(DEFAULT_LIVE_VOICE);
    expect(JSON.stringify(data)).not.toContain("sk-test-dummy");
  });

  it("POST /api/auth/verify validates ACCESS_CODE properly", async () => {
    const env = createTestEnv({ ACCESS_CODE: "gabinete412" });

    const badReq = new Request(
      "https://gabinetedovava.pages.dev/api/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: "errada" }),
      }
    );
    const badRes = await worker.fetch(badReq, env, dummyCtx);
    expect(badRes.status).toBe(401);

    const goodReq = new Request(
      "https://gabinetedovava.pages.dev/api/auth/verify",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: "gabinete412" }),
      }
    );
    const goodRes = await worker.fetch(goodReq, env, dummyCtx);
    expect(goodRes.status).toBe(200);
    expect(await goodRes.json()).toEqual({ ok: true });
  });

  it("POST /api/live/session rejects invalid SDP payload with 400", async () => {
    const req = new Request(
      "https://gabinetedovava.pages.dev/api/live/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sdp: "invalid" }),
      }
    );
    const res = await worker.fetch(req, createTestEnv(), dummyCtx);
    expect(res.status).toBe(400);
  });

  it("POST /api/live/session enforces ACCESS_CODE when configured", async () => {
    const req = new Request(
      "https://gabinetedovava.pages.dev/api/live/session",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
          accessCode: "errada",
        }),
      }
    );
    const res = await worker.fetch(
      req,
      createTestEnv({ ACCESS_CODE: "gabinete412" }),
      dummyCtx
    );
    expect(res.status).toBe(401);
  });

  it("POST /api/chat rejects empty message with 400", async () => {
    const req = new Request("https://gabinetedovava.pages.dev/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: "   " }),
    });
    const res = await worker.fetch(req, createTestEnv(), dummyCtx);
    expect(res.status).toBe(400);
  });

  it("POST /api/director returns heuristic fallback cleanly when no API key is configured", async () => {
    const ledger = createInitialLedger("livre");
    const req = new Request("https://gabinetedovava.pages.dev/api/director", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userMessage: "Quero 4 milhões pro asfalto da minha base!",
        assistantReply:
          "Fechado, meu caro! Vou carimbar uma emenda de 4 milhões pro rodeio e asfalto da tua base!",
        ledger,
      }),
    });
    const res = await worker.fetch(
      req,
      createTestEnv({ OPENAI_API_KEY: "" }),
      dummyCtx
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      source: string;
      patch: { action: { type: string }; mood: string };
    };
    expect(data.source).toBe("fallback");
    expect(data.patch.action.type).toBe("carimbar_emenda");
    expect(data.patch.mood).toBe("acordo");
  });

  it("buildFallbackDirectorPatch triggers mic cut on taquigrafia phrases", () => {
    const ledger = createInitialLedger("cpi_imprensa");
    const patch = buildFallbackDirectorPatch(
      "Onde está o dinheiro?",
      "Corta o áudio dele, taquigrafia! Isso é ataque ao Parlamento!",
      ledger
    );
    expect(patch.action.type).toBe("cortar_microfone");
    expect(patch.mood).toBe("crise");
  });
});
