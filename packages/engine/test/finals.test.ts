import { describe, expect, it } from 'vitest';
import { finalsMvp, type FinalsBoxLine } from '../src/index.ts';

const line = (
  gameId: string,
  playerId: string,
  teamId: string,
  over: Partial<FinalsBoxLine> = {},
): FinalsBoxLine => ({
  gameId,
  playerId,
  teamId,
  seconds: 2000,
  pts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  orb: 0,
  drb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  pf: 0,
  ...over,
});

describe('MVP delle Finali', () => {
  it('la valutazione a partita più alta della squadra campione, con le medie', () => {
    const lines = ['g1', 'g2', 'g3', 'g4'].flatMap((g) => [
      line(g, 'a', 'BOS', { pts: 30, fgm: 11, fga: 20, drb: 6, ast: 5 }),
      line(g, 'b', 'BOS', { pts: 20, fgm: 8, fga: 15, drb: 10, ast: 2 }),
      // Il migliore della finale gioca per chi ha perso: non conta
      line(g, 'c', 'LAL', { pts: 45, fgm: 18, fga: 25, drb: 12, ast: 8 }),
    ]);
    const mvp = finalsMvp(lines, 'BOS');
    // a: 30 + 6 + 5 − 9 = 32; b: 20 + 10 + 2 − 7 = 25
    expect(mvp).toEqual({
      playerId: 'a',
      teamId: 'BOS',
      games: 4,
      score: 32,
      perGame: { pts: 30, reb: 6, ast: 5 },
    });
  });

  it('servono almeno metà delle partite della serie, contando solo quelle in cui è entrato', () => {
    const lines = [
      ...['g1', 'g2', 'g3', 'g4', 'g5'].map((g) => line(g, 'a', 'BOS', { pts: 10 })),
      // b gioca benissimo ma solo 2 partite su 5 (ne servono 3), poi resta in panchina
      line('g1', 'b', 'BOS', { pts: 40 }),
      line('g2', 'b', 'BOS', { pts: 40 }),
      line('g3', 'b', 'BOS', { seconds: 0 }),
    ];
    expect(finalsMvp(lines, 'BOS')?.playerId).toBe('a');
  });

  it('a parità: più partite, poi più punti, poi l’id più piccolo; senza nessuno in campo null', () => {
    const tie = ['g1', 'g2', 'g3', 'g4'].flatMap((g) => [
      line(g, 'z', 'BOS', { pts: 10, tov: 0 }),
      line(g, 'y', 'BOS', { pts: 8, drb: 2 }),
      line(g, 'x', 'BOS', { pts: 10 }),
    ]);
    // Tutti a 10 di valutazione: z e x hanno più punti di y, poi vince l'id più piccolo
    expect(finalsMvp(tie, 'BOS')?.playerId).toBe('x');
    expect(finalsMvp([], 'BOS')).toBeNull();
    expect(finalsMvp([line('g1', 'a', 'LAL')], 'BOS')).toBeNull();
  });
});
