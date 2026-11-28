import { useEffect, useRef, useState } from "react";
import { Copy, Download, MessageSquareWarning, X } from "lucide-react";
import type { CabinetDocument } from "../shared/gameState";
import {
  downloadBlob,
  generateDocumentCard,
  shareImageNativeOrCopy,
} from "../utils/shareCardGenerator";
import { useModalBehavior } from "../hooks/useModalBehavior";

interface DocumentOverlayProps {
  document: CabinetDocument | null;
  onClose: () => void;
  onConfrontJabuti?: (jabutiText: string) => void;
}

export function DocumentOverlay({
  document: doc,
  onClose,
  onConfrontJabuti,
}: DocumentOverlayProps) {
  const [shareFeedback, setShareFeedback] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const feedbackTimerRef = useRef<number | null>(null);

  useModalBehavior(Boolean(doc), onClose);

  // Reset transient feedback state when opening a new document or closing
  useEffect(() => {
    setShareFeedback(null);
    setBusy(false);
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  }, [doc?.id]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current !== null) {
        window.clearTimeout(feedbackTimerRef.current);
      }
    };
  }, []);

  if (!doc) return null;

  const scheduleFeedbackClear = () => {
    if (feedbackTimerRef.current !== null) {
      window.clearTimeout(feedbackTimerRef.current);
    }
    feedbackTimerRef.current = window.setTimeout(() => {
      feedbackTimerRef.current = null;
      setShareFeedback(null);
    }, 2600);
  };

  const handleExport = async (mode: "copy" | "download") => {
    setBusy(true);
    try {
      const blob = await generateDocumentCard(doc);
      const filename = `gabinete-vava-${doc.action.type}-${doc.turn}.png`;
      if (mode === "download") {
        downloadBlob(blob, filename);
        setShareFeedback("PNG salvo!");
        scheduleFeedbackClear();
      } else {
        const result = await shareImageNativeOrCopy(
          blob,
          filename,
          "Documento do Gabinete do Vavá",
          "Olha o documento que o Dr. Vavá carimbou no Gabinete 412: https://gabinetedovava.pages.dev"
        );
        if (result === "cancelled") {
          return;
        }
        setShareFeedback(
          result === "shared"
            ? "Compartilhado!"
            : result === "copied"
            ? "Imagem copiada! Cole no WhatsApp."
            : "PNG salvo!"
        );
        scheduleFeedbackClear();
      }
    } catch {
      setShareFeedback("Erro ao gerar PNG.");
      scheduleFeedbackClear();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label="Documento Oficial do Gabinete"
      onClick={onClose}
    >
      <div
        className="paper-document"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="paper-close-btn"
          onClick={onClose}
          aria-label="Fechar documento"
        >
          <X size={18} />
        </button>

        <div className="paper-masthead">
          <span>REPÚBLICA SATÍRICA DO BALCÃO · ANEXO IV</span>
          <strong>
            {doc.action.type === "nomear_dou"
              ? "DIÁRIO OFICIAL DA UNIÃO — SEÇÃO 2"
              : doc.action.type === "carimbar_emenda"
              ? "EMENDA DE RELATOR (URGÊNCIA URGENTÍSSIMA)"
              : "GAVETA DA PRESIDÊNCIA — CONFIDENCIAL"}
          </strong>
          <small>Registro {doc.createdAt} · Turno {doc.turn} · Sátira 100% ficcional</small>
        </div>

        <div className="paper-body">
          {doc.action.type === "carimbar_emenda" && (() => {
            const emenda = doc.action;
            return (
              <>
                <div className="paper-stamp is-red">CARIMBADO</div>
                <p className="paper-mono">PROTOCOLO: {emenda.protocolo}</p>
                <div className="paper-amount">R$ {emenda.valorMilhoes},0 MILHÕES</div>
                <p className="paper-paragraph">
                  <strong>Objeto declarado:</strong> {emenda.destino}
                </p>

                <div className="jabuti-box">
                  <span className="jabuti-label">
                    PARÁGRAFO ÚNICO (JABUTI TÉCNICO INSERIDO ÀS 03h14):
                  </span>
                  <p>{emenda.jabutiOculto}</p>
                  {onConfrontJabuti && (
                    <button
                      type="button"
                      className="btn-confront-jabuti"
                      onClick={() => {
                        onConfrontJabuti(
                          `Ei, Presidente! Que jabuti escondido é esse aqui no rodapé da emenda: "${emenda.jabutiOculto}"?! Tira isso já!`
                        );
                        onClose();
                      }}
                    >
                      <MessageSquareWarning size={14} />
                      Confrontar o Vavá sobre esse Jabuti!
                    </button>
                  )}
                </div>
              </>
            );
          })()}

          {doc.action.type === "nomear_dou" && (
            <>
              <div className="paper-stamp is-green">PUBLICADO NO DOU</div>
              <p className="paper-mono">
                PORTARIA Nº 4.171/PMD · CÓDIGO {doc.action.simbolo}
              </p>
              <p className="paper-paragraph">
                O Presidente da Câmara dos Deputados <strong>RESOLVE NOMEAR{" "}
                {doc.action.nomeado.toUpperCase()}</strong> para exercer o cargo em
                comissão de <strong>{doc.action.cargo}</strong> ({doc.action.simbolo}),
                com remuneração mensal de <strong>{doc.action.salarioMensal}</strong>.
              </p>
              <p className="paper-quote">
                &ldquo;{doc.action.justificativa}&rdquo;
              </p>
            </>
          )}

          {doc.action.type === "puxar_dossie" && (() => {
            const dossie = doc.action;
            return (
              <>
                <div className="paper-stamp is-red">CONFIDENCIAL</div>
                <h4 className="paper-dossier-title">{dossie.titulo}</h4>
                <p className="paper-paragraph">{dossie.resumo}</p>
                <div className="jabuti-box">
                  <span className="jabuti-label">NA GAVETA DO PRESIDENTE:</span>
                  <p>{dossie.ameaca}</p>
                  {onConfrontJabuti && (
                    <button
                      type="button"
                      className="btn-confront-jabuti"
                      onClick={() => {
                        onConfrontJabuti(
                          `Isso é chantagem de gaveta, Presidente! Esse dossiê "${dossie.titulo}" não me intimida — vai bancar isso no plenário ou vai recuar?`
                        );
                        onClose();
                      }}
                    >
                      <MessageSquareWarning size={14} />
                      Confrontar o Vavá sobre esse Dossiê!
                    </button>
                  )}
                </div>
              </>
            );
          })()}
        </div>

        <div className="paper-signature">
          <span>Dep. Dr. Valdemar &ldquo;Vavá&rdquo; Braga (PMD/DF)</span>
          <small>Caneta Montblanc · Gabinete 412</small>
        </div>

        <div className="paper-actions">
          <button
            type="button"
            className="btn-paper-primary"
            disabled={busy}
            onClick={() => void handleExport("copy")}
          >
            <Copy size={15} />
            {shareFeedback || "Copiar p/ WhatsApp"}
          </button>
          <button
            type="button"
            className="btn-paper-secondary"
            disabled={busy}
            onClick={() => void handleExport("download")}
          >
            <Download size={15} />
            Baixar PNG
          </button>
        </div>
      </div>
    </div>
  );
}
