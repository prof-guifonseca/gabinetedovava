import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  public state: ErrorBoundaryState = { hasError: false };

  public static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  public componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[ErrorBoundary] Erro na interface do Gabinete:", error, info);
  }

  public render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div className="error-boundary-shell" role="alert">
          <div className="error-boundary-card">
            <p className="modal-kicker">PLANTÃO TÉCNICO · GABINETE 412</p>
            <h2>Sessão interrompida por questão de ordem!</h2>
            <p className="modal-desc">
              O painel eletrônico do Anexo IV teve uma oscilação inesperada.
              Recarregue a página para reabrir a audiência com o Dr. Vavá.
            </p>
            <button
              type="button"
              className="btn-voice"
              onClick={() => window.location.reload()}
            >
              Reabrir o Gabinete
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
