import { useState, type FormEvent } from "react";
import { Lock } from "lucide-react";

interface AccessGateModalProps {
  open: boolean;
  onSubmit: (code: string) => void;
}

export function AccessGateModal({ open, onSubmit }: AccessGateModalProps) {
  const [code, setCode] = useState("");

  if (!open) return null;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) return;
    onSubmit(code.trim());
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card" onSubmit={handleSubmit}>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Lock size={18} color="var(--gold)" />
          Credencial do Bunker Faraday
        </h3>
        <p>
          Esta sessão do Gabinete do Vavá exige a senha de acesso
          para abrir áudio ao vivo ou despachar ofícios.
        </p>
        <input
          type="password"
          className="chat-input"
          placeholder="Digite a senha de gabinete..."
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        <button type="submit" className="btn-tribuna" disabled={!code.trim()}>
          Liberar Acesso ao Plenário
        </button>
      </form>
    </div>
  );
}
