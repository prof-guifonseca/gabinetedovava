import { Award, CheckCircle2, ExternalLink, X } from "lucide-react";
import type { ScenarioId } from "../shared/gameState";
import { SCENARIO_LIST } from "../shared/scenarios";
import type { SavedAchievement } from "../hooks/useCabinetGame";
import { cabinetSfx } from "../audio/cabinetSfx";

interface ScenarioDrawerProps {
  open: boolean;
  activeScenarioId: ScenarioId;
  achievements: SavedAchievement[];
  onSelectScenario: (id: ScenarioId) => void;
  onClose: () => void;
}

export function ScenarioDrawer({
  open,
  activeScenarioId,
  achievements,
  onSelectScenario,
  onClose,
}: ScenarioDrawerProps) {
  if (!open) return null;

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Crachás e Missões do Gabinete"
      onClick={onClose}
    >
      <div
        className="modal-card modal-wide"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header-row is-sticky">
          <div>
            <p className="modal-kicker">PORTARIA DO ANEXO IV · CRACHÁ DE ENTRADA</p>
            <h3>Escolha seu Papel na Audiência</h3>
          </div>
          <button
            type="button"
            className="icon-close-btn"
            onClick={onClose}
            aria-label="Fechar"
          >
            <X size={18} />
          </button>
        </div>

        <p className="modal-desc">
          Cada crachá muda a abertura, a meta da audiência e a postura do Dr. Vavá — funciona tanto no chat escrito quanto na voz ao vivo.
        </p>

        <div className="scenario-grid">
          {SCENARIO_LIST.map((sc) => {
            const isActive = sc.id === activeScenarioId;
            return (
              <button
                key={sc.id}
                type="button"
                className={`scenario-card ${isActive ? "is-active" : ""}`}
                onClick={() => {
                  cabinetSfx.playPaperTap();
                  onSelectScenario(sc.id);
                  onClose();
                }}
              >
                <div className="scenario-card-top">
                  <span className="scenario-badge">{sc.badge}</span>
                  {isActive && (
                    <span className="scenario-active-tag">
                      <CheckCircle2 size={13} /> Em curso
                    </span>
                  )}
                </div>
                <strong className="scenario-title">{sc.title}</strong>
                <p className="scenario-tagline">{sc.tagline}</p>
                <span className="scenario-goal">{sc.objective}</span>
              </button>
            );
          })}
        </div>

        {achievements.length > 0 && (
          <div className="achievements-shelf">
            <div className="achievements-title">
              <Award size={14} />
              <span>Selos Conquistados no Gabinete ({achievements.length})</span>
            </div>
            <div className="achievements-chips">
              {achievements.slice(0, 6).map((ach) => (
                <span key={ach.id} className="achievement-chip">
                  {ach.stamp} · {ach.title}
                </span>
              ))}
            </div>
          </div>
        )}

        <div className="trinca-bar">
          <span className="trinca-label">TRINCA CAÓTICA DO ANEXO IV</span>
          <div className="trinca-links">
            <span className="trinca-pill is-current">
              Gab. 412 · Dr. Vavá (Você está aqui)
            </span>
            <a
              href="https://gabinetedobento.pages.dev"
              target="_blank"
              rel="noreferrer"
              className="trinca-pill"
            >
              Gab. 717 · Prof. Bento (Minoria) <ExternalLink size={11} />
            </a>
            <a
              href="https://gabinetedaclarice.pages.dev"
              target="_blank"
              rel="noreferrer"
              className="trinca-pill"
            >
              Gab. 222 · Dep. Clarice (Costumes) <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
