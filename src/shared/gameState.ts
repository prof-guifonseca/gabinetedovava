export type AvatarMood =
  | "neutro"
  | "falando"
  | "acordo"
  | "crise"
  | "sussurro"
  | "telefone";

export type ScenarioId =
  | "livre"
  | "emenda_pix"
  | "cpi_imprensa"
  | "salve_restinga"
  | "caca_cargo";

export type DramaticAct = 1 | 2 | 3;

export interface CabinetMeters {
  apoioBase: number;
  riscoCpi: number;
  verbaMilhoes: number;
  paciencia: number;
}

export interface SuggestedMove {
  id: string;
  label: string;
  prompt: string;
  tone: "acordo" | "pressao" | "blefe";
}

export interface EmendaAction {
  type: "carimbar_emenda";
  valorMilhoes: number;
  destino: string;
  jabutiOculto: string;
  protocolo: string;
}

export interface DouAction {
  type: "nomear_dou";
  nomeado: string;
  cargo: string;
  simbolo: "DAS-4" | "DAS-5" | "DAS-6" | "NES";
  salarioMensal: string;
  justificativa: string;
}

export interface DossieAction {
  type: "puxar_dossie";
  titulo: string;
  resumo: string;
  ameaca: string;
}

export type DocumentAction = EmendaAction | DouAction | DossieAction;

export type CabinetAction =
  | { type: "none" }
  | DocumentAction
  | { type: "bater_martelo"; motivo: string }
  | { type: "cortar_microfone"; segundos: number; motivo: string };

export interface CabinetDocument {
  id: string;
  createdAt: string;
  turn: number;
  action: DocumentAction;
}

export interface BackstageInterrupt {
  id: string;
  source: "dona_neide" | "tv_camara" | "tcu" | "bancada";
  badge: string;
  headline: string;
  chatSystemNote: string;
  liveInstruction: string;
  liveCommentary: string;
  mood: AvatarMood;
  meterDelta?: Partial<CabinetMeters>;
  minTurn?: number;
  minRiscoCpi?: number;
  minVerba?: number;
  maxPaciencia?: number;
}

export interface DirectorPatch {
  mood: AvatarMood;
  meterDelta: Partial<CabinetMeters>;
  action: CabinetAction;
  usedTropes: string[];
  newFacts: string[];
  suggestedMoves: SuggestedMove[];
  headlineTicker?: string;
}

export type SessionEndReason =
  | "vitoria"
  | "expulso"
  | "cpi_estourou"
  | "manual";

export interface SessionLedger {
  scenarioId: ScenarioId;
  turnCount: number;
  act: DramaticAct;
  meters: CabinetMeters;
  facts: string[];
  recentTropes: string[];
  documents: CabinetDocument[];
  triggeredInterruptIds: string[];
  suggestedMoves: SuggestedMove[];
  headlineTicker: string;
  jabutisEngolidos: number;
  micCutCount: number;
  bestQuote: { text: string; mood: AvatarMood } | null;
  endedReason?: SessionEndReason;
  endedTitle?: string;
  endedSummary?: string;
}

export interface VisitorArchetype {
  id: string;
  title: string;
  subtitle: string;
  stamp: string;
}

const VALID_MOODS = new Set<AvatarMood>([
  "neutro",
  "falando",
  "acordo",
  "crise",
  "sussurro",
  "telefone",
]);

const VALID_SIMBOLOS = new Set(["DAS-4", "DAS-5", "DAS-6", "NES"]);

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function computeDramaticAct(
  turnCount: number,
  meters: CabinetMeters
): DramaticAct {
  if (
    turnCount >= 7 ||
    meters.riscoCpi >= 75 ||
    meters.paciencia <= 25 ||
    meters.verbaMilhoes >= 14
  ) {
    return 3;
  }
  if (
    turnCount >= 3 ||
    meters.riscoCpi >= 45 ||
    meters.apoioBase >= 65 ||
    meters.verbaMilhoes >= 4
  ) {
    return 2;
  }
  return 1;
}

export function isDocumentAction(action: CabinetAction): action is DocumentAction {
  return (
    action.type === "carimbar_emenda" ||
    action.type === "nomear_dou" ||
    action.type === "puxar_dossie"
  );
}

export function sanitizeDirectorPatch(raw: unknown): DirectorPatch {
  const obj =
    typeof raw === "object" && raw !== null
      ? (raw as Record<string, unknown>)
      : {};

  const mood: AvatarMood =
    typeof obj.mood === "string" && VALID_MOODS.has(obj.mood as AvatarMood)
      ? (obj.mood as AvatarMood)
      : "falando";

  const rawDelta =
    typeof obj.meterDelta === "object" && obj.meterDelta !== null
      ? (obj.meterDelta as Record<string, unknown>)
      : {};

  const meterDelta: Partial<CabinetMeters> = {};
  if (typeof rawDelta.apoioBase === "number" && Number.isFinite(rawDelta.apoioBase)) {
    meterDelta.apoioBase = clamp(Math.round(rawDelta.apoioBase), -30, 30);
  }
  if (typeof rawDelta.riscoCpi === "number" && Number.isFinite(rawDelta.riscoCpi)) {
    meterDelta.riscoCpi = clamp(Math.round(rawDelta.riscoCpi), -25, 35);
  }
  if (typeof rawDelta.verbaMilhoes === "number" && Number.isFinite(rawDelta.verbaMilhoes)) {
    meterDelta.verbaMilhoes = clamp(Math.round(rawDelta.verbaMilhoes), -10, 20);
  }
  if (typeof rawDelta.paciencia === "number" && Number.isFinite(rawDelta.paciencia)) {
    meterDelta.paciencia = clamp(Math.round(rawDelta.paciencia), -35, 25);
  }

  let action: CabinetAction = { type: "none" };
  const rawAction =
    typeof obj.action === "object" && obj.action !== null
      ? (obj.action as Record<string, unknown>)
      : null;

  if (rawAction && typeof rawAction.type === "string") {
    switch (rawAction.type) {
      case "carimbar_emenda": {
        const valor = clamp(
          Math.round(Number(rawAction.valorMilhoes) || 4),
          1,
          25
        );
        const destino =
          String(rawAction.destino || "Obras de Asfalto e Rodeio da Base").slice(
            0,
            120
          );
        const jabutiOculto = String(
          rawAction.jabutiOculto ||
            "Art. 47-B: Dispensa licitação para a empreiteira do cunhado e cria pedágio municipal."
        ).slice(0, 220);
        const protocolo = String(
          rawAction.protocolo ||
            `RP9-${Math.floor(1000 + Math.random() * 8999)}/2026`
        ).slice(0, 32);
        action = {
          type: "carimbar_emenda",
          valorMilhoes: valor,
          destino,
          jabutiOculto,
          protocolo,
        };
        break;
      }
      case "nomear_dou": {
        const simboloRaw = String(rawAction.simbolo || "DAS-6").toUpperCase();
        const simbolo = (
          VALID_SIMBOLOS.has(simboloRaw) ? simboloRaw : "DAS-6"
        ) as DouAction["simbolo"];
        action = {
          type: "nomear_dou",
          nomeado: String(rawAction.nomeado || "Sobrinho do Visitante").slice(0, 80),
          cargo: String(
            rawAction.cargo || "Assessor Especial de Articulação Territorial"
          ).slice(0, 100),
          simbolo,
          salarioMensal: String(rawAction.salarioMensal || "R$ 18.420,00").slice(
            0,
            32
          ),
          justificativa: String(
            rawAction.justificativa ||
              "Por relevante interesse de composição regional e consenso da Mesa Diretora."
          ).slice(0, 180),
        };
        break;
      }
      case "bater_martelo": {
        action = {
          type: "bater_martelo",
          motivo: String(rawAction.motivo || "Pela ordem no gabinete!").slice(0, 100),
        };
        break;
      }
      case "cortar_microfone": {
        action = {
          type: "cortar_microfone",
          segundos: clamp(Math.round(Number(rawAction.segundos) || 5), 3, 8),
          motivo: String(
            rawAction.motivo || "Taquigrafia, corta o áudio por quebra de decoro!"
          ).slice(0, 120),
        };
        break;
      }
      case "puxar_dossie": {
        action = {
          type: "puxar_dossie",
          titulo: String(
            rawAction.titulo || "GAVETA DA PRESIDÊNCIA — NOTA RESERVADA"
          ).slice(0, 90),
          resumo: String(
            rawAction.resumo ||
              "Consta nos registros da liderança que o visitante deve café e votos à bancada."
          ).slice(0, 220),
          ameaca: String(
            rawAction.ameaca ||
              "90 pedidos de impeachment e um ofício na Corregedoria aguardando carimbo."
          ).slice(0, 160),
        };
        break;
      }
      default:
        action = { type: "none" };
    }
  }

  const usedTropes = Array.isArray(obj.usedTropes)
    ? obj.usedTropes
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((s) => s.trim().toLowerCase().slice(0, 40))
        .slice(0, 5)
    : [];

  const newFacts = Array.isArray(obj.newFacts)
    ? obj.newFacts
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .map((s) => s.trim().slice(0, 120))
        .slice(0, 3)
    : [];

  const suggestedMoves: SuggestedMove[] = Array.isArray(obj.suggestedMoves)
    ? obj.suggestedMoves
        .filter(
          (item): item is Record<string, unknown> =>
            typeof item === "object" && item !== null
        )
        .slice(0, 3)
        .map((item, idx) => {
          const toneRaw = String(item.tone || "acordo");
          const tone: SuggestedMove["tone"] =
            toneRaw === "pressao" || toneRaw === "blefe" ? toneRaw : "acordo";
          const label = String(item.label || "").trim().slice(0, 48);
          const prompt = String(item.prompt || label).trim().slice(0, 160);
          return {
            id: `move-${Date.now()}-${idx}`,
            label,
            prompt,
            tone,
          };
        })
        .filter((m) => m.label.length > 0 && m.prompt.length > 0)
    : [];

  const headlineTicker =
    typeof obj.headlineTicker === "string" && obj.headlineTicker.trim().length > 0
      ? obj.headlineTicker.trim().slice(0, 120)
      : undefined;

  return {
    mood,
    meterDelta,
    action,
    usedTropes,
    newFacts,
    suggestedMoves,
    headlineTicker,
  };
}

export function applyDirectorPatch(
  ledger: SessionLedger,
  patch: DirectorPatch,
  assistantReply: string,
  nowLabel: string
): {
  nextLedger: SessionLedger;
  firedAction: CabinetAction;
  newDocument: CabinetDocument | null;
  justEnded: boolean;
} {
  const nextTurn = ledger.turnCount + 1;

  let extraVerba = 0;
  if (
    patch.action.type === "carimbar_emenda" &&
    (!patch.meterDelta.verbaMilhoes || patch.meterDelta.verbaMilhoes <= 0)
  ) {
    extraVerba = patch.action.valorMilhoes;
  }

  const nextMeters: CabinetMeters = {
    apoioBase: clamp(ledger.meters.apoioBase + (patch.meterDelta.apoioBase ?? 0), 0, 100),
    riscoCpi: clamp(ledger.meters.riscoCpi + (patch.meterDelta.riscoCpi ?? 0), 0, 100),
    verbaMilhoes: clamp(
      ledger.meters.verbaMilhoes + (patch.meterDelta.verbaMilhoes ?? 0) + extraVerba,
      0,
      50
    ),
    paciencia: clamp(ledger.meters.paciencia + (patch.meterDelta.paciencia ?? 0), 0, 100),
  };

  const nextAct = computeDramaticAct(nextTurn, nextMeters);

  // Merge facts deduplicated (keep latest 10)
  const factSet = new Set(ledger.facts.map((f) => f.toLowerCase()));
  const mergedFacts = [...ledger.facts];
  for (const fact of patch.newFacts) {
    if (!factSet.has(fact.toLowerCase())) {
      factSet.add(fact.toLowerCase());
      mergedFacts.push(fact);
    }
  }
  const facts = mergedFacts.slice(-10);

  // Sliding cooldown window of last 8 tropes
  const tropeMerged = [...ledger.recentTropes];
  for (const trope of patch.usedTropes) {
    const existingIdx = tropeMerged.indexOf(trope);
    if (existingIdx !== -1) tropeMerged.splice(existingIdx, 1);
    tropeMerged.push(trope);
  }
  const recentTropes = tropeMerged.slice(-8);

  // Documents
  let newDocument: CabinetDocument | null = null;
  const documents = [...ledger.documents];
  if (isDocumentAction(patch.action)) {
    newDocument = {
      id: `doc-${nextTurn}-${Math.random().toString(36).slice(2, 6)}`,
      createdAt: nowLabel,
      turn: nextTurn,
      action: patch.action,
    };
    documents.push(newDocument);
  }

  const jabutisEngolidos =
    ledger.jabutisEngolidos + (patch.action.type === "carimbar_emenda" ? 1 : 0);
  const micCutCount =
    ledger.micCutCount + (patch.action.type === "cortar_microfone" ? 1 : 0);

  // Pick punchy best quote for shareable dossier
  const trimmedReply = assistantReply.trim();
  const isStrongQuote =
    trimmedReply.length >= 45 &&
    trimmedReply.length <= 280 &&
    (patch.mood === "crise" ||
      patch.mood === "acordo" ||
      patch.mood === "sussurro" ||
      !ledger.bestQuote);
  const bestQuote = isStrongQuote
    ? { text: trimmedReply, mood: patch.mood }
    : ledger.bestQuote;

  // Evaluate scenario outcomes (only if not already ended)
  let endedReason = ledger.endedReason;
  let endedTitle = ledger.endedTitle;
  let endedSummary = ledger.endedSummary;
  let justEnded = false;

  if (!endedReason) {
    if (nextMeters.paciencia <= 0) {
      endedReason = "expulso";
      endedTitle = "Sessão Encerrada pela Mesa Diretora";
      endedSummary =
        "A paciência do Dr. Vavá zerou. A taquigrafia cortou seu áudio e a Polícia Legislativa acompanhou você gentilmente até o elevador.";
      justEnded = true;
    } else if (ledger.scenarioId === "emenda_pix" && nextMeters.verbaMilhoes >= 12) {
      endedReason = "vitoria";
      endedTitle = "Emenda PIX Carimbada no Diário Oficial!";
      endedSummary = `Você arrancou R$ ${nextMeters.verbaMilhoes} milhões para Santa Rita do Asfalto — com apenas ${jabutisEngolidos} jabuti(s) do cunhado no rodapé.`;
      justEnded = true;
    } else if (ledger.scenarioId === "cpi_imprensa" && nextMeters.riscoCpi >= 90) {
      endedReason = "vitoria";
      endedTitle = "Manchete Nacional! CPI Aberta na Madrugada!";
      endedSummary =
        "Você encurralou o Presidente da Câmara até o Risco de CPI explodir. O áudio já está no Plantão da TV Câmara!";
      justEnded = true;
    } else if (
      ledger.scenarioId === "salve_restinga" &&
      nextMeters.apoioBase >= 80
    ) {
      endedReason = "vitoria";
      endedTitle = "Restinga Salva no Grito e no Consenso!";
      endedSummary =
        "Por milagre regimental, você convenceu a Mesa Diretora a engavetar o paredão de 40 andares (por enquanto).";
      justEnded = true;
    } else if (
      ledger.scenarioId === "caca_cargo" &&
      documents.some((d) => d.action.type === "nomear_dou")
    ) {
      endedReason = "vitoria";
      endedTitle = "Publicado no DOU — Sobrinho Empossado!";
      endedSummary =
        "Portaria assinada na caneta Montblanc! Seu indicado já tem crachá, sala no Anexo IV e café liberado.";
      justEnded = true;
    } else if (
      ledger.scenarioId !== "cpi_imprensa" &&
      nextMeters.riscoCpi >= 100
    ) {
      endedReason = "cpi_estourou";
      endedTitle = "Plantão Extra: Polícia Federal na Ante-Sala!";
      endedSummary =
        "O escândalo vazou antes da assinatura final. Vavá trancou a gaveta dos ofícios e convocou coletiva dizendo que foi tudo 'trabalho territorial'.";
      justEnded = true;
    }
  }

  const nextLedger: SessionLedger = {
    ...ledger,
    turnCount: nextTurn,
    act: nextAct,
    meters: nextMeters,
    facts,
    recentTropes,
    documents,
    suggestedMoves:
      patch.suggestedMoves.length > 0
        ? patch.suggestedMoves
        : ledger.suggestedMoves,
    headlineTicker: patch.headlineTicker || ledger.headlineTicker,
    jabutisEngolidos,
    micCutCount,
    bestQuote,
    endedReason,
    endedTitle,
    endedSummary,
  };

  return {
    nextLedger,
    firedAction: patch.action,
    newDocument,
    justEnded,
  };
}

export function classifyVisitorArchetype(ledger: SessionLedger): VisitorArchetype {
  const hasDou = ledger.documents.some((d) => d.action.type === "nomear_dou");
  const hasEmenda = ledger.documents.some((d) => d.action.type === "carimbar_emenda");

  if (ledger.endedReason === "expulso" || ledger.micCutCount >= 2) {
    return {
      id: "alvo_taquigrafia",
      title: "Alvo da Taquigrafia",
      subtitle: "Teve o microfone cortado ao vivo por insistir em fazer pergunta difícil.",
      stamp: "ÁUDIO CORTADO",
    };
  }
  if (ledger.meters.riscoCpi >= 85) {
    return {
      id: "terror_cpi",
      title: "Terror do Colégio de Líderes",
      subtitle: "Fez o Dr. Vavá suar frio e transformou o gabinete em Plantão da TV Câmara.",
      stamp: "CPI INSTAURADA",
    };
  }
  if (hasDou) {
    return {
      id: "sobrinho_empossado",
      title: "Sobrinho em Posse (DAS-6)",
      subtitle: "Dominou a arte da troca cruzada e saiu com nomeação carimbada no DOU.",
      stamp: "PUBLICADO NO DOU",
    };
  }
  if (hasEmenda || ledger.meters.verbaMilhoes >= 10) {
    return {
      id: "padrinho_emenda",
      title: "Padrinho da Emenda PIX",
      subtitle: `Saiu do Anexo IV com R$ ${ledger.meters.verbaMilhoes}M empenhados e um jabuti no bolso.`,
      stamp: "EMENDA LIBERADA",
    };
  }
  if (ledger.meters.apoioBase >= 75) {
    return {
      id: "mestre_balcao",
      title: "Articulador do Centrão Raiz",
      subtitle: "Estabeleceu consensos, construiu pontes e saiu maior do que entrou.",
      stamp: "BASE CONTEMPLADA",
    };
  }
  return {
    id: "turista_cafezinho",
    title: "Visitante do Cafezinho",
    subtitle: "Tomou o café do Anexo IV, ouviu umas verdades tortas e sobreviveu ao rito regimental.",
    stamp: "AUDIÊNCIA REGISTRADA",
  };
}
