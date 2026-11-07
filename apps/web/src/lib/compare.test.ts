import { ARCHETYPE_PROFILES, generatePlayer, Rng, type Role } from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import { bestOf, compareHref, parseCompare, searchText, withPlayer } from './compare.ts';
import { DEFAULT_FA_QUERY, filterFreeAgents } from './market.ts';
import { rotationProfile, skillAverage, skillOf } from './skills.ts';
import { teamNeeds, WEAK_GAP } from './teamNeeds.ts';

const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const C = '00000000-0000-4000-8000-00000000000c';
const D = '00000000-0000-4000-8000-00000000000d';

describe('confronto tra giocatori', () => {
  it('fino a 3 id validi, senza doppioni; il quarto fa uscire il primo', () => {
    expect(parseCompare(`${A},${B},${A},nonunid,${C},${D}`)).toEqual([B, C, D]);
    expect(parseCompare(null)).toEqual([]);
    expect(withPlayer([A, B], C)).toEqual([A, B, C]);
    expect(withPlayer([A, B, C], D)).toEqual([B, C, D]);
    expect(withPlayer([A, B, C], A)).toEqual([B, C, A]);
    expect(compareHref('L', [A, B])).toBe(`/lega/L/confronta?g=${A},${B}`);
    expect(compareHref('L', [])).toBe('/lega/L/confronta');
  });

  it('il migliore di ogni riga, anche a pari merito; niente se tutti uguali o senza confronto', () => {
    const line = (scores: (number | null)[], higher: boolean | null = true) => ({
      label: 'x',
      values: scores.map((s) => ({ text: String(s), score: s })),
      higher,
    });
    expect([...bestOf(line([70, 80, 75]))]).toEqual([1]);
    expect([...bestOf(line([80, 80, 75]))]).toEqual([0, 1]);
    expect([...bestOf(line([2.1, 3.4], false))]).toEqual([0]);
    expect([...bestOf(line([70, 70]))]).toEqual([]);
    expect([...bestOf(line([70, null]))]).toEqual([]);
    expect([...bestOf(line([70, 60], null))]).toEqual([]);
  });

  it('la ricerca toglie i caratteri dei filtri PostgREST e tiene gli accenti', () => {
    expect(searchText(' Dončić, (Luka)* ')).toBe('Dončić Luka');
    expect(searchText("O'Neal  Jr.")).toBe("O'Neal Jr.");
    expect(searchText('a%b_c')).toBe('abc');
  });
});

describe('bisogni della squadra', () => {
  const rng = new Rng('bisogni');
  const make = (role: Role, i: number, level = 0) => ({
    ...generatePlayer(rng, ARCHETYPE_PROFILES, { id: `p${i}`, role, level }),
    contractType: 'standard' as string | null,
  });

  it('ruoli scoperti rispetto a 3 PG, 3 SG, 3 SF, 2 PF e 2 C (i two-way non contano)', () => {
    const roster = [
      ...(['PG', 'SG', 'SG', 'SG', 'SF', 'SF', 'SF', 'PF', 'PF', 'C', 'C'] as Role[]).map((r, i) =>
        make(r, i),
      ),
      { ...make('PG', 20), contractType: 'two-way' },
    ];
    const needs = teamNeeds(roster, null);
    expect(needs.map((n) => n.title)).toEqual(['Serve un PG']);
    expect(needs[0]).toMatchObject({ kind: 'role', query: { role: 'PG', sort: 'overall' } });
    expect(needs[0]!.detail).toBe('Ne hai 1 su 3 come ruolo principale.');
  });

  it('punti deboli: i gruppi sotto la media della lega di almeno 2 punti, dal più grave, al massimo 3', () => {
    const roster = (
      ['PG', 'PG', 'PG', 'SG', 'SG', 'SG', 'SF', 'SF', 'SF', 'PF', 'PF', 'C', 'C'] as Role[]
    ).map((r, i) => make(r, i));
    const mine = rotationProfile(roster);
    const league = { ...mine };
    league.rimbalzi += 6;
    league.tiro3 += WEAK_GAP;
    league.regia += 1.5;
    league.post += 3;
    league.atletismo += 10;
    const needs = teamNeeds(roster, league).filter((n) => n.kind === 'skill');
    expect(needs.map((n) => n.title)).toEqual(['Atletismo', 'Rimbalzi', 'Gioco in post']);
    expect(needs[1]!.query).toEqual({ sort: 'skill:rimbalzi' });
  });

  it('la rotazione sono gli 8 con la media dei gruppi più alta', () => {
    const roster = Array.from({ length: 12 }, (_, i) => make('SF', 100 + i, i / 3));
    const top = [...roster].sort((a, b) => skillAverage(b.ratings) - skillAverage(a.ratings)).slice(0, 8);
    const want = top.reduce((a, p) => a + skillOf(p.ratings, 'tiro3'), 0) / 8;
    expect(rotationProfile(roster).tiro3).toBeCloseTo(want, 9);
  });

  it('gli svincolati si ordinano anche per gruppo di abilità', () => {
    const rows = [make('PG', 1, -1), make('C', 2, 1), make('SF', 3, 0)].map((p) => ({
      p: { ...p, scoutedPotential: 50 },
      ovr: 60,
      ask: 1,
      minimum: 1,
    }));
    const sorted = filterFreeAgents(rows, { ...DEFAULT_FA_QUERY, sort: 'skill:rimbalzi' }, 0);
    const values = sorted.map((r) => skillOf(r.p.ratings, 'rimbalzi'));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});
