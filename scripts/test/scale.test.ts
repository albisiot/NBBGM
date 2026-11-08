import {
  ARCHETYPE_PROFILES,
  generateLeague,
  OVERALL_SCALE,
  overallRaw,
  RATING_KEYS,
  ROLES,
  Rng,
  type LeagueData,
} from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import { REFERENCE_SCALE, toReferenceScale, V2_OVERALL_QUANTILES } from '../src/import/scale.ts';

type Players = LeagueData['players'];

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));

/** Una lega generata portata su una scala "alla 2K": abilità più alte, costanze molto più disperse. */
function twoKLike(): Players {
  const league = generateLeague(new Rng('scala'), ARCHETYPE_PROFILES);
  return league.players.map((p) => ({
    ...p,
    ratings: Object.fromEntries(
      RATING_KEYS.map((k) => [k, Math.min(99, Math.round(p.ratings[k] * 1.1 + 6))]),
    ) as typeof p.ratings,
    hidden: {
      ...p.hidden,
      offensiveConsistency: Math.max(25, Math.min(99, p.hidden.offensiveConsistency * 2 - 60)),
    },
  }));
}

describe('toReferenceScale', () => {
  const input = twoKLike();
  const { players, changes } = toReferenceScale(input);
  const rostered = players.filter((p) => p.teamId !== null);

  it('dà all’overall la distribuzione del v2, con media e dispersione di OVERALL_SCALE per ruolo', () => {
    expect(changes.map((c) => c.role)).toEqual([...ROLES]);
    const z = rostered
      .map((p) => (overallRaw(p.ratings, p.role) - OVERALL_SCALE[p.role].mean) / OVERALL_SCALE[p.role].sd)
      .sort((a, b) => a - b);
    for (const [u, expected] of V2_OVERALL_QUANTILES.filter(([u]) => [0.1, 0.5, 0.9, 0.975].includes(u)))
      expect(Math.abs(z[Math.round(u * (z.length - 1))]! - expected!), `quantile ${u}`).toBeLessThan(0.1);
    for (const role of ROLES) {
      const raws = rostered.filter((p) => p.role === role).map((p) => overallRaw(p.ratings, role));
      expect(Math.abs(mean(raws) - OVERALL_SCALE[role].mean), role).toBeLessThan(0.5);
      expect(Math.abs(sd(raws) - OVERALL_SCALE[role].sd), role).toBeLessThan(0.6);
    }
  });

  it('riporta le costanze alla scala del ruolo, con lo stesso ordine', () => {
    for (const role of ROLES) {
      const list = rostered.filter((p) => p.role === role);
      const xs = list.map((p) => p.hidden.offensiveConsistency);
      const ref = REFERENCE_SCALE[role].hidden.offensiveConsistency;
      expect(Math.abs(mean(xs) - ref.mean)).toBeLessThan(0.6);
      expect(Math.abs(sd(xs) - ref.sd)).toBeLessThan(0.6);
      const before = new Map(input.map((p) => [p.id, p.hidden.offensiveConsistency]));
      const sorted = [...list].sort((a, b) => before.get(a.id)! - before.get(b.id)!);
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i]!.hidden.offensiveConsistency).toBeGreaterThanOrEqual(
          sorted[i - 1]!.hidden.offensiveConsistency,
        );
    }
  });

  it('dà valori interi tra 0 e 100 e non tocca tendenze, Freddezza e Leadership', () => {
    for (const p of players) {
      for (const k of RATING_KEYS) {
        expect(Number.isInteger(p.ratings[k])).toBe(true);
        expect(p.ratings[k]).toBeGreaterThanOrEqual(0);
        expect(p.ratings[k]).toBeLessThanOrEqual(100);
      }
    }
    const byId = new Map(input.map((p) => [p.id, p]));
    for (const p of players) {
      const q = byId.get(p.id)!;
      expect(p.tendencies).toEqual(q.tendencies);
      expect([p.ratings.clutch, p.ratings.leadership]).toEqual([q.ratings.clutch, q.ratings.leadership]);
      expect(p.hidden.potential).toBe(q.hidden.potential);
    }
  });

  it('gli svincolati seguono le rette dei giocatori nelle rose', () => {
    const twin = input.find((p) => p.teamId !== null)!;
    const free = { ...twin, id: 'gemello', teamId: null };
    const out = toReferenceScale([...input, free]).players;
    const a = out.find((p) => p.id === twin.id)!;
    const b = out.find((p) => p.id === 'gemello')!;
    expect(b.ratings).toEqual(a.ratings);
    expect(b.hidden).toEqual(a.hidden);
  });

  it('su un file già alla scala di riferimento cambia poco', () => {
    const again = toReferenceScale(players).players;
    const diffs = again.flatMap((p, i) =>
      RATING_KEYS.map((k) => Math.abs(p.ratings[k] - players[i]!.ratings[k])),
    );
    expect(mean(diffs)).toBeLessThan(0.6);
  });
});
