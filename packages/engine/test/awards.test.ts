import { describe, expect, it } from 'vitest';
import { efficiency, emptyStats, seasonAwards, type AwardPlayer, type SeasonStats } from '../src/index.ts';

const stats = (over: Partial<SeasonStats>): SeasonStats => ({ ...emptyStats(), g: 82, gs: 82, ...over });
const player = (
  id: string,
  teamId: string | null,
  over: Partial<SeasonStats>,
  rookie: boolean | null = false,
) => ({ id, teamId, rookie, stats: stats(over) }) satisfies AwardPlayer;

describe('premi di fine stagione', () => {
  it('valutazione a partita', () => {
    // 20 punti con 8/16 al tiro e 4/5 ai liberi, 10 rimbalzi, 5 assist, 1 rubata, 1 stoppata, 3 perse
    const s = stats({
      g: 1,
      pts: 20,
      fgm: 8,
      fga: 16,
      ftm: 4,
      fta: 5,
      orb: 2,
      drb: 8,
      ast: 5,
      stl: 1,
      blk: 1,
      tov: 3,
    });
    expect(efficiency(s)).toBe(20 + 10 + 5 + 1 + 1 - 8 - 1 - 3);
    expect(efficiency(stats({ g: 0 }))).toBe(0);
  });

  it('MVP: a parità di numeri conta la squadra che vince', () => {
    const line = { pts: 82 * 25, drb: 82 * 8, ast: 82 * 6 };
    const r = seasonAwards([player('a', 'T1', line), player('b', 'T2', line)], (t) =>
      t === 'T1' ? 0.3 : 0.7,
    );
    expect(r.awards.find((x) => x.key === 'mvp')?.playerId).toBe('b');
    expect(r.ballots.mvp.map((x) => x.playerId)).toEqual(['b', 'a']);
  });

  it('miglior difensore, rookie e sesto uomo', () => {
    const players = [
      player('star', 'T1', { pts: 82 * 30, drb: 82 * 5 }),
      player('muro', 'T1', { pts: 82 * 8, drb: 82 * 9, blk: 82 * 3, stl: 82 }),
      player('nuovo', 'T2', { pts: 82 * 15, drb: 82 * 4 }, true),
      player('panca', 'T2', { gs: 10, pts: 82 * 16, drb: 82 * 3 }),
    ];
    const r = seasonAwards(players, () => 0.5);
    const winner = Object.fromEntries(r.awards.map((a) => [a.key, a.playerId]));
    expect(winner).toEqual({ mvp: 'star', dpoy: 'muro', roy: 'nuovo', sixth: 'panca' });
  });

  it('servono almeno metà delle partite del più presente', () => {
    const r = seasonAwards(
      [player('pochi', 'T1', { g: 30, gs: 30, pts: 30 * 40 }), player('sempre', 'T1', { pts: 82 * 10 })],
      () => 0.5,
    );
    expect(r.minGames).toBe(41);
    expect(r.leaders.points.map((l) => l.playerId)).toEqual(['sempre']);
    expect(r.awards.find((a) => a.key === 'mvp')?.playerId).toBe('sempre');
  });

  it('migliori marcatori, rimbalzisti e assistmen a partita, al massimo 5', () => {
    const players = Array.from({ length: 7 }, (_, i) =>
      player(`p${i}`, 'T1', { pts: 82 * (10 + i), orb: 82 * i, ast: 82 * (6 - i) }),
    );
    const r = seasonAwards(players, () => 0.5);
    expect(r.leaders.points.map((l) => l.playerId)).toEqual(['p6', 'p5', 'p4', 'p3', 'p2']);
    expect(r.leaders.points[0]?.value).toBe(16);
    expect(r.leaders.rebounds[0]?.playerId).toBe('p6');
    expect(r.leaders.assists[0]?.playerId).toBe('p0');
  });

  it('senza rookie noti niente rookie dell’anno; a parità decide chi ha più partite, poi l’id', () => {
    const r = seasonAwards(
      [player('b', 'T1', { pts: 82 * 10 }, null), player('a', 'T1', { pts: 82 * 10 }, null)],
      () => 0.5,
    );
    expect(r.awards.some((a) => a.key === 'roy')).toBe(false);
    expect(r.ballots.mvp[0]?.playerId).toBe('a');
  });
});
