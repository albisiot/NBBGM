// Pezzi dello stile Edicola per mercato, scheda giocatore, pagina di una squadra e confronto: il voto in un quadratino
// d'inchiostro, le righe divise da filetti, i pulsanti a filo da accendere, i filtri, le testatine di sezione, il
// tabellino con i filetti verticali, la riga della pagella. I colori seguono ui.tsx: inchiostro per quello che va
// bene o è scelto, rosso solo per i problemi, stampa per il resto; ogni classe ha la sua variante scura.
import type { ReactNode, SelectHTMLAttributes } from 'react';
import { buttonClass, FIELD_LABEL, GHOST_LINK } from '../lib/linkStyles.ts';

export { FIELD_LABEL, GHOST_LINK };

/** Campo (select, input) a filo d'inchiostro, come TextInput di ui.tsx. */
export const FIELD =
  'min-h-11 min-w-0 rounded-sm border border-stampa-900 bg-stampa-25 px-3 text-base text-stampa-900 focus:ring-2 focus:ring-rosso-200 focus:outline-none sm:text-sm dark:border-stampa-300 dark:bg-stampa-800 dark:text-stampa-50 dark:focus:ring-rosso-900';

/** Riquadro con il filetto d'inchiostro (come Card, senza il margine interno). */
export const BOX = 'border border-stampa-900 bg-stampa-25 dark:border-stampa-600 dark:bg-stampa-800';

/** Filetto sottile tra le righe di un elenco. */
export const RULE = 'border-b border-stampa-300 dark:border-stampa-700';

/** Riga di dettaglio in corsivo sotto un nome (ruolo, età, richiesta). */
export const META = 'text-[0.8125rem] italic text-stampa-600 dark:text-stampa-300';

/** Testo secondario. */
export const MUTED = 'text-stampa-500 dark:text-stampa-400';

/** Testo dei problemi. */
export const BAD = 'text-rosso-700 dark:text-rosso-300';

/** Nota in corsivo sotto una sezione. */
export const NOTE = 'text-[0.8125rem] italic text-stampa-500 dark:text-stampa-400';

/** Il voto (overall) in un quadratino d'inchiostro; i lettori di schermo sentono "overall 58". */
export function OvrBox({ value, small = false }: { value: number | string; small?: boolean }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center bg-stampa-900 font-titolo font-bold text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900 ${
        small ? 'size-7 text-sm' : 'size-9 text-[1.0625rem]'
      }`}
    >
      <span className="sr-only">overall </span>
      {value}
    </span>
  );
}

export type LinkVariant = 'primary' | 'accent' | 'secondary';

/** Classi di un link che si presenta come un pulsante di ui.tsx (Proponi uno scambio, Confronta, Gestisci). */
export function linkButton(variant: LinkVariant, extra = ''): string {
  return buttonClass(variant, extra);
}

/** Pulsante a filo da accendere (bisogni della squadra): acceso è pieno d'inchiostro. */
export function PressButton({
  pressed,
  onClick,
  children,
}: {
  pressed: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center rounded-sm border px-3 text-left font-titolo text-[0.8125rem] font-semibold tracking-wider uppercase ${
        pressed
          ? 'border-stampa-900 bg-stampa-900 text-stampa-25 dark:border-stampa-100 dark:bg-stampa-100 dark:text-stampa-900'
          : 'border-stampa-900 text-stampa-900 hover:bg-stampa-100 dark:border-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-700'
      }`}
    >
      {children}
    </button>
  );
}

/**
 * Filtro come un pulsante a filo: un select vero (sul telefono apre la scelta del sistema), pieno d'inchiostro quando
 * è diverso da "tutti". Con ghost è il link in corsivo dell'ordinamento.
 */
export function FilterSelect({
  label,
  active = false,
  ghost = false,
  className = '',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement> & { label: string; active?: boolean; ghost?: boolean }) {
  const look = ghost
    ? 'border-transparent bg-transparent font-serif text-[0.95rem] font-semibold italic text-stampa-800 underline underline-offset-4 dark:text-stampa-100'
    : active
      ? 'border-stampa-900 bg-stampa-900 font-titolo text-[0.8125rem] font-semibold tracking-wider text-stampa-25 uppercase dark:border-stampa-100 dark:bg-stampa-100 dark:text-stampa-900'
      : 'border-stampa-900 bg-transparent font-titolo text-[0.8125rem] font-semibold tracking-wider text-stampa-900 uppercase dark:border-stampa-100 dark:text-stampa-50';
  return (
    <span className={`relative inline-flex min-w-0 ${className}`}>
      <select
        aria-label={label}
        className={`min-h-11 max-w-full min-w-0 cursor-pointer appearance-none truncate rounded-sm border py-0 pr-8 pl-3 ${look}`}
        {...props}
      />
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className={`pointer-events-none absolute top-1/2 right-2 size-4 -translate-y-1/2 ${
          active && !ghost ? 'text-stampa-25 dark:text-stampa-900' : 'text-stampa-900 dark:text-stampa-50'
        }`}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

/** Titolo di una parte dentro una sezione (h3): maiuscolo stretto con il filetto pieno sotto, a destra un'aggiunta. */
export function SubTitle({ children, aside }: { children: ReactNode; aside?: ReactNode }) {
  return (
    <h3 className="flex items-baseline justify-between gap-3 border-b-2 border-stampa-900 pb-1 text-sm font-semibold tracking-wider uppercase dark:border-stampa-100">
      <span className="min-w-0">{children}</span>
      {aside !== undefined && (
        <span className="shrink-0 font-serif text-sm font-normal tracking-normal normal-case italic">
          {aside}
        </span>
      )}
    </h3>
  );
}

/** Titoletto rosso di un gruppo (Tiro, Difesa...), come l'occhiello. */
export function GroupTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="font-titolo text-xs font-semibold tracking-[0.12em] text-rosso-700 uppercase dark:text-rosso-300">
      {children}
    </h3>
  );
}

export interface StripItem {
  label: string;
  value: ReactNode;
  /** Un problema: il valore in rosso. */
  bad?: boolean;
  /** Riga in corsivo sotto il valore. */
  note?: ReactNode;
  /** Su telefono occupa tutta la riga. */
  wide?: boolean;
}

/**
 * Tabellino: voci in maiuscolo stretto e valori grandi, tra un filetto pieno sopra e uno sottile sotto, con i filetti
 * tra le voci. Su telefono due colonne (wide: l'ultima voce su tutta la riga), da sm in su una riga sola (cols).
 */
export function Strip({ items, cols = 'sm:grid-cols-4' }: { items: StripItem[]; cols?: string }) {
  return (
    <dl
      className={`grid grid-cols-2 border-t-2 border-b border-stampa-900 dark:border-stampa-100 ${cols} [&>div]:border-stampa-300 dark:[&>div]:border-stampa-700`}
    >
      {items.map((i, n) => (
        <div
          key={i.label}
          className={[
            'min-w-0 py-1.5 pr-2',
            // Su telefono: filetto a sinistra nella seconda colonna, sopra dalla seconda riga
            !i.wide && n % 2 === 1 ? 'border-l pl-2.5' : '',
            n >= 2 ? 'border-t sm:border-t-0' : '',
            i.wide ? 'col-span-2 sm:col-span-1' : '',
            // Da sm in su: tutte in fila, con il filetto a sinistra dalla seconda
            n > 0 ? 'sm:border-l sm:pl-2.5' : '',
          ].join(' ')}
        >
          <dt className="font-titolo text-xs font-semibold tracking-widest text-stampa-600 uppercase dark:text-stampa-300">
            {i.label}
          </dt>
          <dd className={`font-titolo text-lg leading-tight font-bold ${i.bad ? BAD : ''}`}>{i.value}</dd>
          {i.note && <dd className={i.bad ? `text-[0.8125rem] italic ${BAD}` : META}>{i.note}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * Riga della pagella: voce, puntini e voto. A differenza di Leader la voce va a capo quando è lunga ("Lettura delle
 * linee di passaggio" su due colonne strette).
 */
export function GradeRow({
  label,
  value,
  tone = 'mid',
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: 'top' | 'mid' | 'low';
}) {
  const weight = {
    top: 'font-bold text-stampa-900 dark:text-stampa-50',
    mid: 'font-semibold',
    low: 'font-normal text-stampa-600 dark:text-stampa-300',
  }[tone];
  return (
    <div className="flex min-h-7 items-baseline gap-2 text-sm">
      <span className="min-w-0">{label}</span>
      <span
        aria-hidden="true"
        className="min-w-4 flex-1 border-b-2 border-dotted border-stampa-300 dark:border-stampa-600"
      />
      <span className={`shrink-0 text-right font-titolo text-[0.9375rem] ${weight}`}>{value}</span>
    </div>
  );
}

/** Barra sottile d'inchiostro (energia, morale), rossa quando il valore è un problema. */
export function Bar({ value, bad = false }: { value: number; bad?: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="mt-1 block h-1 w-full max-w-24 overflow-hidden bg-stampa-200 dark:bg-stampa-700"
    >
      <span
        className={`block h-full ${bad ? 'bg-rosso-600 dark:bg-rosso-400' : 'bg-stampa-900 dark:bg-stampa-100'}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}
