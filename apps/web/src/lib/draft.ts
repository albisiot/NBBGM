// Draft iniziale: letture (RLS: le vedono i membri della lega, la lista solo il suo manager) e azioni (Edge
// Function draft).
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

export interface DraftState {
  mode: 'list' | 'live';
  state: 'waiting' | 'running' | 'done';
  pickSeconds: number;
  order: string[];
  next: number;
  deadline: string | null;
}

export interface DraftPlayer {
  id: string;
  name: string;
  role: string;
  secondaryRole: string | null;
  age: number;
  overall: number;
  salary: number;
}

export interface DraftPickRow {
  pick: number;
  teamId: string;
  playerId: string;
  auto: boolean;
}

export async function draftState(leagueId: string): Promise<DraftState | null> {
  const { data, error } = await supabase
    .from('initial_drafts')
    .select('mode, state, pick_seconds, team_order, next_pick, pick_deadline')
    .eq('league_id', leagueId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    mode: data.mode,
    state: data.state,
    pickSeconds: data.pick_seconds,
    order: data.team_order,
    next: data.next_pick,
    deadline: data.pick_deadline,
  };
}

export async function draftPool(leagueId: string): Promise<DraftPlayer[]> {
  const { data, error } = await supabase
    .from('initial_draft_pool')
    .select('player_id, overall, salaries, player:players(first_name, last_name, role, secondary_role, age)')
    .eq('league_id', leagueId);
  if (error) throw error;
  type Row = {
    player_id: string;
    overall: number | string;
    salaries: (number | string)[];
    player: {
      first_name: string;
      last_name: string;
      role: string;
      secondary_role: string | null;
      age: number;
    };
  };
  return ((data ?? []) as unknown as Row[])
    .map((r) => ({
      id: r.player_id,
      name: `${r.player.first_name} ${r.player.last_name}`,
      role: r.player.role,
      secondaryRole: r.player.secondary_role,
      age: r.player.age,
      overall: Number(r.overall),
      salary: Number(r.salaries[0] ?? 0),
    }))
    .sort((a, b) => b.overall - a.overall);
}

export async function draftPicks(leagueId: string, from = 0): Promise<DraftPickRow[]> {
  const { data, error } = await supabase
    .from('initial_draft_picks')
    .select('pick_no, team_id, player_id, auto')
    .eq('league_id', leagueId)
    .gte('pick_no', from)
    .order('pick_no');
  if (error) throw error;
  return (data ?? []).map((r) => ({
    pick: r.pick_no,
    teamId: r.team_id,
    playerId: r.player_id,
    auto: r.auto,
  }));
}

export async function myDraftList(teamId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('initial_draft_lists')
    .select('player_ids')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) throw error;
  return (data?.player_ids as string[] | undefined) ?? [];
}

export async function saveDraftList(teamId: string, leagueId: string, playerIds: string[]): Promise<void> {
  const { error } = await supabase.from('initial_draft_lists').upsert({
    team_id: teamId,
    league_id: leagueId,
    player_ids: playerIds,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export type DraftActionKind = 'start' | 'pick' | 'tick' | 'to-list';

export async function draftAction(
  leagueId: string,
  action: DraftActionKind,
  playerId?: string,
): Promise<void> {
  const { error } = await supabase.functions.invoke('draft', {
    body: { league_id: leagueId, action, player_id: playerId },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Azione sul draft non riuscita');
    }
    throw error;
  }
}

/** "14,4 M$" */
export function formatSalary(dollars: number): string {
  return `${(dollars / 1_000_000).toLocaleString('it-IT', { maximumFractionDigits: 1 })} M$`;
}

/** Secondi che mancano alla scadenza (mai negativi). */
export function secondsLeft(deadline: string | null, now = Date.now()): number | null {
  if (deadline === null) return null;
  return Math.max(0, Math.ceil((new Date(deadline).getTime() - now) / 1000));
}

/**
 * Testo per i lettori di schermo nel draft dal vivo. Il conto alla rovescia cambia a ogni aggiornamento (ogni 2
 * secondi): annunciarlo sempre coprirebbe tutto il resto. Questo testo cambia solo nei momenti importanti: quando
 * tocca a te, quando restano 10 secondi e allo scadere. Vuoto quando tocca ad altri.
 */
export function draftAnnouncement(myTurn: boolean, left: number | null, pickSeconds: number): string {
  if (!myTurn || left === null) return '';
  if (left === 0) return 'Tempo scaduto: sceglie il server dalla tua lista.';
  if (left <= 10 && pickSeconds > 10) return 'Restano 10 secondi per scegliere.';
  return `Tocca a te: hai ${pickSeconds} secondi per scegliere.`;
}

/** Giro e chiamata nel giro: "giro 2, scelta 5". */
export function pickLabel(pick: number, teams = 30): string {
  return `giro ${Math.floor(pick / teams) + 1}, scelta ${(pick % teams) + 1}`;
}

/** Giocatori al massimo nella lista del draft annuale (vincolo di draft_lists; i prospetti sono 70). */
export const ANNUAL_DRAFT_LIST_MAX = 100;

/**
 * Lista del draft annuale da salvare: solo i prospetti di quest'anno, senza doppioni, nell'ordine scelto e al più
 * ANNUAL_DRAFT_LIST_MAX. La lista salvata resta da una stagione all'altra: senza questo filtro i giocatori già scelti
 * negli anni prima si sommavano e una lista lunga avrebbe superato il limite del database.
 */
export function annualListToSave(list: readonly string[], prospects: ReadonlySet<string>): string[] {
  return [...new Set(list)].filter((id) => prospects.has(id)).slice(0, ANNUAL_DRAFT_LIST_MAX);
}
