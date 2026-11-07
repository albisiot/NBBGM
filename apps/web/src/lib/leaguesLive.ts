// Stato dal vivo di tutte le leghe dell'utente, per l'elenco delle leghe: tocca a te, umani pronti, decisioni
// aperte e stato della lega. Una sola lettura (public.my_leagues_status) per tutte le leghe, riletta al ritorno in
// primo piano e ogni minuto mentre l'elenco è aperto: niente canali in tempo reale per ogni lega.
import { useEffect, useState } from 'react';
import { onResume } from './resume.ts';
import { supabase } from './supabase.ts';
import {
  countsAsReady,
  PHASE_LABEL,
  PHASE_TONE,
  roundPhase,
  type Readiness,
  type RoundInfo,
  type RoundPhase,
  type Tone,
} from './turns.ts';

/** Una riga della risposta di my_leagues_status. */
export interface LeagueLiveRow {
  league_id: string;
  paused: boolean;
  draft_state: string | null;
  round: {
    id: string;
    number: number;
    kind: RoundInfo['kind'];
    state: RoundInfo['state'];
    stage: string | null;
    closing_started_at: string | null;
    attempts: number | null;
    failed_at: string | null;
  } | null;
  my_team_id: string;
  decisions: number;
  readiness: { team_id: string; state: string }[] | null;
}

/** Stato dal vivo di una lega, come lo mostra l'elenco. */
export interface LeagueLive {
  leagueId: string;
  /** Fase del turno, la stessa di barra e scheda del turno; null senza turno. */
  phase: RoundPhase | null;
  /** Stato della propria squadra nel turno (come lo conta il server per la chiusura). */
  myState: Readiness | null;
  /** Squadre umane pronte (Pronto o allenatore senza avvisi), sul totale di quelle che giocano il turno. */
  ready: number;
  humans: number;
  /** Decisioni bloccanti aperte della propria squadra. */
  decisions: number;
}

const READINESS: readonly string[] = ['ready', 'coach', 'blocked', 'waiting', 'out'];

/** Dalla riga del server a quanto serve all'elenco. */
export function leagueLive(row: LeagueLiveRow, now = Date.now()): LeagueLive {
  const states = (row.readiness ?? []).filter((r) => READINESS.includes(r.state)) as {
    team_id: string;
    state: Readiness;
  }[];
  const inRound = states.filter((s) => s.state !== 'out');
  const r = row.round;
  return {
    leagueId: row.league_id,
    phase: r
      ? roundPhase(
          { state: r.state, closingStartedAt: r.closing_started_at },
          {
            trouble: r.state === 'closing' ? { attempts: r.attempts ?? 0, failedAt: r.failed_at } : null,
            paused: row.paused,
            draftPending: row.draft_state != null && row.draft_state !== 'done',
          },
          now,
        )
      : null,
    myState: r ? (states.find((s) => s.team_id === row.my_team_id)?.state ?? null) : null,
    ready: inRound.filter((s) => countsAsReady(s.state)).length,
    humans: inRound.length,
    decisions: Number(row.decisions) || 0,
  };
}

export interface LiveBadge {
  label: string;
  tone: Tone;
}

/**
 * Etichette dell'elenco, nell'ordine: stato della lega se non è un turno aperto (draft iniziale, turno bloccato,
 * simulazione, pausa), "Tocca a te" se la propria squadra non è pronta, umani pronti sul totale, decisioni aperte.
 */
export function liveBadges(l: LeagueLive): LiveBadge[] {
  const out: LiveBadge[] = [];
  if (l.phase === null) return out;
  if (l.phase !== 'open') out.push({ label: PHASE_LABEL[l.phase], tone: PHASE_TONE[l.phase] });
  const playing = l.phase === 'open' || l.phase === 'paused';
  if (playing) {
    if (l.myState === 'waiting' || l.myState === 'blocked') out.push({ label: 'Tocca a te', tone: 'orange' });
    else if (l.myState === 'ready') out.push({ label: 'Pronto', tone: 'green' });
    else if (l.myState === 'coach') out.push({ label: 'Allenatore', tone: 'sky' });
    else if (l.myState === 'out') out.push({ label: 'Non gioca', tone: 'slate' });
    if (l.humans > 0) out.push({ label: `Pronti ${l.ready}/${l.humans}`, tone: 'slate' });
  }
  if (l.decisions > 0)
    out.push({ label: l.decisions === 1 ? '1 decisione' : `${l.decisions} decisioni`, tone: 'amber' });
  return out;
}

/** Stato dal vivo delle leghe dell'utente; null se il database non ha ancora la funzione. */
export async function leaguesLive(): Promise<Map<string, LeagueLive> | null> {
  const { data, error } = await supabase.rpc('my_leagues_status');
  if (error?.code === 'PGRST202') return null;
  if (error) throw error;
  const now = Date.now();
  return new Map(((data ?? []) as LeagueLiveRow[]).map((r) => [r.league_id, leagueLive(r, now)]));
}

/** Ogni quanto l'elenco si rilegge mentre è aperto e in primo piano. */
export const LIVE_REFRESH_MS = 60_000;

/**
 * Stato dal vivo per l'elenco delle leghe: letto all'apertura, al ritorno in primo piano e ogni minuto (solo con
 * la pagina visibile). Una lettura fallita lascia i dati di prima.
 */
export function useLeaguesLive(userId: string): Map<string, LeagueLive> | null {
  const [live, setLive] = useState<Map<string, LeagueLive> | null>(null);
  useEffect(() => {
    let alive = true;
    let running = false;
    const load = () => {
      if (running) return;
      running = true;
      leaguesLive()
        .then((m) => {
          if (alive) setLive(m);
        })
        .catch(() => undefined)
        .finally(() => {
          running = false;
        });
    };
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, LIVE_REFRESH_MS);
    const stop = onResume(load);
    return () => {
      alive = false;
      clearInterval(timer);
      stop();
    };
  }, [userId]);
  return live;
}
