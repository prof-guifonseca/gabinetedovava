import { ChevronDown, ChevronUp, Sparkles } from "lucide-react";
import { useState } from "react";
import type { SuggestedMove } from "../shared/gameState";

interface ActionDeckProps {
  moves: SuggestedMove[];
  disabled: boolean;
  onPickMove: (prompt: string) => void;
}

export function ActionDeck({ moves, disabled, onPickMove }: ActionDeckProps) {
  const [collapsed, setCollapsed] = useState(false);

  if (!moves || moves.length === 0) return null;

  return (
    <div className="action-deck">
      <div className="action-deck-header">
        <span className="action-deck-title">
          <Sparkles size={12} />
          Cartas na Manga
        </span>
        <button
          type="button"
          className="action-deck-toggle"
          onClick={() => setCollapsed((v) => !v)}
          aria-expanded={!collapsed}
        >
          {collapsed ? (
            <>
              Mostrar <ChevronUp size={13} />
            </>
          ) : (
            <>
              Ocultar <ChevronDown size={13} />
            </>
          )}
        </button>
      </div>

      {!collapsed && (
        <div className="action-deck-row">
          {moves.slice(0, 3).map((move) => (
            <button
              key={move.id}
              type="button"
              className={`tactic-chip is-${move.tone}`}
              disabled={disabled}
              onClick={() => onPickMove(move.prompt)}
              title={move.prompt}
            >
              {move.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
