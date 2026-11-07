// Turno corrente: chi è pronto, chi ha l'allenatore, avvisi della propria squadra, Pronto e azioni del
// commissario. Lo stato si legge in una volta con la funzione turn_status e lo condividono barra, scheda e pagine
// (lib/turnStore.ts); gli aggiornamenti arrivano in tempo reale (Supabase Realtime, con la RLS) e, per sicurezza,
// con una rilettura ogni 30 secondi.
import { onResume } from './resume.ts';
import { supabase } from './supabase.ts';
import {
  toAlert,
  toDelegation,
  toLastGame,
  toRound,
  toStates,
  turnFromServer,
  type AlertItem,
  type AlertRow,
  type Delegation,
  type DelegationRow,
  type LastGameRow,
  type Readiness,
  type RoundInfo,
  type RoundRow,
  type RoundTrouble,
  type TurnStatus,
  type TurnStatusRow,
} from './turnStatus.ts';

export { turnFromServer };
export type {
  AlertItem,
  Delegation,
  LastGame,
  Readiness,
  RoundInfo,
  RoundTrouble,
  TurnStatus,
  TurnStatusRow,
} from './turnStatus.ts';

// onResume sta in un modulo a sé, che l'intestazione usa senza caricare il resto di questo file
export { onResume };

/**
 * Stato del turno della lega per l'utente collegato, in una sola lettura (turn_status). Se il database non ha
 * ancora la funzione (l'app si pubblica insieme alle migrazioni) lo ricava dalle tabelle, come prima.
 */
export async function loadTurn(leagueId: string, userId: string): Promise<TurnStatus> {
  const { data, error } = await supabase.rpc('turn_status', { p_league: leagueId });
  if (error?.code === 'PGRST202') return turnStatusFromTables(leagueId, userId);
  if (error) throw error;
  return turnFromServer(leagueId, data as TurnStatusRow | null);
}

/** Lo stesso stato dalle tabelle, con più letture: solo senza turn_status. */
async function turnStatusFromTables(leagueId: string, userId: string): Promise<TurnStatus> {
  const [league, team] = await Promise.all([
    supabase
      .from('leagues')
      .select(
        'paused, max_pace_seconds, current_season_id, round:rounds!leagues_current_round(id, number, kind, state, stage, deadline, created_at, forced_at, closing_started_at), draft:initial_drafts(state)',
      )
      .eq('id', leagueId)
      .maybeSingle(),
    supabase.from('teams').select('id').eq('league_id', leagueId).eq('owner_id', userId).maybeSingle(),
  ]);
  if (league.error) throw league.error;
  if (team.error) throw team.error;
  const l = league.data as unknown as {
    paused: boolean;
    max_pace_seconds: number;
    current_season_id: string | null;
    round: RoundRow | null;
    draft: { state: string } | { state: string }[] | null;
  } | null;
  const myTeamId = (team.data as { id: string } | null)?.id ?? null;
  const round = l?.round ?? null;
  const [flags, delegations, alerts, games, teamStates] = await Promise.all([
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
    round ? serverReadiness(leagueId) : Promise.resolve(null),
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
  const draft = Array.isArray(l?.draft) ? l?.draft[0] : l?.draft;
  return {
    leagueId,
    round: round && toRound(round),
    paused: l?.paused ?? false,
    maxPaceSeconds: l?.max_pace_seconds ?? 60,
    draftPending: draft != null && draft.state !== 'done',
    ready: new Set(((flags.data ?? []) as { team_id: string }[]).map((f) => f.team_id)),
    delegations: ((delegations.data ?? []) as DelegationRow[]).map(toDelegation),
    alerts: ((alerts.data ?? []) as AlertRow[]).map(toAlert),
    lastGame: toLastGame((games.data ?? [])[0] as LastGameRow | undefined),
    playing,
    championId,
    trouble,
    myTeamId,
    teamStates,
  };
}

/**
 * Stato delle squadre umane nel turno corrente, dal server. Null se il database non ha ancora round_readiness
 * (l'app si pubblica insieme alle migrazioni): la scheda lo ricava allora dalle tabelle.
 */
async function serverReadiness(leagueId: string): Promise<Map<string, Readiness> | null> {
  const { data, error } = await supabase.rpc('round_readiness', { p_league: leagueId });
  if (error?.code === 'PGRST202') return null;
  if (error) throw error;
  return toStates((data ?? []) as { team_id: string; state: string }[]);
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
export function roundStuck(
  round: Pick<RoundInfo, 'state' | 'closingStartedAt'>,
  trouble: RoundTrouble | null,
  now = Date.now(),
): boolean {
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

/** La squadra conta come pronta per la chiusura del turno. */
export const countsAsReady = (r: Readiness): boolean => r === 'ready' || r === 'coach';

/**
 * Stato di una squadra nel turno. Lo dà il server, che vede gli avvisi di tutti; senza (database non ancora
 * aggiornato) si ricava dalle tabelle, e gli avvisi bloccanti si vedono solo per la propria squadra.
 */
export function readiness(status: TurnStatus, teamId: string, now = Date.now()): Readiness {
  const d = status.delegations.find((x) => x.teamId === teamId);
  const coach = status.round !== null && coachActive(d, status.round.number, now);
  const server = status.teamStates?.get(teamId);
  if (server !== undefined)
    // La delega può scadere tra una lettura e l'altra
    return (server === 'coach' || server === 'blocked') && !coach ? 'waiting' : server;
  if (status.playing && !status.playing.has(teamId)) return 'out';
  if (status.ready.has(teamId)) return 'ready';
  if (!coach) return 'waiting';
  return teamId === status.myTeamId && status.alerts.some((a) => a.blocking) ? 'blocked' : 'coach';
}

/** "Bruno", "Bruno e Carla", "Bruno, Carla e te" */
function namesList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
}

/**
 * Nota sotto l'elenco dei manager, per un turno aperto e una lega non in pausa: chi deve ancora decidere (con
 * l'allenatore fermo da un avviso) oppure, se tutti sono pronti, come parte il turno. Null se non c'è niente da
 * dire.
 */
export function readinessNote(teams: { name: string; mine: boolean; state: Readiness }[]): string | null {
  const inRound = teams.filter((t) => t.state !== 'out');
  if (inRound.length === 0) return null;
  if (inRound.every((t) => countsAsReady(t.state)))
    return inRound.every((t) => t.state === 'coach')
      ? 'Tutti con l’allenatore: la lega avanza da sola, al ritmo scelto dal commissario.'
      : 'Tutti pronti: il turno parte a momenti.';
  const blocked = inRound.filter((t) => t.state === 'blocked');
  if (blocked.length === 0) return null;
  // Prima gli altri, "te" in fondo
  const names = [
    ...blocked.filter((t) => !t.mine).map((t) => t.name),
    ...(blocked.some((t) => t.mine) ? ['te'] : []),
  ];
  return `Si aspetta una decisione da ${namesList(names)}: con un avviso aperto l’allenatore si ferma finché il manager non risponde.`;
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

/**
 * Riapre il turno fermo in chiusura (il commissario, o qualsiasi membro MEMBER_REOPEN_HOURS ore dopo il blocco);
 * con newSeed la simulazione si rifà con un caso diverso, con withdrawMarket si ritirano offerte, scambi, tagli e
 * rinnovi in sospeso di tutta la lega.
 */
export async function reopenRound(leagueId: string, newSeed: boolean, withdrawMarket = false): Promise<void> {
  const { error } = await supabase.rpc('reopen_round', {
    p_league: leagueId,
    p_new_seed: newSeed,
    p_withdraw_market: withdrawMarket,
  });
  if (error) throw error;
}

/** Ore dopo il blocco del turno oltre le quali lo riapre qualsiasi membro (private.member_reopen_hours). */
export const MEMBER_REOPEN_HOURS = 6;

/**
 * Da quando un membro che non è il commissario può riaprire il turno bloccato (null se non è bloccato): il
 * commissario può sempre.
 */
export function memberReopenAt(trouble: RoundTrouble | null): number | null {
  if (!trouble?.failedAt) return null;
  return Date.parse(trouble.failedAt) + MEMBER_REOPEN_HOURS * 3600_000;
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
 * Ascolta in tempo reale turni, Pronto, allenatori e avvisi della lega; onChange si chiama a ogni modifica
 * (la RLS decide che cosa arriva), al ritorno in primo piano e ogni 30 secondi. Restituisce la funzione per
 * smettere di ascoltare. Lo usa lo stato del turno condiviso (lib/turnStore.ts): un solo ascolto per lega.
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
    case 'storage':
      return {
        title: 'Database quasi pieno',
        body: `Il database del gioco occupa ${String(p.mb)} MB su ${String(p.limit_mb ?? 500)}: per ora non si creano leghe nuove. Se avete leghe che non giocate più, eliminatele dalla loro pagina.`,
        action: 'Ok',
      };
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

/**
 * Che cosa succede, se il turno si chiude adesso, alle decisioni ancora aperte e alle modifiche non salvate: lo si
 * dice prima di segnarsi pronti. coach: allenatore attivo (decide lui i rinnovi lasciati aperti). Vuoto se non
 * c'è nulla da dire.
 */
export function readyWarnings(
  decisions: readonly { kind: string }[],
  opts: { unsaved?: boolean; coach?: boolean } = {},
): string[] {
  const out: string[] = [];
  if (opts.unsaved)
    out.push('In Squadra hai modifiche non salvate: se non le salvi si gioca con le impostazioni di prima.');
  const count = (kind: string) => decisions.filter((d) => d.kind === kind).length;
  const trades = count('trade_offer');
  if (trades === 1) out.push('La proposta di scambio che hai ricevuto, senza risposta, viene rifiutata.');
  else if (trades > 1) out.push(`Le ${trades} proposte di scambio senza risposta vengono rifiutate.`);
  if (count('renewals'))
    out.push(
      opts.coach
        ? 'I rinnovi che non hai fatto li decide l’allenatore, con la logica del bot.'
        : 'I giocatori in scadenza che non hai rinnovato diventano svincolati: li perdi.',
    );
  if (count('roster_minimum'))
    out.push(
      'La rosa è sotto il minimo: il server firma al minimo i migliori svincolati dei ruoli scoperti.',
    );
  if (count('draft_pick'))
    out.push(
      'Al draft sceglie il server: il primo disponibile della tua lista, senza lista il migliore per i ruoli scoperti.',
    );
  if (count('free_agency'))
    out.push('In free agency valgono solo le offerte già fatte: l’allenatore non ne fa.');
  if (count('preparation'))
    out.push('Il server taglia gli esuberi con l’overall più basso e firma al minimo chi manca.');
  const known = ['trade_offer', 'renewals', 'roster_minimum', 'draft_pick', 'free_agency', 'preparation'];
  if (decisions.some((d) => !known.includes(d.kind)))
    out.push('Gli altri avvisi senza risposta si chiudono come scaduti.');
  return out;
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

export const STAGE_LABEL: Record<string, string> = {
  draft: 'Draft',
  renewals: 'Rinnovi',
  fa1: 'Free agency, turno 1 di 4',
  fa2: 'Free agency, turno 2 di 4',
  fa3: 'Free agency, turno 3 di 4',
  fa4: 'Free agency, turno 4 di 4',
  preparation: 'Preparazione della stagione',
};

/** "Giornata 13 di 82", "Play-in", "Playoff", "Offseason · Rinnovi" */
export function roundTitle(kind: string, number: number, stage: string | null): string {
  if (kind === 'regular') return `Giornata ${number + 1} di 82`;
  if (kind === 'play-in') return 'Play-in';
  if (kind === 'playoffs') return 'Playoff';
  const label = STAGE_LABEL[stage ?? ''];
  return label ? `Offseason · ${label}` : 'Offseason';
}

// ---------------------------------------------------------------- fase del turno, per barra e scheda

/**
 * Fase del turno come la mostrano la barra in cima alle pagine e la scheda nella pagina della lega: le due la
 * ricavano da qui, così dicono la stessa cosa.
 *   draft     il draft iniziale non è finito: il primo turno parte dopo (il server non lo chiude prima)
 *   failed    simulazione fallita all'ultimo tentativo: il turno è fermo finché qualcuno non lo riapre
 *   late      in chiusura da più di 5 minuti: il server riprova
 *   closing   simulazione in corso
 *   paused    lega in pausa (il Pronto si può dare e togliere)
 *   open      turno aperto
 */
export type RoundPhase = 'draft' | 'failed' | 'late' | 'closing' | 'paused' | 'open';

export function roundPhase(
  round: Pick<RoundInfo, 'state' | 'closingStartedAt'>,
  opts: { trouble: RoundTrouble | null; paused: boolean; draftPending: boolean },
  now = Date.now(),
): RoundPhase {
  if (round.state !== 'open') {
    if (opts.trouble?.failedAt) return 'failed';
    return roundStuck(round, opts.trouble, now) ? 'late' : 'closing';
  }
  if (opts.draftPending) return 'draft';
  return opts.paused ? 'paused' : 'open';
}

export const PHASE_LABEL: Record<RoundPhase, string> = {
  draft: 'Draft in corso',
  failed: 'Turno bloccato',
  late: 'Simulazione in ritardo',
  closing: 'Simulazione in corso…',
  paused: 'Lega in pausa',
  open: 'Aperto',
};

export type Tone = 'green' | 'sky' | 'amber' | 'slate' | 'orange' | 'red';

/** Colori delle etichette di stato (barra del turno, elenco delle leghe), nel tema chiaro e scuro. */
export const TONE_CLASS: Record<Tone, string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
  red: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
};

export const PHASE_TONE: Record<RoundPhase, Tone> = {
  draft: 'slate',
  failed: 'red',
  late: 'orange',
  closing: 'orange',
  paused: 'slate',
  open: 'green',
};

/** Pulsante del Pronto: segnarsi pronti, togliere il Pronto o niente (turno non aperto, draft, non si gioca). */
export function readyAction(phase: RoundPhase, state: Readiness | null): 'ready' | 'unready' | null {
  if (phase !== 'open' && phase !== 'paused') return null;
  if (state === null || state === 'out') return null;
  return state === 'ready' ? 'unready' : 'ready';
}

// ---------------------------------------------------------------- barra del turno su ogni pagina della lega

/** Quanto serve alla barra in cima alle pagine della lega: poche letture, senza partite né tabellone. */
export interface BarStatus {
  /** Lega a cui si riferiscono i dati: cambiando lega la barra non agisce sui dati di quella di prima. */
  leagueId: string;
  round: {
    id: string;
    number: number;
    kind: string;
    state: RoundInfo['state'];
    stage: string | null;
    closingStartedAt: string | null;
  } | null;
  paused: boolean;
  /** Il draft iniziale non è ancora finito: il primo turno parte dopo. */
  draftPending: boolean;
  /** Solo per un turno in chiusura: tentativi di simulazione e stato fermo. */
  trouble: RoundTrouble | null;
  myTeamId: string | null;
  /** Stato della propria squadra nel turno (come lo conta il server per la chiusura). */
  myState: Readiness | null;
  /** Avvisi bloccanti aperti della propria squadra: le decisioni da prendere. */
  decisions: { id: string; kind: string }[];
}

/** Quanto serve alla barra dallo stato del turno condiviso con la scheda. */
export function barFromTurn(status: TurnStatus, now = Date.now()): BarStatus {
  const r = status.round;
  return {
    leagueId: status.leagueId,
    round: r && {
      id: r.id,
      number: r.number,
      kind: r.kind,
      state: r.state,
      stage: r.stage,
      closingStartedAt: r.closingStartedAt,
    },
    paused: status.paused,
    draftPending: status.draftPending,
    trouble: status.trouble,
    myTeamId: status.myTeamId,
    myState: r && status.myTeamId ? readiness(status, status.myTeamId, now) : null,
    decisions: status.alerts.filter((a) => a.blocking).map((a) => ({ id: a.id, kind: a.kind })),
  };
}

/**
 * I dati della barra solo se sono della lega che si sta guardando. Mentre si caricano quelli di un'altra lega
 * (per esempio toccando la notifica di un'altra lega) la barra non mostra il turno di prima e non manda il
 * Pronto alla lega sbagliata.
 */
export function barFor(data: BarStatus | null, leagueId: string): BarStatus | null {
  return data !== null && data.leagueId === leagueId ? data : null;
}

export interface BarView {
  title: string;
  /** Stato da mostrare accanto al turno. */
  badge: { label: string; tone: Tone };
  /** Pulsante: segnarsi pronti, togliere il Pronto o niente. */
  action: 'ready' | 'unready' | null;
  decisions: number;
}

/** Che cosa mostra la barra del turno: la fase del turno come la scheda, poi lo stato della propria squadra. */
export function barView(s: BarStatus, now = Date.now()): BarView | null {
  if (!s.round || !s.myTeamId) return null;
  const decisions = s.decisions.length;
  const title = roundTitle(s.round.kind, s.round.number, s.round.stage);
  const phase = roundPhase(s.round, s, now);
  const action = readyAction(phase, s.myState);
  if (phase !== 'open' && phase !== 'paused')
    return { title, badge: { label: PHASE_LABEL[phase], tone: PHASE_TONE[phase] }, action, decisions };
  const state = s.myState ?? 'waiting';
  const badge: BarView['badge'] = {
    ready: { label: 'Pronto', tone: 'green' as const },
    coach: { label: 'Allenatore', tone: 'sky' as const },
    blocked: { label: 'Da decidere', tone: 'amber' as const },
    waiting: { label: phase === 'paused' ? 'Lega in pausa' : 'Non pronto', tone: 'slate' as const },
    out: { label: 'Non gioca', tone: 'slate' as const },
  }[state];
  return { title, badge, action, decisions };
}
