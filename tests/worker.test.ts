import { describe, expect, it } from "vitest";
import {
  DEFAULT_LIVE_VOICE,
  VAVA_GREETING,
  buildLiveInstructions,
  buildTextInstructions,
  inferMoodFromText,
} from "../src/shared/persona";
import worker, { formatLiveVoiceParam, parseLiveVoice } from "../worker/index";

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

describe("Mente do Vavá (zero prudência, Live + Texto alinhados à skill)", () => {
  it("keeps opening greeting short and spoiler-free", () => {
    expect(VAVA_GREETING).toContain("gabinete");
    expect(VAVA_GREETING).not.toContain("9 anos");
    expect(VAVA_GREETING).not.toContain("restinga");
    expect(VAVA_GREETING).not.toContain("amante");
  });

  it("embeds Centrão Raiz anti-prudence engine, mamatinha-first rules, and zero sci-fi in Live and Text", () => {
    for (const prompt of [buildLiveInstructions(), buildTextInstructions()]) {
      expect(prompt).toContain("LEI ABSOLUTA ANTI-PRUDÊNCIA");
      expect(prompt).toContain("REGRA DE IMPROVISO UNIVERSAL");
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
    expect(parseLiveVoice("invalid_voice", DEFAULT_LIVE_VOICE)).toBe(DEFAULT_LIVE_VOICE);
    expect(formatLiveVoiceParam(DEFAULT_LIVE_VOICE)).toEqual({ id: DEFAULT_LIVE_VOICE });
    expect(formatLiveVoiceParam("tempo")).toBe("tempo");
  });

  it("infers avatar mood cleanly from reply content", () => {
    expect(inferMoodFromText("Corta o áudio dele, taquigrafia! Chora na rampa!")).toBe("crise");
    expect(inferMoodFromText("Truste familiar no cartório do compadre com os meninos da base")).toBe("acordo");
    expect(inferMoodFromText("Pega um cafezinho aí!")).toBe("acordo");
    expect(inferMoodFromText("Olha só o que eu penso sobre isso.")).toBe("falando");
  });
});

describe("Gabinete do Vavá Worker API", () => {
  it("GET /api/health returns live/text models and custom voice without TTS or secrets", async () => {
    const req = new Request("https://gabinetedovava.pages.dev/api/health");
    const res = await worker.fetch(req, createTestEnv(), dummyCtx);
    expect(res.status).toBe(200);
    const data = (await res.json()) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(data.service).toBe("gabinetedovava");
    expect(data.liveModel).toBe("gpt-live-1.1");
    expect(data.textModel).toBe("gpt-6-luna");
    expect(data.ttsModel).toBeUndefined();
    expect(data.defaultVoice).toBe(DEFAULT_LIVE_VOICE);
    expect(JSON.stringify(data)).not.toContain("sk-test-dummy");
  });

  it("POST /api/live/session rejects invalid SDP payload with 400", async () => {
    const req = new Request("https://gabinetedovava.pages.dev/api/live/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sdp: "invalid" }),
    });
    const res = await worker.fetch(req, createTestEnv(), dummyCtx);
    expect(res.status).toBe(400);
  });

  it("POST /api/live/session enforces ACCESS_CODE when configured", async () => {
    const req = new Request("https://gabinetedovava.pages.dev/api/live/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sdp: "v=0\r\no=- 1 1 IN IP4 127.0.0.1\r\n",
        accessCode: "errada",
      }),
    });
    const res = await worker.fetch(
      req,
      createTestEnv({ ACCESS_CODE: "gabinete2048" }),
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
});
