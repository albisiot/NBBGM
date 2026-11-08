import type { BodyPart } from '../fields.ts';
import type { InjurySeverity, Player } from '../types.ts';

export interface Tactics {
  pace: 'slow' | 'normal' | 'fast';
  focus: 'perimeter' | 'balanced' | 'inside';
  defense: 'man' | 'zone';
  intensity: 'low' | 'medium' | 'high';
}

export const DEFAULT_TACTICS: Tactics = {
  pace: 'normal',
  focus: 'balanced',
  defense: 'man',
  intensity: 'medium',
};

/** Impostazioni di una squadra per una partita. */
export interface TeamSetup {
  teamId: string;
  /** Giocatori a referto (al massimo 13; gli infortunati vengono ignorati). */
  players: Player[];
  /** Id dei 5 titolari, uno per slot: PG, SG, SF, PF, C. */
  starters: [string, string, string, string, string];
  /** Minuti obiettivo per id; la somma deve fare 240. */
  minutes: Record<string, number>;
  tactics: Tactics;
  /**
   * Effetto della qualità dell'allenatore (voce Tattica): moltiplica le abilità di tutti i giocatori della squadra
   * per 1 + coaching, come il morale. Assente o 0: nessun effetto (stesse partite di prima, bit per bit).
   */
  coaching?: number;
}

export interface PlayerLine {
  playerId: string;
  name: string;
  starter: boolean;
  seconds: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  plusMinus: number;
}

export interface GameEvent {
  period: number;
  /** Secondi che mancano alla fine del periodo. */
  clock: number;
  /** Secondi di gioco trascorsi dall'inizio della partita. */
  elapsed: number;
  team: 'home' | 'away' | null;
  /** Giocatori coinvolti, per i controlli (es. nessun infortunato in campo). */
  players: string[];
  text: string;
  home: number;
  away: number;
}

export interface GameInjury {
  playerId: string;
  team: 'home' | 'away';
  bodyPart: BodyPart;
  severity: InjurySeverity;
  games: number;
  /** Secondo di gioco in cui è avvenuto. */
  elapsed: number;
}

export interface TeamTotals {
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
  possessions: number;
  /** Tiri segnati e tentati per zona: al ferro, da vicino (1-3 m), dalla media, da tre. */
  zones: Record<'rim' | 'short' | 'mid' | 'three', { m: number; a: number }>;
}

export interface GameResult {
  home: { teamId: string; score: number; quarters: number[]; box: PlayerLine[]; totals: TeamTotals };
  away: { teamId: string; score: number; quarters: number[]; box: PlayerLine[]; totals: TeamTotals };
  overtimes: number;
  /** Energia di ogni giocatore a fine partita. */
  finalEnergy: Record<string, number>;
  injuries: GameInjury[];
  playByPlay: GameEvent[];
}
