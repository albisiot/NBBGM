import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateDraftClass, generateLeague, generatePlayer } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { validateLeague } from '../src/validate.ts';

describe('generatore', () => {
  it('produce una lega di 30 squadre valida', () => {
    const league = generateLeague(new Rng('lega'), ARCHETYPE_PROFILES);
    expect(league.teams).toHaveLength(30);
    for (const t of league.teams) expect(league.players.filter((p) => p.teamId === t.id)).toHaveLength(15);
    expect(new Set(league.players.map((p) => p.id)).size).toBe(league.players.length);
    expect(validateLeague(league)).toEqual([]);
  });

  it('stesso seed, stessa lega', () => {
    const a = generateLeague(new Rng('s'), ARCHETYPE_PROFILES);
    const b = generateLeague(new Rng('s'), ARCHETYPE_PROFILES);
    expect(a).toEqual(b);
  });

  it('pochi fuoriclasse, molte riserve', () => {
    const league = generateLeague(new Rng('distribuzione'), ARCHETYPE_PROFILES);
    const ovr = league.players.map((p) => overall(p)).sort((x, y) => x - y);
    const stars = ovr.filter((o) => o >= 80).length;
    expect(stars).toBeGreaterThan(3);
    expect(stars / ovr.length).toBeLessThan(0.1);
    const median = ovr[Math.floor(ovr.length / 2)]!;
    expect(median).toBeGreaterThan(54);
    expect(median).toBeLessThan(68);
  });

  it('i centri sono più alti e stoppano più dei playmaker', () => {
    const rng = new Rng('ruoli');
    const make = (role: 'PG' | 'C') =>
      Array.from({ length: 200 }, (_, i) =>
        generatePlayer(rng, ARCHETYPE_PROFILES, { id: `${role}${i}`, role }),
      );
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const pg = make('PG');
    const c = make('C');
    expect(avg(c.map((p) => p.heightCm))).toBeGreaterThan(avg(pg.map((p) => p.heightCm)) + 10);
    expect(avg(c.map((p) => p.ratings.block))).toBeGreaterThan(avg(pg.map((p) => p.ratings.block)) + 20);
    expect(avg(pg.map((p) => p.ratings.ballHandle))).toBeGreaterThan(
      avg(c.map((p) => p.ratings.ballHandle)) + 15,
    );
  });

  it('classe di draft: giovani con potenziale sopra il livello attuale', () => {
    const rookies = generateDraftClass(new Rng('draft'), ARCHETYPE_PROFILES, { idPrefix: 'd2027' });
    expect(rookies).toHaveLength(60);
    for (const r of rookies) {
      expect(r.age).toBeGreaterThanOrEqual(19);
      expect(r.age).toBeLessThanOrEqual(22);
      expect(r.hidden.potential).toBeGreaterThanOrEqual(overall(r));
    }
  });
});
