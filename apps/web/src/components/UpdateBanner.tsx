// Avviso quando è arrivata una versione nuova dell'app ("Nuova edizione", tra due filetti come una riga del
// giornale): si ricarica quando si vuole (in Squadra ci possono essere modifiche non salvate). Sta
// nell'intestazione, sotto il menu della lega: resta in vista quando la pagina scorre ma non copre il menu né la
// barra Salva in basso, e i margini delle aree sicure sono quelli dell'intestazione. Si chiude con ✕ fino alla
// prossima apertura dell'app.
import { useState } from 'react';
import { useUpdateReady } from '../pwa/register.ts';
import { Button } from './ui.tsx';

export function UpdateBanner() {
  const ready = useUpdateReady();
  const [closed, setClosed] = useState(false);
  if (!ready || closed) return null;
  return (
    <div role="status" className="mx-auto max-w-4xl px-4">
      <div className="flex items-center gap-2 border-t-2 border-b border-stampa-900 py-0.5 pl-1 text-[0.875rem] dark:border-stampa-100">
        <span className="min-w-0 flex-1 leading-snug">
          <strong className="font-titolo font-semibold tracking-wider uppercase">Nuova edizione</strong> ·{' '}
          <em>è uscita una versione nuova di NBBGM</em>
        </span>
        <Button className="shrink-0 px-3" onClick={() => window.location.reload()}>
          Ricarica
        </Button>
        <button
          type="button"
          aria-label="Chiudi l’avviso della nuova versione"
          onClick={() => setClosed(true)}
          className="inline-flex size-11 shrink-0 items-center justify-center hover:bg-stampa-100 dark:hover:bg-stampa-800"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
