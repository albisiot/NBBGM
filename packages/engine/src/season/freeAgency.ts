import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import { minimumSalaryFor } from './config.ts';
import { teamStrength, playerValue } from './bots.ts';
import {
  MIN_STANDARD,
  canSign,
  marketValue,
  payroll,
  roster,
  salaryRun,
  signContract,
  standardRoster,
  typicalYears,
} from './finance.ts';
import type { LeagueState, PlayerState } from './state.ts';

export interface Offer {
  teamId: string;
  playerId: string;
  salaries: number[];
}

/** Turni di free agency nell'offseason. */
export const FREE_AGENCY_ROUNDS = 4;

/**
 * Richiesta minima di uno svincolato: il suo valore di mercato, un po' più alta con il morale basso,
 * che scende di turno in turno senza andare sotto il minimo.
 */
export function askingSalary(state: LeagueState, p: PlayerState, round: number): number {
  const minimum = minimumSalaryFor(state.config, p.yearsInLeague);
  const ask = marketValue(state.config, p) * (1 + (50 - p.morale) / 400) * (1 - 0.12 * round);
  return Math.max(minimum, Math.round(ask / 10_000) * 10_000);
}

/** Posto che il giocatore avrebbe nella rotazione di una squadra: 1 da titolare, 0,6 da sesto-ottavo, 0,3 oltre. */
function expectedRole(state: LeagueState, teamId: string, p: PlayerState): number {
  const mine = overall(p);
  const better = roster(state, teamId).filter((x) => overall(x) > mine).length;
  const sameRoleBetter = roster(state, teamId).filter((x) => x.role === p.role && overall(x) > mine).length;
  if (better < 5 || sameRoleBetter === 0) return 1;
  return better < 8 ? 0.6 : 0.3;
}

/**
 * Punteggio di un'offerta per il giocatore: 0,55 soldi + 0,25 minuti attesi + 0,20 forza della squadra.
 * Dopo i 30 anni conta di più la durata.
 */
export function offerScore(
  state: LeagueState,
  p: PlayerState,
  offer: Offer,
  ask: number,
  strength: Map<string, number>,
): number {
  const years = offer.salaries.length;
  const money = Math.min(1.5, (offer.salaries[0] ?? 0) / ask) * (p.age >= 30 ? 1 + 0.06 * (years - 1) : 1);
  const minutes = expectedRole(state, offer.teamId, p);
  const s = Math.max(0, Math.min(1, ((strength.get(offer.teamId) ?? 60) - 60) / 15));
  return 0.55 * money + 0.25 * minutes + 0.2 * s;
}

/**
 * Risolve un turno di offerte: ogni svincolato sceglie, tra quelle sopra la richiesta, l'offerta con il
 * punteggio più alto (a parità, la squadra peggio classificata). Restituisce gli id firmati.
 */
export function resolveOffers(
  state: LeagueState,
  offers: readonly Offer[],
  round: number,
  worstFirst: readonly string[],
  turn: number | null,
): string[] {
  const strength = new Map(state.teams.map((t) => [t.id, teamStrength(state, t.id)]));
  const byPlayer = new Map<string, Offer[]>();
  for (const o of offers) byPlayer.set(o.playerId, [...(byPlayer.get(o.playerId) ?? []), o]);
  const signed: string[] = [];
  // I migliori scelgono per primi: le firme consumano spazio salariale e posti in rosa
  const order = [...byPlayer.keys()]
    .map((id) => state.players.find((p) => p.id === id) as PlayerState)
    .sort((a, b) => overall(b) - overall(a));
  for (const p of order) {
    if (p.teamId !== null) continue;
    const ask = askingSalary(state, p, round);
    const valid = (byPlayer.get(p.id) ?? []).filter(
      (o) => (o.salaries[0] ?? 0) >= ask && canSign(state, o.teamId, p, o.salaries[0] ?? 0).ok,
    );
    if (!valid.length) continue;
    const best = valid.reduce((a, b) => {
      const sa = offerScore(state, p, a, ask, strength);
      const sb = offerScore(state, p, b, ask, strength);
      if (sb > sa + 1e-9) return b;
      if (Math.abs(sb - sa) <= 1e-9 && worstFirst.indexOf(b.teamId) < worstFirst.indexOf(a.teamId)) return b;
      return a;
    });
    signContract(
      state,
      p,
      {
        playerId: p.id,
        teamId: best.teamId,
        type: 'standard',
        salaries: best.salaries,
        options: best.salaries.map(() => null),
        guaranteed: null,
      },
      turn,
    );
    signed.push(p.id);
  }
  return signed;
}

/** Offerte dei bot in un turno di free agency: coprono i posti liberi con chi vale di più per il prezzo. */
export function botOffers(state: LeagueState, round: number, rng: Rng, opts: { fillTo: number }): Offer[] {
  const free = state.players.filter((p) => p.teamId === null && p.age < 39);
  const offers: Offer[] = [];
  for (const team of state.teams) {
    if (team.human) continue;
    const open = opts.fillTo - standardRoster(state, team.id).length;
    if (open <= 0) continue;
    const space = state.config.salaryCap - payroll(state, team.id);
    const scored = free
      .map((p) => {
        const ask = askingSalary(state, p, round);
        const minimum = minimumSalaryFor(state.config, p.yearsInLeague);
        const affordable = ask <= minimum || (space >= ask && team.balance >= 0);
        return {
          p,
          ask,
          affordable,
          value: playerValue(p, undefined, team.strategy, state.config) / (ask / 1e6 + 2),
        };
      })
      .filter((x) => x.affordable)
      .sort((a, b) => b.value - a.value)
      .slice(0, Math.min(open, 3) + 2);
    for (const { p, ask } of scored.slice(0, Math.min(open, 3))) {
      const salary = Math.round((ask * (1 + rng.next() * 0.08)) / 10_000) * 10_000;
      const first = salary > space && salary > minimumSalaryFor(state.config, p.yearsInLeague) ? ask : salary;
      offers.push({ teamId: team.id, playerId: p.id, salaries: salaryRun(first, typicalYears(p.age)) });
    }
  }
  return offers;
}

/** In stagione: chi ha meno di 13 contratti standard firma al minimo i migliori svincolati. */
export function fillMinimumRosters(state: LeagueState, turn: number | null): void {
  for (const team of state.teams) {
    if (team.human) continue;
    while (standardRoster(state, team.id).length < MIN_STANDARD) {
      const free = state.players
        .filter((p) => p.teamId === null && p.age < 39)
        .sort((a, b) => overall(b) - overall(a));
      const p = free[0];
      if (!p) break;
      const salary = minimumSalaryFor(state.config, p.yearsInLeague);
      signContract(
        state,
        p,
        {
          playerId: p.id,
          teamId: team.id,
          type: 'standard',
          salaries: [salary],
          options: [null],
          guaranteed: null,
        },
        turn,
      );
    }
  }
}
