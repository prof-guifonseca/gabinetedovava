import { useState, type FormEvent } from "react";
import { KeyRound } from "lucide-react";

interface AccessGateModalProps {
  open: boolean;
  onVerified: (code: string) => void;
}

export function AccessGateModal({ open, onVerified }: AccessGateModalProps) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  if (!open) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed || verifying) return;

    setVerifying(true);
    setError(null);
    try {
      const res = await fetch("/api/auth/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accessCode: trimmed }),
      });

      if (res.ok) {
        onVerified(trimmed);
        return;
      }

      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error || "Credencial recusada na portaria do gabinete.");
    } catch {
      setError("Falha de rede ao verificar a senha na portaria.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <form className="modal-card" onSubmit={(e) => void handleSubmit(e)}>
        <p className="modal-kicker">PORTARIA DO GABINETE 412 · ANEXO IV</p>
        <h3 style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <KeyRound size={18} color="var(--gold)" />
          Credencial da Ante-Sala
        </h3>
        <p className="modal-desc">
          Esta audiência no Gabinete do Vavá exige a senha de acesso para abrir
          o microfone ao vivo ou protocolar ofícios.
        </p>
        <input
          type="password"
          className="chat-input"
          placeholder="Digite a senha do gabinete..."
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoFocus
        />
        {error && <div className="error-banner">{error}</div>}
        <button
          type="submit"
          className="btn-voice"
          disabled={!code.trim() || verifying}
        >
          {verifying ? "Conferindo na portaria..." : "Entrar no Gabinete"}
        </button>
      </form>
    </div>
  );
}
