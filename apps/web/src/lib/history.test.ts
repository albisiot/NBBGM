import { describe, expect, it } from 'vitest';
import {
  clearPastSeasons,
  defaultSeason,
  pastSeason,
  regularSeasonOver,
  seasonLabel,
  toStats,
  type LeagueSeason,
} from './history.ts';

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

  it('una stagione passata si legge una volta sola, con la classifica finale dalle partite', async () => {
    clearPastSeasons();
    const teams = (['AAA', 'BBB'] as const).map((code, i) => ({
      id: code,
      code,
      fullName: code,
      conference: 'East' as const,
      division: 'Atlantic',
      ownerId: null,
      ownerName: null,
      index: i,
    }));
    let reads = 0;
    const read = {
      players: async () => {
        reads++;
        return { players: [], live: false };
      },
      records: async () => {
        reads++;
        return [
          {
            turn: 0,
            phase: 'regular' as const,
            homeId: 'AAA',
            awayId: 'BBB',
            homeScore: 100,
            awayScore: 90,
            overtimes: 0,
          },
        ];
      },
    };
    const league = { id: 'lega', teams } as unknown as Parameters<typeof pastSeason>[0];
    const first = await pastSeason(league, season(2026, 'offseason'), read);
    expect(first.standings.East.map((l) => [l.teamId, l.w, l.l])).toEqual([
      ['AAA', 1, 0],
      ['BBB', 0, 1],
    ]);
    expect(reads).toBe(2);
    // Di nuovo la stessa stagione (anche dopo averne vista un'altra): nessuna lettura
    await pastSeason(league, season(2025, 'offseason'), read);
    expect(reads).toBe(4);
    expect(await pastSeason(league, season(2026, 'offseason'), read)).toBe(first);
    expect(reads).toBe(4);
  });

  it('statistiche complete con i numeri come numeri', () => {
    const s = toStats({ g: '82', pts: 1640, ast: null });
    expect(s.g).toBe(82);
    expect(s.pts).toBe(1640);
    expect(s.ast).toBe(0);
    expect(s.blk).toBe(0);
  });
});
