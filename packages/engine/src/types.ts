import type { BodyPart, HiddenKey, RatingKey, TendencyKey } from './fields.ts';

export const ROLES = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
export type Role = (typeof ROLES)[number];

export type Ratings = Record<RatingKey, number>;
export type Tendencies = Record<TendencyKey, number>;
export type Hidden = Record<HiddenKey, number>;

export type Conference = 'East' | 'West';
export type Division = 'Atlantic' | 'Central' | 'Southeast' | 'Northwest' | 'Pacific' | 'Southwest';

export interface Team {
  /** Sigla NBA, es. "BOS". */
  id: string;
  city: string;
  name: string;
  /** Nome completo come nel file dei giocatori, es. "Boston Celtics". */
  fullName: string;
  conference: Conference;
  division: Division;
}

export type InjurySeverity = 'light' | 'medium' | 'severe';

export interface Injury {
  bodyPart: BodyPart;
  severity: InjurySeverity;
  /** Partite ancora da saltare. */
  gamesRemaining: number;
}

/** Draft NBA di un giocatore: anno e, se è stato scelto, giro e scelta assoluta. */
export interface DraftInfo {
  /** Anno del draft (es. 2018 per il draft di giugno 2018); null per chi non è stato scelto e non ha un anno noto. */
  year: number | null;
  /** null: non scelto. */
  round: 1 | 2 | null;
  /** Scelta assoluta (1-60); null: non scelto. */
  pick: number | null;
}

export interface Player {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  role: Role;
  secondaryRole: Role | null;
  hand: 'R' | 'L';
  archetype: string;
  age: number;
  heightCm: number;
  /** Stimata dall'altezza nel file dati. */
  wingspanCm: number;
  weightKg: number;
  yearsInLeague: number | null;
  /**
   * Draft NBA (giocatori reali dal file del draft, prospetti al draft annuale della lega). Assente o null: non noto
   * (giocatori generati fuori dal draft). Il motore non lo usa: è una voce della scheda.
   */
  draft?: DraftInfo | null;
  ratings: Ratings;
  tendencies: Tendencies;
  /** Valori nascosti: non escono mai dal server. */
  hidden: Hidden;
  /** 0-100: cala giocando, risale a riposo. */
  energy: number;
  /** 0-100. */
  morale: number;
  injury: Injury | null;
}

export type ContractType = 'standard' | 'rookie' | 'two-way' | 'ten-day' | 'minimum' | 'unknown';
export type ContractOption = 'player' | 'team' | null;

export interface Contract {
  playerId: string;
  teamId: string;
  type: ContractType;
  /** Stipendio di ogni stagione a partire da quella corrente, in dollari. Vuoto per i two-way. */
  salaries: number[];
  /** Opzione sulla stagione con lo stesso indice di salaries. */
  options: ContractOption[];
  guaranteed: number | null;
}

/** Stipendio residuo di un giocatore tagliato, a carico della squadra che lo ha tagliato. */
export interface DeadMoney {
  teamId: string;
  playerName: string;
  salaries: number[];
}

/** Lega completa così come esce dall'import o dal generatore. */
export interface LeagueData {
  season: string;
  teams: Team[];
  /** teamId null = svincolato. */
  players: (Player & { teamId: string | null })[];
  contracts: Contract[];
  deadMoney: DeadMoney[];
}
