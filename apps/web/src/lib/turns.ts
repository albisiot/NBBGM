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
  /** Inizio della chiusura (o dell'ultima ripresa) della simulazione. */
  closingStartedAt: string | null;
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
  /** Solo per un turno in chiusura: tentativi di simulazione e stato fermo. */
  trouble: RoundTrouble | null;
}

export async function turnStatus(leagueId: string, myTeamId: string | null): Promise<TurnStatus> {
  const league = await supabase
    .from('leagues')
    .select(
      'paused, max_pace_seconds, current_season_id, round:rounds!leagues_current_round(id, number, kind, state, deadline, created_at, forced_at, closing_started_at)',
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
      closing_started_at: string | null;
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
  const trouble = round?.state === 'closing' ? await roundTrouble(round.id) : null;
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
      closingStartedAt: round.closing_started_at,
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
    trouble,
  };
}

/**
 * Tentativi di simulazione del turno. Letti a parte: se il database non ha ancora le colonne (l'app si pubblica
 * insieme alle migrazioni) la scheda del turno funziona lo stesso, senza queste informazioni.
 */
async function roundTrouble(roundId: string): Promise<RoundTrouble | null> {
  const { data, error } = await supabase
    .from('rounds')
    .select('attempts, failed_at')
    .eq('id', roundId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { attempts: number; failed_at: string | null };
  return { attempts: r.attempts, failedAt: r.failed_at };
}

/** Tentativi di simulazione prima che il turno si fermi (come private.max_round_attempts nel database). */
export const MAX_ROUND_ATTEMPTS = 3;

/** Minuti dopo i quali un turno in chiusura si considera fermo (il server lo riprende o il commissario lo riapre). */
export const STUCK_AFTER_MS = 5 * 60_000;

/** Turno in chiusura che non si è chiuso: fermo dopo l'ultimo tentativo o in chiusura da più di 5 minuti. */
export function roundStuck(round: RoundInfo, trouble: RoundTrouble | null, now = Date.now()): boolean {
  if (round.state !== 'closing') return false;
  if (trouble?.failedAt) return true;
  return round.closingStartedAt !== null && now - Date.parse(round.closingStartedAt) > STUCK_AFTER_MS;
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

/**
 * Pronto o tolto il Pronto per il turno che il manager sta guardando (roundId): se nel frattempo il server è
 * passato al turno successivo, rifiuta. Restituisce true se ora tutte le squadre umane sono pronte.
 */
export async function setReady(teamId: string, ready: boolean, roundId: string): Promise<boolean> {
  let { data, error } = await supabase.rpc('set_ready', {
    p_team: teamId,
    p_ready: ready,
    p_round: roundId,
  });
  // Database non ancora aggiornato (l'app si pubblica insieme alle migrazioni): set_ready senza il turno
  if (error?.code === 'PGRST202')
    ({ data, error } = await supabase.rpc('set_ready', { p_team: teamId, p_ready: ready }));
  if (error) throw error;
  return data as boolean;
}

export async function forceRound(leagueId: string): Promise<void> {
  const { error } = await supabase.rpc('force_round', { p_league: leagueId });
  if (error) throw error;
}

/** Ultimo errore della simulazione del turno corrente: solo per il commissario. */
export async function roundError(leagueId: string): Promise<string | null> {
  const { data, error } = await supabase.rpc('round_error', { p_league: leagueId });
  if (error) throw error;
  return (data as string | null) ?? null;
}

/** Il commissario riapre il turno fermo in chiusura; con newSeed la simulazione si rifà con un caso diverso. */
export async function reopenRound(leagueId: string, newSeed: boolean): Promise<void> {
  const { error } = await supabase.rpc('reopen_round', { p_league: leagueId, p_new_seed: newSeed });
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

// Ogni canale ha un nome suo: supabase-js riusa un canale con lo stesso nome, anche se sta per chiudersi
let channelCount = 0;
export const channelName = (prefix: string, leagueId: string) => `${prefix}:${leagueId}:${++channelCount}`;

/**
 * Chiama onVisible quando l'app torna in primo piano o la rete torna: mentre era in background (PWA chiusa,
 * telefono bloccato) gli eventi in tempo reale si sono persi. Restituisce la funzione per smettere.
 */
export function onResume(onVisible: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') onVisible();
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('online', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('online', handler);
  };
}

/**
 * Ascolta in tempo reale turni, Pronto, allenatori e avvisi della lega; onChange si chiama a ogni modifica
 * (la RLS decide che cosa arriva), al ritorno in primo piano e ogni 30 secondi. Restituisce la funzione per
 * smettere di ascoltare.
 */
export function subscribeTurn(leagueId: string, onChange: () => void): () => void {
  const filter = `league_id=eq.${leagueId}`;
  const channel = supabase.channel(channelName('turno', leagueId));
  for (const table of ['rounds', 'ready_flags', 'coach_delegations', 'alerts'])
    channel.on('postgres_changes', { event: '*', schema: 'public', table, filter }, onChange);
  channel.subscribe();
  const timer = setInterval(onChange, 30_000);
  const stopResume = onResume(onChange);
  return () => {
    clearInterval(timer);
    stopResume();
    void supabase.removeChannel(channel);
  };
}

/** Turno corrente della lega, per capire se è cambiato. */
export async function currentRoundId(leagueId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from('leagues')
    .select('current_round_id')
    .eq('id', leagueId)
    .maybeSingle();
  if (error) throw error;
  return (data?.current_round_id as string | null | undefined) ?? null;
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
    case 'trade_offer':
      return {
        title: 'Proposta di scambio',
        body: 'Hai ricevuto una proposta di scambio: rispondi prima che il turno si chiuda, altrimenti è rifiutata. Finché non rispondi l’allenatore è fermo.',
        action: 'Vai agli scambi',
      };
    case 'market':
      return { title: 'Mercato', body: String(p.text ?? ''), action: 'Ok' };
    case 'draft_pick': {
      const picks = Array.isArray(p.picks) ? (p.picks as number[]) : [];
      return {
        title: `Draft ${String(p.draft_year ?? '')}`,
        body: `Hai ${picks.length === 1 ? 'la scelta' : 'le scelte'} n. ${picks.join(', ')}. Ordina i tuoi preferiti nella pagina del draft: alla chiusura del turno sceglie il server, il primo disponibile della tua lista (senza lista, il migliore per i ruoli scoperti).`,
        action: 'Lista pronta',
      };
    }
    case 'renewals':
      return {
        title: 'Rinnovi',
        body: `Hai ${String(p.players)} ${p.players === 1 ? 'giocatore' : 'giocatori'} in scadenza: rinnova chi vuoi tenere nella pagina del mercato. Chi non rinnovi diventa svincolato alla chiusura del turno.`,
        action: 'Ho deciso',
      };
    case 'free_agency':
      return {
        title: `Free agency, turno ${String(p.round)} di 4`,
        body: 'Fai le tue offerte agli svincolati nella pagina del mercato: alla chiusura del turno ognuno sceglie l’offerta migliore. Le richieste scendono di turno in turno.',
        action: 'Ho finito',
      };
    case 'preparation':
      return {
        title: 'Preparazione della stagione',
        body: 'Ultimo turno dell’offseason: sistema rosa (13-15 contratti standard, al massimo 3 two-way), quintetto e tattiche. Alla chiusura il server taglia gli esuberi con l’overall più basso e firma al minimo chi manca.',
        action: 'Squadra pronta',
      };
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
