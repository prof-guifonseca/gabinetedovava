import { useEffect, useRef, useState, type FormEvent } from "react";
import { Mic, MicOff, Send } from "lucide-react";
import type { ChatEntry } from "../hooks/useGptLiveSession";

interface TaquigrafiaPanelProps {
  entries: ChatEntry[];
  isLive: boolean;
  isSendingText: boolean;
  onSendText: (message: string) => void;
  onToggleVoiceCall: () => void;
}

export function TaquigrafiaPanel({
  entries,
  isLive,
  isSendingText,
  onSendText,
  onToggleVoiceCall,
}: TaquigrafiaPanelProps) {
  const [draft, setDraft] = useState("");
  const feedRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (feedRef.current) {
      feedRef.current.scrollTop = feedRef.current.scrollHeight;
    }
  }, [entries, isSendingText]);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (!trimmed || isSendingText) return;
    setDraft("");
    onSendText(trimmed);
  };

  return (
    <section className="panel-card chat-card" aria-label="Conversa com o Vavá">
      <div className="chat-feed" ref={feedRef}>
        {entries.map((entry) => {
          if (entry.role === "system") {
            return (
              <div key={entry.id} className="msg-bubble is-system">
                {entry.text}
              </div>
            );
          }

          const isAssistant = entry.role === "assistant";

          return (
            <article
              key={entry.id}
              className={`msg-bubble ${isAssistant ? "is-assistant" : "is-user"}`}
            >
              <div className="msg-meta">
                <span>{isAssistant ? "Vavá" : "Você"}</span>
                <span className="msg-time">{entry.timestamp}</span>
              </div>
              <div className="msg-text">{entry.text}</div>
            </article>
          );
        })}

        {isSendingText && (
          <div className="msg-bubble is-system">Vavá está respondendo...</div>
        )}
      </div>

      <form className="chat-composer" onSubmit={handleSubmit}>
        <button
          type="button"
          className={`composer-mic-btn ${isLive ? "is-live" : ""}`}
          onClick={onToggleVoiceCall}
          title={isLive ? "Encerrar voz ao vivo" : "Falar por voz ao vivo"}
          aria-label={isLive ? "Encerrar voz ao vivo" : "Falar por voz ao vivo"}
        >
          {isLive ? <MicOff size={18} /> : <Mic size={18} />}
        </button>

        <input
          type="text"
          className="chat-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={
            isLive
              ? "Fale no microfone ou digite aqui..."
              : "Converse com o Vavá..."
          }
          maxLength={1200}
        />

        <button
          type="submit"
          className="btn-send"
          disabled={!draft.trim() || isSendingText}
          aria-label="Enviar mensagem"
        >
          <Send size={16} />
        </button>
      </form>
    </section>
  );
}
