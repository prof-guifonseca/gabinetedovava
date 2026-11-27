import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDirectorPatch,
  classifyVisitorArchetype,
  clamp,
  sanitizeDirectorPatch,
  type AvatarMood,
  type BackstageInterrupt,
  type CabinetDocument,
  type CabinetMeters,
  type ScenarioId,
  type SessionLedger,
} from "../shared/gameState";
import {
  SCENARIOS,
  createInitialLedger,
  pickBackstageInterrupt,
} from "../shared/scenarios";
import { cabinetSfx } from "../audio/cabinetSfx";

export interface SavedAchievement {
  id: string;
  title: string;
  stamp: string;
  scenarioId: ScenarioId;
  achievedAt: string;
}

const ACHIEVEMENTS_KEY = "gabinete_vava_achievements_v2";

function loadAchievements(): SavedAchievement[] {
  try {
    const raw = window.localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.slice(0, 20) : [];
  } catch {
    return [];
  }
}

function saveAchievement(entry: SavedAchievement): SavedAchievement[] {
  const current = loadAchievements();
  const filtered = current.filter((a) => a.id !== entry.id);
  const next = [entry, ...filtered].slice(0, 20);
  try {
    window.localStorage.setItem(ACHIEVEMENTS_KEY, JSON.stringify(next));
  } catch {
    // ignore storage errors
  }
  return next;
}

export function useCabinetGame() {
  const [ledger, setLedger] = useState<SessionLedger>(() =>
    createInitialLedger("livre")
  );
  const [mood, setMood] = useState<AvatarMood>("neutro");
  const [lastDeltas, setLastDeltas] = useState<Partial<CabinetMeters> | null>(
    null
  );
  const [activeDocument, setActiveDocument] = useState<CabinetDocument | null>(
    null
  );
  const [isGavelShaking, setIsGavelShaking] = useState(false);
  const [micCutSecondsLeft, setMicCutSecondsLeft] = useState(0);
  const [activeInterrupt, setActiveInterrupt] =
    useState<BackstageInterrupt | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  const [sfxMuted, setSfxMuted] = useState<boolean>(() => cabinetSfx.isMuted());
  const [achievements, setAchievements] = useState<SavedAchievement[]>(
    loadAchievements
  );

  const ledgerRef = useRef(ledger);
  ledgerRef.current = ledger;

  const moodDecayRef = useRef<number | null>(null);
  const deltaClearRef = useRef<number | null>(null);
  const interruptClearRef = useRef<number | null>(null);
  const micCutIntervalRef = useRef<number | null>(null);

  const scheduleMoodDecay = useCallback((nextMood: AvatarMood) => {
    if (moodDecayRef.current !== null) {
      window.clearTimeout(moodDecayRef.current);
      moodDecayRef.current = null;
    }
    if (nextMood === "neutro") return;
    moodDecayRef.current = window.setTimeout(() => {
      setMood((curr) => (curr === nextMood ? "neutro" : curr));
    }, 9500);
  }, []);

  const setTransientMood = useCallback(
    (nextMood: AvatarMood) => {
      setMood(nextMood);
      scheduleMoodDecay(nextMood);
    },
    [scheduleMoodDecay]
  );

  const triggerGavelShake = useCallback(() => {
    setIsGavelShaking(true);
    cabinetSfx.playGavelStrike();
    window.setTimeout(() => setIsGavelShaking(false), 680);
  }, []);

  const triggerMicCut = useCallback((seconds: number) => {
    cabinetSfx.playMicCut();
    setMicCutSecondsLeft(seconds);
    if (micCutIntervalRef.current !== null) {
      window.clearInterval(micCutIntervalRef.current);
    }
    micCutIntervalRef.current = window.setInterval(() => {
      setMicCutSecondsLeft((prev) => {
        if (prev <= 1) {
          if (micCutIntervalRef.current !== null) {
            window.clearInterval(micCutIntervalRef.current);
            micCutIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  const toggleSfxMute = useCallback(() => {
    setSfxMuted((prev) => {
      const next = !prev;
      cabinetSfx.setMuted(next);
      return next;
    });
  }, []);

  const resetForScenario = useCallback((scenarioId: ScenarioId) => {
    if (moodDecayRef.current !== null) window.clearTimeout(moodDecayRef.current);
    if (deltaClearRef.current !== null) window.clearTimeout(deltaClearRef.current);
    if (interruptClearRef.current !== null)
      window.clearTimeout(interruptClearRef.current);
    if (micCutIntervalRef.current !== null)
      window.clearInterval(micCutIntervalRef.current);

    const fresh = createInitialLedger(scenarioId);
    ledgerRef.current = fresh;
    setLedger(fresh);
    setMood("neutro");
    setLastDeltas(null);
    setActiveDocument(null);
    setIsGavelShaking(false);
    setMicCutSecondsLeft(0);
    setActiveInterrupt(null);
    setShowSummary(false);
    return SCENARIOS[scenarioId];
  }, []);

  const evaluateTurnWithDirector = useCallback(
    async (params: {
      userMessage: string;
      assistantReply: string;
      accessCode: string;
      nowLabel: string;
      isLive: boolean;
      onSystemEvent: (text: string) => void;
      onLiveInject?: (instruction: string, commentary?: string) => void;
      onForceMicCut?: (seconds: number) => void;
    }) => {
      const currentLedger = ledgerRef.current;

      try {
        const res = await fetch("/api/director", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            userMessage: params.userMessage,
            assistantReply: params.assistantReply,
            ledger: currentLedger,
            accessCode: params.accessCode,
          }),
        });

        if (!res.ok) return null;
        const data = (await res.json().catch(() => ({}))) as {
          patch?: unknown;
        };
        if (!data.patch) return null;

        const patch = sanitizeDirectorPatch(data.patch);
        const { nextLedger, firedAction, newDocument, justEnded } =
          applyDirectorPatch(
            ledgerRef.current,
            patch,
            params.assistantReply,
            params.nowLabel
          );

        // Apply mood & visual meter deltas
        setTransientMood(patch.mood);
        if (
          Object.values(patch.meterDelta).some(
            (v) => typeof v === "number" && v !== 0
          )
        ) {
          setLastDeltas(patch.meterDelta);
          if (deltaClearRef.current !== null) {
            window.clearTimeout(deltaClearRef.current);
          }
          deltaClearRef.current = window.setTimeout(() => {
            setLastDeltas(null);
          }, 3400);
        }

        // Execute tactile Cabinet Actions
        if (firedAction.type === "bater_martelo") {
          triggerGavelShake();
          params.onSystemEvent(`🔨 Mesa Diretora: ${firedAction.motivo}`);
        } else if (firedAction.type === "cortar_microfone") {
          triggerGavelShake();
          triggerMicCut(firedAction.segundos);
          params.onForceMicCut?.(firedAction.segundos);
          params.onSystemEvent(
            `🔇 Taquigrafia cortou seu áudio por ${firedAction.segundos}s: "${firedAction.motivo}"`
          );
        } else if (firedAction.type === "carimbar_emenda" && newDocument) {
          cabinetSfx.playStampThud();
          setActiveDocument(newDocument);
          params.onSystemEvent(
            `📜 Emenda ${firedAction.protocolo} carimbada: R$ ${firedAction.valorMilhoes}M (${firedAction.destino}) — confira o jabuti no rodapé!`
          );
        } else if (firedAction.type === "nomear_dou" && newDocument) {
          cabinetSfx.playStampThud();
          setActiveDocument(newDocument);
          params.onSystemEvent(
            `📰 Publicado no Diário Oficial: ${firedAction.nomeado} nomeado(a) como ${firedAction.cargo} (${firedAction.simbolo})!`
          );
        } else if (firedAction.type === "puxar_dossie" && newDocument) {
          cabinetSfx.playDossierSlide();
          setActiveDocument(newDocument);
          params.onSystemEvent(
            `📂 Dr. Vavá abriu a Gaveta da Presidência: "${firedAction.titulo}"`
          );
        }

        // Check if an organic Brasília Backstage Interrupt should fire!
        let finalLedger = nextLedger;
        if (!justEnded) {
          const interrupt = pickBackstageInterrupt(nextLedger);
          if (interrupt) {
            const delta = interrupt.meterDelta ?? {};
            finalLedger = {
              ...nextLedger,
              triggeredInterruptIds: [
                ...nextLedger.triggeredInterruptIds,
                interrupt.id,
              ],
              headlineTicker: interrupt.headline,
              meters: {
                apoioBase: clamp(
                  nextLedger.meters.apoioBase + (delta.apoioBase ?? 0),
                  0,
                  100
                ),
                riscoCpi: clamp(
                  nextLedger.meters.riscoCpi + (delta.riscoCpi ?? 0),
                  0,
                  100
                ),
                verbaMilhoes: clamp(
                  nextLedger.meters.verbaMilhoes + (delta.verbaMilhoes ?? 0),
                  0,
                  50
                ),
                paciencia: clamp(
                  nextLedger.meters.paciencia + (delta.paciencia ?? 0),
                  0,
                  100
                ),
              },
            };

            // Trigger backstage audio + visual banner slightly after the reply lands
            window.setTimeout(() => {
              if (interrupt.source === "dona_neide") {
                if (interrupt.mood === "telefone") {
                  cabinetSfx.playOfficePhone();
                } else {
                  cabinetSfx.playIntercomBeep();
                }
              } else {
                cabinetSfx.playTickerAlert();
              }
              setTransientMood(interrupt.mood);
              setActiveInterrupt(interrupt);
              params.onSystemEvent(interrupt.chatSystemNote);
              if (params.isLive && params.onLiveInject) {
                params.onLiveInject(
                  interrupt.liveInstruction,
                  interrupt.liveCommentary
                );
              }
              if (interruptClearRef.current !== null) {
                window.clearTimeout(interruptClearRef.current);
              }
              interruptClearRef.current = window.setTimeout(() => {
                setActiveInterrupt(null);
              }, 9000);
            }, 900);
          }
        }

        ledgerRef.current = finalLedger;
        setLedger(finalLedger);

        if (justEnded) {
          const arch = classifyVisitorArchetype(finalLedger);
          setAchievements(
            saveAchievement({
              id: arch.id,
              title: arch.title,
              stamp: arch.stamp,
              scenarioId: finalLedger.scenarioId,
              achievedAt: params.nowLabel,
            })
          );
          if (finalLedger.endedReason === "expulso") {
            triggerGavelShake();
          } else {
            cabinetSfx.playTickerAlert();
          }
          window.setTimeout(() => setShowSummary(true), 1200);
        }

        return { patch, ledger: finalLedger };
      } catch {
        return null;
      }
    },
    [setTransientMood, triggerGavelShake, triggerMicCut]
  );

  const openManualSummary = useCallback(() => {
    const current = ledgerRef.current;
    const arch = classifyVisitorArchetype(current);
    setAchievements(
      saveAchievement({
        id: arch.id,
        title: arch.title,
        stamp: arch.stamp,
        scenarioId: current.scenarioId,
        achievedAt: new Date().toLocaleDateString("pt-BR"),
      })
    );
    setShowSummary(true);
  }, []);

  useEffect(() => {
    return () => {
      if (moodDecayRef.current !== null) window.clearTimeout(moodDecayRef.current);
      if (deltaClearRef.current !== null) window.clearTimeout(deltaClearRef.current);
      if (interruptClearRef.current !== null)
        window.clearTimeout(interruptClearRef.current);
      if (micCutIntervalRef.current !== null)
        window.clearInterval(micCutIntervalRef.current);
    };
  }, []);

  return {
    ledger,
    mood,
    lastDeltas,
    activeDocument,
    setActiveDocument,
    isGavelShaking,
    micCutSecondsLeft,
    activeInterrupt,
    showSummary,
    setShowSummary,
    sfxMuted,
    achievements,
    setTransientMood,
    toggleSfxMute,
    resetForScenario,
    evaluateTurnWithDirector,
    openManualSummary,
  };
}
