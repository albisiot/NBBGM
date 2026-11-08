import { coachAsk, CONFIG_2026_27, DEFAULT_OWNER } from '@nbbgm/engine';
import { describe, expect, it, vi } from 'vitest';
import {
  coachContractText,
  coachFromRow,
  coachGrades,
  contractTotal,
  freeCoachesByRating,
  hireProblem,
  leagueCoaches,
  myCoachRequest,
  ownerTraitsText,
  stars,
  teamStaff,
  traitsText,
  type CoachInfo,
  type CoachRow,
} from './coaches.ts';
import { millions } from './market.ts';

// Finto PostgREST: una tabella che non c'è ancora (app pubblicata prima della migrazione) o qualche riga
const server = vi.hoisted(() => {
  const state = { missing: false, rows: [] as unknown[] };
  const from = () => {
    const q = {
      select: () => q,
      eq: () => q,
      order: () => q,
      maybeSingle: () =>
        Promise.resolve(
          state.missing
            ? { data: null, error: { code: 'PGRST205', message: 'tabella' } }
            : { data: state.rows[0] ?? null, error: null },
        ),
      then(ok: (v: unknown) => unknown) {
        return Promise.resolve(
          state.missing
            ? { data: null, error: { code: '42P01', message: 'tabella' } }
            : { data: state.rows, error: null },
        ).then(ok);
      },
    };
    return q;
  };
  return { state, from };
});
vi.mock('./supabase.ts', () => ({ supabase: { from: server.from } }));

const row: CoachRow = {
  id: 'c1',
  team_id: null,
  first_name: 'Mike',
  last_name: 'Carter',
  nationality: 'Stati Uniti',
  age: 52,
  philosophy: 'space',
  traits: { rotation: 'short', trust: 'youth', rest: 'high', flexible: true },
  ratings: { tactics: 82, development: 40, motivation: 60 },
  salaries: ['7300000', 7519000],
  since: null,
};

const coach = (over: Partial<CoachInfo> = {}): CoachInfo => ({ ...coachFromRow(row), ...over });

describe('allenatori nell’app', () => {
  it('dalla riga del database, con gli stipendi in numeri', () => {
    const c = coachFromRow(row);
    expect(c.salaries).toEqual([7_300_000, 7_519_000]);
    expect(c.philosophy).toBe('space');
    expect(c.teamId).toBeNull();
  });

  it('stelle, qualità e carattere in parole', () => {
    expect(stars(82)).toBe('★★★★★');
    expect(stars(40)).toBe('★★☆☆☆');
    expect(coachGrades(coach()).map((g) => [g.label, g.stars])).toEqual([
      ['Tattica', 5],
      ['Sviluppo', 2],
      ['Gestione del gruppo', 3],
    ]);
    expect(traitsText(coach().traits)).toEqual([
      'Rotazione corta',
      'Fa giocare i giovani',
      'Fa riposare chi è stanco',
      'Si adatta alla rosa',
    ]);
    // Del GM solo le voci fuori dalla media
    expect(ownerTraitsText(DEFAULT_OWNER)).toEqual([]);
    expect(ownerTraitsText({ ...DEFAULT_OWNER, trades: 'high', patience: 'low' })).toEqual([
      'Sempre sul mercato',
      'Poca pazienza con l’allenatore',
    ]);
  });

  it('contratto in breve e quanto resta da pagare', () => {
    expect(coachContractText([7_300_000, 7_519_000], millions)).toBe('7,30 mln · 2 anni');
    expect(coachContractText([3_000_000], millions)).toBe('3,00 mln · 1 anno');
    expect(coachContractText([], millions)).toBe('senza contratto');
    expect(contractTotal([1, 2, 3])).toBe(6);
  });

  it('chi si può prendere: libero, e in rosso non più caro di quello di adesso', () => {
    const c = coach();
    const ask = coachAsk(CONFIG_2026_27, c)[0] as number;
    expect(hireProblem(CONFIG_2026_27, c, null, 1)).toBeNull();
    expect(hireProblem(CONFIG_2026_27, { ...c, teamId: 'altra' }, null, 1)).toMatch(/Allena già/);
    expect(hireProblem(CONFIG_2026_27, c, coach({ salaries: [ask - 1] }), -1)).toMatch(/saldo negativo/);
    expect(hireProblem(CONFIG_2026_27, c, coach({ salaries: [ask] }), -1)).toBeNull();
  });

  it('i liberi dal migliore, senza quelli in panchina', () => {
    const list = [
      coach({ id: 'a', ratings: { tactics: 40, development: 40, motivation: 40 } }),
      coach({ id: 'b', ratings: { tactics: 90, development: 70, motivation: 70 } }),
      coach({ id: 'c', teamId: 't', ratings: { tactics: 95, development: 95, motivation: 95 } }),
    ];
    expect(freeCoachesByRating(list).map((c) => c.id)).toEqual(['b', 'a']);
  });

  it('senza le tabelle (app pubblicata prima della migrazione) come una lega senza allenatori', async () => {
    server.state.missing = true;
    expect(await leagueCoaches('lega')).toEqual([]);
    expect(await teamStaff('squadra')).toEqual({ coach: null, buyouts: [] });
    expect(await myCoachRequest('squadra')).toBeNull();
    server.state.missing = false;
    server.state.rows = [row];
    expect((await leagueCoaches('lega')).map((c) => c.id)).toEqual(['c1']);
  });
});
