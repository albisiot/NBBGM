// Conferma prima di segnarsi pronti (barra del turno e scheda del turno), in un pannello che sale dal basso: se il
// turno si chiudesse adesso, che cosa succede alle decisioni ancora aperte e alle modifiche non salvate in Squadra.
// Con modifiche non salvate propone di salvarle prima. Si chiude con Annulla, Esc o toccando fuori.
import { Link } from 'react-router';
import { readyConfirmTitle } from '../lib/frontPage.ts';
import { LINK_BUTTON } from '../lib/linkStyles.ts';
import { Button, Sheet } from './ui.tsx';

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
    <Sheet
      kicker="Prima di segnarti pronto"
      title={readyConfirmTitle(warnings.length, unsaved)}
      onClose={onCancel}
    >
      <p className="text-[0.95rem]">Se il turno si chiude adesso:</p>
      <ul className="space-y-2 text-[0.95rem] leading-snug">
        {warnings.map((w, i) => (
          <li key={w} className="flex gap-2.5">
            {/* Quadratino rosso per le decisioni, d'inchiostro per le modifiche non salvate (readyWarnings le mette
                per prime) */}
            <span
              aria-hidden="true"
              className={`mt-[0.4rem] size-2 shrink-0 ${
                unsaved && i === 0 ? 'bg-stampa-900 dark:bg-stampa-100' : 'bg-rosso-600 dark:bg-rosso-400'
              }`}
            />
            <span>{w}</span>
          </li>
        ))}
      </ul>
      <div className="grid gap-2 pt-1">
        {/* Con modifiche non salvate niente link: uscire da Squadra chiederebbe di nuovo che cosa farne */}
        {alertsLink && !unsaved && (
          <Link to={`/lega/${leagueId}`} className={`${LINK_BUTTON.primary} min-h-12`} onClick={onCancel}>
            Vedi le decisioni
          </Link>
        )}
        {unsaved && (
          <Button variant="secondary" className="min-h-12" disabled={busy} onClick={onSaveAndReady}>
            Salva e sono pronto
          </Button>
        )}
        <Button variant="secondary" className="min-h-12" disabled={busy} onClick={onReady}>
          {unsaved ? 'Pronto senza salvare' : 'Sono pronto lo stesso'}
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onCancel}>
          Annulla
        </Button>
      </div>
    </Sheet>
  );
}
