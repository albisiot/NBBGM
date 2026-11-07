import type { Role } from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import { DEFAULT_FA_QUERY } from './market.ts';
import {
  bidTone,
  change,
  contractEnd,
  gradeTone,
  mln1,
  myTaxIncrease,
  needActive,
  needQuery,
  pickName,
  previewRows,
  selectedSalary,
} from './marketView.ts';
import { teamNeeds } from './teamNeeds.ts';
import type { SideNumbers, SidePreview, TradePreview } from './tradePreview.ts';

const M = 1e6;

const numbers = (n: Partial<SideNumbers>): SideNumbers => ({
  payroll: 150 * M,
  capSpace: 15 * M,
  taxRoom: 50 * M,
  tax: 0,
  standard: 14,
  twoWay: 2,
  total: 16,
  ...n,
});

const side = (s: Partial<SidePreview>): SidePreview => ({
  teamId: 'a',
  code: 'BOS',
  before: numbers({}),
  after: numbers({}),
  rosterOk: true,
  stepienGaps: [],
  balance: 'ok',
  taxEstimated: false,
  ...s,
});

describe('cifre in milioni', () => {
  it('un decimale con la virgola, il meno tipografico', () => {
    expect(mln1(196_400_000)).toBe('196,4');
    expect(mln1(2_949_999)).toBe('2,9');
    expect(mln1(0)).toBe('0,0');
    expect(mln1(-4_000_000)).toBe('−4,0');
    // Sotto i 50.000 $ non c'è un "meno zero"
    expect(mln1(-40_000)).toBe('0,0');
  });

  it('prima → dopo solo se cambia', () => {
    expect(change('1,0', '2,0')).toBe('1,0 → 2,0');
    expect(change('ok', 'ok')).toBe('ok');
  });
});

describe('anteprima dello scambio in tabella', () => {
  const me = side({
    before: numbers({ payroll: 196.4 * M, capSpace: -31.4 * M, taxRoom: 4 * M, tax: 0 }),
    after: numbers({ payroll: 213.1 * M, capSpace: -48.1 * M, taxRoom: -12.7 * M, tax: 23 * M }),
  });
  const them = side({
    teamId: 'b',
    code: 'NYK',
    before: numbers({ payroll: 201.8 * M, capSpace: -36.8 * M, taxRoom: -1.4 * M, tax: 2.1 * M }),
    after: numbers({ payroll: 185.1 * M, capSpace: -20.1 * M, taxRoom: 15.3 * M, tax: 0 }),
    balance: 'unknown',
    taxEstimated: true,
  });
  const preview: TradePreview = { sides: [me, them], problems: [] };
  const rows = previewRows(preview, false);
  const row = (label: string) => rows.find((r) => r.label === label)!;

  it('una riga per voce, una cella per squadra', () => {
    expect(rows.map((r) => r.label)).toEqual([
      'Monte stipendi',
      'Spazio sotto il cap',
      'Dalla soglia della tassa',
      'Luxury tax stimata',
      'Rosa: standard + two-way',
      'Regola Stepien',
      'Vincolo del saldo',
    ]);
    expect(row('Monte stipendi').cells.map((c) => c.text)).toEqual(['196,4 → 213,1', '201,8 → 185,1']);
    expect(row('Spazio sotto il cap').cells[0].text).toBe('nessuno');
  });

  it('in rosso la tassa che sale e la soglia superata di più, non quelle che scendono', () => {
    expect(row('Luxury tax stimata').cells).toEqual([
      { text: '0 → 23,0', bad: true },
      // L'altra squadra: stima con le aliquote normali, segnata con l'asterisco
      { text: '2,1 → 0*', bad: false },
    ]);
    expect(row('Dalla soglia della tassa').cells).toEqual([
      { text: '4,0 sotto → 12,7 sopra', bad: true },
      { text: '1,4 sopra → 15,3 sotto', bad: false },
    ]);
    expect(row('Vincolo del saldo').cells.map((c) => c.text)).toEqual(['ok', 'riservato']);
    expect(myTaxIncrease(preview)).toBe(23 * M);
    expect(myTaxIncrease({ sides: [them, me], problems: [] })).toBe(0);
  });

  it('rosa fuori dai limiti, buchi della regola Stepien e saldo in rosso in rosso', () => {
    const bad = previewRows(
      {
        sides: [
          side({ after: numbers({ standard: 16 }), rosterOk: false, stepienGaps: [2028, 2029] }),
          side({ balance: 'blocked' }),
        ],
        problems: ['x'],
      },
      false,
    );
    const get = (label: string) => bad.find((r) => r.label === label)!.cells;
    expect(get('Rosa: standard + two-way')[0]).toEqual({ text: '14 + 2 → 16 + 2', bad: true });
    expect(get('Regola Stepien')[0]).toEqual({ text: 'buco nel 2028, 2029', bad: true });
    expect(get('Vincolo del saldo')[1]).toEqual({ text: 'non rispettato', bad: true });
  });

  it('in offseason la rosa si conta in tutto, fino a 21', () => {
    const off = previewRows({ sides: [me, them], problems: [] }, true);
    const rosa = off.find((r) => r.label === 'Rosa in tutto (two-way)')!;
    expect(rosa.cells[0].text).toBe('16 (2)');
  });
});

describe('scelte e stipendi della proposta', () => {
  it('somma lo stipendio di questa stagione dei giocatori scelti, senza i two-way', () => {
    const roster = [
      { id: 'a', contractType: 'standard', salaries: [2.9 * M, 3 * M] },
      { id: 'b', contractType: 'two-way', salaries: [0.6 * M] },
      { id: 'c', contractType: 'standard', salaries: [10 * M] },
      { id: 'd', contractType: null, salaries: [] },
    ];
    expect(selectedSalary(roster, new Set(['a', 'b', 'd']))).toBe(2.9 * M);
    expect(selectedSalary(roster, new Set())).toBe(0);
  });

  it('nome della scelta', () => {
    expect(pickName({ round: 1, draftYear: 2027 })).toBe('Prima scelta 2027');
    expect(pickName({ round: 2, draftYear: 2029 })).toBe('Seconda scelta 2029');
  });

  it('fine del contratto', () => {
    // 4 stagioni dal 2026-27: l'ultima è il 2029-30
    expect(contractEnd(2026, 4)).toBe(2030);
  });
});

describe('bisogni della squadra', () => {
  const make = (role: Role, i: number) => ({
    id: `p${i}`,
    role,
    contractType: 'standard',
    ratings: {} as never,
  });

  it('il bisogno acceso è quello con i filtri uguali ai suoi', () => {
    const need = { query: { role: 'C', sort: 'overall' as const } };
    expect(needQuery(need)).toEqual({ ...DEFAULT_FA_QUERY, role: 'C' });
    expect(needActive({ ...DEFAULT_FA_QUERY, role: 'C' }, need)).toBe(true);
    // Un filtro in più (il nome) e non è più quello del bisogno
    expect(needActive({ ...DEFAULT_FA_QUERY, role: 'C', name: 'x' }, need)).toBe(false);
    expect(needActive(DEFAULT_FA_QUERY, need)).toBe(false);
  });

  it('il testo breve del pulsante dice ruolo e quanti ne hai', () => {
    const roster = (['PG', 'PG', 'PG', 'SG', 'SG', 'SG', 'SF', 'SF', 'SF', 'PF', 'PF', 'C'] as Role[]).map(
      make,
    );
    const needs = teamNeeds(roster, null);
    expect(needs.map((n) => n.short)).toEqual(['C scoperto · 1 su 2']);
  });
});

describe('toni', () => {
  it('pagella: eccellenze, voti medi e bassi', () => {
    expect([gradeTone(80), gradeTone(79), gradeTone(50), gradeTone(49)]).toEqual([
      'top',
      'mid',
      'mid',
      'low',
    ]);
  });

  it('offerte agli svincolati: firmato, perso, in attesa', () => {
    expect(bidTone('won')).toBe('ink');
    expect(bidTone('lost')).toBe('red');
    expect(bidTone('invalid')).toBe('red');
    expect(bidTone('pending')).toBe('outline');
  });
});
