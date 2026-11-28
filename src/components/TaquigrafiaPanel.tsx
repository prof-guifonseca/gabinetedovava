import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, FileText, Mic, MicOff, Send, Share2 } from "lucide-react";
import type { ChatEntry, LiveConnectionState } from "../hooks/useGptLiveSession";
import type { AvatarMood, CabinetDocument, SuggestedMove } from "../shared/gameState";
import { ActionDeck } from "./ActionDeck";
import {
  generateQuoteCard,
  shareImageNativeOrCopy,
} from "../utils/shareCardGenerator";

interface TaquigrafiaPanelProps {
  entries: ChatEntry[];
  headlineTicker: string;
  scenarioBadge: string;
  suggestedMoves: SuggestedMove[];
  liveStatus: LiveConnectionState;
  isSendingText: boolean;
  micCutSecondsLeft: number;
  onSendText: (message: string) => void;
  onToggleVoiceCall: () => void;
  onInspectDocument: (doc: CabinetDocument) => void;
}

function getDocumentCardMeta(doc: CabinetDocument): {
  tag: string;
  title: string;
  subtitle: string;
} {
  if (doc.action.type === "carimbar_emenda") {
    return {
      tag: `EMENDA CARIMBADA · ${doc.action.protocolo}`,
      title: `R$ ${doc.action.valorMilhoes}M — ${doc.action.destino}`,
      subtitle: `Jabuti oculto: ${doc.action.jabutiOculto.slice(0, 95)}`,
    };
  }
  if (doc.action.type === "nomear_dou") {
    return {
      tag: `DIÁRIO OFICIAL · ${doc.action.simbolo}`,
      title: `${doc.action.nomeado} — ${doc.action.cargo}`,
      subtitle: `Salário: ${doc.action.salarioMensal} · ${doc.action.justificativa.slice(0, 80)}`,
    };
  }
  return {
    tag: "GAVETA DA PRESIDÊNCIA · CONFIDENCIAL",
    title: doc.action.titulo,
    subtitle: doc.action.resumo.slice(0, 95),
  };
}

export function TaquigrafiaPanel({
  entries,
  headlineTicker,
  scenarioBadge,
  suggestedMoves,
  liveStatus,
  isSendingText,
  micCutSecondsLeft,
  onSendText,
  onToggleVoiceCall,
  onInspectDocument,
}: TaquigrafiaPanelProps) {
  const [draft, setDraft] = useState("");
  const [sharingId, setSharingId] = useState<string | null>(null);
  const [copiedMeta, setCopiedMeta] = useState<{ id: string; label: string } | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const feedRef = useRef<HTMLDivElement | null>(null);
  const isPinnedToBottomRef = useRef<boolean>(true);
  const toastTimerRef = useRef<number | null>(null);
  const copiedTimerRef = useRef<number | null>(null);

  const isLive = liveStatus === "live";
  const isConnectingLive = liveStatus === "connecting";
  const isInputBlocked = isSendingText || micCutSecondsLeft > 0;

  // Hide typing indicator as soon as SSE reply text starts streaming into the last assistant bubble
  const lastEntry = entries[entries.length - 1];
  const hasStreamingReplyText =
    isSendingText &&
    lastEntry?.role === "assistant" &&
    lastEntry.text.trim().length > 0;
  const showTypingIndicator = isSendingText && !hasStreamingReplyText;

  const handleFeedScroll = () => {
    const feed = feedRef.current;
    if (!feed) return;
    const distanceFromBottom =
      feed.scrollHeight - feed.scrollTop - feed.clientHeight;
    isPinnedToBottomRef.current = distanceFromBottom < 100;
  };

  // Respect user scrolling up: only auto-scroll when pinned near the bottom
  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || !isPinnedToBottomRef.current) return;

    const scrollToBottom = () => {
      if (isPinnedToBottomRef.current) {
        feed.scrollTop = feed.scrollHeight;
      }
    };

    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      scrollToBottom();
      raf2 = requestAnimationFrame(scrollToBottom);
    });
    const timer = window.setTimeout(scrollToBottom, 80);

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
      window.clearTimeout(timer);
    };
  }, [entries, isSendingText]);

  useEffect(() => {
    const feed = feedRef.current;
    if (!feed || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (isPinnedToBottomRef.current) {
        feed.scrollTop = feed.scrollHeight;
      }
    });
    ro.observe(feed);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    return () => {
      if (toastTimerRef.current !== null) {
        window.clearTimeout(toastTimerRef.current);
      }
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
    };
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isInputBlocked) return;
    isPinnedToBottomRef.current = true;
    setDraft("");
    onSendText(trimmed);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    if (toastTimerRef.current !== null) {
      window.clearTimeout(toastTimerRef.current);
    }
    toastTimerRef.current = window.setTimeout(() => {
      toastTimerRef.current = null;
      setToastMsg((curr) => (curr === msg ? null : curr));
    }, 2600);
  };

  const handleShareQuote = async (entry: ChatEntry) => {
    if (sharingId) return;
    setSharingId(entry.id);
    try {
      const blob = await generateQuoteCard({
        quote: entry.text,
        mood: (entry.mood as AvatarMood) || "falando",
        badge: scenarioBadge,
      });
      const result = await shareImageNativeOrCopy(
        blob,
        `aspas-vava-${entry.id}.png`,
        "Aspas da TV Câmara — Gabinete do Vavá",
        `"${entry.text}" — Dep. Dr. Vavá Braga (https://gabinetedovava.pages.dev)`
      );
      if (result === "cancelled") {
        return;
      }
      const label =
        result === "shared"
          ? "Enviado!"
          : result === "copied"
          ? "Copiado!"
          : "PNG salvo!";
      setCopiedMeta({ id: entry.id, label });
      showToast(
        result === "shared"
          ? "Card compartilhado!"
          : result === "copied"
          ? "Card PNG copiado! Cole no WhatsApp."
          : "Card PNG salvo no seu dispositivo!"
      );
      if (copiedTimerRef.current !== null) {
        window.clearTimeout(copiedTimerRef.current);
      }
      copiedTimerRef.current = window.setTimeout(() => {
        copiedTimerRef.current = null;
        setCopiedMeta((curr) => (curr?.id === entry.id ? null : curr));
      }, 2600);
    } catch {
      showToast("Não foi possível gerar o card agora.");
    } finally {
      setSharingId(null);
    }
  };

  return (
    <section className="panel-card chat-card" aria-label="Taquigrafia do Gabinete">
      <div className="tv-ticker-bar" aria-live="polite" title={headlineTicker}>
        <span className="tv-ticker-tag">TV CÂMARA</span>
        <span className="tv-ticker-text">{headlineTicker}</span>
      </div>

      {toastMsg && (
        <div className="chat-toast" role="status">
          {toastMsg}
        </div>
      )}

      <div className="chat-feed" ref={feedRef} onScroll={handleFeedScroll}>
        {entries.map((entry) => {
          if (entry.document) {
            const doc = entry.document;
            const meta = getDocumentCardMeta(doc);
            return (
              <button
                key={entry.id}
                type="button"
                className="inline-doc-card"
                onClick={() => onInspectDocument(doc)}
              >
                <div className="inline-doc-top">
                  <span className="inline-doc-tag">
                    <FileText size={12} /> {meta.tag}
                  </span>
                  <span className="inline-doc-cta">Abrir &amp; PNG →</span>
                </div>
                <strong className="inline-doc-title">{meta.title}</strong>
                <span className="inline-doc-sub">{meta.subtitle}</span>
              </button>
            );
          }

          if (entry.role === "system") {
            return (
              <div key={entry.id} className="msg-bubble is-system">
                {entry.text}
              </div>
            );
          }

          // Don't render placeholder streaming bubble until the first token arrives
          if (entry.role === "assistant" && !entry.text.trim()) {
            return null;
          }

          const isAssistant = entry.role === "assistant";
          const canShare = isAssistant && entry.text.trim().length >= 24;
          const isBusy = sharingId === entry.id;
          const isDone = copiedMeta?.id === entry.id;

          return (
            <article
              key={entry.id}
              className={`msg-bubble ${isAssistant ? "is-assistant" : "is-user"}`}
            >
              <div className="msg-meta">
                <span>{isAssistant ? "Dep. Vavá" : "Você"}</span>
                <div className="msg-meta-right">
                  {canShare && (
                    <button
                      type="button"
                      className={`quote-share-btn ${isDone ? "is-done" : ""}`}
                      disabled={isBusy}
                      onClick={() => void handleShareQuote(entry)}
                      title="Gerar card PNG 'Aspas da TV Câmara' para WhatsApp"
                    >
                      {isBusy ? (
                        "Gerando..."
                      ) : isDone ? (
                        <>
                          <Check size={11} /> {copiedMeta.label}
                        </>
                      ) : (
                        <>
                          <Share2 size={11} /> Aspas
                        </>
                      )}
                    </button>
                  )}
                  <span className="msg-time">{entry.timestamp}</span>
                </div>
              </div>
              <div className="msg-text">{entry.text}</div>
            </article>
          );
        })}

        {showTypingIndicator && (
          <div className="msg-bubble is-system is-typing">
            Dr. Vavá está ajeitando a gravata pra responder...
          </div>
        )}
      </div>

      <ActionDeck
        moves={suggestedMoves}
        disabled={isInputBlocked}
        onPickMove={(prompt) => {
          if (!isInputBlocked) {
            isPinnedToBottomRef.current = true;
            onSendText(prompt);
          }
        }}
      />

      <form className="chat-composer" onSubmit={handleSubmit}>
        <button
          type="button"
          className={`composer-mic-btn ${
            isLive ? "is-live" : isConnectingLive ? "is-connecting" : ""
          }`}
          disabled={isConnectingLive}
          aria-busy={isConnectingLive}
          onClick={onToggleVoiceCall}
          title={
            isConnectingLive
              ? "Conectando chamada de voz..."
              : isLive
              ? "Encerrar voz ao vivo"
              : "Falar por voz ao vivo"
          }
          aria-label={
            isConnectingLive
              ? "Conectando chamada de voz"
              : isLive
              ? "Encerrar voz ao vivo"
              : "Falar por voz ao vivo"
          }
        >
          {isLive ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        <input
          type="text"
          className="chat-input"
          aria-label="Mensagem para o Dr. Vavá"
          value={draft}
          disabled={micCutSecondsLeft > 0}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            micCutSecondsLeft > 0
              ? `Áudio cortado pela taquigrafia (${micCutSecondsLeft}s)...`
              : isConnectingLive
              ? "Conectando microfone ao vivo..."
              : isLive
              ? "Fale ou digite aqui..."
              : "Fale com o Dr. Vavá..."
          }
          maxLength={1200}
        />

        <button
          type="submit"
          className="btn-send"
          disabled={!draft.trim() || isInputBlocked}
          aria-label="Enviar mensagem"
        >
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}
