// Firme al minimo per le squadre umane rimaste sotto 13 (Fase 9): il server sceglie i migliori svincolati
// dei ruoli più scoperti, per un anno al minimo.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { minimumSalaryFor } from '../src/season/config.ts';
import { contractOf, MIN_STANDARD, standardRoster } from '../src/season/finance.ts';
import { fillRosterAtMinimum } from '../src/season/freeAgency.ts';
import { createLeagueState } from '../src/season/season.ts';

describe('rosa umana sotto il minimo', () => {
  it('il server firma al minimo i migliori dei ruoli scoperti fino a 13', () => {
    const data = generateLeague(new Rng('minimo'), ARCHETYPE_PROFILES);
    const state = createLeagueState(data, 'minimo', { humanTeams: ['BOS'], potentialOnOverallScale: true });
    // Boston perde i suoi centri: restano senza contratto, con gli altri svincolati
    const centers = standardRoster(state, 'BOS').filter((p) => p.role === 'C');
    expect(centers.length).toBeGreaterThan(0);
    for (const p of centers) {
      state.contracts = state.contracts.filter((c) => c.playerId !== p.id);
      p.teamId = null;
    }
    while (standardRoster(state, 'BOS').length > MIN_STANDARD - 2) {
      const p = standardRoster(state, 'BOS').find((x) => x.role !== 'C')!;
      state.contracts = state.contracts.filter((c) => c.playerId !== p.id);
      p.teamId = null;
    }
    const signed = fillRosterAtMinimum(state, 'BOS', 5);
    expect(signed).toHaveLength(2);
    expect(standardRoster(state, 'BOS')).toHaveLength(MIN_STANDARD);
    // Il primo firmato è un centro, il migliore tra i centri svincolati
    const freeCenters = state.players.filter(
      (p) => p.role === 'C' && (p.teamId === null || signed.includes(p)),
    );
    const best = freeCenters.sort((a, b) => overall(b) - overall(a))[0]!;
    expect(signed[0]?.id).toBe(best.id);
    for (const p of signed) {
      const c = contractOf(state, p.id)!;
      expect(c).toMatchObject({ teamId: 'BOS', type: 'standard' });
      expect(c.salaries).toEqual([minimumSalaryFor(state.config, p.yearsInLeague)]);
    }
    expect(state.transactions.filter((t) => t.type === 'signing' && t.turn === 5)).toHaveLength(2);
  });
});
