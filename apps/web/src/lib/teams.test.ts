import { describe, expect, it } from 'vitest';
import type { PickInfo } from './market.ts';
import { contractSummary, teamPayroll, teamPicks, teamSwaps, type SwapInfo } from './teams.ts';

const pick = (over: Partial<PickInfo>): PickInfo => ({
  id: 'k',
  draftYear: 2027,
  round: 1,
  originalTeamId: 'A',
  ownerTeamId: 'A',
  protection: null,
  ...over,
});

const mln = (x: number) => `${(x / 1e6).toFixed(2)}`;

describe('pagina di una squadra', () => {
  it('scelte possedute (sue e di altri) e cedute, in ordine di draft e giro', () => {
    const picks = [
      pick({ id: '1', draftYear: 2028, round: 1 }),
      pick({ id: '2', draftYear: 2027, round: 2 }),
      pick({ id: '3', draftYear: 2027, round: 1, originalTeamId: 'B', protection: 10 }),
      pick({ id: '4', draftYear: 2027, round: 1, ownerTeamId: 'C' }),
      pick({ id: '5', originalTeamId: 'B', ownerTeamId: 'B' }),
    ];
    const r = teamPicks(picks, 'A');
    expect(r.owned.map((k) => k.id)).toEqual(['3', '2', '1']);
    expect(r.traded.map((k) => k.id)).toEqual(['4']);
  });

  it('swap con il diritto e swap concessi', () => {
    const w = (id: string, holder: string, other: string): SwapInfo => ({
      id,
      draftYear: 2028,
      round: 1,
      holderTeamId: holder,
      otherTeamId: other,
    });
    const r = teamSwaps([w('1', 'A', 'B'), w('2', 'C', 'A'), w('3', 'B', 'C')], 'A');
    expect(r.held.map((x) => x.id)).toEqual(['1']);
    expect(r.given.map((x) => x.id)).toEqual(['2']);
  });

  it('monte stipendi senza i two-way, con i residui dei tagliati', () => {
    const roster = [
      { contractType: 'standard', salaries: [10e6, 11e6] },
      { contractType: 'two-way', salaries: [] },
      { contractType: 'rookie', salaries: [3e6] },
      { contractType: 'standard', salaries: [] },
    ];
    expect(teamPayroll(roster, [{ salaries: [2e6, 2e6] }])).toBe(15e6);
  });

  it('contratto in breve', () => {
    expect(
      contractSummary({ contractType: 'standard', salaries: [12e6, 13e6], options: [null, 'player'] }, mln),
    ).toBe('12.00 · 2 anni, opz. giocatore');
    expect(contractSummary({ contractType: 'standard', salaries: [5e6], options: ['team'] }, mln)).toBe(
      '5.00 · 1 anno, opz. squadra',
    );
    expect(contractSummary({ contractType: 'two-way', salaries: [], options: [] }, mln)).toBe('two-way');
    expect(contractSummary({ contractType: 'standard', salaries: [], options: [] }, mln)).toBe('in scadenza');
  });
});
