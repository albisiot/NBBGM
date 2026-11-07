// Testi delle pagine del mercato, della scheda giocatore e della pagina squadra nello stile Edicola: cifre in milioni
// con un decimale come nei tabellini, l'anteprima dello scambio in tabella (prima → dopo, con i valori che peggiorano
// in rosso), il bisogno della squadra acceso, le soglie di energia e morale. Modulo puro: nessuna lettura dal server.
import { DEFAULT_FA_QUERY, type FreeAgentQuery } from './market.ts';
import type { Need } from './teamNeeds.ts';
import type { SideNumbers, SidePreview, TradePreview } from './tradePreview.ts';

/** "196,4": milioni di dollari con un decimale, senza unità (le tabelle lo dicono nella didascalia). */
export function mln1(x: number): string {
  const v = Math.round(x / 1e5) / 10;
  return `${v < 0 ? '−' : ''}${Math.abs(v).toFixed(1).replace('.', ',')}`;
}

/** "196,4 → 213,1", o un valore solo se non cambia. */
export function change(before: string, after: string): string {
  return before === after ? after : `${before} → ${after}`;
}

export interface PreviewCell {
  text: string;
  /** Il valore dopo lo scambio è un problema o peggiora (luxury tax in più, rosa fuori dai limiti...). */
  bad: boolean;
}

export interface PreviewRow {
  label: string;
  /** Una cella per squadra, nell'ordine dell'anteprima: la propria, poi l'altra. */
  cells: [PreviewCell, PreviewCell];
}

const capText = (n: SideNumbers) => (n.capSpace >= 0 ? mln1(n.capSpace) : 'nessuno');
const taxRoomText = (n: SideNumbers) =>
  n.taxRoom >= 0 ? `${mln1(n.taxRoom)} sotto` : `${mln1(-n.taxRoom)} sopra`;
const taxText = (n: SideNumbers) => (n.tax > 0 ? mln1(n.tax) : '0');
const rosterText = (n: SideNumbers, offseason: boolean) =>
  offseason ? `${n.total} (${n.twoWay})` : `${n.standard} + ${n.twoWay}`;

/**
 * Righe della tabella "prima → dopo" dell'anteprima dello scambio, per le due squadre. In rosso: luxury tax che sale,
 * sforamento della soglia che cresce, rosa fuori dai limiti, buchi nuovi della regola Stepien, vincolo del saldo in
 * rosso non rispettato. Le regole sono quelle di tradePreview: qui si scrivono solo i testi.
 */
export function previewRows(preview: TradePreview, offseason: boolean): PreviewRow[] {
  const cells = (f: (s: SidePreview) => PreviewCell): [PreviewCell, PreviewCell] => [
    f(preview.sides[0]),
    f(preview.sides[1]),
  ];
  return [
    {
      label: 'Monte stipendi',
      cells: cells((s) => ({ text: change(mln1(s.before.payroll), mln1(s.after.payroll)), bad: false })),
    },
    {
      label: 'Spazio sotto il cap',
      cells: cells((s) => ({ text: change(capText(s.before), capText(s.after)), bad: false })),
    },
    {
      label: 'Dalla soglia della tassa',
      cells: cells((s) => ({
        text: change(taxRoomText(s.before), taxRoomText(s.after)),
        bad: s.after.taxRoom < 0 && s.after.taxRoom < s.before.taxRoom,
      })),
    },
    {
      label: 'Luxury tax stimata',
      cells: cells((s) => ({
        text: `${change(taxText(s.before), taxText(s.after))}${s.taxEstimated ? '*' : ''}`,
        bad: s.after.tax > s.before.tax,
      })),
    },
    {
      label: offseason ? 'Rosa in tutto (two-way)' : 'Rosa: standard + two-way',
      cells: cells((s) => ({
        text: change(rosterText(s.before, offseason), rosterText(s.after, offseason)),
        bad: !s.rosterOk,
      })),
    },
    {
      label: 'Regola Stepien',
      cells: cells((s) => ({
        text: s.stepienGaps.length ? `buco nel ${s.stepienGaps.join(', ')}` : 'ok',
        bad: s.stepienGaps.length > 0,
      })),
    },
    {
      label: 'Vincolo del saldo',
      cells: cells((s) => ({
        text: s.balance === 'unknown' ? 'riservato' : s.balance === 'blocked' ? 'non rispettato' : 'ok',
        bad: s.balance === 'blocked',
      })),
    },
  ];
}

/** Luxury tax stimata in più per la propria squadra (la prima dell'anteprima); 0 se non sale. */
export function myTaxIncrease(preview: TradePreview): number {
  const me = preview.sides[0];
  return Math.max(0, me.after.tax - me.before.tax);
}

/** Stipendio di questa stagione dei giocatori scelti per uno scambio (i two-way sono fuori dal monte). */
export function selectedSalary(
  roster: readonly { id: string; contractType: string | null; salaries: readonly number[] }[],
  ids: ReadonlySet<string>,
): number {
  return roster
    .filter((p) => ids.has(p.id) && p.contractType !== 'two-way')
    .reduce((a, p) => a + (p.salaries[0] ?? 0), 0);
}

/** "Prima scelta 2027", "Seconda scelta 2028". */
export function pickName(k: { round: number; draftYear: number }): string {
  return `${k.round === 1 ? 'Prima' : 'Seconda'} scelta ${k.draftYear}`;
}

/** Filtri degli svincolati che un bisogno della squadra applica (partendo da quelli di base). */
export function needQuery(n: Pick<Need, 'query'>): FreeAgentQuery {
  return { ...DEFAULT_FA_QUERY, ...n.query };
}

export function sameQuery(a: FreeAgentQuery, b: FreeAgentQuery): boolean {
  return a.name === b.name && a.role === b.role && a.age === b.age && a.ask === b.ask && a.sort === b.sort;
}

/** Il bisogno è quello acceso: i filtri degli svincolati sono esattamente i suoi. */
export function needActive(query: FreeAgentQuery, n: Pick<Need, 'query'>): boolean {
  return sameQuery(query, needQuery(n));
}

/** Sotto questa energia il giocatore rende meno (il motore toglie fino al 15% di efficacia sotto 70). */
export const LOW_ENERGY = 70;
/** Sotto questo morale il giocatore non rinnova il contratto. */
export const LOW_MORALE = 30;

/** Anno in cui finisce un contratto di n stagioni che parte dalla stagione firstYear-(firstYear+1): "fino al 2030". */
export function contractEnd(firstYear: number, seasons: number): number {
  return firstYear + seasons;
}

/** Peso di un voto nella pagella: le eccellenze in grassetto, i voti bassi più chiari. */
export function gradeTone(value: number): 'top' | 'mid' | 'low' {
  return value >= 80 ? 'top' : value < 50 ? 'low' : 'mid';
}

/** Come si mostra lo stato di un'offerta a uno svincolato: firmato d'inchiostro, perso o non valido in rosso. */
export function bidTone(status: string): 'ink' | 'red' | 'outline' {
  return status === 'won' ? 'ink' : status === 'lost' || status === 'invalid' ? 'red' : 'outline';
}
