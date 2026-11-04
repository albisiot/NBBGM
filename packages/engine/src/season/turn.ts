import type { GameResult } from '../game/types.ts';
import type { LeagueState, PlayerState } from './state.ts';

/** Energia recuperata tra un turno e l'altro (a Resistenza 50), da calibrare con pnpm sim:seasons. */
export const ENERGY_RECOVERY = 12;

/** Applica a giocatori e statistiche il risultato di una partita. */
export function applyGameToPlayers(state: LeagueState, result: GameResult, regular: boolean): void {
  const byId = new Map(state.players.map((p) => [p.id, p]));
  for (const side of [result.home, result.away]) {
    for (const line of side.box) {
      const p = byId.get(line.playerId);
      if (!p || line.seconds === 0) continue;
      p.energy = result.finalEnergy[p.id] ?? p.energy;
      if (!regular) continue;
      const s = p.stats;
      s.g++;
      if (line.starter) s.gs++;
      s.seconds += line.seconds;
      s.pts += line.pts;
      s.fgm += line.fgm;
      s.fga += line.fga;
      s.tpm += line.tpm;
      s.tpa += line.tpa;
      s.ftm += line.ftm;
      s.fta += line.fta;
      s.orb += line.orb;
      s.drb += line.drb;
      s.ast += line.ast;
      s.stl += line.stl;
      s.blk += line.blk;
      s.tov += line.tov;
      s.pf += line.pf;
    }
  }
  for (const inj of result.injuries) {
    const p = byId.get(inj.playerId);
    if (!p) continue;
    p.injury = { bodyPart: inj.bodyPart, severity: inj.severity, gamesRemaining: inj.games };
  }
}

/**
 * Fine turno per le squadre che hanno giocato: recupero dell'energia, una partita in meno di stop per gli
 * infortunati (non per chi si è appena fatto male), morale.
 */
export function endTurn(state: LeagueState, played: Map<string, { won: boolean; result: GameResult }>): void {
  const justInjured = new Set([...played.values()].flatMap((x) => x.result.injuries.map((i) => i.playerId)));
  for (const p of state.players) {
    // Recupero: chi ha giocato riparte dall'energia di fine partita, chi non ha giocato si riposa di più
    const rate = ENERGY_RECOVERY * (0.7 + (0.6 * p.ratings.stamina) / 100);
    const game = p.teamId ? played.get(p.teamId) : undefined;
    p.energy = Math.min(100, p.energy + rate * (game ? 1 : 1.5));
    if (!game) continue;
    if (p.injury && !justInjured.has(p.id)) {
      p.injury.gamesRemaining--;
      if (p.injury.gamesRemaining <= 0) p.injury = null;
    }
    updateMorale(state, p, game.won, game.result);
  }
}

function updateMorale(state: LeagueState, p: PlayerState, won: boolean, result: GameResult): void {
  const line = [...result.home.box, ...result.away.box].find((l) => l.playerId === p.id);
  const minutes = line ? line.seconds / 60 : 0;
  // Minuti attesi in base al posto nella squadra
  const mates = state.players.filter((x) => x.teamId === p.teamId && !x.injury);
  const rank = [...mates]
    .sort((a, b) => b.stats.seconds / Math.max(1, b.stats.g) - a.stats.seconds / Math.max(1, a.stats.g))
    .indexOf(p);
  const expected = rank < 0 ? 0 : rank < 5 ? 28 : rank < 8 ? 16 : 6;
  let delta = won ? 1.2 : -1.2;
  if (p.injury === null) delta += minutes >= expected ? 0.6 : minutes < expected * 0.5 ? -1 : 0;
  // Il Carattere rende il morale più stabile, la Leadership dei compagni attenua le sconfitte
  const leader = Math.max(0, ...mates.filter((x) => x !== p).map((x) => x.ratings.leadership));
  if (delta < 0) delta *= 1 - Math.max(0, leader - 60) / 100;
  delta *= 1.4 - p.hidden.character / 100;
  p.morale = Math.max(0, Math.min(100, p.morale + delta + (60 - p.morale) * 0.02));
}
