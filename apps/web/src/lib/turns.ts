// Turno corrente: chi è pronto, chi ha l'allenatore, avvisi della propria squadra, Pronto e azioni del
// commissario. Gli aggiornamenti arrivano in tempo reale (Supabase Realtime, con la RLS) e, per sicurezza,
// con una rilettura ogni 30 secondi.
import { supabase } from './supabase.ts';

export interface RoundInfo {
  id: string;
  number: number;
  kind: 'regular' | 'play-in' | 'playoffs' | 'offseason';
  state: 'open' | 'closing' | 'done';
  deadline: string | null;
  createdAt: string;
  forcedAt: string | null;
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
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  overtimes: number;
}

export interface TurnStatus {
  round: RoundInfo | null;
  paused: boolean;
  maxPaceSeconds: number;
  /** Squadre con il Pronto premuto in questo turno. */
  ready: Set<string>;
  delegations: Delegation[];
  /** Avvisi aperti della propria squadra (gli altri non si vedono). */
  alerts: AlertItem[];
  lastGame: LastGame | null;
  /** In play-in e playoff le squadre con una partita nel turno; null in regular season (giocano tutte). */
  playing: Set<string> | null;
  /** A stagione finita, il campione. */
  championId: string | null;
}

export async function turnStatus(leagueId: string, myTeamId: string | null): Promise<TurnStatus> {
  const league = await supabase
    .from('leagues')
    .select(
      'paused, max_pace_seconds, current_season_id, round:rounds!leagues_current_round(id, number, kind, state, deadline, created_at, forced_at)',
    )
    .eq('id', leagueId)
    .maybeSingle();
  if (league.error) throw league.error;
  const l = league.data as unknown as {
    paused: boolean;
    max_pace_seconds: number;
    current_season_id: string | null;
    round: {
      id: string;
      number: number;
      kind: RoundInfo['kind'];
      state: RoundInfo['state'];
      deadline: string | null;
      created_at: string;
      forced_at: string | null;
    } | null;
  } | null;
  const round = l?.round ?? null;
  const [flags, delegations, alerts, games] = await Promise.all([
    round
      ? supabase.from('ready_flags').select('team_id').eq('round_id', round.id).eq('ready', true)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from('coach_delegations')
      .select('team_id, active, until_round, until_at')
      .eq('league_id', leagueId),
    myTeamId
      ? supabase
          .from('alerts')
          .select('id, kind, blocking, payload, created_at')
          .eq('team_id', myTeamId)
          .eq('status', 'open')
          .order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    myTeamId
      ? supabase
          .from('games')
          .select('round_number, home_team_id, away_team_id, home_score, away_score, overtimes')
          .eq('league_id', leagueId)
          .not('home_score', 'is', null)
          .or(`home_team_id.eq.${myTeamId},away_team_id.eq.${myTeamId}`)
          .order('played_at', { ascending: false })
          .limit(1)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [flags, delegations, alerts, games]) if (r.error) throw r.error;
  let playing: Set<string> | null = null;
  let championId: string | null = null;
  const season = l?.current_season_id ?? null;
  if (round && season && (round.kind === 'play-in' || round.kind === 'playoffs')) {
    const r = await supabase
      .from('games')
      .select('home_team_id, away_team_id')
      .eq('season_id', season)
      .eq('round_number', round.number);
    if (r.error) throw r.error;
    playing = new Set(
      ((r.data ?? []) as { home_team_id: string; away_team_id: string }[]).flatMap((g) => [
        g.home_team_id,
        g.away_team_id,
      ]),
    );
  }
  if (round?.kind === 'offseason' && season) {
    const r = await supabase
      .from('playoff_series')
      .select('winner_team_id')
      .eq('season_id', season)
      .eq('round', 4)
      .maybeSingle();
    if (r.error) throw r.error;
    championId = (r.data as { winner_team_id: string | null } | null)?.winner_team_id ?? null;
  }
  const g = (games.data ?? [])[0] as
    | {
        round_number: number;
        home_team_id: string;
        away_team_id: string;
        home_score: number;
        away_score: number;
        overtimes: number | null;
      }
    | undefined;
  return {
    round: round && {
      id: round.id,
      number: round.number,
      kind: round.kind,
      state: round.state,
      deadline: round.deadline,
      createdAt: round.created_at,
      forcedAt: round.forced_at,
    },
    paused: l?.paused ?? false,
    maxPaceSeconds: l?.max_pace_seconds ?? 60,
    ready: new Set(((flags.data ?? []) as { team_id: string }[]).map((f) => f.team_id)),
    delegations: (
      (delegations.data ?? []) as {
        team_id: string;
        active: boolean;
        until_round: number | null;
        until_at: string | null;
      }[]
    ).map((d) => ({ teamId: d.team_id, active: d.active, untilRound: d.until_round, untilAt: d.until_at })),
    alerts: (
      (alerts.data ?? []) as {
        id: string;
        kind: string;
        blocking: boolean;
        payload: Record<string, unknown>;
        created_at: string;
      }[]
    ).map((a) => ({
      id: a.id,
      kind: a.kind,
      blocking: a.blocking,
      payload: a.payload,
      createdAt: a.created_at,
    })),
    lastGame: g
      ? {
          roundNumber: g.round_number,
          homeTeamId: g.home_team_id,
          awayTeamId: g.away_team_id,
          homeScore: g.home_score,
          awayScore: g.away_score,
          overtimes: g.overtimes ?? 0,
        }
      : null,
    playing,
    championId,
  };
}

/** Allenatore attivo per quel turno, come lo conta il server (gli avvisi bloccanti a parte). */
export function coachActive(d: Delegation | undefined, roundNumber: number, now = Date.now()): boolean {
  if (!d?.active) return false;
  if (d.untilRound !== null && roundNumber > d.untilRound) return false;
  if (d.untilAt !== null && now >= Date.parse(d.untilAt)) return false;
  return true;
}

export type Readiness = 'ready' | 'coach' | 'waiting' | 'out';

/**
 * Stato di una squadra umana nel turno: Pronto premuto, allenatore attivo, in attesa, oppure fuori dal turno
 * (in play-in e playoff chi non gioca non deve essere pronto).
 */
export function readiness(status: TurnStatus, teamId: string, now = Date.now()): Readiness {
  if (status.playing && !status.playing.has(teamId)) return 'out';
  if (status.ready.has(teamId)) return 'ready';
  const d = status.delegations.find((x) => x.teamId === teamId);
  if (status.round && coachActive(d, status.round.number, now)) return 'coach';
  return 'waiting';
}

/** Pronto o tolto il Pronto; restituisce true se ora tutte le squadre umane sono pronte. */
export async function setReady(teamId: string, ready: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_ready', { p_team: teamId, p_ready: ready });
  if (error) throw error;
  return data as boolean;
}

export async function forceRound(leagueId: string): Promise<void> {
  const { error } = await supabase.rpc('force_round', { p_league: leagueId });
  if (error) throw error;
}

export async function setPaused(leagueId: string, paused: boolean): Promise<void> {
  const { error } = await supabase.from('leagues').update({ paused }).eq('id', leagueId);
  if (error) throw error;
}

export async function answerAlert(alertId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc('answer_alert', { p_alert: alertId });
  if (error) throw error;
  return data as boolean;
}

/**
 * Ascolta in tempo reale turni, Pronto, allenatori e avvisi della lega; onChange si chiama a ogni modifica
 * (la RLS decide che cosa arriva). Restituisce la funzione per smettere di ascoltare.
 */
export function subscribeTurn(leagueId: string, onChange: () => void): () => void {
  const filter = `league_id=eq.${leagueId}`;
  const channel = supabase.channel(`turno:${leagueId}`);
  for (const table of ['rounds', 'ready_flags', 'coach_delegations', 'alerts'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, onChange);
  channel.subscribe();
  const timer = setInterval(onChange, 30_000);
  return () => {
    clearInterval(timer);
    void supabase.removeChannel(channel);
  };
}

/** Testo di un avviso per il manager. */
export function alertText(a: Pick<AlertItem, 'kind' | 'payload'>): {
  title: string;
  body: string;
  action: string;
} {
  const p = a.payload;
  switch (a.kind) {
    case 'roster_minimum':
      return {
        title: 'Rosa sotto il minimo',
        body: `Hai ${String(p.standard)} contratti standard: ne servono almeno ${String(p.minimum ?? 13)}. Se il turno si chiude con la rosa ancora corta, il server firma al minimo, per un anno, i migliori svincolati dei ruoli scoperti. Finché non rispondi l'allenatore è fermo.`,
        action: 'Ho capito, firma il server',
      };
    case 'injury': {
      const games = Number(p.games);
      return {
        title: 'Infortunio',
        body: `${String(p.player)} si è fatto male (${String(p.body_part_label ?? p.body_part)}): starà fuori ${games} ${games === 1 ? 'partita' : 'partite'}.`,
        action: 'Ok',
      };
    }
    default:
      return { title: 'Avviso', body: '', action: 'Ok' };
  }
}

/** "tra 12 min", "tra 3 h 20 min", "scaduta" */
export function timeLeft(deadline: string, now = Date.now()): string {
  const s = Math.floor((Date.parse(deadline) - now) / 1000);
  if (s <= 0) return 'scaduta';
  if (s < 60) return `tra ${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `tra ${m} min`;
  const h = Math.floor(m / 60);
  return m % 60 ? `tra ${h} h ${m % 60} min` : `tra ${h} h`;
}
