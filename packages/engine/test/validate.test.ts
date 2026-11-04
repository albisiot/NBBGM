import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { validateLeague } from '../src/validate.ts';

const base = () => generateLeague(new Rng('validazione'), ARCHETYPE_PROFILES);

describe('validateLeague', () => {
  it('segnala valori fuori scala e id duplicati come errori', () => {
    const league = base();
    league.players[0]!.ratings.threePoint = 140;
    league.players[2]!.id = league.players[1]!.id;
    const errors = validateLeague(league)
      .filter((i) => i.level === 'error')
      .map((i) => i.message);
    expect(errors.some((m) => m.includes('threePoint = 140, fuori da 0-100'))).toBe(true);
    expect(errors.some((m) => m.includes('id duplicato'))).toBe(true);
  });

  it('segnala le rose fuori misura come avvisi', () => {
    const league = base();
    const extra = league.players.filter((p) => p.teamId === null).slice(0, 2);
    for (const p of extra) {
      p.teamId = 'BOS';
      league.contracts.push({
        playerId: p.id,
        teamId: 'BOS',
        type: 'standard',
        salaries: [1_300_000],
        options: [null],
        guaranteed: null,
      });
    }
    const warnings = validateLeague(league)
      .filter((i) => i.level === 'warning')
      .map((i) => i.message);
    expect(warnings).toContain('Boston Celtics: 17 contratti standard, oltre il massimo di 15');
  });

  it('un giocatore migliore in tutto ha un overall più alto', () => {
    const p = base().players[0]!;
    const better = {
      ...p,
      ratings: Object.fromEntries(
        Object.entries(p.ratings).map(([k, v]) => [k, Math.min(99, v + 10)]),
      ) as typeof p.ratings,
    };
    expect(overall(better)).toBeGreaterThan(overall(p));
  });
});
