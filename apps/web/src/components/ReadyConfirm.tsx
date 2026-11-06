// Conferma prima di segnarsi pronti (barra del turno e scheda del turno): se il turno si chiudesse adesso, che cosa
// succede alle decisioni ancora aperte e alle modifiche non salvate in Squadra. Con modifiche non salvate propone
// di salvarle prima.
import { Link } from 'react-router';
import { Button } from './ui.tsx';

export function ReadyConfirm({
  warnings,
  leagueId,
  alertsLink = true,
  unsaved,
  busy,
  onReady,
  onSaveAndReady,
  onCancel,
}: {
  warnings: string[];
  leagueId: string;
  /** Link agli avvisi nella pagina della lega (non serve dentro la pagina della lega). */
  alertsLink?: boolean;
  /** Ci sono modifiche non salvate in Squadra: si può salvare e poi segnarsi pronti. */
  unsaved: boolean;
  busy: boolean;
  onReady: () => void;
  onSaveAndReady: () => void;
  onCancel: () => void;
}) {
  return (
    <div
      role="alertdialog"
      aria-labelledby="pronto-titolo"
      className="mt-2 space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
    >
      <p id="pronto-titolo" className="font-semibold">
        Prima di segnarti pronto
      </p>
      <p>Se il turno si chiude adesso:</p>
      <ul className="list-disc space-y-1 pl-5">
        {warnings.map((w) => (
          <li key={w}>{w}</li>
        ))}
      </ul>
      {alertsLink && !unsaved && (
        <p>
          <Link to={`/lega/${leagueId}`} className="font-semibold underline" onClick={onCancel}>
            Vedi gli avvisi
          </Link>
        </p>
      )}
      <div className="flex flex-wrap gap-2 pt-1">
        {unsaved && (
          <Button disabled={busy} onClick={onSaveAndReady}>
            Salva e sono pronto
          </Button>
        )}
        <Button variant={unsaved ? 'secondary' : 'primary'} disabled={busy} onClick={onReady}>
          {unsaved ? 'Pronto senza salvare' : 'Sono pronto lo stesso'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </div>
  );
}
