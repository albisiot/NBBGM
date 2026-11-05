// Firme al minimo per le squadre rimaste sotto 13 (Fase 9): il server sceglie i migliori svincolati dei ruoli
// più scoperti, per un anno al minimo. Dopo la Fase 13: solo tra chi accetta il minimo (lo chiede o quasi) ed è
// sano, così tagliare un giocatore non fa arrivare gratis uno svincolato che chiede milioni.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { minimumSalaryFor } from '../src/season/config.ts';
import { contractOf, MIN_STANDARD, standardRoster } from '../src/season/finance.ts';
import {
  askingSalaryFor,
  fillMinimumRosters,
  fillRosterAtMinimum,
  FREE_AGENCY_ROUNDS,
  MINIMUM_SIGNING_SLACK,
  minimumSigningPool,
} from '../src/season/freeAgency.ts';
import { createLeagueState } from '../src/season/season.ts';
import type { LeagueState, PlayerState } from '../src/season/state.ts';

function league(): LeagueState {
  const data = generateLeague(new Rng('minimo'), ARCHETYPE_PROFILES);
  return createLeagueState(data, 'minimo', { humanTeams: ['BOS'], potentialOnOverallScale: true });
}

/** Abilità da stella (nella lega generata gli overall sono bassi e quasi tutti chiedono il minimo). */
function makeStar(p: PlayerState, level: number): void {
  for (const k of Object.keys(p.ratings) as (keyof PlayerState['ratings'])[]) p.ratings[k] = level;
}

/** Il giocatore lascia la squadra senza contratto. */
function free(state: LeagueState, p: PlayerState): void {
  state.contracts = state.contracts.filter((c) => c.playerId !== p.id);
  p.teamId = null;
}

const ask = (state: LeagueState, p: PlayerState) => askingSalaryFor(state.config, p, FREE_AGENCY_ROUNDS - 1);
const acceptsMinimum = (state: LeagueState, p: PlayerState) =>
  p.injury === null &&
  ask(state, p) <= minimumSalaryFor(state.config, p.yearsInLeague) * MINIMUM_SIGNING_SLACK;

describe('rosa sotto il minimo', () => {
  it('il server firma al minimo i migliori dei ruoli scoperti fino a 13, tra chi accetta il minimo', () => {
    const state = league();
    // Boston perde i suoi centri: restano senza contratto, con gli altri svincolati
    const centers = standardRoster(state, 'BOS').filter((p) => p.role === 'C');
    expect(centers.length).toBeGreaterThan(0);
    for (const p of centers) free(state, p);
    while (standardRoster(state, 'BOS').length > MIN_STANDARD - 2)
      free(
        state,
        standardRoster(state, 'BOS').find((x) => x.role !== 'C')!,
      );
    const pool = minimumSigningPool(state);
    const signed = fillRosterAtMinimum(state, 'BOS', 5);
    expect(signed).toHaveLength(2);
    expect(standardRoster(state, 'BOS')).toHaveLength(MIN_STANDARD);
    // Il primo firmato è un centro, il migliore tra i centri che accettano il minimo
    const best = pool.filter((p) => p.role === 'C').sort((a, b) => overall(b) - overall(a))[0]!;
    expect(signed[0]?.id).toBe(best.id);
    for (const p of signed) {
      expect(acceptsMinimum(state, p)).toBe(true);
      const c = contractOf(state, p.id)!;
      expect(c).toMatchObject({ teamId: 'BOS', type: 'standard' });
      expect(c.salaries).toEqual([minimumSalaryFor(state.config, p.yearsInLeague)]);
    }
    expect(state.transactions.filter((t) => t.type === 'signing' && t.turn === 5)).toHaveLength(2);
  });

  it('tagliare non fa arrivare al minimo chi chiede milioni, né un infortunato', () => {
    const state = league();
    // Tra gli svincolati: la stella di un'altra squadra (chiede molto) e un buon giocatore infortunato
    const star = [...standardRoster(state, 'MIA')].sort((a, b) => overall(b) - overall(a))[0]!;
    free(state, star);
    makeStar(star, 92);
    const hurt = [...standardRoster(state, 'NYK')].sort((a, b) => overall(b) - overall(a))[3]!;
    free(state, hurt);
    hurt.injury = { bodyPart: 'ankles', severity: 'medium', gamesRemaining: 10 };
    expect(ask(state, star)).toBeGreaterThan(minimumSalaryFor(state.config, star.yearsInLeague) * 3);
    // Boston (umana) e Chicago (bot) scendono a 12
    for (const team of ['BOS', 'CHI'])
      while (standardRoster(state, team).length >= MIN_STANDARD) free(state, standardRoster(state, team)[0]!);
    const before = new Set(standardRoster(state, 'CHI').map((p) => p.id));
    const signed = fillRosterAtMinimum(state, 'BOS', 5);
    fillMinimumRosters(state, 5);
    expect(standardRoster(state, 'BOS')).toHaveLength(MIN_STANDARD);
    expect(standardRoster(state, 'CHI')).toHaveLength(MIN_STANDARD);
    for (const p of [star, hurt]) expect(p.teamId).toBeNull();
    const chi = standardRoster(state, 'CHI').filter((p) => !before.has(p.id));
    expect(chi.length).toBeGreaterThan(0);
    for (const p of [...signed, ...chi]) expect(acceptsMinimum(state, p)).toBe(true);
  });

  it('se nessuno accetta il minimo, la rosa arriva comunque a 13 con chi chiede meno', () => {
    const state = league();
    while (standardRoster(state, 'BOS').length >= MIN_STANDARD) free(state, standardRoster(state, 'BOS')[0]!);
    // Fuori dal mercato tutti gli svincolati; restano solo due giocatori forti, che chiedono più del minimo
    for (const p of state.players.filter((x) => x.teamId === null)) p.teamId = 'ritirato';
    const strong = [...standardRoster(state, 'MIA')].sort((a, b) => overall(b) - overall(a)).slice(0, 2);
    strong.forEach((p, i) => {
      free(state, p);
      makeStar(p, 85 + 5 * i);
    });
    for (const p of strong) expect(acceptsMinimum(state, p)).toBe(false);
    const signed = fillRosterAtMinimum(state, 'BOS', 5);
    expect(signed).toHaveLength(1);
    expect(standardRoster(state, 'BOS')).toHaveLength(MIN_STANDARD);
    const cheaper = [...strong].sort(
      (a, b) =>
        ask(state, a) / minimumSalaryFor(state.config, a.yearsInLeague) -
        ask(state, b) / minimumSalaryFor(state.config, b.yearsInLeague),
    )[0]!;
    expect(signed[0]!.id).toBe(cheaper.id);
  });
});
