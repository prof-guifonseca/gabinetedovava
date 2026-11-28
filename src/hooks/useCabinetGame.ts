import { useCallback, useEffect, useRef, useState } from "react";
import {
  applyDirectorPatch,
  classifyVisitorArchetype,
  clamp,
  computeDramaticAct,
  evaluateScenarioOutcome,
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
const VALID_SCENARIO_IDS = new Set<string>(Object.keys(SCENARIOS));

function loadAchievements(): SavedAchievement[] {
  try {
    const raw = window.localStorage.getItem(ACHIEVEMENTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is SavedAchievement => {
        if (typeof item !== "object" || item === null) return false;
        const rec = item as Record<string, unknown>;
        return (
          typeof rec.id === "string" &&
          rec.id.trim().length > 0 &&
          typeof rec.title === "string" &&
          rec.title.trim().length > 0 &&
          typeof rec.stamp === "string" &&
          rec.stamp.trim().length > 0 &&
          typeof rec.scenarioId === "string" &&
          VALID_SCENARIO_IDS.has(rec.scenarioId) &&
          typeof rec.achievedAt === "string"
        );
      })
      .slice(0, 20);
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

  const sessionEpochRef = useRef<number>(0);
  const directorAbortRef = useRef<AbortController | null>(null);

  const moodDecayRef = useRef<number | null>(null);
  const deltaClearRef = useRef<number | null>(null);
  const gavelShakeRef = useRef<number | null>(null);
  const interruptDelayRef = useRef<number | null>(null);
  const interruptClearRef = useRef<number | null>(null);
  const summaryDelayRef = useRef<number | null>(null);
  const micCutIntervalRef = useRef<number | null>(null);
  const micCutDeadlineRef = useRef<number | null>(null);

  const clearAllTimers = useCallback(() => {
    if (moodDecayRef.current !== null) {
      window.clearTimeout(moodDecayRef.current);
      moodDecayRef.current = null;
    }
    if (deltaClearRef.current !== null) {
      window.clearTimeout(deltaClearRef.current);
      deltaClearRef.current = null;
    }
    if (gavelShakeRef.current !== null) {
      window.clearTimeout(gavelShakeRef.current);
      gavelShakeRef.current = null;
    }
    if (interruptDelayRef.current !== null) {
      window.clearTimeout(interruptDelayRef.current);
      interruptDelayRef.current = null;
    }
    if (interruptClearRef.current !== null) {
      window.clearTimeout(interruptClearRef.current);
      interruptClearRef.current = null;
    }
    if (summaryDelayRef.current !== null) {
      window.clearTimeout(summaryDelayRef.current);
      summaryDelayRef.current = null;
    }
    if (micCutIntervalRef.current !== null) {
      window.clearInterval(micCutIntervalRef.current);
      micCutIntervalRef.current = null;
    }
    micCutDeadlineRef.current = null;
  }, []);

  const scheduleMoodDecay = useCallback((nextMood: AvatarMood) => {
    if (moodDecayRef.current !== null) {
      window.clearTimeout(moodDecayRef.current);
      moodDecayRef.current = null;
    }
    if (nextMood === "neutro") return;
    const epoch = sessionEpochRef.current;
    moodDecayRef.current = window.setTimeout(() => {
      moodDecayRef.current = null;
      if (epoch !== sessionEpochRef.current) return;
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
    if (gavelShakeRef.current !== null) {
      window.clearTimeout(gavelShakeRef.current);
    }
    const epoch = sessionEpochRef.current;
    gavelShakeRef.current = window.setTimeout(() => {
      gavelShakeRef.current = null;
      if (epoch !== sessionEpochRef.current) return;
      setIsGavelShaking(false);
    }, 680);
  }, []);

  const triggerMicCut = useCallback((seconds: number) => {
    cabinetSfx.playMicCut();
    const safeSeconds = Math.max(1, Math.round(seconds));
    micCutDeadlineRef.current = Date.now() + safeSeconds * 1000;
    setMicCutSecondsLeft(safeSeconds);

    if (micCutIntervalRef.current !== null) {
      window.clearInterval(micCutIntervalRef.current);
    }
    micCutIntervalRef.current = window.setInterval(() => {
      if (micCutDeadlineRef.current === null) return;
      const left = Math.max(
        0,
        Math.ceil((micCutDeadlineRef.current - Date.now()) / 1000)
      );
      setMicCutSecondsLeft(left);
      if (left <= 0) {
        if (micCutIntervalRef.current !== null) {
          window.clearInterval(micCutIntervalRef.current);
          micCutIntervalRef.current = null;
        }
        micCutDeadlineRef.current = null;
      }
    }, 500);
  }, []);

  const toggleSfxMute = useCallback(() => {
    const next = !cabinetSfx.isMuted();
    cabinetSfx.setMuted(next);
    setSfxMuted(next);
  }, []);

  const finalizeEndedSession = useCallback(
    (endedLedger: SessionLedger, nowLabel: string, epoch: number) => {
      const arch = classifyVisitorArchetype(endedLedger);
      setAchievements(
        saveAchievement({
          id: arch.id,
          title: arch.title,
          stamp: arch.stamp,
          scenarioId: endedLedger.scenarioId,
          achievedAt: nowLabel,
        })
      );
      if (endedLedger.endedReason === "expulso") {
        triggerGavelShake();
      } else {
        cabinetSfx.playTickerAlert();
      }
      if (summaryDelayRef.current !== null) {
        window.clearTimeout(summaryDelayRef.current);
      }
      summaryDelayRef.current = window.setTimeout(() => {
        summaryDelayRef.current = null;
        if (epoch !== sessionEpochRef.current) return;
        setShowSummary(true);
      }, 1200);
    },
    [triggerGavelShake]
  );

  const resetForScenario = useCallback(
    (scenarioId: ScenarioId) => {
      sessionEpochRef.current += 1;
      if (directorAbortRef.current) {
        directorAbortRef.current.abort();
        directorAbortRef.current = null;
      }
      clearAllTimers();

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
    },
    [clearAllTimers]
  );

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
      const epoch = sessionEpochRef.current;
      const currentLedger = ledgerRef.current;

      if (directorAbortRef.current) {
        directorAbortRef.current.abort();
      }
      const controller = new AbortController();
      directorAbortRef.current = controller;

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
          signal: controller.signal,
        });

        if (epoch !== sessionEpochRef.current || controller.signal.aborted) {
          return null;
        }
        if (!res.ok) return null;

        const data = (await res.json().catch(() => ({}))) as {
          patch?: unknown;
        };
        if (epoch !== sessionEpochRef.current || controller.signal.aborted) {
          return null;
        }
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
            deltaClearRef.current = null;
            if (epoch !== sessionEpochRef.current) return;
            setLastDeltas(null);
          }, 3400);
        }

        // Execute tactile Cabinet Actions (Documents appear as inline clickable cards)
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
        } else if (firedAction.type === "nomear_dou" && newDocument) {
          cabinetSfx.playStampThud();
        } else if (firedAction.type === "puxar_dossie" && newDocument) {
          cabinetSfx.playDossierSlide();
        }

        ledgerRef.current = nextLedger;
        setLedger(nextLedger);

        if (justEnded) {
          finalizeEndedSession(nextLedger, params.nowLabel, epoch);
        } else {
          // Check if an organic Brasília Backstage Interrupt should fire and apply it in lockstep at 900ms!
          const interrupt = pickBackstageInterrupt(nextLedger);
          if (interrupt) {
            if (interruptDelayRef.current !== null) {
              window.clearTimeout(interruptDelayRef.current);
            }
            interruptDelayRef.current = window.setTimeout(() => {
              interruptDelayRef.current = null;
              if (epoch !== sessionEpochRef.current) return;

              const latest = ledgerRef.current;
              if (
                latest.endedReason ||
                latest.triggeredInterruptIds.includes(interrupt.id)
              ) {
                return;
              }

              const delta = interrupt.meterDelta ?? {};
              const updatedMeters: CabinetMeters = {
                apoioBase: clamp(
                  latest.meters.apoioBase + (delta.apoioBase ?? 0),
                  0,
                  100
                ),
                riscoCpi: clamp(
                  latest.meters.riscoCpi + (delta.riscoCpi ?? 0),
                  0,
                  100
                ),
                verbaMilhoes: clamp(
                  latest.meters.verbaMilhoes + (delta.verbaMilhoes ?? 0),
                  0,
                  50
                ),
                paciencia: clamp(
                  latest.meters.paciencia + (delta.paciencia ?? 0),
                  0,
                  100
                ),
              };

              const updatedAct = computeDramaticAct(
                latest.turnCount,
                updatedMeters
              );

              const candidateLedger: SessionLedger = {
                ...latest,
                act: updatedAct,
                triggeredInterruptIds: [
                  ...latest.triggeredInterruptIds,
                  interrupt.id,
                ],
                headlineTicker: interrupt.headline,
                meters: updatedMeters,
              };

              const outcome = evaluateScenarioOutcome(candidateLedger);
              const updatedLedger: SessionLedger = {
                ...candidateLedger,
                endedReason: outcome.endedReason,
                endedTitle: outcome.endedTitle,
                endedSummary: outcome.endedSummary,
              };

              ledgerRef.current = updatedLedger;
              setLedger(updatedLedger);

              if (
                Object.values(delta).some(
                  (v) => typeof v === "number" && v !== 0
                )
              ) {
                setLastDeltas(delta);
                if (deltaClearRef.current !== null) {
                  window.clearTimeout(deltaClearRef.current);
                }
                deltaClearRef.current = window.setTimeout(() => {
                  deltaClearRef.current = null;
                  if (epoch !== sessionEpochRef.current) return;
                  setLastDeltas(null);
                }, 3400);
              }

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
                interruptClearRef.current = null;
                if (epoch !== sessionEpochRef.current) return;
                setActiveInterrupt(null);
              }, 9000);

              if (outcome.justEnded) {
                finalizeEndedSession(updatedLedger, params.nowLabel, epoch);
              }
            }, 900);
          }
        }

        return { patch, ledger: nextLedger, newDocument };
      } catch {
        return null;
      } finally {
        if (directorAbortRef.current === controller) {
          directorAbortRef.current = null;
        }
      }
    },
    [finalizeEndedSession, setTransientMood, triggerGavelShake, triggerMicCut]
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
      sessionEpochRef.current += 1;
      if (directorAbortRef.current) {
        directorAbortRef.current.abort();
        directorAbortRef.current = null;
      }
      clearAllTimers();
    };
  }, [clearAllTimers]);

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
