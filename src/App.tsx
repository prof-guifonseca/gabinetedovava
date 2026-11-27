import { useCallback, useEffect, useRef, useState } from "react";
import { BroadcastHeader } from "./components/BroadcastHeader";
import { AvatarStage } from "./components/AvatarStage";
import { TaquigrafiaPanel } from "./components/TaquigrafiaPanel";
import { AccessGateModal } from "./components/AccessGateModal";
import {
  formatNow,
  makeId,
  useGptLiveSession,
  type ChatEntry,
} from "./hooks/useGptLiveSession";
import {
  DEFAULT_LIVE_VOICE,
  VAVA_GREETING,
  inferMoodFromText,
  type AvatarMood,
  type RecentTurn,
} from "./shared/persona";

function createInitialEntries(): ChatEntry[] {
  return [
    {
      id: makeId("greeting"),
      role: "assistant",
      source: "text",
      timestamp: formatNow(),
      text: VAVA_GREETING,
    },
  ];
}

export default function App() {
  const [mood, setMood] = useState<AvatarMood>("neutro");
  const [voice, setVoice] = useState(DEFAULT_LIVE_VOICE);
  const [isSendingText, setIsSendingText] = useState(false);
  const [entries, setEntries] = useState<ChatEntry[]>(createInitialEntries);

  const [requiresAccessCode, setRequiresAccessCode] = useState(false);
  const [accessCode, setAccessCode] = useState<string>(() => {
    try {
      return window.sessionStorage.getItem("gabinete_vava_code") || "";
    } catch {
      return "";
    }
  });
  const [showAccessModal, setShowAccessModal] = useState(false);

  const lastDeltaMetaRef = useRef<{ role: "user" | "assistant"; at: number } | null>(
    null
  );

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
          if (!accessCode) setShowAccessModal(true);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [accessCode]);

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
    (role: "user" | "assistant", delta: string) => {
      const now = Date.now();
      const last = lastDeltaMetaRef.current;
      const shouldMerge = Boolean(
        last && last.role === role && now - last.at < 3500
      );
      lastDeltaMetaRef.current = { role, at: now };

      setEntries((prev) => {
        if (shouldMerge && prev.length > 0) {
          const tail = prev[prev.length - 1];
          if (tail.role === role && tail.source === "live") {
            const updated = [...prev];
            updated[updated.length - 1] = {
              ...tail,
              text: `${tail.text}${delta}`,
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
            text: delta,
          },
        ];
      });
    },
    []
  );

  const live = useGptLiveSession({
    onTranscriptDelta: appendTranscriptDelta,
    onSystemEvent: appendSystemEvent,
    onMoodHint: (hint) => setMood(hint),
    onUnauthorized: () => setShowAccessModal(true),
  });

  const handleStartLive = () => {
    if (requiresAccessCode && !accessCode) {
      setShowAccessModal(true);
      return;
    }
    const recentHistory: RecentTurn[] = entries
      .filter((e) => e.role === "user" || e.role === "assistant")
      .slice(-6)
      .map((e) => ({
        role: e.role as "user" | "assistant",
        content: e.text,
      }));
    void live.connect({ voice, history: recentHistory, accessCode });
  };

  const handleToggleVoiceCall = () => {
    if (live.status === "live" || live.status === "connecting") {
      live.disconnect("Chamada de voz encerrada.");
    } else {
      handleStartLive();
    }
  };

  const handleSendText = async (message: string) => {
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
        setMood(inferMoodFromText(message, "falando"));
        return;
      }
    }

    setIsSendingText(true);
    try {
      const history: RecentTurn[] = entries
        .filter((e) => e.role === "user" || e.role === "assistant")
        .slice(-14)
        .map((e) => ({
          role: e.role as "user" | "assistant",
          content: e.text,
        }));

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message,
          history,
          accessCode,
        }),
      });

      if (res.status === 401) {
        setShowAccessModal(true);
        appendSystemEvent("Senha de gabinete necessária.");
        return;
      }

      const data = (await res.json().catch(() => ({}))) as {
        reply?: string;
        error?: string;
      };

      if (!res.ok || !data.reply) {
        appendSystemEvent(
          data.error || "Não foi possível falar com o gabinete agora."
        );
        return;
      }

      const replyId = makeId("ast");
      const nextMood = inferMoodFromText(data.reply, "falando");
      setMood(nextMood);

      setEntries((prev) => [
        ...prev,
        {
          id: replyId,
          role: "assistant",
          source: "text",
          timestamp: formatNow(),
          text: data.reply!,
        },
      ]);
    } catch {
      appendSystemEvent("Falha de conexão com o gabinete.");
    } finally {
      setIsSendingText(false);
    }
  };

  const handleResetChat = () => {
    if (live.status === "live" || live.status === "connecting") {
      live.disconnect();
    }
    setMood("neutro");
    setEntries(createInitialEntries());
  };

  const handleSaveAccessCode = (code: string) => {
    setAccessCode(code);
    setShowAccessModal(false);
    try {
      window.sessionStorage.setItem("gabinete_vava_code", code);
    } catch {
      // ignore storage errors
    }
  };

  return (
    <div className="app-shell">
      <BroadcastHeader
        status={live.status}
        isSpeaking={live.isSpeaking}
        onResetChat={handleResetChat}
      />

      <main className="cabinet-layout">
        <AvatarStage
          mood={live.isSpeaking ? mood : mood === "falando" ? "neutro" : mood}
          status={live.status}
          isSpeaking={live.isSpeaking}
          isMuted={live.isMuted}
          voiceLevel={live.outputLevel}
          inputLevel={live.inputLevel}
          remainingSeconds={live.remainingSeconds}
          error={live.error}
          onStartLive={handleStartLive}
          onStopLive={() => live.disconnect("Chamada de voz encerrada.")}
          onToggleMute={live.toggleMute}
          onExtendSession={live.extendSession}
        />

        <TaquigrafiaPanel
          entries={entries}
          isLive={live.status === "live"}
          isSendingText={isSendingText}
          onSendText={(msg) => void handleSendText(msg)}
          onToggleVoiceCall={handleToggleVoiceCall}
        />
      </main>

      <AccessGateModal open={showAccessModal} onSubmit={handleSaveAccessCode} />
    </div>
  );
}
