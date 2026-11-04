import { describe, expect, it } from 'vitest';
import { Rng } from '../src/rng.ts';

describe('Rng', () => {
  it('stesso seed, stessa sequenza', () => {
    const a = new Rng('partita-1');
    const b = new Rng('partita-1');
    expect(Array.from({ length: 50 }, () => a.next())).toEqual(Array.from({ length: 50 }, () => b.next()));
  });

  it('seed diversi, sequenze diverse', () => {
    const a = new Rng('a');
    const b = new Rng('b');
    expect(a.next()).not.toBe(b.next());
  });

  it('int resta negli estremi e li raggiunge', () => {
    const rng = new Rng(1);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it('weightedIndex rispetta i pesi', () => {
    const rng = new Rng(2);
    const counts = [0, 0, 0];
    for (let i = 0; i < 30000; i++) counts[rng.weightedIndex([1, 2, 0])]! += 1;
    expect(counts[2]).toBe(0);
    expect(counts[1]! / counts[0]!).toBeGreaterThan(1.8);
    expect(counts[1]! / counts[0]!).toBeLessThan(2.2);
  });

  it('normal ha media e dispersione attese', () => {
    const rng = new Rng(3);
    const xs = Array.from({ length: 20000 }, () => rng.normal(10, 2));
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
    expect(mean).toBeCloseTo(10, 1);
    expect(sd).toBeCloseTo(2, 1);
  });

  it('fork è deterministico e indipendente', () => {
    const a = new Rng('x').fork('quarto');
    const b = new Rng('x').fork('quarto');
    expect(a.next()).toBe(b.next());
    expect(new Rng('x').fork('quarto').next()).not.toBe(new Rng('x').fork('altro').next());
  });
});
