import { CONFIG_2026_27, luxuryTax, nextConfig, salaryRun } from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import {
  effectiveConfig,
  faRoundOf,
  millions,
  offerInput,
  offerSalary,
  projectedTax,
  salaryRunOf,
} from './market.ts';

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
    expect(['fa1', 'fa4', 'draft', null].map(faRoundOf)).toEqual([0, 3, null, null]);
    expect(effectiveConfig(CONFIG_2026_27, 'offseason', 'draft')).toBe(CONFIG_2026_27);
    expect(effectiveConfig(CONFIG_2026_27, 'offseason', 'fa2')).toEqual(nextConfig(CONFIG_2026_27));
    expect(effectiveConfig(CONFIG_2026_27, 'regular', null)).toBe(CONFIG_2026_27);
  });
});
