// Partita finta e veloce (stessa dei test del motore): serve a provare in fretta crescita ed economia.
import type { GameResult, PlayerLine, TeamSetup, TeamTotals } from '@nbbgm/engine';
import { overall } from '@nbbgm/engine';
import { Rng } from '@nbbgm/engine';

const zeroTotals = (): TeamTotals => ({
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
  possessions: 0,
  zones: { rim: { m: 0, a: 0 }, short: { m: 0, a: 0 }, mid: { m: 0, a: 0 }, three: { m: 0, a: 0 } },
});

/** Partita finta e veloce per i test di stagione: vince più spesso la squadra con l'overall più alto. */
export function quickGame(home: TeamSetup, away: TeamSetup, seed: string): GameResult {
  const rng = new Rng(seed);
  const rating = (s: TeamSetup) =>
    s.players.reduce((a, p) => a + overall(p) * (s.minutes[p.id] ?? 0), 0) / 240;
  const h = Math.round(112 + (rating(home) - rating(away)) * 1.5 + rng.normal(0, 11));
  let a = Math.round(112 + rng.normal(0, 11));
  if (h === a) a--;
  const box = (s: TeamSetup): PlayerLine[] =>
    s.players.map((p) => ({
      playerId: p.id,
      name: `${p.firstName} ${p.lastName}`,
      starter: s.starters.includes(p.id),
      seconds: (s.minutes[p.id] ?? 0) * 60,
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
      plusMinus: 0,
    }));
  const energy: Record<string, number> = {};
  for (const p of [...home.players, ...away.players]) energy[p.id] = 80;
  return {
    home: { teamId: home.teamId, score: h, quarters: [h], box: box(home), totals: zeroTotals() },
    away: { teamId: away.teamId, score: a, quarters: [a], box: box(away), totals: zeroTotals() },
    overtimes: 0,
    finalEnergy: energy,
    injuries: [],
    playByPlay: [],
  };
}
