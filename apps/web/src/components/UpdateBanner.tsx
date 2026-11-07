// Avviso quando è arrivata una versione nuova dell'app: si ricarica quando si vuole (in Squadra ci possono essere
// modifiche non salvate). Sta nell'intestazione, sotto il menu della lega: resta in vista quando la pagina
// scorre ma non copre il menu né la barra Salva in basso, e i margini delle aree sicure sono quelli
// dell'intestazione. Si chiude con ✕ fino alla prossima apertura dell'app.
import { useState } from 'react';
import { useUpdateReady } from '../pwa/register.ts';
import { Button } from './ui.tsx';

export function UpdateBanner() {
  const ready = useUpdateReady();
  const [closed, setClosed] = useState(false);
  if (!ready || closed) return null;
  return (
    <div role="status" className="bg-slate-900 text-white dark:bg-slate-700">
      <div className="mx-auto flex max-w-4xl items-center gap-2 py-1 pr-1 pl-4 text-sm">
        <span className="min-w-0 flex-1">È disponibile una nuova versione di NBBGM.</span>
        <Button className="shrink-0" onClick={() => window.location.reload()}>
          Ricarica
        </Button>
        <button
          type="button"
          aria-label="Chiudi l’avviso della nuova versione"
          onClick={() => setClosed(true)}
          className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-white/10"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
