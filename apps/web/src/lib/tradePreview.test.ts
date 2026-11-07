import {
  ARCHETYPE_PROFILES,
  contractOf,
  createLeagueState,
  generateLeague,
  luxuryTax,
  payroll,
  Rng,
  validateTrade,
  type LeagueState,
  type Trade,
} from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import type { PickInfo } from './market.ts';
import {
  tradeOf,
  tradePreview,
  type PreviewInput,
  type PreviewTeam,
  type TradeSelection,
} from './tradePreview.ts';

// Una lega generata: nel motore le squadre hanno per id la sigla; nell'app gli id sono altri (qui "id-BOS")
const base = createLeagueState(generateLeague(new Rng('anteprima'), ARCHETYPE_PROFILES), 'anteprima');

const teamOf = (state: LeagueState, code: string, known: boolean): PreviewTeam => {
  const t = state.teams.find((x) => x.id === code)!;
  return {
    id: `id-${code}`,
    code,
    roster: state.players
      .filter((p) => p.teamId === code)
      .map((p) => {
        const c = contractOf(state, p.id);
        return {
          id: p.id,
          firstName: p.firstName,
          lastName: p.lastName,
          contractType: c?.type ?? null,
          salaries: c?.salaries ?? [],
        };
      }),
    deadMoney: state.deadMoney.filter((d) => d.teamId === code),
    balance: known ? t.balance : null,
    repeater: known ? false : null,
  };
};

const picksOf = (state: LeagueState): PickInfo[] =>
  state.picks.map((k) => ({
    id: k.id,
    draftYear: k.draftYear,
    round: k.round,
    originalTeamId: `id-${k.originalTeamId}`,
    ownerTeamId: `id-${k.ownerId}`,
    protection: k.protection,
  }));

const input = (state: LeagueState, sel: Partial<TradeSelection>): PreviewInput => ({
  config: state.config,
  roundKind: state.phase === 'offseason' ? 'offseason' : 'regular',
  roundNumber: state.turn,
  me: teamOf(state, 'BOS', true),
  partner: teamOf(state, 'LAL', false),
  picks: picksOf(state),
  swaps: [],
  sel: { give: [], get: [], givePicks: [], getPicks: [], protections: {}, swaps: [], ...sel },
});

const standard = (state: LeagueState, code: string) =>
  state.players.filter((p) => p.teamId === code && contractOf(state, p.id)?.type !== 'two-way');

describe('anteprima dello scambio', () => {
  it('monte stipendi, spazio, tassa e rosa prima e dopo, come il motore', () => {
    const state = structuredClone(base);
    const give = standard(state, 'BOS')
      .slice(0, 2)
      .map((p) => p.id);
    const get = standard(state, 'LAL')
      .slice(0, 1)
      .map((p) => p.id);
    const preview = tradePreview(input(state, { give, get }));
    const [me, them] = preview.sides;
    expect(me.before.payroll).toBe(payroll(state, 'BOS'));
    expect(them.before.payroll).toBe(payroll(state, 'LAL'));
    const salary = (id: string) => contractOf(state, id)?.salaries[0] ?? 0;
    const diff = salary(get[0]!) - salary(give[0]!) - salary(give[1]!);
    expect(me.after.payroll - me.before.payroll).toBe(diff);
    expect(them.after.payroll - them.before.payroll).toBe(-diff);
    expect(me.after.standard).toBe(me.before.standard - 1);
    expect(them.after.standard).toBe(them.before.standard + 1);
    expect(me.after.capSpace).toBe(state.config.salaryCap - me.after.payroll);
    expect(me.after.taxRoom).toBe(state.config.luxuryTax - me.after.payroll);
    expect(me.after.tax).toBe(luxuryTax(state.config, me.after.payroll, false));
    // Dell'altra squadra non si sa se paga le aliquote maggiorate né il saldo
    expect(me.taxEstimated).toBe(false);
    expect(them.taxEstimated).toBe(true);
    expect(them.balance).toBe('unknown');
  });

  it('gli stessi problemi di validateTrade sullo stato intero, con le sigle delle squadre', () => {
    const state = structuredClone(base);
    const bos = standard(state, 'BOS');
    const lal = standard(state, 'LAL');
    const cases: Partial<TradeSelection>[] = [
      // Rosa sotto 13 per BOS
      { give: bos.slice(0, 4).map((p) => p.id) },
      // Rosa oltre 15 per BOS
      { get: lal.slice(0, 4).map((p) => p.id) },
      // Regola Stepien: BOS cede le prime scelte di due draft di fila
      {
        givePicks: state.picks
          .filter((k) => k.originalTeamId === 'BOS' && k.round === 1 && k.draftYear <= state.config.year + 2)
          .map((k) => k.id),
      },
      // Uno scambio valido
      { give: [bos[0]!.id], get: [lal[0]!.id] },
    ];
    for (const sel of cases) {
      const i = input(state, sel);
      const preview = tradePreview(i);
      const t: Trade = tradeOf(i);
      expect(preview.problems).toEqual(validateTrade(state, t));
    }
    expect(tradePreview(input(state, cases[0]!)).sides[0].rosterOk).toBe(false);
    expect(tradePreview(input(state, cases[0]!)).problems.join(' ')).toContain('BOS: sotto 13');
    expect(tradePreview(input(state, cases[2]!)).sides[0].stepienGaps.length).toBeGreaterThan(0);
    expect(tradePreview(input(state, cases[2]!)).problems.join(' ')).toContain('regola Stepien');
    expect(tradePreview(input(state, cases[3]!)).problems).toEqual([]);
  });

  it('con il saldo in rosso la propria squadra non aumenta il monte stipendi', () => {
    const state = structuredClone(base);
    state.teams.find((t) => t.id === 'BOS')!.balance = -1;
    const bos = standard(state, 'BOS').sort(
      (a, b) => (contractOf(state, a.id)?.salaries[0] ?? 0) - (contractOf(state, b.id)?.salaries[0] ?? 0),
    );
    const lal = standard(state, 'LAL').sort(
      (a, b) => (contractOf(state, b.id)?.salaries[0] ?? 0) - (contractOf(state, a.id)?.salaries[0] ?? 0),
    );
    const sel = { give: [bos[0]!.id], get: [lal[0]!.id] };
    const preview = tradePreview(input(state, sel));
    expect(preview.sides[0].balance).toBe('blocked');
    expect(preview.problems.join(' ')).toContain('saldo negativo');
    expect(preview.problems).toEqual(validateTrade(state, tradeOf(input(state, sel))));
    // Cedere senza ricevere (meno stipendi) va bene
    expect(tradePreview(input(state, { give: [bos[0]!.id] })).sides[0].balance).toBe('ok');
  });

  it('dopo la trade deadline il motore blocca gli scambi', () => {
    const state = structuredClone(base);
    state.turn = 70;
    const preview = tradePreview(input(state, { give: [standard(state, 'BOS')[0]!.id] }));
    expect(preview.problems[0]).toBe('Scambi bloccati dalla trade deadline');
  });
});
