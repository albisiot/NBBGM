// Stile Edicola per risultati, classifiche, box score e statistiche: le tabelle come i tabellini del giornale
// (filetto pieno sotto l'intestazione, righe sottili, filetti spessi o a puntini dove la classifica cambia), più
// qualche funzione pura per i testi dei risultati. Le classi stanno qui perché le usano più pagine.
import type { BoxLine, Play } from './results.ts';

/**
 * Tabella a bordi separati (non collassati): i filetti stanno sulle celle, così quelli della colonna fissa (sticky)
 * la seguono quando la tabella scorre su telefono. Con i bordi collassati il bordo di una cella fissa resta dove
 * era e il fondo della cella copre i filetti delle righe che le passano sotto.
 */
export const TABLE = 'w-full border-separate border-spacing-0 text-sm';

/** Intestazione: maiuscolo stretto piccolo, filetto pieno d'inchiostro sotto. */
export const HEAD_ROW =
  'font-titolo text-xs tracking-wider uppercase text-stampa-600 dark:text-stampa-300 *:border-b-2 *:border-stampa-900 *:font-semibold dark:*:border-stampa-100';

export type RowRule = 'thin' | 'solid' | 'dotted' | 'none';

/** Filetto sotto una riga: sottile tra le righe, pieno o a puntini dove la classifica cambia. */
export function rowRule(rule: RowRule): string {
  switch (rule) {
    case 'solid':
      return '*:border-b-2 *:border-stampa-900 dark:*:border-stampa-100';
    case 'dotted':
      return '*:border-b-2 *:border-dotted *:border-stampa-900 dark:*:border-stampa-100';
    case 'none':
      return '';
    default:
      return '*:border-b *:border-stampa-200 dark:*:border-stampa-700';
  }
}

/** Colonna fissa a sinistra quando la tabella scorre: ha un fondo, perché le altre colonne le passano sotto. */
export const STICKY = 'sticky left-0 z-[1]';
/** Fondo della pagina (carta) e della riga evidenziata (la propria squadra). */
export const PAPER = 'bg-stampa-50 dark:bg-stampa-900';
export const HIGHLIGHT = 'bg-stampa-25 dark:bg-stampa-800';

/** Titoletto sopra un gruppo (giro dei playoff, classifica di una conference): maiuscolo stretto grigio. */
export const SUBHEAD =
  'font-titolo text-xs font-semibold tracking-[0.12em] uppercase text-stampa-600 dark:text-stampa-300';

/** Nota in corsivo sotto una tabella o una riga: almeno 13 px, grigio leggibile su carta e sui riquadri. */
export const NOTE = 'text-[0.8125rem] italic text-stampa-600 dark:text-stampa-300';

/** Selettore (stagione, squadra, ruolo) e campo di ricerca a filo d'inchiostro. */
export const FIELD =
  'min-h-11 rounded-sm border border-stampa-900 bg-stampa-25 px-2 text-sm text-stampa-900 dark:border-stampa-300 dark:bg-stampa-800 dark:text-stampa-50';

/** Link d'inchiostro sottolineato al passaggio (nomi di giocatori e squadre nelle tabelle). */
export const INK_LINK = 'hover:underline underline-offset-2';

/** Link in corsivo rosso, come "box score ›" nei risultati. */
export const RED_LINK = 'font-semibold italic text-rosso-700 hover:underline dark:text-rosso-300';

/** Posto in classifica di conference dopo cui cambia il filetto: pieno dopo il 6° (playoff), a puntini dopo il 10°. */
export function standingsRule(rank: number): RowRule {
  if (rank === 6) return 'solid';
  if (rank === 10) return 'dotted';
  return 'thin';
}

/** Che cosa vale un posto di conference: playoff (1-6), play-in (7-10) o niente. */
export function seedZone(rank: number): 'playoff' | 'play-in' | null {
  if (rank >= 1 && rank <= 6) return 'playoff';
  if (rank >= 7 && rank <= 10) return 'play-in';
  return null;
}

/** "d.t.s." (dopo i tempi supplementari) accanto al risultato; con più supplementari il loro numero. */
export function overtimeShort(overtimes: number | null | undefined): string {
  if (!overtimes) return '';
  return overtimes === 1 ? 'd.t.s.' : `d.t.s. (${overtimes})`;
}

/** Chi ha vinto tra trasferta e casa; null se la partita non è giocata (o, per assurdo, è pari). */
export function winnerSide(away: number | null, home: number | null): 'away' | 'home' | null {
  if (away === null || home === null || away === home) return null;
  return away > home ? 'away' : 'home';
}

/** "24–28, 31–27, …": i parziali, prima la squadra in trasferta come nel titolo della partita. */
export function partialsText(q: { home: number[]; away: number[] } | null): string {
  if (!q) return '';
  const n = Math.max(q.home.length, q.away.length);
  return Array.from({ length: n }, (_, i) => `${q.away[i] ?? 0}–${q.home[i] ?? 0}`).join(', ');
}

/**
 * Parziali della partita dal vivo fino a dove è arrivato il replay: solo i periodi già finiti (prima di `period`, o
 * tutti a partita finita), dalla cronaca mostrata finora. Il punteggio a fine periodo è quello dell'ultima azione di
 * quel periodo (o di prima, se nel periodo nessuno ha segnato). [trasferta, casa] per periodo.
 */
export function livePartials(
  plays: readonly Play[],
  shown: number,
  period: number,
  finished: boolean,
): [number, number][] {
  const seen = plays.slice(0, shown);
  const last = finished ? seen.reduce((m, p) => Math.max(m, p[0]), 4) : period - 1;
  const out: [number, number][] = [];
  let before: [number, number] = [0, 0];
  for (let p = 1; p <= last; p++) {
    let end: [number, number] = before;
    for (const x of seen) if (x[0] <= p) end = [x[5], x[4]];
    out.push([end[0] - before[0], end[1] - before[1]]);
    before = end;
  }
  return out;
}

/** "11/21": tiri segnati su tentati. */
export const shotLine = (made: number, attempted: number) => `${made}/${attempted}`;

export interface BoxTotals {
  minutes: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
}

/** Totale di squadra del box score; i minuti arrotondati sulla somma (240 nei tempi regolamentari). */
export function boxTotals(lines: readonly BoxLine[]): BoxTotals {
  const t = lines.reduce(
    (a, l) => ({
      minutes: a.minutes + l.seconds,
      pts: a.pts + l.pts,
      fgm: a.fgm + l.fgm,
      fga: a.fga + l.fga,
      tpm: a.tpm + l.tpm,
      tpa: a.tpa + l.tpa,
      ftm: a.ftm + l.ftm,
      fta: a.fta + l.fta,
      reb: a.reb + l.orb + l.drb,
      ast: a.ast + l.ast,
      stl: a.stl + l.stl,
      blk: a.blk + l.blk,
      tov: a.tov + l.tov,
      pf: a.pf + l.pf,
    }),
    {
      minutes: 0,
      pts: 0,
      fgm: 0,
      fga: 0,
      tpm: 0,
      tpa: 0,
      ftm: 0,
      fta: 0,
      reb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      pf: 0,
    },
  );
  return { ...t, minutes: Math.round(t.minutes / 60) };
}

/** Il migliore della squadra in punti, rimbalzi e assist (in grassetto nel tabellino); 0 se nessuno ne ha. */
export function teamHighs(lines: readonly BoxLine[]): { pts: number; reb: number; ast: number } {
  const played = lines.filter((l) => l.seconds > 0);
  const max = (f: (l: BoxLine) => number) => played.reduce((m, l) => Math.max(m, f(l)), 0);
  return { pts: max((l) => l.pts), reb: max((l) => l.orb + l.drb), ast: max((l) => l.ast) };
}
