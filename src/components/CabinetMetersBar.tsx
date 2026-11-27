import { useState } from "react";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Coins,
  Flame,
  Handshake,
  ShieldAlert,
} from "lucide-react";
import type { CabinetMeters, DramaticAct, ScenarioId } from "../shared/gameState";
import { SCENARIOS } from "../shared/scenarios";

interface CabinetMetersBarProps {
  scenarioId: ScenarioId;
  act: DramaticAct;
  meters: CabinetMeters;
  lastDeltas: Partial<CabinetMeters> | null;
}

const ACT_LABELS: Record<DramaticAct, string> = {
  1: "ATO I · CAFEZINHO",
  2: "ATO II · BALCÃO QUENTE",
  3: "ATO III · 03H DA MANHÃ",
};

const ACT_SHORT: Record<DramaticAct, string> = {
  1: "ATO I",
  2: "ATO II",
  3: "ATO III",
};

function formatDelta(value: number | undefined, suffix = ""): string | null {
  if (!value) return null;
  return `${value > 0 ? "+" : ""}${value}${suffix}`;
}

export function CabinetMetersBar({
  scenarioId,
  act,
  meters,
  lastDeltas,
}: CabinetMetersBarProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const scenario = SCENARIOS[scenarioId] ?? SCENARIOS.livre;
  const cpiDanger = meters.riscoCpi >= 70;
  const lowPatience = meters.paciencia <= 30;

  const deltaApoio = formatDelta(lastDeltas?.apoioBase, "%");
  const deltaCpi = formatDelta(lastDeltas?.riscoCpi, "%");
  const deltaVerba = formatDelta(lastDeltas?.verbaMilhoes, "M");
  const deltaPaciencia = formatDelta(lastDeltas?.paciencia, "%");

  return (
    <section
      className={`meters-strip ${mobileExpanded ? "is-mobile-expanded" : ""}`}
      aria-label="Painel Eletrônico do Gabinete"
    >
      {/* Mobile ultra-compact single-line summary bar */}
      <div className="mobile-meters-compact">
        <span className={`act-chip is-act-${act}`}>{ACT_SHORT[act]}</span>
        <div className="mobile-meters-inline">
          <span className="mini-stat is-emerald" title="Apoio da Base">
            <Handshake size={11} /> {meters.apoioBase}%
          </span>
          <span className="mini-stat is-danger" title="Risco de CPI">
            <ShieldAlert size={11} /> {meters.riscoCpi}%
          </span>
          <span className="mini-stat is-gold" title="Emendas Carimbadas">
            <Coins size={11} /> R${meters.verbaMilhoes}M
          </span>
          <span className={`mini-stat ${lowPatience ? "is-danger" : "is-warm"}`} title="Paciência">
            <Flame size={11} /> {meters.paciencia}%
          </span>
        </div>
        <button
          type="button"
          className="mobile-meters-toggle"
          onClick={() => setMobileExpanded((v) => !v)}
          aria-expanded={mobileExpanded}
          aria-label={mobileExpanded ? "Recolher medidores" : "Expandir medidores e meta"}
        >
          {mobileExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </button>
      </div>

      {/* Full desktop bar (and expandable drawer on mobile) */}
      <div className="meters-full-body">
        <div className="meters-top-row">
          <span className={`act-chip is-act-${act}`}>{ACT_LABELS[act]}</span>
          <span className="mission-objective-line">
            <strong>{scenario.badge}:</strong> {scenario.objective}
          </span>
        </div>

        <div className="meters-grid">
          <div className="meter-cell">
            <div className="meter-label-row">
              <span className="meter-label">
                <Handshake size={13} />
                Base
              </span>
              <span className="meter-value is-emerald">
                {meters.apoioBase}%
                {deltaApoio && (
                  <em className={`delta-badge ${(lastDeltas?.apoioBase ?? 0) > 0 ? "is-pos" : "is-neg"}`}>
                    {deltaApoio}
                  </em>
                )}
              </span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill is-emerald"
                style={{ width: `${meters.apoioBase}%` }}
              />
            </div>
          </div>

          <div className={`meter-cell ${cpiDanger ? "is-alert" : ""}`}>
            <div className="meter-label-row">
              <span className="meter-label">
                <ShieldAlert size={13} />
                Risco CPI
              </span>
              <span className="meter-value is-danger">
                {meters.riscoCpi}%
                {deltaCpi && (
                  <em className={`delta-badge ${(lastDeltas?.riscoCpi ?? 0) > 0 ? "is-neg" : "is-pos"}`}>
                    {deltaCpi}
                  </em>
                )}
              </span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill is-danger"
                style={{ width: `${meters.riscoCpi}%` }}
              />
            </div>
          </div>

          <div className="meter-cell">
            <div className="meter-label-row">
              <span className="meter-label">
                <Coins size={13} />
                Emendas
              </span>
              <span className="meter-value is-gold">
                R$&nbsp;{meters.verbaMilhoes}M
                {deltaVerba && (
                  <em className="delta-badge is-gold">{deltaVerba}</em>
                )}
              </span>
            </div>
            <div className="meter-track">
              <div
                className="meter-fill is-gold"
                style={{ width: `${Math.min(100, Math.round((meters.verbaMilhoes / 20) * 100))}%` }}
              />
            </div>
          </div>

          <div className={`meter-cell ${lowPatience ? "is-alert" : ""}`}>
            <div className="meter-label-row">
              <span className="meter-label">
                {lowPatience ? <AlertTriangle size={13} /> : <Flame size={13} />}
                Paciência
              </span>
              <span className={`meter-value ${lowPatience ? "is-danger" : "is-warm"}`}>
                {meters.paciencia}%
                {deltaPaciencia && (
                  <em className={`delta-badge ${(lastDeltas?.paciencia ?? 0) > 0 ? "is-pos" : "is-neg"}`}>
                    {deltaPaciencia}
                  </em>
                )}
              </span>
            </div>
            <div className="meter-track">
              <div
                className={`meter-fill ${lowPatience ? "is-danger" : "is-warm"}`}
                style={{ width: `${meters.paciencia}%` }}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
