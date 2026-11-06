// Avviso in alto quando è arrivata una versione nuova dell'app: si ricarica quando si vuole (in Squadra ci
// possono essere modifiche non salvate). In alto per non coprire la barra Salva in basso.
import { useUpdateReady } from '../pwa/register.ts';
import { Button } from './ui.tsx';

export function UpdateBanner() {
  const ready = useUpdateReady();
  if (!ready) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-3"
    >
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 rounded-xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg dark:bg-slate-700">
        <span>È disponibile una nuova versione di NBBGM.</span>
        <Button onClick={() => window.location.reload()}>Ricarica</Button>
      </div>
    </div>
  );
}
