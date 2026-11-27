import { describe, expect, it } from "vitest";
import {
  applyDirectorPatch,
  classifyVisitorArchetype,
  computeDramaticAct,
  sanitizeDirectorPatch,
} from "../src/shared/gameState";
import {
  SCENARIOS,
  createInitialLedger,
  pickBackstageInterrupt,
} from "../src/shared/scenarios";
import {
  buildLiveInstructions,
  buildTextInstructions,
} from "../src/shared/persona";

describe("Cabinet State Engine & Scenarios (Vavá 2.0)", () => {
  it("initializes each scenario with distinct meters, moves, and analog openings", () => {
    for (const id of Object.keys(SCENARIOS) as Array<keyof typeof SCENARIOS>) {
      const ledger = createInitialLedger(id);
      expect(ledger.scenarioId).toBe(id);
      expect(ledger.act).toBe(1);
      expect(ledger.suggestedMoves.length).toBe(3);
      expect(ledger.headlineTicker.length).toBeGreaterThan(10);
    }
  });

  it("clamps meter deltas, tracks facts & sliding trope cooldown, and records documents", () => {
    const start = createInitialLedger("emenda_pix");
    const patch = sanitizeDirectorPatch({
      mood: "acordo",
      meterDelta: {
        apoioBase: 25,
        riscoCpi: 10,
        verbaMilhoes: 12,
        paciencia: 5,
      },
      action: {
        type: "carimbar_emenda",
        valorMilhoes: 12,
        destino: "Asfalto de Santa Rita",
        jabutiOculto: "Art. 99: Pedágio a cada 4 km da construtora do cunhado.",
        protocolo: "RP9-4120/2026",
      },
      usedTropes: ["sobrinho", "jabuti", "rodeio"],
      newFacts: ["Prefeito garantiu 40 mil votos"],
      suggestedMoves: [
        {
          label: "Confrontar jabuti",
          prompt: "Tira esse pedágio do texto!",
          tone: "pressao",
        },
      ],
      headlineTicker: "EMENDA DE 12M CARIMBADA PARA SANTA RITA",
    });

    const result = applyDirectorPatch(
      start,
      patch,
      "Fechado, prefeito! Carimbei os doze milhões pro asfalto!",
      "17:10"
    );

    expect(result.newDocument).not.toBeNull();
    expect(result.nextLedger.documents).toHaveLength(1);
    expect(result.nextLedger.jabutisEngolidos).toBe(1);
    expect(result.nextLedger.meters.verbaMilhoes).toBe(12);
    expect(result.nextLedger.facts).toContain("Prefeito garantiu 40 mil votos");
    expect(result.nextLedger.recentTropes).toEqual([
      "sobrinho",
      "jabuti",
      "rodeio",
    ]);
    // Emenda PIX victory triggers at >= 12M!
    expect(result.justEnded).toBe(true);
    expect(result.nextLedger.endedReason).toBe("vitoria");
    expect(classifyVisitorArchetype(result.nextLedger).id).toBe(
      "padrinho_emenda"
    );
  });

  it("expels the visitor when patience drops to zero", () => {
    const start = createInitialLedger("livre");
    start.meters.paciencia = 10;
    const patch = sanitizeDirectorPatch({
      mood: "crise",
      meterDelta: { paciencia: -25, riscoCpi: 15 },
      action: {
        type: "cortar_microfone",
        segundos: 5,
        motivo: "Corta o áudio dele, taquigrafia!",
      },
      usedTropes: ["taquigrafia"],
      newFacts: [],
      suggestedMoves: [],
    });

    const result = applyDirectorPatch(
      start,
      patch,
      "Corta o áudio dele, taquigrafia!",
      "17:12"
    );
    expect(result.nextLedger.meters.paciencia).toBe(0);
    expect(result.nextLedger.endedReason).toBe("expulso");
    expect(classifyVisitorArchetype(result.nextLedger).id).toBe(
      "alvo_taquigrafia"
    );
  });

  it("escalates acts and picks eligible Brasília backstage interrupts without duplicates", () => {
    const ledger = createInitialLedger("cpi_imprensa");
    expect(computeDramaticAct(1, ledger.meters)).toBe(1);
    expect(computeDramaticAct(4, { ...ledger.meters, riscoCpi: 50 })).toBe(2);
    expect(computeDramaticAct(7, { ...ledger.meters, riscoCpi: 80 })).toBe(3);

    ledger.turnCount = 3;
    const first = pickBackstageInterrupt(ledger);
    expect(first).not.toBeNull();
    ledger.triggeredInterruptIds.push(first!.id);
    ledger.turnCount = 6;
    const second = pickBackstageInterrupt(ledger);
    expect(second).not.toBeNull();
    expect(second!.id).not.toBe(first!.id);
  });

  it("injects dynamic scenario, facts, and trope cooldown into text and live prompts", () => {
    const ledger = createInitialLedger("salve_restinga");
    ledger.facts = ["Visitante prometeu apoio da associação de hotéis"];
    ledger.recentTropes = ["restinga", "sobrinho"];
    ledger.meters.paciencia = 20;

    for (const prompt of [
      buildTextInstructions(ledger),
      buildLiveInstructions([], ledger),
    ]) {
      expect(prompt).toContain("Salve a Restinga");
      expect(prompt).toContain("COOLDOWN OBRIGATÓRIO");
      expect(prompt).toContain("restinga, sobrinho");
      expect(prompt).toContain("associação de hotéis");
      expect(prompt).toContain("PACIÊNCIA ESTÁ POR UM FIO");
    }
  });
});
