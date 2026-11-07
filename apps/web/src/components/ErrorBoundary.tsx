// Un errore durante il disegno di una pagina lasciava lo schermo bianco, e nell'app installata su iPhone non
// c'è nemmeno il pulsante per ricaricare. Qui si mostra un messaggio con "Ricarica" e "Torna alle leghe".
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from './ui.tsx';

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(error, info.componentStack);
  }

  override render(): ReactNode {
    if (this.state.error) return <ErrorScreen error={this.state.error} />;
    return this.props.children;
  }
}

export function ErrorScreen({
  error,
  onReload = () => window.location.reload(),
  onHome = () => {
    window.location.hash = '#/';
    window.location.reload();
  },
}: {
  error: Error;
  onReload?: () => void;
  onHome?: () => void;
}) {
  return (
    <main
      role="alert"
      className="mx-auto max-w-md space-y-4 px-4 pt-[calc(var(--spazio-alto)+1.5rem)] pb-8 text-stampa-900 dark:text-stampa-100"
    >
      <h1 className="text-xl font-bold">Qualcosa è andato storto</h1>
      <p className="text-sm text-stampa-600 dark:text-stampa-300">
        La pagina si è bloccata per un errore dell’app. Ricarica: le scelte già salvate restano.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button onClick={onReload}>Ricarica</Button>
        <Button variant="secondary" onClick={onHome}>
          Torna alle leghe
        </Button>
      </div>
      <p className="font-mono text-xs break-words text-stampa-500 dark:text-stampa-400">{error.message}</p>
    </main>
  );
}
