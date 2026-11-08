import { CONFIG_2026_27, luxuryTax, nextConfig, salaryRun } from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import {
  contractFirstYear,
  DEFAULT_FA_QUERY,
  effectiveConfig,
  faRoundOf,
  filterFreeAgents,
  minimumOf,
  millions,
  missingPlayerIds,
  offerInput,
  offerSalary,
  pendingOption,
  projectedTax,
  qualifyingOffer,
  rfaEligible,
  salaryRunOf,
  termsText,
  type FreeAgentQuery,
} from './market.ts';

describe('stagioni dei contratti', () => {
  it('dopo il draft dell’offseason il primo stipendio è della stagione che arriva', () => {
    expect(contractFirstYear(2026, 'regular', null)).toBe(2026);
    expect(contractFirstYear(2026, 'playoffs', null)).toBe(2026);
    expect(contractFirstYear(2026, 'offseason', 'draft')).toBe(2026);
    expect(contractFirstYear(2026, 'offseason', 'renewals')).toBe(2027);
    expect(contractFirstYear(2026, 'offseason', 'preparation')).toBe(2027);
  });
});

describe('mercato nell’app', () => {
  it('stipendi e tassa come li calcola il server', () => {
    expect(salaryRunOf(10_000_000, 4)).toEqual(salaryRun(10_000_000, 4));
    const f = { balance: 0, repeater: false, payroll: 215_000_000, deadMoney: [], ledger: [] };
    expect(projectedTax(CONFIG_2026_27, f)).toBe(luxuryTax(CONFIG_2026_27, 215_000_000, false));
    expect(projectedTax(CONFIG_2026_27, { ...f, payroll: 150_000_000 })).toBe(0);
    expect(millions(12_345_678)).toBe('12,35 mln');
  });

  it('l’offerta proposta e la cifra mostrata valgono la richiesta esatta, anche per i minimi', () => {
    const minimums = [...CONFIG_2026_27.minimumSalary, ...nextConfig(CONFIG_2026_27).minimumSalary];
    for (const ask of minimums) {
      // Cifra proposta di default
      expect(offerSalary(offerInput(ask), ask)).toBe(ask);
      // Cifra riscritta dal messaggio "chiede 1,45 mln"
      expect(offerSalary(millions(ask).replace(' mln', ''), ask)).toBe(ask);
    }
    expect(offerInput(1_452_806)).toBe('1,45');
    expect(offerSalary('1,45', 1_452_806)).toBe(1_452_806);
    expect(offerSalary('3.52', 3_524_115)).toBe(3_524_115);
    // Un'offerta diversa resta com'è
    expect(offerSalary('2', 1_452_806)).toBe(2_000_000);
    expect(offerSalary('', 1_452_806)).toBeNull();
    expect(offerSalary('abc', 1_452_806)).toBeNull();
  });
});

describe('offseason nell’app', () => {
  it('turno di free agency e configurazione della stagione che arriva', () => {
    expect(['fa1', 'fa4', 'fa15', 'fa16', 'options', 'draft', null].map(faRoundOf)).toEqual([
      0,
      3,
      14,
      null,
      null,
      null,
      null,
    ]);
    expect(effectiveConfig(CONFIG_2026_27, 'offseason', 'draft')).toBe(CONFIG_2026_27);
    expect(effectiveConfig(CONFIG_2026_27, 'offseason', 'fa2')).toEqual(nextConfig(CONFIG_2026_27));
    expect(effectiveConfig(CONFIG_2026_27, 'regular', null)).toBe(CONFIG_2026_27);
    expect(effectiveConfig(CONFIG_2026_27, 'offseason', 'options')).toEqual(nextConfig(CONFIG_2026_27));
  });

  it('RFA, offerta di qualifica, opzioni da decidere e termini di un rinnovo', () => {
    expect(rfaEligible({ contractType: 'rookie', yearsInLeague: 6 })).toBe(true);
    expect(rfaEligible({ contractType: 'standard', yearsInLeague: 3 })).toBe(true);
    expect(rfaEligible({ contractType: 'standard', yearsInLeague: 4 })).toBe(false);
    expect(rfaEligible({ contractType: 'standard', yearsInLeague: null })).toBe(false);
    // 125% dell'ultimo stipendio, almeno il minimo
    expect(qualifyingOffer(CONFIG_2026_27, { yearsInLeague: 3 }, 8_000_000)).toBe(10_000_000);
    expect(qualifyingOffer(CONFIG_2026_27, { yearsInLeague: 3 }, 1_000_000)).toBe(
      minimumOf(CONFIG_2026_27, { yearsInLeague: 3 }),
    );
    expect(pendingOption({ options: ['team', null], salaries: [5, 6] })).toBe(true);
    expect(pendingOption({ options: [null, 'team'], salaries: [5, 6] })).toBe(false);
    expect(termsText({ salary: 12_350_000, years: 3, option: 'player' })).toBe(
      '3 anni, 12,35 mln il primo, opzione del giocatore sull’ultimo',
    );
    expect(termsText({ salary: 2_000_000, years: 1, option: null })).toBe('1 anno, 2,00 mln il primo');
  });
});

describe('giocatori da descrivere nel mercato', () => {
  const offer = (playersFrom: string[], playersTo: string[]) => ({ playersFrom, playersTo });
  it('solo quelli citati e non ancora caricati, una volta sola', () => {
    const known = new Map([
      ['mio', 1],
      ['svincolato', 1],
    ]);
    expect(
      missingPlayerIds(
        [offer(['mio'], ['loro1', 'loro2']), offer(['loro2'], [])],
        [{ playerId: 'svincolato' }, { playerId: 'firmato-altrove' }],
        known,
      ),
    ).toEqual(['loro1', 'loro2', 'firmato-altrove']);
  });

  it('niente offerte e niente scambi: nessuna richiesta in più', () => {
    expect(missingPlayerIds([], [], new Map())).toEqual([]);
  });
});

describe('ricerca tra gli svincolati', () => {
  const MIN = 1_300_000;
  const fa = (
    firstName: string,
    lastName: string,
    over: Partial<{ role: string; secondaryRole: string | null; age: number; scoutedPotential: number }>,
    ovr: number,
    ask: number,
  ) => ({
    p: { firstName, lastName, role: 'SG', secondaryRole: null, age: 27, scoutedPotential: 60, ...over },
    ovr,
    ask,
    minimum: MIN,
  });
  const rows = [
    fa('Luka', 'Dončić', { role: 'PG', age: 27, scoutedPotential: 90 }, 88, 40_000_000),
    fa('Mario', 'Rossi', { role: 'C', age: 33, scoutedPotential: 50 }, 60, MIN + 4_000),
    fa(
      'Gianni',
      'Bianchi',
      { role: 'SF', secondaryRole: 'PF', age: 22, scoutedPotential: 75 },
      62,
      MIN + 1_500_000,
    ),
    fa('Paolo', 'Verdi', { role: 'PF', age: 29, scoutedPotential: 55 }, 62, MIN + 4_500_000),
  ];
  const q = (over: Partial<FreeAgentQuery>) => ({ ...DEFAULT_FA_QUERY, ...over });
  const names = (r: { p: { lastName: string } }[]) => r.map((x) => x.p.lastName);

  it('per overall, a parità per nome', () => {
    expect(names(filterFreeAgents(rows, DEFAULT_FA_QUERY, 0))).toEqual([
      'Dončić',
      'Bianchi',
      'Verdi',
      'Rossi',
    ]);
  });

  it('nome senza accenti e maiuscole, anche con più parole', () => {
    expect(names(filterFreeAgents(rows, q({ name: 'doncic' }), 0))).toEqual(['Dončić']);
    expect(names(filterFreeAgents(rows, q({ name: 'LUKA don' }), 0))).toEqual(['Dončić']);
    expect(names(filterFreeAgents(rows, q({ name: 'xyz' }), 0))).toEqual([]);
  });

  it('ruolo principale o secondario, fasce d’età', () => {
    expect(names(filterFreeAgents(rows, q({ role: 'PF' }), 0))).toEqual(['Bianchi', 'Verdi']);
    expect(names(filterFreeAgents(rows, q({ age: 'young' }), 0))).toEqual(['Bianchi']);
    expect(names(filterFreeAgents(rows, q({ age: 'prime' }), 0))).toEqual(['Dončić', 'Verdi']);
    expect(names(filterFreeAgents(rows, q({ age: 'veteran' }), 0))).toEqual(['Rossi']);
  });

  it('richiesta: al minimo (con la tolleranza della cifra mostrata), minimo + X, spazio sotto il cap', () => {
    expect(names(filterFreeAgents(rows, q({ ask: 'min' }), 0))).toEqual(['Rossi']);
    expect(names(filterFreeAgents(rows, q({ ask: 'min2' }), 0))).toEqual(['Bianchi', 'Rossi']);
    expect(names(filterFreeAgents(rows, q({ ask: 'min5' }), 0))).toEqual(['Bianchi', 'Verdi', 'Rossi']);
    // Sopra il cap: solo chi chiede il minimo; con 3 milioni di spazio anche Bianchi
    expect(names(filterFreeAgents(rows, q({ ask: 'space' }), 0))).toEqual(['Rossi']);
    expect(names(filterFreeAgents(rows, q({ ask: 'space' }), 3_000_000))).toEqual(['Bianchi', 'Rossi']);
  });

  it('ordinamento per potenziale, età e richiesta', () => {
    expect(names(filterFreeAgents(rows, q({ sort: 'potential' }), 0))).toEqual([
      'Dončić',
      'Bianchi',
      'Verdi',
      'Rossi',
    ]);
    expect(names(filterFreeAgents(rows, q({ sort: 'age' }), 0))).toEqual([
      'Bianchi',
      'Dončić',
      'Verdi',
      'Rossi',
    ]);
    expect(names(filterFreeAgents(rows, q({ sort: 'ask' }), 0))).toEqual([
      'Rossi',
      'Bianchi',
      'Verdi',
      'Dončić',
    ]);
  });

  it('il minimo dipende dall’anzianità', () => {
    expect(minimumOf(CONFIG_2026_27, { yearsInLeague: 0 })).toBe(CONFIG_2026_27.minimumSalary[0]);
    expect(minimumOf(CONFIG_2026_27, { yearsInLeague: 15 })).toBe(CONFIG_2026_27.minimumSalary[10]);
  });
});
