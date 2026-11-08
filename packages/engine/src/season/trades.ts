import {
  MAX_STANDARD,
  MAX_TWO_WAY,
  MIN_STANDARD,
  OFFSEASON_MAX_ROSTER,
  contractOf,
  roster,
  standardRoster,
  twoWayRoster,
} from './finance.ts';
import { tradeDeadlineDay } from './calendar.ts';
import { deferralYears, ownPick, pickInSwap, stepienGaps, swapLive, swapTouches } from './picks.ts';
import type { DraftPick, DraftSwap, LeagueState } from './state.ts';

export interface Trade {
  teamA: string;
  teamB: string;
  /** Giocatori che A cede a B, e viceversa. */
  playersA: string[];
  playersB: string[];
  picksA: string[];
  picksB: string[];
  /** Diritti di swap concessi: holder riceve il diritto, other lo concede. */
  swaps?: Omit<DraftSwap, 'id'>[];
  /** Protezione "top N" (1-20) messa da chi cede su una sua prima scelta: id della scelta -> N. */
  protections?: Record<string, number>;
}

/** Protezione massima di una prima scelta ceduta. */
export const MAX_PROTECTION = 20;

/** "prima scelta 2028 di BOS (top 10)" */
export function pickName(
  k: Pick<DraftPick, 'round' | 'draftYear' | 'originalTeamId' | 'protection'>,
): string {
  return `${k.round === 1 ? 'prima' : 'seconda'} scelta ${k.draftYear} di ${k.originalTeamId}${k.protection ? ` (top ${k.protection})` : ''}`;
}

/**
 * Gli scambi si fanno fino alla trade deadline (il primo giovedì di febbraio, tradeDeadlineDay) compresa, poi sono
 * bloccati fino alla fine dei playoff.
 */
export function tradeWindowOpen(state: Pick<LeagueState, 'phase' | 'day' | 'config'>): boolean {
  if (state.phase === 'postseason') return false;
  if (state.phase === 'regular') return state.day <= tradeDeadlineDay(state.config.year);
  return true;
}

const roundName = (round: number) => (round === 1 ? 'prima' : 'seconda');

/** Ci sono id ripetuti? */
const repeats = (ids: readonly string[]) => new Set(ids).size !== ids.length;

/**
 * Motivi per cui lo scambio non è valido; vuoto se si può fare. È il controllo di tutti: la funzione market prima di
 * salvare una proposta, la chiusura del turno (runMarket) prima di eseguirla, l'anteprima nell'app e i bot.
 *
 * - Ogni giocatore e ogni scelta compare una volta sola (terza analisi: un id ripetuto contava due volte per il bot
 *   e nei conteggi di rosa e stipendi, mentre executeTrade lo sposta una volta).
 * - Uno swap riguarda le scelte proprie delle due squadre per un draft e un giro (anno e giro interi): le due
 *   squadre devono averle ancora, non possono cederle nello stesso scambio e nessun altro swap aperto può toccarle.
 *   Finché lo swap è aperto quelle scelte non si cedono. Non si fa uno swap su una prima scelta che il rinvio di una
 *   scelta protetta potrebbe portare via, né una protezione che lo renderebbe possibile.
 */
export function validateTrade(state: LeagueState, t: Trade): string[] {
  const problems: string[] = [];
  if (!tradeWindowOpen(state)) problems.push('Scambi bloccati dalla trade deadline');
  if (t.teamA === t.teamB) problems.push('Le due squadre coincidono');
  if (repeats([...t.playersA, ...t.playersB]))
    problems.push('Un giocatore compare più di una volta nello scambio');
  if (repeats([...t.picksA, ...t.picksB])) problems.push('Una scelta compare più di una volta nello scambio');
  const nextDraft = state.config.year + 1;
  for (const [team, players, picks] of [
    [t.teamA, t.playersA, t.picksA],
    [t.teamB, t.playersB, t.picksB],
  ] as const) {
    for (const id of players) {
      const p = state.players.find((x) => x.id === id);
      if (!p) problems.push('Un giocatore dello scambio non esiste');
      else if (p.teamId !== team) problems.push(`${p.firstName} ${p.lastName} non è di ${team}`);
    }
    for (const id of picks) {
      const pick = state.picks.find((x) => x.id === id);
      if (!pick) problems.push('Una scelta dello scambio non esiste');
      else if (pick.ownerId !== team) problems.push(`La ${pickName(pick)} non è di ${team}`);
      else if (pickInSwap(state.swaps, pick))
        problems.push(`La ${pickName(pick)} è legata a uno swap: non si cede finché lo swap è aperto`);
    }
  }
  for (const [id, n] of Object.entries(t.protections ?? {})) {
    const pick = state.picks.find((x) => x.id === id);
    const ceded = t.picksA.includes(id) ? t.teamA : t.picksB.includes(id) ? t.teamB : null;
    if (!pick || !ceded) problems.push('La protezione riguarda una scelta che non è nello scambio');
    else if (pick.round !== 1) problems.push('Si possono proteggere solo le prime scelte');
    else if (pick.originalTeamId !== ceded || pick.protection !== null)
      problems.push('Si protegge solo una propria prima scelta non ancora protetta');
    else if (!Number.isInteger(n) || n < 1 || n > MAX_PROTECTION)
      problems.push(`La protezione va da top 1 a top ${MAX_PROTECTION}`);
  }
  const traded = new Set([...t.picksA, ...t.picksB]);
  const swaps = t.swaps ?? [];
  swaps.forEach((w, i) => {
    const pair = new Set([w.holderId, w.otherId]);
    if (pair.size !== 2 || !pair.has(t.teamA) || !pair.has(t.teamB))
      problems.push('Lo swap deve essere tra le due squadre dello scambio');
    else if (w.round !== 1 && w.round !== 2) problems.push('Lo swap riguarda il primo o il secondo giro');
    else if (
      !Number.isInteger(w.draftYear) ||
      w.draftYear <= state.config.year ||
      w.draftYear > state.config.year + 7
    )
      problems.push('Lo swap riguarda uno dei prossimi 7 draft');
    else
      for (const team of [w.holderId, w.otherId]) {
        const own = ownPick(state.picks, team, w.draftYear, w.round);
        const name = `${roundName(w.round)} scelta ${w.draftYear} di ${team}`;
        if (own?.ownerId !== team) problems.push(`Lo swap riguarda la ${name}, che non è più sua`);
        else if (traded.has(own.id))
          problems.push(`La ${name} è nello scambio: non può essere anche in uno swap`);
        else if (
          state.swaps.some((x) => swapTouches(x, w.draftYear, w.round, team)) ||
          swaps.some((x, j) => j !== i && swapTouches(x, w.draftYear, w.round, team))
        )
          problems.push(`La ${name} è già legata a uno swap`);
      }
  });
  if (problems.length) return [...new Set(problems)];

  for (const [team, out, inn] of [
    [t.teamA, t.playersA, t.playersB],
    [t.teamB, t.playersB, t.playersA],
  ] as const) {
    const isTwoWay = (id: string) => contractOf(state, id)?.type === 'two-way';
    const standard =
      standardRoster(state, team).length -
      out.filter((id) => !isTwoWay(id)).length +
      inn.filter((id) => !isTwoWay(id)).length;
    const total = roster(state, team).length - out.length + inn.length;
    const twoWays =
      twoWayRoster(state, team).length - out.filter(isTwoWay).length + inn.filter(isTwoWay).length;
    if (twoWays > MAX_TWO_WAY) problems.push(`${team}: oltre ${MAX_TWO_WAY} two-way`);
    if (state.phase === 'offseason') {
      if (total > OFFSEASON_MAX_ROSTER)
        problems.push(`${team}: rosa oltre ${OFFSEASON_MAX_ROSTER} giocatori`);
    } else {
      if (standard > MAX_STANDARD) problems.push(`${team}: oltre ${MAX_STANDARD} contratti standard`);
      if (standard < MIN_STANDARD) problems.push(`${team}: sotto ${MIN_STANDARD} contratti standard`);
    }
    const salary = (ids: readonly string[]) =>
      ids.reduce((a, id) => a + (contractOf(state, id)?.salaries[0] ?? 0), 0);
    const team_ = state.teams.find((x) => x.id === team);
    if (team_ && team_.balance < 0 && salary(inn) > salary(out)) {
      problems.push(`${team}: con saldo negativo non può aumentare il monte stipendi`);
    }
  }
  // Regola Stepien: lo scambio non deve creare un buco nuovo. Una squadra che è già senza prima scelta in due draft
  // consecutivi (per esempio dopo il rinvio di una scelta protetta) può scambiare, se non peggiora la situazione
  const after = state.picks.map((p) => {
    const owner = t.picksA.includes(p.id) ? t.teamB : t.picksB.includes(p.id) ? t.teamA : p.ownerId;
    const protection = t.protections?.[p.id] ?? p.protection;
    return owner === p.ownerId && protection === p.protection ? p : { ...p, ownerId: owner, protection };
  });
  for (const team of [t.teamA, t.teamB]) {
    const before = new Set(stepienGaps(state.picks, team, nextDraft));
    if (stepienGaps(after, team, nextDraft).some((y) => !before.has(y)))
      problems.push(`${team}: resterebbe senza prima scelta in due draft consecutivi (regola Stepien)`);
  }
  // Rinvii delle scelte protette: una prima scelta in uno swap (nuovo, o aperto e ancora valido) non deve poter
  // passare ad altri. Uno swap aperto che lo poteva già prima dello scambio (salvato prima di questa regola) non
  // blocca gli scambi che non lo peggiorano
  for (const team of [t.teamA, t.teamB]) {
    const reachBefore = deferralYears(state.picks, team);
    const reachAfter = deferralYears(after, team);
    const firsts = (list: readonly Omit<DraftSwap, 'id'>[]) =>
      list.filter((w) => w.round === 1 && (w.holderId === team || w.otherId === team));
    for (const w of firsts(swaps))
      if (reachAfter.has(w.draftYear))
        problems.push(
          `La prima scelta ${w.draftYear} di ${team} potrebbe passare ad altri con il rinvio di una scelta protetta: niente swap su quella scelta`,
        );
    for (const w of firsts(state.swaps.filter((x) => swapLive(state.picks, x))))
      if (reachAfter.has(w.draftYear) && !reachBefore.has(w.draftYear))
        problems.push(
          `La prima scelta ${w.draftYear} di ${team} è legata a uno swap: la protezione potrebbe spostarla con un rinvio`,
        );
  }
  return problems;
}

/** Esegue uno scambio già validato. */
export function executeTrade(state: LeagueState, t: Trade, turn: number | null): void {
  const move = (ids: readonly string[], to: string) => {
    for (const id of ids) {
      const p = state.players.find((x) => x.id === id);
      if (p) p.teamId = to;
      const c = contractOf(state, id);
      if (c) c.teamId = to;
    }
  };
  move(t.playersA, t.teamB);
  move(t.playersB, t.teamA);
  for (const p of state.picks) {
    if (t.picksA.includes(p.id)) p.ownerId = t.teamB;
    else if (t.picksB.includes(p.id)) p.ownerId = t.teamA;
    const protection = t.protections?.[p.id];
    if (protection) p.protection = protection;
    // Una scelta protetta che torna alla squadra d'origine è di nuovo libera
    if (p.ownerId === p.originalTeamId && p.protection !== null) {
      p.protection = null;
      p.deferrals = 0;
    }
  }
  for (const s of t.swaps ?? [])
    state.swaps.push({ ...s, id: `${s.draftYear}-${s.round}-${s.holderId}-${s.otherId}` });
  const name = (id: string) => {
    const p = state.players.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : id;
  };
  const pick = (id: string) => {
    const k = state.picks.find((x) => x.id === id);
    return k ? pickName(k) : 'una scelta';
  };
  const side = (players: string[], picks: string[]) =>
    [...players.map(name), ...picks.map(pick)].join(', ') || 'niente';
  state.transactions.push({
    year: state.config.year,
    turn,
    type: 'trade',
    text: `Scambio: ${t.teamA} cede ${side(t.playersA, t.picksA)} a ${t.teamB} per ${side(t.playersB, t.picksB)}`,
  });
}

/** Differenza di monte stipendi per una squadra dopo lo scambio (positivo = spende di più); season come in payroll. */
export function payrollChange(state: LeagueState, t: Trade, team: string, season = 0): number {
  const salary = (ids: readonly string[]) =>
    ids.reduce((a, id) => a + (contractOf(state, id)?.salaries[season] ?? 0), 0);
  const [out, inn] = team === t.teamA ? [t.playersA, t.playersB] : [t.playersB, t.playersA];
  return salary(inn) - salary(out);
}
