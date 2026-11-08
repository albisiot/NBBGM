// Stato del turno: i tipi e la conversione della risposta di public.turn_status. Modulo puro (niente Supabase né
// browser): lo usano turns.ts e il test della funzione sul database (scripts/test/turnStatus.test.ts).

/**
 * Stato di una squadra umana nel turno:
 *   ready     Pronto premuto
 *   rest      in regular season senza partita nel giorno, con il Pronto messo dal server: conta come pronta (il
 *             manager può toglierlo, per esempio per fare mercato)
 *   coach     allenatore attivo, senza avvisi bloccanti: conta come pronta
 *   blocked   allenatore attivo ma con un avviso bloccante aperto: non è pronta finché il manager non risponde
 *   waiting   non pronta
 *   out       in play-in e playoff senza partita nel turno: non deve essere pronta
 */
export type Readiness = 'ready' | 'rest' | 'coach' | 'blocked' | 'waiting' | 'out';

export interface RoundInfo {
  id: string;
  number: number;
  kind: 'regular' | 'play-in' | 'playoffs' | 'offseason';
  state: 'open' | 'closing' | 'done';
  /** Turno di offseason: draft, renewals, fa1-fa4, preparation. */
  stage: string | null;
  deadline: string | null;
  createdAt: string;
  forcedAt: string | null;
  /** Inizio della chiusura (o dell'ultima ripresa) della simulazione. */
  closingStartedAt: string | null;
  /** Giorno del turno, in giorni dall'apertura della stagione (null in offseason). */
  day: number | null;
  /** Anno della stagione del turno (2026 per il 2026-27). */
  seasonYear: number | null;
}

/** Simulazione che non riesce: tentativi fatti e, dopo l'ultimo, quando il turno si è fermato. */
export interface RoundTrouble {
  attempts: number;
  failedAt: string | null;
}

export interface Delegation {
  teamId: string;
  active: boolean;
  untilRound: number | null;
  untilAt: string | null;
}

export interface AlertItem {
  id: string;
  kind: string;
  blocking: boolean;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface LastGame {
  roundNumber: number;
  kind: 'regular' | 'play-in' | 'playoffs';
  /** Giorno della partita e anno della sua stagione: la data. */
  day: number | null;
  seasonYear: number | null;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  overtimes: number;
}

export interface TurnStatus {
  /** Lega a cui si riferiscono i dati. */
  leagueId: string;
  round: RoundInfo | null;
  paused: boolean;
  maxPaceSeconds: number;
  /** Il draft iniziale non è ancora finito: il primo turno parte dopo. */
  draftPending: boolean;
  /** Squadre con il Pronto premuto in questo turno. */
  ready: Set<string>;
  delegations: Delegation[];
  /** Avvisi aperti della propria squadra (gli altri non si vedono). */
  alerts: AlertItem[];
  lastGame: LastGame | null;
  /** In play-in e playoff le squadre con una partita nel turno (le altre non devono essere pronte); null in regular season. */
  playing: Set<string> | null;
  /** Squadre con una partita nel turno, anche in regular season (le altre riposano); null in offseason. */
  today: Set<string> | null;
  /** A stagione finita, il campione. */
  championId: string | null;
  /** Solo per un turno in chiusura: tentativi di simulazione e stato fermo. */
  trouble: RoundTrouble | null;
  /** Squadra del manager collegato, se ne ha una. */
  myTeamId: string | null;
  /**
   * Stato delle squadre umane calcolato dal server (round_readiness), con la regola che decide la chiusura del
   * turno; null se il database non ha ancora la funzione.
   */
  teamStates: Map<string, Readiness> | null;
}

export type RoundRow = {
  id: string;
  number: number;
  kind: RoundInfo['kind'];
  state: RoundInfo['state'];
  stage: string | null;
  deadline: string | null;
  created_at: string;
  forced_at: string | null;
  closing_started_at: string | null;
  /** Dal 20261108090000. */
  day?: number | null;
  season_year?: number | null;
};

export type LastGameRow = {
  round_number: number;
  kind?: LastGame['kind'];
  day?: number | null;
  season_year?: number | null;
  home_team_id: string;
  away_team_id: string;
  home_score: number;
  away_score: number;
  overtimes: number | null;
};

export type AlertRow = {
  id: string;
  kind: string;
  blocking: boolean;
  payload: Record<string, unknown>;
  created_at: string;
};

export type DelegationRow = {
  team_id: string;
  active: boolean;
  until_round: number | null;
  until_at: string | null;
};

/** Risposta di public.turn_status (null per chi non è nella lega). */
export interface TurnStatusRow {
  paused: boolean;
  max_pace_seconds: number | null;
  season_id: string | null;
  round: (RoundRow & { attempts?: number | null; failed_at?: string | null }) | null;
  draft_state: string | null;
  my_team_id: string | null;
  ready: string[] | null;
  delegations: DelegationRow[] | null;
  alerts: AlertRow[] | null;
  last_game: LastGameRow | null;
  readiness: { team_id: string; state: string }[] | null;
  playing: string[] | null;
  champion_id: string | null;
}

export const toRound = (r: RoundRow): RoundInfo => ({
  id: r.id,
  number: r.number,
  kind: r.kind,
  state: r.state,
  stage: r.stage ?? null,
  deadline: r.deadline,
  createdAt: r.created_at,
  forcedAt: r.forced_at,
  closingStartedAt: r.closing_started_at,
  day: r.day ?? null,
  seasonYear: r.season_year ?? null,
});

export const toLastGame = (g: LastGameRow | null | undefined): LastGame | null =>
  g
    ? {
        roundNumber: g.round_number,
        kind: g.kind ?? 'regular',
        day: g.day ?? null,
        seasonYear: g.season_year ?? null,
        homeTeamId: g.home_team_id,
        awayTeamId: g.away_team_id,
        homeScore: g.home_score,
        awayScore: g.away_score,
        overtimes: g.overtimes ?? 0,
      }
    : null;

export const toAlert = (a: AlertRow): AlertItem => ({
  id: a.id,
  kind: a.kind,
  blocking: a.blocking,
  payload: a.payload,
  createdAt: a.created_at,
});

export const toDelegation = (d: DelegationRow): Delegation => ({
  teamId: d.team_id,
  active: d.active,
  untilRound: d.until_round,
  untilAt: d.until_at,
});

const READINESS: readonly Readiness[] = ['ready', 'rest', 'coach', 'blocked', 'waiting', 'out'];

export const toStates = (rows: readonly { team_id: string; state: string }[]): Map<string, Readiness> =>
  new Map(
    rows
      .filter((r) => (READINESS as readonly string[]).includes(r.state))
      .map((r) => [r.team_id, r.state as Readiness]),
  );

/** Stato del turno dalla risposta di turn_status: lo stesso che si ricavava dalle letture separate. */
export function turnFromServer(leagueId: string, row: TurnStatusRow | null): TurnStatus {
  const round = row?.round ?? null;
  const postseason = round?.kind === 'play-in' || round?.kind === 'playoffs';
  return {
    leagueId,
    round: round && toRound(round),
    paused: row?.paused ?? false,
    maxPaceSeconds: row?.max_pace_seconds ?? 60,
    draftPending: row?.draft_state != null && row.draft_state !== 'done',
    ready: new Set(row?.ready ?? []),
    delegations: (row?.delegations ?? []).map(toDelegation),
    alerts: (row?.alerts ?? []).map(toAlert),
    lastGame: toLastGame(row?.last_game),
    playing: postseason ? new Set(row?.playing ?? []) : null,
    today: round && round.kind !== 'offseason' ? new Set(row?.playing ?? []) : null,
    championId: round?.kind === 'offseason' ? (row?.champion_id ?? null) : null,
    trouble:
      round?.state === 'closing'
        ? { attempts: round.attempts ?? 0, failedAt: round.failed_at ?? null }
        : null,
    myTeamId: row?.my_team_id ?? null,
    teamStates: round ? toStates(row?.readiness ?? []) : null,
  };
}
