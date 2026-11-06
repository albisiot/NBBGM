import { describe, expect, it } from 'vitest';
import { defaultSeason, regularSeasonOver, seasonLabel, toStats, type LeagueSeason } from './history.ts';

const season = (year: number, phase: string, current = false): LeagueSeason => ({
  id: String(year),
  year,
  phase,
  current,
});

describe('storico delle stagioni', () => {
  it('etichetta della stagione', () => {
    expect(seasonLabel(2026)).toBe('2026-27');
    expect(seasonLabel(2099)).toBe('2099-00');
  });

  it('regular season finita: le stagioni passate e quella in corso dopo la giornata 82', () => {
    expect(regularSeasonOver(season(2026, 'offseason'))).toBe(true);
    expect(regularSeasonOver(season(2027, 'regular', true))).toBe(false);
    expect(regularSeasonOver(season(2027, 'playoffs', true))).toBe(true);
  });

  it('di default la stagione più recente con la regular season finita', () => {
    expect(defaultSeason([season(2027, 'regular', true), season(2026, 'offseason')])?.year).toBe(2026);
    expect(defaultSeason([season(2027, 'play-in', true), season(2026, 'offseason')])?.year).toBe(2027);
    expect(defaultSeason([season(2026, 'regular', true)])?.year).toBe(2026);
    expect(defaultSeason([])).toBeNull();
  });

  it('statistiche complete con i numeri come numeri', () => {
    const s = toStats({ g: '82', pts: 1640, ast: null });
    expect(s.g).toBe(82);
    expect(s.pts).toBe(1640);
    expect(s.ast).toBe(0);
    expect(s.blk).toBe(0);
  });
});
