import { describe, expect, it, vi } from 'vitest';
import { leaguePicks, mergePicks, missingPickIds, picksByIds, type PickInfo } from './market.ts';

// Finto PostgREST per draft_picks: eq, is (null), or (colonne in cui compare la squadra) e in, come li interpreta il
// database. Le scelte usate al draft restano con la loro posizione e il giocatore null (come le salva il turno).
const server = vi.hoisted(() => {
  type Row = Record<string, string | number | null>;
  const state = { rows: [] as Row[], requests: [] as string[] };
  const from = (table: string) => {
    const filters: ((r: Row) => boolean)[] = [];
    let columns = '';
    const q = {
      select(c: string) {
        columns = c;
        return q;
      },
      eq(col: string, v: unknown) {
        filters.push((r) => r[col] === v);
        return q;
      },
      is(col: string, v: null) {
        filters.push((r) => r[col] === v);
        return q;
      },
      in(col: string, vs: unknown[]) {
        filters.push((r) => vs.includes(r[col]));
        return q;
      },
      or(expr: string) {
        const terms = expr.split(',').map((t) => {
          const [col, op, v] = t.split('.') as [string, string, string];
          if (op !== 'eq') throw new Error(`filtro inatteso: ${t}`);
          return (r: Row) => r[col] === v;
        });
        filters.push((r) => terms.some((f) => f(r)));
        return q;
      },
      order: () => q,
      then(ok: (v: unknown) => unknown) {
        state.requests.push(`${table}?${columns}`);
        const keep = columns.split(', ');
        const data = state.rows
          .filter((r) => filters.every((f) => f(r)))
          .map((r) => Object.fromEntries(keep.map((c) => [c, r[c]])));
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  return { state, from };
});
vi.mock('./supabase.ts', () => ({ supabase: { from: server.from } }));

const row = (id: string, over: Record<string, string | number | null> = {}) => ({
  id,
  league_id: 'L',
  draft_year: 2027,
  round: 1,
  original_team_id: 'A',
  owner_team_id: 'A',
  protection: null,
  deferrals: 0,
  position: null,
  player_id: null,
  ...over,
});

describe('scelte al draft nel mercato e nella pagina della squadra', () => {
  it('le scelte già usate (con la posizione al draft) non sono future, anche con il giocatore null', () => {
    server.state.rows = [
      row('usata', { draft_year: 2026, position: 4 }),
      row('futura', {
        draft_year: 2028,
        original_team_id: 'B',
        owner_team_id: 'A',
        protection: 10,
        deferrals: 1,
      }),
      row('di-altri', { owner_team_id: 'C', original_team_id: 'C' }),
      row('altra-lega', { league_id: 'M' }),
    ];
    return Promise.all([leaguePicks('L', 'A'), leaguePicks('L')]).then(([mine, all]) => {
      expect(mine.map((k) => k.id)).toEqual(['futura']);
      expect(mine[0]).toMatchObject({ originalTeamId: 'B', ownerTeamId: 'A', protection: 10, deferrals: 1 });
      expect(all.map((k) => k.id).sort()).toEqual(['di-altri', 'futura']);
    });
  });

  it('le scelte citate dalle proposte che mancano si leggono per id, anche se già usate', async () => {
    server.state.rows = [row('usata', { position: 12 }), row('x', { owner_team_id: 'B' })];
    const offers = [
      { picksFrom: ['x', 'nota'], picksTo: ['usata'] },
      { picksFrom: [], picksTo: ['x'] },
    ];
    const known = new Map([['nota', {}]]);
    expect(missingPickIds(offers, known)).toEqual(['x', 'usata']);
    const found = await picksByIds(missingPickIds(offers, known));
    expect(found.map((k) => k.id).sort()).toEqual(['usata', 'x']);
  });

  it('le scelte delle due squadre senza doppioni, in ordine di draft e giro', () => {
    const k = (id: string, draftYear: number, round: 1 | 2): PickInfo => ({
      id,
      draftYear,
      round,
      originalTeamId: 'A',
      ownerTeamId: 'A',
      protection: null,
    });
    expect(
      mergePicks([k('a', 2028, 1), k('b', 2027, 2)], [k('b', 2027, 2), k('c', 2027, 1)]).map((x) => x.id),
    ).toEqual(['c', 'b', 'a']);
  });
});
