import type { CSSProperties } from "react";
import { Mic, MicOff, PhoneOff } from "lucide-react";
import type { AvatarMood } from "../shared/persona";
import type { LiveConnectionState } from "../hooks/useGptLiveSession";

interface AvatarStageProps {
  mood: AvatarMood;
  status: LiveConnectionState;
  isSpeaking: boolean;
  isMuted: boolean;
  voiceLevel: number;
  inputLevel: number;
  remainingSeconds: number;
  error: string | null;
  onStartLive: () => void;
  onStopLive: () => void;
  onToggleMute: () => void;
  onExtendSession: () => void;
}

const AVATAR_SOURCES: Record<AvatarMood, string> = {
  neutro: "/avatars/vava-neutro.jpg",
  falando: "/avatars/vava-falando.jpg",
  acordo: "/avatars/vava-acordo.jpg",
  crise: "/avatars/vava-crise.jpg",
};

function formatTimer(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function AvatarStage({
  mood,
  status,
  isSpeaking,
  isMuted,
  voiceLevel,
  inputLevel,
  remainingSeconds,
  error,
  onStartLive,
  onStopLive,
  onToggleMute,
  onExtendSession,
}: AvatarStageProps) {
  const activeMood: AvatarMood =
    isSpeaking && mood === "neutro" ? "falando" : mood;

  const eqHeights = [0.45, 0.85, 1, 0.72, 0.92, 0.55].map((weight, i) => {
    const base = isSpeaking ? 5 : 3;
    const dynamic = isSpeaking
      ? Math.round(voiceLevel * 24 * weight + (i % 2) * 3)
      : 0;
    return Math.min(26, base + dynamic);
  });

  const viewportStyle = {
    "--voice-level": isSpeaking ? voiceLevel.toFixed(3) : "0",
  } as CSSProperties;

  return (
    <aside className="panel-card avatar-stage" aria-label="Dep. Vavá Braga">
      <div
        className={`avatar-viewport ${isSpeaking ? "is-speaking" : ""}`}
        data-mood={activeMood}
        style={viewportStyle}
      >
        {(Object.keys(AVATAR_SOURCES) as AvatarMood[]).map((key) => (
          <img
            key={key}
            src={AVATAR_SOURCES[key]}
            alt='Dep. Dr. Valdemar "Vavá" Braga'
            className={`avatar-img ${activeMood === key ? "is-active" : ""}`}
          />
        ))}

        <div className="avatar-vignette" />
        <div className="avatar-halo" />

        <div className="avatar-caption">
          <div>
            <p className="avatar-name">Dr. Valdemar &ldquo;Vavá&rdquo; Braga</p>
            <p className="avatar-role">Presidente da Câmara</p>
          </div>
          <div className="eq-bars" aria-hidden="true">
            {eqHeights.map((h, idx) => (
              <span
                key={idx}
                className="eq-bar"
                style={{
                  height: `${h}px`,
                  background:
                    activeMood === "crise"
                      ? "var(--danger)"
                      : activeMood === "acordo"
                      ? "var(--gold)"
                      : "var(--emerald)",
                }}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="stage-controls">
        <div className="primary-cta-row">
          {status !== "live" ? (
            <button
              type="button"
              className="btn-voice"
              disabled={status === "connecting"}
              onClick={onStartLive}
            >
              <Mic size={18} />
              {status === "connecting"
                ? "Entrando no gabinete..."
                : "Falar com o Vavá"}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={`btn-secondary ${isMuted ? "is-muted" : ""}`}
                onClick={onToggleMute}
                aria-label={isMuted ? "Ativar microfone" : "Silenciar microfone"}
              >
                {isMuted ? <MicOff size={17} /> : <Mic size={17} />}
                {isMuted ? "Mutado" : "Mic"}
              </button>
              <button
                type="button"
                className="btn-voice is-danger"
                onClick={onStopLive}
              >
                <PhoneOff size={17} />
                Encerrar voz
              </button>
            </>
          )}
        </div>

        {status === "live" && (
          <div className="live-footer-meta">
            <div className="mic-meter-row">
              <span>{isMuted ? "MUDO" : "MIC"}</span>
              <div className="mic-meter-track">
                <div
                  className="mic-meter-fill"
                  style={{
                    width: `${isMuted ? 0 : Math.min(100, Math.round(inputLevel * 100))}%`,
                  }}
                />
              </div>
              <span className="timer-inline">{formatTimer(remainingSeconds)}</span>
              <button
                type="button"
                className="timer-extend"
                onClick={onExtendSession}
              >
                +3m
              </button>
            </div>
          </div>
        )}

        {error && <div className="error-banner">{error}</div>}
      </div>
    </aside>
  );
}
