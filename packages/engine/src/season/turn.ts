import type { GameResult } from '../game/types.ts';
import { coachOf, motivationFactor } from './coaches.ts';
import type { LeagueState, PlayerState } from './state.ts';

/** Energia recuperata almeno in una notte (a Resistenza 50), da calibrare con pnpm sim:seasons. */
export const ENERGY_RECOVERY = 6;

/**
 * Quota dell'energia che manca recuperata in una notte (a Resistenza 50), quando è più di ENERGY_RECOVERY: chi è
 * molto stanco recupera di più. Con il calendario a giorni una squadra gioca ogni 2 giorni circa: un titolare da 35
 * minuti arriva a inizio gara a circa 91 (sopra 85), uno da 42 a circa 72 (sotto 75), e nella seconda sera di un
 * back-to-back (una notte sola) il titolare da 35 minuti a circa 86, 5 punti in meno (pnpm sim:seasons).
 */
export const ENERGY_RECOVERY_SHARE = 0.21;

/**
 * Energia dopo nights notti di riposo: ogni notte il più alto tra ENERGY_RECOVERY punti e ENERGY_RECOVERY_SHARE di
 * quella che manca, entrambi da 0,7 a 1,3 volte con la Resistenza.
 */
export function recoverEnergy(energy: number, stamina: number, nights: number): number {
  const k = 0.7 + (0.6 * stamina) / 100;
  let e = energy;
  for (let i = 0; i < nights && e < 100; i++)
    e = Math.min(100, e + Math.max(ENERGY_RECOVERY * k, (100 - e) * Math.min(1, ENERGY_RECOVERY_SHARE * k)));
  return e;
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
  // A disposizione: in rosa e sano prima della partita (gli infortuni di questa partita arrivano dopo)
  if (regular) {
    const teams = new Set([result.home.teamId, result.away.teamId]);
    for (const p of state.players)
      if (p.teamId !== null && teams.has(p.teamId) && !p.injury) p.stats.av = (p.stats.av ?? 0) + 1;
  }
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
 * Fine turno (un giorno): recupero dell'energia per le notti fino al prossimo turno (giorni senza partite compresi),
 * una partita in meno di stop per gli infortunati delle squadre che hanno giocato (non per chi si è appena fatto
 * male), morale di chi ha giocato. day è il giorno del turno.
 */
export function endTurn(
  state: LeagueState,
  played: Map<string, { won: boolean; result: GameResult }>,
  day: number,
  nights: number,
): void {
  const justInjured = new Set([...played.values()].flatMap((x) => x.result.injuries.map((i) => i.playerId)));
  // Gestione del gruppo dell'allenatore di ogni squadra che ha giocato
  const motivation = new Map([...played.keys()].map((id) => [id, motivationFactor(coachOf(state, id))]));
  // Gli svincolati non giocano, ma guariscono al ritmo di una squadra: una partita ogni 2 giorni
  const freeHealing = played.size > 0 ? Math.floor((day + nights) / 2) - Math.floor(day / 2) : 0;
  for (const p of state.players) {
    // Recupero: chi ha giocato riparte dall'energia di fine partita
    const game = p.teamId ? played.get(p.teamId) : undefined;
    p.energy = recoverEnergy(p.energy, p.ratings.stamina, nights);
    if (p.teamId === null && p.injury && freeHealing > 0) {
      p.injury.gamesRemaining -= freeHealing;
      if (p.injury.gamesRemaining <= 0) p.injury = null;
    }
    if (!game) continue;
    if (p.injury && !justInjured.has(p.id)) {
      p.injury.gamesRemaining--;
      if (p.injury.gamesRemaining <= 0) p.injury = null;
    }
    updateMorale(state, p, game.won, game.result, motivation.get(p.teamId as string) ?? 0);
  }
}

/** Quota in più (o in meno) delle variazioni del morale con la migliore (peggiore) Gestione del gruppo. */
export const COACH_MORALE_SHARE = 0.3;
/** Punti in più (o in meno) del livello a cui il morale torna con la migliore (peggiore) Gestione del gruppo. */
export const COACH_MORALE_REST = 5;

function updateMorale(
  state: LeagueState,
  p: PlayerState,
  won: boolean,
  result: GameResult,
  motivation: number,
): void {
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
  // Un buon allenatore fa salire di più il morale e lo fa scendere di meno, uno scarso il contrario
  if (motivation)
    delta *= delta > 0 ? 1 + COACH_MORALE_SHARE * motivation : 1 - COACH_MORALE_SHARE * motivation;
  const rest = 60 + COACH_MORALE_REST * motivation;
  p.morale = Math.max(0, Math.min(100, p.morale + delta + (rest - p.morale) * 0.02));
}
