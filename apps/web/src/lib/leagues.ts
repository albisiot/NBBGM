// Leghe dell'utente: letture (filtrate dalla RLS) e azioni (funzioni del server).
import { FunctionsHttpError } from '@supabase/supabase-js';
import { supabase } from './supabase.ts';

export interface MyLeague {
  leagueId: string;
  name: string;
  commissioner: boolean;
  teamCode: string;
  teamName: string;
  seasonYear: number | null;
  roundNumber: number | null;
  roundKind: string | null;
}

export interface LeagueTeam {
  id: string;
  code: string;
  fullName: string;
  conference: 'East' | 'West';
  division: string;
  ownerId: string | null;
  ownerName: string | null;
}

export interface LeagueDetail {
  id: string;
  name: string;
  inviteCode: string;
  commissionerId: string;
  deadlineMinutes: number | null;
  maxPaceSeconds: number;
  rosterMode: 'real' | 'draft';
  rookieSource: 'generated' | 'real';
  seasonYear: number | null;
  roundNumber: number | null;
  roundKind: string | null;
  roundState: string | null;
  draftState: 'waiting' | 'running' | 'done' | null;
  draftMode: 'list' | 'live';
  teams: LeagueTeam[];
}

export interface LeaguePreview {
  league_id: string;
  name: string;
  commissioner: string | null;
  already_member: boolean;
  teams: { code: string; full_name: string; conference: 'East' | 'West'; division: string; taken: boolean }[];
}

export interface NewLeagueSettings {
  deadline_minutes: number | null;
  max_pace_seconds: number;
  roster_mode: 'real' | 'draft';
  draft_mode: 'list' | 'live';
  rookie_source: 'generated' | 'real';
  /** Secondi per scelta nel draft iniziale dal vivo. */
  pick_seconds: number;
}

export const PICK_SECONDS_OPTIONS: { label: string; value: number }[] = [
  { label: '30 secondi', value: 30 },
  { label: '1 minuto', value: 60 },
  { label: '90 secondi', value: 90 },
  { label: '2 minuti', value: 120 },
];

// Le relazioni con più chiavi esterne vanno indicate per nome del vincolo
const LEAGUE_STATUS =
  'season:seasons!leagues_current_season(year), round:rounds!leagues_current_round(number, kind, state)';

interface StatusRow {
  season: { year: number } | null;
  round: { number: number; kind: string; state: string } | null;
}

export async function myLeagues(userId: string): Promise<MyLeague[]> {
  const { data, error } = await supabase
    .from('teams')
    .select(`code, full_name, league:leagues(id, name, commissioner_id, ${LEAGUE_STATUS})`)
    .eq('owner_id', userId);
  if (error) throw error;
  type Row = {
    code: string;
    full_name: string;
    league: ({ id: string; name: string; commissioner_id: string } & StatusRow) | null;
  };
  return ((data ?? []) as unknown as Row[])
    .filter((r) => r.league !== null)
    .map((r) => {
      const l = r.league as NonNullable<Row['league']>;
      return {
        leagueId: l.id,
        name: l.name,
        commissioner: l.commissioner_id === userId,
        teamCode: r.code,
        teamName: r.full_name,
        seasonYear: l.season?.year ?? null,
        roundNumber: l.round?.number ?? null,
        roundKind: l.round?.kind ?? null,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'it'));
}

export async function leagueDetail(id: string): Promise<LeagueDetail | null> {
  const { data, error } = await supabase
    .from('leagues')
    .select(
      `id, name, invite_code, commissioner_id, deadline_minutes, max_pace_seconds, roster_mode, draft_mode, rookie_source, ${LEAGUE_STATUS}, draft:initial_drafts(state)`,
    )
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const l = data as unknown as {
    id: string;
    name: string;
    invite_code: string;
    commissioner_id: string;
    deadline_minutes: number | null;
    max_pace_seconds: number;
    roster_mode: 'real' | 'draft';
    draft_mode: 'list' | 'live';
    rookie_source: 'generated' | 'real';
    draft: { state: 'waiting' | 'running' | 'done' } | { state: 'waiting' | 'running' | 'done' }[] | null;
  } & StatusRow;
  const teams = await supabase
    .from('teams')
    .select('id, code, full_name, conference, division, owner_id, owner:profiles(display_name)')
    .eq('league_id', id)
    .order('full_name');
  if (teams.error) throw teams.error;
  type TeamRow = {
    id: string;
    code: string;
    full_name: string;
    conference: 'East' | 'West';
    division: string;
    owner_id: string | null;
    owner: { display_name: string } | null;
  };
  return {
    id: l.id,
    name: l.name,
    inviteCode: l.invite_code,
    commissionerId: l.commissioner_id,
    deadlineMinutes: l.deadline_minutes,
    maxPaceSeconds: l.max_pace_seconds,
    rosterMode: l.roster_mode,
    rookieSource: l.rookie_source,
    seasonYear: l.season?.year ?? null,
    roundNumber: l.round?.number ?? null,
    roundKind: l.round?.kind ?? null,
    roundState: l.round?.state ?? null,
    // Relazione uno a uno: PostgREST può restituire l'oggetto o un elenco di uno
    draftState: (Array.isArray(l.draft) ? l.draft[0] : l.draft)?.state ?? null,
    draftMode: l.draft_mode,
    teams: ((teams.data ?? []) as unknown as TeamRow[]).map((t) => ({
      id: t.id,
      code: t.code,
      fullName: t.full_name,
      conference: t.conference,
      division: t.division,
      ownerId: t.owner_id,
      ownerName: t.owner?.display_name ?? null,
    })),
  };
}

/** Crea la lega con la Edge Function create-league; restituisce id e codice invito. */
export async function createLeague(input: {
  name: string;
  team: string;
  settings: NewLeagueSettings;
}): Promise<{ league_id: string; invite_code: string }> {
  const { data, error } = await supabase.functions.invoke('create-league', { body: input });
  if (error) {
    // L'errore della funzione è nel corpo della risposta
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Non è stato possibile creare la lega');
    }
    throw error;
  }
  return data as { league_id: string; invite_code: string };
}

export async function previewLeague(code: string): Promise<LeaguePreview> {
  const { data, error } = await supabase.rpc('league_preview', { p_code: code });
  if (error) throw error;
  return data as LeaguePreview;
}

export async function joinLeague(code: string, team: string): Promise<string> {
  const { data, error } = await supabase.rpc('join_league', { p_code: code, p_team_code: team });
  if (error) throw error;
  return data as string;
}

export async function updateDisplayName(userId: string, name: string): Promise<void> {
  const { error } = await supabase.from('profiles').update({ display_name: name }).eq('id', userId);
  if (error) throw error;
}

/** "Stagione 2026-27 · giornata 1" */
export function statusLabel(
  seasonYear: number | null,
  roundNumber: number | null,
  roundKind: string | null,
): string {
  if (seasonYear === null) return '';
  const season = `Stagione ${seasonYear}-${String((seasonYear + 1) % 100).padStart(2, '0')}`;
  if (roundNumber === null) return season;
  const kinds: Record<string, string> = {
    regular: `giornata ${roundNumber + 1}`,
    'play-in': 'play-in',
    playoffs: 'playoff',
    offseason: 'offseason',
  };
  return `${season} · ${kinds[roundKind ?? 'regular'] ?? ''}`;
}

export const DEADLINE_OPTIONS: { label: string; value: number | null }[] = [
  { label: 'Nessuna: si avanza quando tutti sono pronti', value: null },
  { label: '15 minuti', value: 15 },
  { label: '12 ore', value: 12 * 60 },
  { label: '24 ore', value: 24 * 60 },
];

export const PACE_OPTIONS: { label: string; value: number }[] = [
  { label: 'Un turno al minuto', value: 60 },
  { label: 'Un turno ogni 5 minuti', value: 300 },
  { label: 'Un turno all’ora', value: 3600 },
];

export function deadlineLabel(minutes: number | null): string {
  return DEADLINE_OPTIONS.find((o) => o.value === minutes)?.label ?? `${minutes} minuti`;
}

export function paceLabel(seconds: number): string {
  return PACE_OPTIONS.find((o) => o.value === seconds)?.label ?? `un turno ogni ${seconds} secondi`;
}
