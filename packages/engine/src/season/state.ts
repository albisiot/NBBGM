import type { SavedSettings } from '../game/setup.ts';
import type { Tactics } from '../game/types.ts';
import type { Contract, DeadMoney, Player, Team } from '../types.ts';
import type { SeasonConfig } from './config.ts';
import type { PostseasonState } from './postseason.ts';
import type { ScheduledGame } from './schedule.ts';

export type Strategy = 'contend' | 'middle' | 'rebuild';

export interface SeasonStats {
  g: number;
  gs: number;
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
}

export interface PlayerState extends Player {
  teamId: string | null;
  stats: SeasonStats;
  /** Stima del potenziale che vedono manager e bot (il valore vero resta nascosto). */
  scoutedPotential: number;
  /** Partite giocate da two-way in questa regular season (massimo 50). */
  twoWayGames: number;
  /** Anno del draft per cui è in attesa di essere scelto (solo durante l'offseason), altrimenti null. */
  prospect?: number | null;
}

export interface TeamState extends Team {
  human: boolean;
  strategy: Strategy;
  tactics: Tactics;
  /** Saldo di bilancio in dollari, passa da una stagione all'altra. */
  balance: number;
  /** Per ogni stagione passata, se ha pagato la luxury tax (la più recente in fondo). */
  taxHistory: boolean[];
  /** Impostazioni salvate dal manager (solo squadre umane): le legge la simulazione al posto del bot. */
  settings?: SavedSettings | null;
  /** Allenatore delegato attivo in questo turno: quintetto e minuti come il pulsante Auto, con le tattiche del manager. */
  coach?: boolean;
}

export interface DraftPick {
  id: string;
  /** Anno del draft (es. 2027 per il draft alla fine della stagione 2026-27). */
  draftYear: number;
  round: 1 | 2;
  originalTeamId: string;
  ownerId: string;
  /** Protezione "top N" (solo primo giro), null se libera. */
  protection: number | null;
  /** Quante volte è già stata rinviata per la protezione. */
  deferrals: number;
}

export interface DraftSwap {
  id: string;
  draftYear: number;
  round: 1 | 2;
  /** Chi ha il diritto di scegliere la migliore delle due. */
  holderId: string;
  otherId: string;
}

/** Una chiamata del draft annuale, con la squadra che sceglie dopo protezioni e swap. */
export interface DraftSlotState {
  /** Numero della chiamata nel draft (1-60). */
  pick: number;
  round: 1 | 2;
  /** Posizione nel giro (1-30). */
  number: number;
  originalTeamId: string;
  ownerId: string;
  playerId: string | null;
}

export interface GameRecord {
  turn: number;
  /**
   * Giorno della stagione (giorni dall'apertura), per chi mostra le partite: il motore usa i giorni del calendario e
   * del tabellone, non questo. Lo scrive il motore per le partite che gioca.
   */
  day?: number;
  phase: 'regular' | 'play-in' | 'playoffs';
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  overtimes: number;
}

export interface Transaction {
  year: number;
  turn: number | null;
  type: 'signing' | 'renewal' | 'trade' | 'release' | 'retirement' | 'draft' | 'option' | 'injury';
  text: string;
}

export interface SeasonSummary {
  year: number;
  championId: string | null;
  finalistId: string | null;
  bestRecordId: string;
  records: Record<string, { w: number; l: number }>;
  lottery: string[];
  trades: number;
  botTrades: number;
  signings: number;
  retirements: number;
}

export type LeaguePhase = 'regular' | 'postseason' | 'offseason';

/** Stato completo di una lega: tutto quello che serve per giocare turni e stagioni. */
export interface LeagueState {
  seed: string;
  config: SeasonConfig;
  phase: LeaguePhase;
  /**
   * Turno di regular season da giocare: l'indice del giorno con partite nel calendario (da 0). In post-season e
   * offseason resta al numero dei turni di regular season.
   */
  turn: number;
  /**
   * Giorno della stagione del turno da giocare (giorni dall'apertura): in regular season quello del calendario, in
   * post-season il prossimo giorno con partite, in offseason l'ultimo giocato. Decide la trade deadline.
   */
  day: number;
  teams: TeamState[];
  players: PlayerState[];
  contracts: Contract[];
  deadMoney: DeadMoney[];
  picks: DraftPick[];
  swaps: DraftSwap[];
  schedule: ScheduledGame[];
  games: GameRecord[];
  postseason: PostseasonState | null;
  transactions: Transaction[];
  history: SeasonSummary[];
  /** Livello della lega alla creazione (media dei migliori 150): ogni offseason ci si riporta lì. */
  talentReference: number;
  /**
   * Seed pubblico (sul server l'id della lega) per i sorteggi che tutti devono poter rifare, come gli spareggi
   * in classifica. Senza, si usa seed: va bene offline, non sul server, dove seed resta segreto.
   */
  publicSeed?: string;
  /** Offseason in corso: draft dell'anno, lottery e chiamate (da startOffseason a startNewSeason). */
  offseason?: { draftYear: number; lottery: string[]; slots: DraftSlotState[] } | null;
  /**
   * Tagli della stagione, dalla prima giornata alla fine della preparazione: una squadra non rifirma chi ha tagliato
   * (tagliare e rifirmare in stagione costava meno che rinnovare). Sul server vengono dalle richieste di taglio
   * eseguite nei turni della stagione.
   */
  releases?: { playerId: string; teamId: string }[];
  /** Luxury tax e monte stipendi minimo pagati all'ultima fine di regular season (per il bilancio del server). */
  lastSettlement?: { teamId: string; payroll: number; tax: number; shortfall: number }[];
}

export function emptyStats(): SeasonStats {
  return {
    g: 0,
    gs: 0,
    seconds: 0,
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
  };
}
