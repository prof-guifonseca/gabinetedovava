import type { CSSProperties } from "react";
import { FileText, Mic, MicOff, PhoneOff, ShieldOff } from "lucide-react";
import type { AvatarMood, CabinetDocument } from "../shared/gameState";
import type { LiveConnectionState } from "../hooks/useGptLiveSession";

interface AvatarStageProps {
  mood: AvatarMood;
  status: LiveConnectionState;
  isSpeaking: boolean;
  isStandby: boolean;
  isMuted: boolean;
  isForceMuted: boolean;
  isGavelShaking: boolean;
  micCutSecondsLeft: number;
  voiceLevel: number;
  inputLevel: number;
  remainingSeconds: number;
  error: string | null;
  documents: CabinetDocument[];
  onInspectDocument: (doc: CabinetDocument) => void;
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
  sussurro: "/avatars/vava-sussurro.jpg",
  telefone: "/avatars/vava-telefone.jpg",
};

const MOOD_LABELS: Record<AvatarMood, string> = {
  neutro: "No gabinete",
  falando: "Com a palavra",
  acordo: "Clima de composição",
  crise: "Pela ordem!",
  sussurro: "Em off...",
  telefone: "Na linha · Bastidor",
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
  isStandby,
  isMuted,
  isForceMuted,
  isGavelShaking,
  micCutSecondsLeft,
  voiceLevel,
  inputLevel,
  remainingSeconds,
  error,
  documents,
  onInspectDocument,
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
    <aside
      className={`panel-card avatar-stage ${isGavelShaking ? "is-gavel-shaking" : ""}`}
      aria-label="Dep. Vavá Braga"
    >
      <div className="stage-shell">
        <div
          className={`avatar-viewport ${isSpeaking ? "is-speaking" : ""}`}
          data-mood={activeMood}
          style={viewportStyle}
        >
          {(Object.keys(AVATAR_SOURCES) as AvatarMood[]).map((key) => {
            const isActive = activeMood === key;
            return (
              <img
                key={key}
                src={AVATAR_SOURCES[key]}
                alt={isActive ? 'Dep. Dr. Valdemar "Vavá" Braga' : ""}
                aria-hidden={!isActive}
                fetchPriority={isActive ? "high" : "low"}
                decoding="async"
                className={`avatar-img ${isActive ? "is-active" : ""}`}
              />
            );
          })}

          <div className="avatar-vignette" />
          <div className="avatar-halo" />

          {/* GC / Tarja TV Câmara */}
          <div className="tv-camara-bug">
            <span className={`tv-dot ${status === "live" ? "is-live" : ""}`} />
            <span>
              {status === "live"
                ? isStandby
                  ? "EM ESPERA · GAB. 412"
                  : "AO VIVO · TV CÂMARA"
                : "GABINETE 412 · ANEXO IV"}
            </span>
            <span className="tv-mood-pill">{MOOD_LABELS[activeMood]}</span>
          </div>

          {/* Selo de Áudio Cortado pela Taquigrafia */}
          {micCutSecondsLeft > 0 && (
            <div className="mic-cut-overlay" role="alert">
              <ShieldOff size={22} />
              <strong>ÁUDIO CORTADO PELA TAQUIGRAFIA</strong>
              <span>Restabelecendo em {micCutSecondsLeft}s...</span>
            </div>
          )}

          <div className="avatar-caption">
            <div>
              <p className="avatar-name">Dr. Valdemar &ldquo;Vavá&rdquo; Braga</p>
              <p className="avatar-role">Presidente da Câmara · PMD/DF</p>
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
                        : activeMood === "acordo" || activeMood === "sussurro"
                        ? "var(--gold)"
                        : activeMood === "telefone"
                        ? "var(--amber)"
                        : "var(--emerald)",
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div className="stage-controls">
          <div className="mobile-stage-meta">
            <div className="mobile-stage-id">
              <strong>Dr. Vavá Braga</strong>
              <span>{MOOD_LABELS[activeMood]}</span>
            </div>
          </div>

          <div className="primary-cta-row">
            {status !== "live" ? (
              <button
                type="button"
                className="btn-voice"
                disabled={status === "connecting"}
                aria-busy={status === "connecting"}
                onClick={onStartLive}
              >
                <Mic size={16} />
                <span className="cta-desktop-label">
                  {status === "connecting"
                    ? "Entrando no gabinete..."
                    : "Falar ao vivo com o Vavá"}
                </span>
                <span className="cta-mobile-label">
                  {status === "connecting" ? "Conectando..." : "Voz ao vivo"}
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className={`btn-secondary ${isMuted ? "is-muted" : ""}`}
                  disabled={isForceMuted}
                  onClick={onToggleMute}
                  aria-pressed={isMuted}
                  aria-label={isMuted ? "Ativar microfone" : "Silenciar microfone"}
                >
                  {isMuted ? <MicOff size={16} /> : <Mic size={16} />}
                  {isForceMuted ? "Cortado" : isMuted ? "Mutado" : "Mic"}
                </button>
                <button
                  type="button"
                  className="btn-voice is-danger"
                  onClick={onStopLive}
                >
                  <PhoneOff size={16} />
                  Encerrar
                </button>
              </>
            )}
          </div>

          {status === "live" && (
            <div className="live-footer-meta">
              <div className="mic-meter-row">
                <span>{isForceMuted ? "CORTE" : isMuted ? "MUDO" : "MIC"}</span>
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
                  aria-label="Estender chamada em 3 minutos"
                >
                  +3m
                </button>
              </div>
            </div>
          )}

          {/* Pasta de Documentos Oficiais da Audiência */}
          {documents.length > 0 && (
            <div className="desk-folder">
              <span className="desk-folder-label">
                Pasta da Mesa ({documents.length})
              </span>
              <div className="desk-folder-list">
                {documents.map((doc) => (
                  <button
                    key={doc.id}
                    type="button"
                    className="doc-pill-btn"
                    onClick={() => onInspectDocument(doc)}
                  >
                    <FileText size={13} />
                    {doc.action.type === "carimbar_emenda"
                      ? `Emenda R$ ${doc.action.valorMilhoes}M`
                      : doc.action.type === "nomear_dou"
                      ? `DOU · ${doc.action.simbolo}`
                      : "Dossiê"}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div className="error-banner" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
