import {
  MAX_STANDARD,
  MIN_STANDARD,
  OFFSEASON_MAX_ROSTER,
  contractOf,
  roster,
  standardRoster,
} from './finance.ts';
import { violatesStepien } from './picks.ts';
import type { DraftPick, DraftSwap, LeagueState } from './state.ts';

/** Trade deadline: dopo questo turno (circa 2/3 di regular season) gli scambi sono bloccati fino alla fine dei playoff. */
export const TRADE_DEADLINE_TURN = 55;

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

export function tradeWindowOpen(state: LeagueState): boolean {
  if (state.phase === 'postseason') return false;
  if (state.phase === 'regular') return state.turn <= TRADE_DEADLINE_TURN;
  return true;
}

/** Motivi per cui lo scambio non è valido; vuoto se si può fare. */
export function validateTrade(state: LeagueState, t: Trade): string[] {
  const problems: string[] = [];
  if (!tradeWindowOpen(state)) problems.push('Scambi bloccati dalla trade deadline');
  if (t.teamA === t.teamB) problems.push('Le due squadre coincidono');
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
  for (const w of t.swaps ?? []) {
    const pair = new Set([w.holderId, w.otherId]);
    if (pair.size !== 2 || !pair.has(t.teamA) || !pair.has(t.teamB))
      problems.push('Lo swap deve essere tra le due squadre dello scambio');
    else if (w.round !== 1 && w.round !== 2) problems.push('Lo swap riguarda il primo o il secondo giro');
    else if (w.draftYear <= state.config.year || w.draftYear > state.config.year + 7)
      problems.push('Lo swap riguarda uno dei prossimi 7 draft');
    else if (
      state.swaps.some(
        (x) =>
          x.draftYear === w.draftYear &&
          x.round === w.round &&
          new Set([x.holderId, x.otherId, ...pair]).size === 2,
      )
    )
      problems.push(`C'è già uno swap tra le due squadre per il draft ${w.draftYear}`);
  }
  if (problems.length) return problems;

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
  // Regola Stepien dopo lo scambio
  const after = state.picks.map((p) => {
    if (t.picksA.includes(p.id)) return { ...p, ownerId: t.teamB };
    if (t.picksB.includes(p.id)) return { ...p, ownerId: t.teamA };
    return p;
  });
  for (const team of [t.teamA, t.teamB]) {
    if (violatesStepien(after, team, nextDraft))
      problems.push(`${team}: resterebbe senza prima scelta in due draft consecutivi (regola Stepien)`);
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

/** Differenza di monte stipendi per una squadra dopo lo scambio (positivo = spende di più). */
export function payrollChange(state: LeagueState, t: Trade, team: string): number {
  const salary = (ids: readonly string[]) =>
    ids.reduce((a, id) => a + (contractOf(state, id)?.salaries[0] ?? 0), 0);
  const [out, inn] = team === t.teamA ? [t.playersA, t.playersB] : [t.playersB, t.playersA];
  return salary(inn) - salary(out);
}
