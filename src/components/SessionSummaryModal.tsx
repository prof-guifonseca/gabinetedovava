import { useState } from "react";
import { Copy, Download, ExternalLink, FileText, RotateCcw, X } from "lucide-react";
import {
  classifyVisitorArchetype,
  type CabinetDocument,
  type SessionLedger,
} from "../shared/gameState";
import { SCENARIOS } from "../shared/scenarios";
import {
  downloadBlob,
  generateDossierCard,
  shareImageNativeOrCopy,
} from "../utils/shareCardGenerator";

interface SessionSummaryModalProps {
  open: boolean;
  ledger: SessionLedger;
  onClose: () => void;
  onRestart: () => void;
  onInspectDocument: (doc: CabinetDocument) => void;
}

export function SessionSummaryModal({
  open,
  ledger,
  onClose,
  onRestart,
  onInspectDocument,
}: SessionSummaryModalProps) {
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const arch = classifyVisitorArchetype(ledger);
  const scenario = SCENARIOS[ledger.scenarioId] ?? SCENARIOS.livre;
  const modalHeadline =
    ledger.endedTitle && ledger.endedTitle !== arch.title
      ? ledger.endedTitle
      : "Resumo da Audiência";

  const handleShare = async (mode: "copy" | "download") => {
    setBusy(true);
    try {
      const blob = await generateDossierCard(ledger);
      const filename = `ata-gabinete-vava-${ledger.scenarioId}.png`;
      if (mode === "download") {
        downloadBlob(blob, filename);
        setStatusMsg("Ata PNG salva!");
      } else {
        const res = await shareImageNativeOrCopy(
          blob,
          filename,
          `Ata do Gabinete do Vavá — ${arch.title}`,
          `Saí do Gabinete 412 como "${arch.title}"! Testa lá: https://gabinetedovava.pages.dev`
        );
        setStatusMsg(
          res === "shared"
            ? "Ata compartilhada!"
            : res === "copied"
            ? "Card copiado! Cole no WhatsApp."
            : "Ata PNG salva!"
        );
      }
      window.setTimeout(() => setStatusMsg(null), 2600);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Ata Final da Audiência"
      onClick={onClose}
    >
      <div
        className="modal-card modal-wide summary-card"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header-row is-sticky">
          <div>
            <p className="modal-kicker">
              ATA OFICIAL DA AUDIÊNCIA · {scenario.title.toUpperCase()}
            </p>
            <h3>{modalHeadline}</h3>
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

        <div className="archetype-banner">
          <div>
            <span className="archetype-stamp">{arch.stamp}</span>
            <h4>{arch.title}</h4>
            <p>{ledger.endedSummary || arch.subtitle}</p>
          </div>
        </div>

        <div className="summary-stats-grid">
          <div className="summary-stat">
            <span>Apoio da Base</span>
            <strong>{ledger.meters.apoioBase}%</strong>
          </div>
          <div className="summary-stat">
            <span>Risco de CPI</span>
            <strong>{ledger.meters.riscoCpi}%</strong>
          </div>
          <div className="summary-stat">
            <span>Verba Carimbada</span>
            <strong className="nowrap-val">R$&nbsp;{ledger.meters.verbaMilhoes}M</strong>
          </div>
          <div className="summary-stat">
            <span>Jabutis Engolidos</span>
            <strong>{ledger.jabutisEngolidos}</strong>
          </div>
        </div>

        {ledger.bestQuote && (
          <blockquote className="summary-quote">
            <span>Aspas da Taquigrafia</span>
            <p>&ldquo;{ledger.bestQuote.text}&rdquo;</p>
          </blockquote>
        )}

        {ledger.documents.length > 0 && (
          <div className="summary-docs">
            <span className="summary-docs-label">
              Documentos despachados nesta sessão ({ledger.documents.length}):
            </span>
            <div className="summary-docs-row">
              {ledger.documents.map((doc) => (
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
                    : "Dossiê da Gaveta"}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="summary-actions">
          <button
            type="button"
            className="btn-voice"
            disabled={busy}
            onClick={() => void handleShare("copy")}
          >
            <Copy size={16} />
            {statusMsg || "Copiar PNG"}
          </button>
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void handleShare("download")}
          >
            <Download size={16} />
            Baixar PNG
          </button>
          <button
            type="button"
            className="btn-secondary is-full-mobile"
            onClick={() => {
              onClose();
              onRestart();
            }}
          >
            <RotateCcw size={16} />
            Nova Audiência
          </button>
        </div>

        <div className="trinca-bar">
          <span className="trinca-label">VISITE OS VIZINHOS DA TRINCA CAÓTICA</span>
          <div className="trinca-links">
            <a
              href="https://gabinetedobento.pages.dev"
              target="_blank"
              rel="noreferrer"
              className="trinca-pill"
            >
              Gab. 717 · Prof. Bento <ExternalLink size={11} />
            </a>
            <a
              href="https://gabinetedaclarice.pages.dev"
              target="_blank"
              rel="noreferrer"
              className="trinca-pill"
            >
              Gab. 222 · Dep. Clarice <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
