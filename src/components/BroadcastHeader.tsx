import { Landmark, RotateCcw } from "lucide-react";
import type { LiveConnectionState } from "../hooks/useGptLiveSession";

interface BroadcastHeaderProps {
  status: LiveConnectionState;
  isSpeaking: boolean;
  onResetChat: () => void;
}

export function BroadcastHeader({
  status,
  isSpeaking,
  onResetChat,
}: BroadcastHeaderProps) {
  const statusLabel =
    status === "live"
      ? isSpeaking
        ? "Falando ao vivo"
        : "Voz ao vivo"
      : status === "connecting"
      ? "Conectando..."
      : "No gabinete";

  return (
    <header className="cabinet-header">
      <div className="brand-group">
        <div className="brand-emblem" aria-hidden="true">
          <Landmark size={18} />
        </div>
        <div className="brand-text">
          <h1 className="brand-title">Gabinete do Vavá</h1>
          <p className="brand-sub">Dep. Dr. Valdemar &ldquo;Vavá&rdquo; Braga</p>
        </div>
      </div>

      <div className="header-actions">
        <span
          className={`status-pill ${
            status === "live"
              ? "is-live"
              : status === "connecting"
              ? "is-connecting"
              : ""
          }`}
        >
          <span className="status-dot" />
          {statusLabel}
        </span>

        <button
          type="button"
          className="header-btn"
          onClick={onResetChat}
          title="Recomeçar conversa"
          aria-label="Recomeçar conversa"
        >
          <RotateCcw size={15} />
        </button>
      </div>
    </header>
  );
}
