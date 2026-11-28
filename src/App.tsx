import { useCallback, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
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
import type { CabinetDocument, ScenarioId } from "./shared/gameState";
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

function describeDocument(doc: CabinetDocument): string {
  if (doc.action.type === "carimbar_emenda") {
    return `Emenda carimbada (${doc.action.protocolo}): R$ ${doc.action.valorMilhoes}M — ${doc.action.destino}`;
  }
  if (doc.action.type === "nomear_dou") {
    return `Portaria no DOU (${doc.action.simbolo}): ${doc.action.nomeado} — ${doc.action.cargo}`;
  }
  return `Dossiê da Presidência: ${doc.action.titulo}`;
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

  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const chatAbortRef = useRef<AbortController | null>(null);
  const isSendingRef = useRef<boolean>(false);

  const lastDeltaMetaRef = useRef<{
    role: "user" | "assistant";
    itemKey?: string;
    at: number;
  } | null>(null);

  const clearAccessCode = useCallback(() => {
    setAccessCode("");
    accessCodeRef.current = "";
    try {
      window.sessionStorage.removeItem("gabinete_vava_code");
    } catch {
      // ignore storage errors
    }
    setShowAccessModal(true);
  }, []);

  // Fetch server health ONCE on mount
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

  // Abort any in-flight chat request on unmount
  useEffect(() => {
    return () => {
      chatAbortRef.current?.abort();
      chatAbortRef.current = null;
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

  const appendDocumentCard = useCallback((doc: CabinetDocument) => {
    setEntries((prev) => [
      ...prev,
      {
        id: makeId("doc"),
        role: "system",
        source: "text",
        timestamp: formatNow(),
        text: describeDocument(doc),
        document: doc,
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
          if (res.newDocument) {
            appendDocumentCard(res.newDocument);
          }
        });
    },
    [appendDocumentCard, appendSystemEvent, game]
  );

  const live = useGptLiveSession({
    onTranscriptDelta: appendTranscriptDelta,
    onSystemEvent: appendSystemEvent,
    onMoodHint: (hint) => game.setTransientMood(hint),
    onLiveTurnComplete: handleLiveTurnComplete,
    onUnauthorized: clearAccessCode,
  });
  liveRef.current = live;

  const handleStartLive = () => {
    if (requiresAccessCode && !accessCodeRef.current) {
      setShowAccessModal(true);
      return;
    }
    const recentHistory: RecentTurn[] = entriesRef.current
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
      accessCode: accessCodeRef.current,
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
    if (game.micCutSecondsLeft > 0 || isSendingRef.current) return;

    if (requiresAccessCode && !accessCodeRef.current) {
      setShowAccessModal(true);
      return;
    }

    const trimmedMsg = message.trim();
    if (!trimmedMsg) return;

    const userEntry: ChatEntry = {
      id: makeId("usr"),
      role: "user",
      source: live.status === "live" ? "live" : "text",
      timestamp: formatNow(),
      text: trimmedMsg,
    };

    const history: RecentTurn[] = entriesRef.current
      .filter((e) => e.role === "user" || e.role === "assistant")
      .slice(-14)
      .map((e) => ({
        role: e.role as "user" | "assistant",
        content: e.text,
      }));

    setEntries((prev) => [...prev, userEntry]);

    if (live.status === "live") {
      const sent = live.sendLiveTextMessage(trimmedMsg);
      if (sent) {
        game.setTransientMood(inferMoodFromText(trimmedMsg, "falando"));
        return;
      }
    }

    isSendingRef.current = true;
    setIsSendingText(true);
    game.setTransientMood("falando");

    chatAbortRef.current?.abort();
    const controller = new AbortController();
    chatAbortRef.current = controller;

    const replyId = makeId("ast");
    let streamBubbleAdded = false;
    let fullReply = "";
    let sseErrorMsg: string | null = null;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: trimmedMsg,
          history,
          ledger: game.ledger,
          stream: true,
          accessCode: accessCodeRef.current,
        }),
        signal: controller.signal,
      });

      if (controller.signal.aborted) return;

      if (res.status === 401) {
        setEntries((prev) => prev.filter((item) => item.id !== userEntry.id));
        clearAccessCode();
        appendSystemEvent("Senha de gabinete inválida ou expirada.");
        return;
      }

      if (!res.ok) {
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        appendSystemEvent(
          errData.error || "Não foi possível falar com o gabinete agora."
        );
        return;
      }

      const contentType = res.headers.get("Content-Type") || "";

      const processSseBlock = (block: string) => {
        let eventName = "message";
        const dataLines: string[] = [];
        for (const line of block.split("\n")) {
          if (line.startsWith("event:")) {
            eventName = line.slice(6).trim();
          } else if (line.startsWith("data:")) {
            dataLines.push(line.slice(5).trim());
          }
        }
        const dataLine = dataLines.join("\n");
        if (!dataLine) return;
        try {
          const payload = JSON.parse(dataLine) as {
            delta?: string;
            reply?: string;
            error?: string;
          };
          if (eventName === "error") {
            sseErrorMsg =
              payload.error || "Oscilação na linha do gabinete. Tente novamente.";
          } else if (eventName === "delta" && payload.delta) {
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
      };

      if (contentType.includes("text/event-stream") && res.body) {
        streamBubbleAdded = true;
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

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer = (buffer + decoder.decode(value, { stream: true }))
              .replace(/\r\n/g, "\n")
              .replace(/\r/g, "\n");

            const blocks = buffer.split("\n\n");
            buffer = blocks.pop() ?? "";
            for (const block of blocks) {
              if (block.trim()) processSseBlock(block);
            }
          }

          buffer = (buffer + decoder.decode())
            .replace(/\r\n/g, "\n")
            .replace(/\r/g, "\n");
          if (buffer.trim()) {
            for (const block of buffer.split("\n\n")) {
              if (block.trim()) processSseBlock(block);
            }
          }
        } finally {
          try {
            reader.releaseLock();
          } catch {
            // ignore
          }
        }

        if (!fullReply.trim()) {
          setEntries((prev) => prev.filter((item) => item.id !== replyId));
        }
        if (sseErrorMsg) {
          appendSystemEvent(sseErrorMsg);
        }
      } else {
        const data = (await res.json().catch(() => ({}))) as { reply?: string };
        if (controller.signal.aborted) return;
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

      if (controller.signal.aborted) return;

      // Unlock chat immediately after reply finishes — run AI Director asynchronously in background
      isSendingRef.current = false;
      setIsSendingText(false);

      if (fullReply.trim() && !sseErrorMsg) {
        const fallbackMood = inferMoodFromText(fullReply, "falando");
        game.setTransientMood(fallbackMood);

        void game
          .evaluateTurnWithDirector({
            userMessage: trimmedMsg,
            assistantReply: fullReply,
            accessCode: accessCodeRef.current,
            nowLabel: formatNow(),
            isLive: false,
            onSystemEvent: appendSystemEvent,
          })
          .then((directorOutcome) => {
            if (!directorOutcome) return;
            const finalMood = directorOutcome.patch.mood || fallbackMood;
            setEntries((prev) =>
              prev.map((item) =>
                item.id === replyId ? { ...item, mood: finalMood } : item
              )
            );
            if (directorOutcome.newDocument) {
              appendDocumentCard(directorOutcome.newDocument);
            }
          });
      }
    } catch (err) {
      if (streamBubbleAdded && !fullReply.trim()) {
        setEntries((prev) => prev.filter((item) => item.id !== replyId));
      }
      if (
        !controller.signal.aborted &&
        !(err instanceof DOMException && err.name === "AbortError")
      ) {
        appendSystemEvent("Falha de conexão com o gabinete.");
      }
    } finally {
      if (chatAbortRef.current === controller) {
        chatAbortRef.current = null;
      }
      isSendingRef.current = false;
      setIsSendingText(false);
    }
  };

  const handleSelectScenario = (scenarioId: ScenarioId) => {
    chatAbortRef.current?.abort();
    chatAbortRef.current = null;
    isSendingRef.current = false;
    setIsSendingText(false);

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
    accessCodeRef.current = code;
    setShowAccessModal(false);
    try {
      window.sessionStorage.setItem("gabinete_vava_code", code);
    } catch {
      // ignore storage errors
    }
  };

  const activeScenario = SCENARIOS[game.ledger.scenarioId] ?? SCENARIOS.livre;

  // Allow "falando" portrait to show while text is streaming too
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

      {/* Alerta de Interrupção de Bastidor fora do .avatar-stage para não ser cortado por transform/overflow no mobile */}
      {game.activeInterrupt && (
        <div className="interrupt-ribbon" role="status" aria-live="polite">
          <Radio size={14} aria-hidden="true" />
          <div>
            <strong>{game.activeInterrupt.badge}</strong>
            <span>{game.activeInterrupt.headline}</span>
          </div>
        </div>
      )}

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
            liveStatus={live.status}
            isSendingText={isSendingText}
            micCutSecondsLeft={game.micCutSecondsLeft}
            onSendText={(msg) => void handleSendText(msg)}
            onToggleVoiceCall={handleToggleVoiceCall}
            onInspectDocument={(doc) => game.setActiveDocument(doc)}
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
