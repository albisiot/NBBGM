// Barra del turno con le modifiche non salvate in Squadra (stile Edicola): al posto del turno e del Pronto,
// "Da salvare" con i minuti (in rosso se non fanno 240, o quello che impedisce di salvare), Annulla e Salva.
// Riquadro d'inchiostro pieno, rovesciato nel tema scuro, per distinguerlo dalla barra del turno.
import { unsavedLine, type Unsaved } from '../lib/unsaved.ts';

export function SaveBar({ unsaved, busy, onSave }: { unsaved: Unsaved; busy: boolean; onSave: () => void }) {
  const line = unsavedLine(unsaved);
  return (
    <section
      aria-label="Modifiche da salvare"
      className="mb-4 flex min-h-[3.75rem] items-center gap-1.5 bg-stampa-900 py-1 pr-1 pl-3 text-stampa-25 dark:bg-stampa-50 dark:text-stampa-900"
    >
      <p className="min-w-0 flex-1 text-sm leading-snug">
        <span className="block font-titolo font-semibold tracking-wider uppercase">Da salvare</span>
        {/* Il totale cambia a ogni tocco dei minuti: i lettori di schermo lo sentono */}
        <span
          aria-live="polite"
          className={`block italic ${line.alert ? 'text-rosso-300 dark:text-rosso-700' : 'text-stampa-200 dark:text-stampa-600'}`}
        >
          {line.text}
        </span>
      </p>
      {unsaved.discard && (
        <button
          type="button"
          disabled={busy}
          onClick={unsaved.discard}
          className="inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold italic underline underline-offset-4 disabled:opacity-50"
        >
          Annulla
        </button>
      )}
      <button
        type="button"
        disabled={busy || Boolean(unsaved.problem)}
        onClick={onSave}
        className="inline-flex min-h-11 shrink-0 items-center bg-stampa-50 px-[1.125rem] font-titolo text-[0.95rem] font-semibold tracking-wider text-stampa-900 uppercase hover:bg-stampa-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-stampa-900 dark:text-stampa-50 dark:hover:bg-stampa-700"
      >
        {busy ? 'Salvo…' : 'Salva'}
      </button>
    </section>
  );
}
