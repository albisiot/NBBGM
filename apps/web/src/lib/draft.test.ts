import { describe, expect, it } from 'vitest';
import {
  ANNUAL_DRAFT_LIST_MAX,
  annualListToSave,
  draftAnnouncement,
  formatSalary,
  pickLabel,
  secondsLeft,
} from './draft.ts';

describe('draft: etichette', () => {
  it('stipendi in milioni', () => {
    expect(formatSalary(14_403_710)).toBe('14,4 M$');
    expect(formatSalary(1_357_763)).toBe('1,4 M$');
  });

  it('giro e scelta', () => {
    expect(pickLabel(0)).toBe('giro 1, scelta 1');
    expect(pickLabel(31)).toBe('giro 2, scelta 2');
  });

  it('annunci del draft dal vivo solo nei momenti importanti', () => {
    // Tocca ad altri: niente
    expect(draftAnnouncement(false, 42, 60)).toBe('');
    // Lo stesso testo per tutto il tempo, finché restano 10 secondi
    const texts = new Set([60, 58, 44, 30, 12, 11].map((s) => draftAnnouncement(true, s, 60)));
    expect([...texts]).toEqual(['Tocca a te: hai 60 secondi per scegliere.']);
    expect(new Set([10, 8, 2].map((s) => draftAnnouncement(true, s, 60))).size).toBe(1);
    expect(draftAnnouncement(true, 0, 60)).toMatch(/Tempo scaduto/);
  });

  it('tempo che manca', () => {
    const now = Date.parse('2026-11-05T20:00:00Z');
    expect(secondsLeft('2026-11-05T20:00:42Z', now)).toBe(42);
    expect(secondsLeft('2026-11-05T19:59:00Z', now)).toBe(0);
    expect(secondsLeft(null, now)).toBeNull();
  });
});

describe('lista del draft annuale', () => {
  it('solo i prospetti di quest’anno, senza doppioni, al massimo 100', () => {
    const prospects = new Set(Array.from({ length: 150 }, (_, i) => `p${i}`));
    expect(annualListToSave(['vecchio', 'p2', 'p1', 'p2', 'altro', 'p0'], prospects)).toEqual([
      'p2',
      'p1',
      'p0',
    ]);
    const all = annualListToSave([...prospects], prospects);
    expect(all).toHaveLength(ANNUAL_DRAFT_LIST_MAX);
    expect(all[0]).toBe('p0');
  });
});
