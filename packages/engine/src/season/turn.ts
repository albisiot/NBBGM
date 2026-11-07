import type { GameResult } from '../game/types.ts';
import type { LeagueState, PlayerState } from './state.ts';

/** Energia recuperata almeno tra un turno e l'altro (a Resistenza 50), da calibrare con pnpm sim:seasons. */
export const ENERGY_RECOVERY = 12;

/**
 * Quota dell'energia che manca recuperata tra un turno e l'altro (a Resistenza 50), quando è più di
 * ENERGY_RECOVERY: chi è molto stanco recupera di più. Con i soli 12 punti chi giocava sempre 42 minuti crollava
 * partita dopo partita; così si stabilizza (sotto 75 a inizio gara), e un titolare da 35 minuti resta sopra 85.
 */
export const ENERGY_RECOVERY_SHARE = 0.4;

/**
 * Energia dopo il recupero tra due turni: il più alto tra ENERGY_RECOVERY punti e ENERGY_RECOVERY_SHARE di quella
 * che manca, entrambi da 0,7 a 1,3 volte con la Resistenza; chi non ha giocato si riposa una volta e mezza tanto.
 */
export function recoverEnergy(energy: number, stamina: number, played: boolean): number {
  const k = (0.7 + (0.6 * stamina) / 100) * (played ? 1 : 1.5);
  const gain = Math.max(ENERGY_RECOVERY * k, (100 - energy) * Math.min(1, ENERGY_RECOVERY_SHARE * k));
  return Math.min(100, energy + gain);
}

/**
 * Guarigione durante l'offseason: chi deve stare fuori fino a 30 partite guarisce del tutto, chi ne ha di più
 * ne sconta 20. Restituisce le partite che salterà nella stagione che arriva.
 */
export function gamesAfterOffseason(gamesRemaining: number): number {
  return gamesRemaining > 30 ? gamesRemaining - 20 : 0;
}

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
    // Chi era già infortunato (con la rosa cortissima gioca anche lui, vedi gamePlayers) tiene lo stop più lungo:
    // un infortunio nuovo e leggero non accorcia quello di prima
    if (p.injury && p.injury.gamesRemaining >= inj.games) continue;
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
    const game = p.teamId ? played.get(p.teamId) : undefined;
    p.energy = recoverEnergy(p.energy, p.ratings.stamina, game !== undefined);
    // Gli svincolati non giocano, ma guariscono un turno alla volta come gli altri
    if (p.teamId === null && p.injury && played.size > 0) {
      p.injury.gamesRemaining--;
      if (p.injury.gamesRemaining <= 0) p.injury = null;
    }
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
