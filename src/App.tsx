import { useCallback, useEffect, useRef, useState } from "react";
import { BroadcastHeader } from "./components/BroadcastHeader";
import { CabinetMetersBar } from "./components/CabinetMetersBar";
import { AvatarStage } from "./components/AvatarStage";
import { TaquigrafiaPanel } from "./components/TaquigrafiaPanel";
import { AccessGateModal } from "./components/AccessGateModal";
import { ScenarioDrawer } from "./components/ScenarioDrawer";
import { DocumentOverlay } from "./components/DocumentOverlay";
import { SessionSummaryModal } from "./components/SessionSummaryModal";
import {
  formatNow,
  makeId,
  useGptLiveSession,
  type ChatEntry,
} from "./hooks/useGptLiveSession";
import { useCabinetGame } from "./hooks/useCabinetGame";
import {
  DEFAULT_LIVE_VOICE,
  inferMoodFromText,
  type RecentTurn,
} from "./shared/persona";
import type { ScenarioId } from "./shared/gameState";
import { SCENARIOS } from "./shared/scenarios";

function createOpeningEntries(scenarioId: ScenarioId): ChatEntry[] {
  const scenario = SCENARIOS[scenarioId] ?? SCENARIOS.livre;
  return [
    {
      id: makeId("greeting"),
      role: "assistant",
      source: "text",
      timestamp: formatNow(),
      mood: "neutro",
      text: scenario.openingGreeting,
    },
  ];
}

export default function App() {
  const game = useCabinetGame();
  const [voice, setVoice] = useState(DEFAULT_LIVE_VOICE);
  const [isSendingText, setIsSendingText] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>(() =>
    createOpeningEntries("livre")
  );
  const [showScenarios, setShowScenarios] = useState(false);

  const [requiresAccessCode, setRequiresAccessCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string>(() => {
    try {
      return window.sessionStorage.getItem("gabinete_vava_code") || "";
    } catch {
      return "";
    }
  });
  const [showAccessModal, setShowAccessModal] = useState(false);

  const accessCodeRef = useRef(accessCode);
  accessCodeRef.current = accessCode;

  const lastDeltaMetaRef = useRef<{
    role: "user" | "assistant";
    itemKey?: string;
    at: number;
  } | null>(null);

  // Fetch server health ONCE on mount (fixes duplicate health fetch bug)
  useEffect(() => {
    let active = true;
    fetch("/api/health")
      .then((res) =>
        res.ok
          ? (res.json() as Promise<{
              defaultVoice?: string;
              requiresAccessCode?: boolean;
            }>)
          : null
      )
      .then((data) => {
        if (!active || !data) return;
        if (data.defaultVoice) setVoice(data.defaultVoice);
        if (data.requiresAccessCode) {
          setRequiresAccessCode(true);
          if (!accessCodeRef.current) setShowAccessModal(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const appendSystemEvent = useCallback((text: string) => {
    setEntries((prev) => [
      ...prev,
      {
        id: makeId("sys"),
        role: "system",
        source: "live",
        timestamp: formatNow(),
        text,
      },
    ]);
  }, []);

  const appendTranscriptDelta = useCallback(
    (
      role: "user" | "assistant",
      delta: string,
      itemKey?: string,
      replaceFull = false
    ) => {
      const now = Date.now();
      const last = lastDeltaMetaRef.current;
      const sameKey = Boolean(itemKey && last?.itemKey === itemKey);
      const shouldMerge = Boolean(
        sameKey || (!itemKey && last && last.role === role && now - last.at < 3000)
      );
      lastDeltaMetaRef.current = { role, itemKey, at: now };

      setEntries((prev) => {
        if (itemKey) {
          const existingIdx = [...prev]
            .reverse()
            .findIndex((e) => e.itemKey === itemKey && e.role === role);
          if (existingIdx !== -1) {
            const targetIdx = prev.length - 1 - existingIdx;
            const target = prev[targetIdx];
            const updated = [...prev];
            updated[targetIdx] = {
              ...target,
              text: replaceFull ? delta : `${target.text}${delta}`,
            };
            return updated;
          }
        }

        if (shouldMerge && prev.length > 0) {
          const tail = prev[prev.length - 1];
          if (tail.role === role && tail.source === "live") {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...tail,
              text: replaceFull ? delta : `${tail.text}${delta}`,
            };
            return updated;
          }
        }

        return [
          ...prev,
          {
            id: makeId(role),
            role,
            source: "live",
            timestamp: formatNow(),
            itemKey,
            text: delta,
          },
        ];
      });
    },
    []
  );

  const liveRef = useRef<ReturnType<typeof useGptLiveSession> | null>(null);

  const handleLiveTurnComplete = useCallback(
    (userText: string, assistantText: string) => {
      void game
        .evaluateTurnWithDirector({
          userMessage: userText,
          assistantReply: assistantText,
          accessCode: accessCodeRef.current,
          nowLabel: formatNow(),
          isLive: true,
          onSystemEvent: appendSystemEvent,
          onLiveInject: (instruction, commentary) => {
            liveRef.current?.injectLiveEvent(instruction, commentary);
          },
          onForceMicCut: (seconds) => {
            liveRef.current?.forceMuteFor(seconds);
          },
        })
        .then((res) => {
          if (!res?.patch) return;
          setEntries((prev) => {
            const copy = [...prev];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].role === "assistant") {
                copy[i] = { ...copy[i], mood: res.patch.mood };
                break;
              }
            }
            return copy;
          });
        });
    },
    [appendSystemEvent, game]
  );

  const live = useGptLiveSession({
    onTranscriptDelta: appendTranscriptDelta,
    onSystemEvent: appendSystemEvent,
    onMoodHint: (hint) => game.setTransientMood(hint),
    onLiveTurnComplete: handleLiveTurnComplete,
    onUnauthorized: () => setShowAccessModal(true),
  });
  liveRef.current = live;

  const handleStartLive = () => {
    if (requiresAccessCode && !accessCode) {
      setShowAccessModal(true);
      return;
    }
    const recentHistory: RecentTurn[] = entries
      .filter((e) => e.role === "user" || e.role === "assistant")
      .slice(-8)
      .map((e) => ({
        role: e.role as "user" | "assistant",
        content: e.text,
      }));
    const scenario = SCENARIOS[game.ledger.scenarioId] ?? SCENARIOS.livre;
    void live.connect({
      voice,
      history: recentHistory,
      ledger: game.ledger,
      openingCue: scenario.liveOpeningCue,
      accessCode,
    });
  };

  const handleToggleVoiceCall = () => {
    if (live.status === "live" || live.status === "connecting") {
      live.disconnect("Chamada de voz encerrada.");
    } else {
      handleStartLive();
    }
  };

  const handleSendText = async (message: string) => {
    if (game.micCutSecondsLeft > 0) return;

    if (requiresAccessCode && !accessCode) {
      setShowAccessModal(true);
      return;
    }

    const userEntry: ChatEntry = {
      id: makeId("usr"),
      role: "user",
      source: live.status === "live" ? "live" : "text",
      timestamp: formatNow(),
      text: message,
    };
    setEntries((prev) => [...prev, userEntry]);

    if (live.status === "live") {
      const sent = live.sendLiveTextMessage(message);
      if (sent) {
        game.setTransientMood(inferMoodFromText(message, "falando"));
        return;
      }
    }

    setIsSendingText(true);
    game.setTransientMood("falando");

    const replyId = makeId("ast");
    const history: RecentTurn[] = entries
      .filter((e) => e.role === "user" || e.role === "assistant")
      .slice(-14)
      .map((e) => ({
        role: e.role as "user" | "assistant",
        content: e.text,
      }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          ledger: game.ledger,
          stream: true,
          accessCode,
        }),
      });

      if (res.status === 401) {
        setShowAccessModal(true);
        appendSystemEvent("Senha de gabinete necessária.");
        return;
      }

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        appendSystemEvent(
          errData.error || "Não foi possível falar com o gabinete agora."
        );
        return;
      }

      let fullReply = "";
      const contentType = res.headers.get("Content-Type") || "";

      if (contentType.includes("text/event-stream") && res.body) {
        // Insert live streaming bubble
        setEntries((prev) => [
          ...prev,
          {
            id: replyId,
            role: "assistant",
            source: "text",
            timestamp: formatNow(),
            mood: "falando",
            text: "",
          },
        ]);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const blocks = buffer.split("\n\n");
          buffer = blocks.pop() ?? "";

          for (const block of blocks) {
            let eventName = "message";
            let dataLine = "";
            for (const line of block.split("\n")) {
              if (line.startsWith("event:")) {
                eventName = line.slice(6).trim();
              } else if (line.startsWith("data:")) {
                dataLine += line.slice(5).trim();
              }
            }
            if (!dataLine) continue;
            try {
              const payload = JSON.parse(dataLine) as {
                delta?: string;
                reply?: string;
              };
              if (eventName === "delta" && payload.delta) {
                fullReply += payload.delta;
                const liveText = fullReply;
                setEntries((prev) =>
                  prev.map((item) =>
                    item.id === replyId ? { ...item, text: liveText } : item
                  )
                );
              } else if (eventName === "done" && payload.reply) {
                fullReply = payload.reply;
                setEntries((prev) =>
                  prev.map((item) =>
                    item.id === replyId ? { ...item, text: fullReply } : item
                  )
                );
              }
            } catch {
              // ignore malformed SSE packet
            }
          }
        }
      } else {
        const data = (await res.json().catch(() => ({}))) as { reply?: string };
        fullReply = data.reply || "";
        if (fullReply) {
          setEntries((prev) => [
            ...prev,
            {
              id: replyId,
              role: "assistant",
              source: "text",
              timestamp: formatNow(),
              mood: inferMoodFromText(fullReply, "falando"),
              text: fullReply,
            },
          ]);
        }
      }

      if (fullReply.trim()) {
        const fallbackMood = inferMoodFromText(fullReply, "falando");
        game.setTransientMood(fallbackMood);

        // Run AI Director sidecar for mood, meters, Cabinet Actions, anti-repetition & interrupts
        const directorOutcome = await game.evaluateTurnWithDirector({
          userMessage: message,
          assistantReply: fullReply,
          accessCode,
          nowLabel: formatNow(),
          isLive: false,
          onSystemEvent: appendSystemEvent,
        });

        const finalMood = directorOutcome?.patch.mood || fallbackMood;
        setEntries((prev) =>
          prev.map((item) =>
            item.id === replyId ? { ...item, mood: finalMood } : item
          )
        );
      }
    } catch {
      appendSystemEvent("Falha de conexão com o gabinete.");
    } finally {
      setIsSendingText(false);
    }
  };

  const handleSelectScenario = (scenarioId: ScenarioId) => {
    if (live.status === "live" || live.status === "connecting") {
      live.disconnect();
    }
    game.resetForScenario(scenarioId);
    setEntries(createOpeningEntries(scenarioId));
  };

  const handleResetChat = () => {
    handleSelectScenario(game.ledger.scenarioId);
  };

  const handleVerifiedAccessCode = (code: string) => {
    setAccessCode(code);
    setShowAccessModal(false);
    try {
      window.sessionStorage.setItem("gabinete_vava_code", code);
    } catch {
      // ignore storage errors
    }
  };

  const activeScenario = SCENARIOS[game.ledger.scenarioId] ?? SCENARIOS.livre;

  // Allow "falando" portrait to show while text is streaming too (fixes Bug #2!)
  const effectiveStageMood =
    live.isSpeaking || isSendingText
      ? game.mood === "neutro"
        ? "falando"
        : game.mood
      : game.mood;

  return (
    <div className="app-shell">
      <BroadcastHeader
        status={live.status}
        isSpeaking={live.isSpeaking || isSendingText}
        isStandby={live.isStandby}
        scenarioId={game.ledger.scenarioId}
        sfxMuted={game.sfxMuted}
        canOpenSummary={game.ledger.turnCount > 0}
        onOpenScenarios={() => setShowScenarios(true)}
        onOpenSummary={game.openManualSummary}
        onToggleSfx={game.toggleSfxMute}
        onResetChat={handleResetChat}
      />

      <div className="cabinet-container">
        <CabinetMetersBar
          scenarioId={game.ledger.scenarioId}
          act={game.ledger.act}
          meters={game.ledger.meters}
          lastDeltas={game.lastDeltas}
        />

        <main className="cabinet-layout">
          <AvatarStage
            mood={effectiveStageMood}
            status={live.status}
            isSpeaking={live.isSpeaking || isSendingText}
            isStandby={live.isStandby}
            isMuted={live.isMuted}
            isForceMuted={live.isForceMuted}
            isGavelShaking={game.isGavelShaking}
            micCutSecondsLeft={game.micCutSecondsLeft}
            voiceLevel={isSendingText && !live.isSpeaking ? 0.36 : live.outputLevel}
            inputLevel={live.inputLevel}
            remainingSeconds={live.remainingSeconds}
            error={live.error}
            activeInterrupt={game.activeInterrupt}
            documents={game.ledger.documents}
            onInspectDocument={(doc) => game.setActiveDocument(doc)}
            onStartLive={handleStartLive}
            onStopLive={() => live.disconnect("Chamada de voz encerrada.")}
            onToggleMute={live.toggleMute}
            onExtendSession={live.extendSession}
          />

          <TaquigrafiaPanel
            entries={entries}
            headlineTicker={game.ledger.headlineTicker}
            scenarioBadge={activeScenario.badge}
            suggestedMoves={game.ledger.suggestedMoves}
            isLive={live.status === "live"}
            isSendingText={isSendingText}
            micCutSecondsLeft={game.micCutSecondsLeft}
            onSendText={(msg) => void handleSendText(msg)}
            onToggleVoiceCall={handleToggleVoiceCall}
          />
        </main>
      </div>

      <ScenarioDrawer
        open={showScenarios}
        activeScenarioId={game.ledger.scenarioId}
        achievements={game.achievements}
        onSelectScenario={handleSelectScenario}
        onClose={() => setShowScenarios(false)}
      />

      <DocumentOverlay
        document={game.activeDocument}
        onClose={() => game.setActiveDocument(null)}
        onConfrontJabuti={(prompt) => void handleSendText(prompt)}
      />

      <SessionSummaryModal
        open={game.showSummary}
        ledger={game.ledger}
        onClose={() => game.setShowSummary(false)}
        onRestart={handleResetChat}
        onInspectDocument={(doc) => {
          game.setShowSummary(false);
          game.setActiveDocument(doc);
        }}
      />

      <AccessGateModal
        open={showAccessModal}
        onVerified={handleVerifiedAccessCode}
      />
    </div>
  );
}
