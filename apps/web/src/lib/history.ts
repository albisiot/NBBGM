// Storico delle stagioni: elenco delle stagioni, campioni e finaliste, statistiche di regular season di ogni
// stagione (salvate a fine regular season in player_seasons; per la stagione in corso quelle dei giocatori).
import { emptyStats, type SeasonStats } from '@nbbgm/engine';
import { supabase } from './supabase.ts';

export interface LeagueSeason {
  id: string;
  year: number;
  phase: string;
  current: boolean;
}

/** "2026-27" */
export function seasonLabel(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

/** Stagioni della lega, dalla più recente. */
export async function leagueSeasons(
  leagueId: string,
  currentSeasonId: string | null,
): Promise<LeagueSeason[]> {
  const { data, error } = await supabase
    .from('seasons')
    .select('id, year, phase')
    .eq('league_id', leagueId)
    .order('year', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as { id: string; year: number; phase: string }[]).map((s) => ({
    ...s,
    current: s.id === currentSeasonId,
  }));
}

/** La regular season è finita: le statistiche sono quelle salvate, non più quelle che crescono turno dopo turno. */
export const regularSeasonOver = (s: Pick<LeagueSeason, 'phase' | 'current'>): boolean =>
  !s.current || s.phase !== 'regular';

/** Stagione da mostrare di default: la più recente con la regular season finita, altrimenti quella in corso. */
export function defaultSeason(seasons: readonly LeagueSeason[]): LeagueSeason | null {
  return seasons.find(regularSeasonOver) ?? seasons[0] ?? null;
}

export interface Final {
  seasonId: string;
  year: number;
  championId: string | null;
  finalistId: string | null;
}

/** Finali di tutte le stagioni della lega: campione (se la serie è finita) e finalista. */
export async function leagueFinals(leagueId: string): Promise<Final[]> {
  const { data, error } = await supabase
    .from('playoff_series')
    .select('season_id, high_team_id, low_team_id, winner_team_id, season:seasons(year)')
    .eq('league_id', leagueId)
    .eq('round', 4);
  if (error) throw error;
  type Row = {
    season_id: string;
    high_team_id: string;
    low_team_id: string;
    winner_team_id: string | null;
    season: { year: number } | { year: number }[] | null;
  };
  return ((data ?? []) as unknown as Row[])
    .map((r) => {
      const season = Array.isArray(r.season) ? r.season[0] : r.season;
      return {
        seasonId: r.season_id,
        year: season?.year ?? 0,
        championId: r.winner_team_id,
        finalistId:
          r.winner_team_id === null
            ? null
            : r.winner_team_id === r.high_team_id
              ? r.low_team_id
              : r.high_team_id,
      };
    })
    .sort((a, b) => b.year - a.year);
}

export interface SeasonPlayer {
  id: string;
  teamId: string | null;
  name: string;
  role: string;
  /** Primo anno nella lega; null se non si sa. */
  rookie: boolean | null;
  stats: SeasonStats;
}

/** Statistiche di stagione complete: le chiavi mancanti valgono zero, i numeri arrivano come numeri. */
export function toStats(raw: Record<string, unknown> | null | undefined): SeasonStats {
  const s = emptyStats();
  for (const k of Object.keys(s) as (keyof SeasonStats)[]) s[k] = Number(raw?.[k] ?? 0) || 0;
  return s;
}

/**
 * Giocatori della stagione con le statistiche di regular season. Stagione finita: quelle salvate a fine regular
 * season (ritirati compresi, con la squadra di allora). Stagione in corso: quelle dei giocatori (live = true).
 */
export async function seasonPlayers(
  leagueId: string,
  season: LeagueSeason,
): Promise<{ players: SeasonPlayer[]; live: boolean }> {
  if (regularSeasonOver(season)) {
    const { data, error } = await supabase
      .from('player_seasons')
      .select('player_id, team_id, rookie, stats, player:players(first_name, last_name, role)')
      .eq('season_id', season.id);
    // Database non ancora aggiornato: per la stagione in corso si usano i giocatori, per le altre non c'è nulla
    if (error && error.code !== '42P01' && error.code !== 'PGRST205') throw error;
    type Row = {
      player_id: string;
      team_id: string | null;
      rookie: boolean | null;
      stats: Record<string, unknown>;
      player: { first_name: string; last_name: string; role: string } | null;
    };
    const rows = (error ? [] : (data ?? [])) as unknown as Row[];
    if (rows.length > 0 || !season.current)
      return {
        players: rows.map((r) => ({
          id: r.player_id,
          teamId: r.team_id,
          name: r.player ? `${r.player.first_name} ${r.player.last_name}` : 'Giocatore',
          role: r.player?.role ?? '',
          rookie: r.rookie,
          stats: toStats(r.stats),
        })),
        live: false,
      };
  }
  const { data, error } = await supabase
    .from('players')
    .select('id, team_id, first_name, last_name, role, years_in_league, season_stats')
    .eq('league_id', leagueId)
    .eq('retired', false);
  if (error) throw error;
  type Row = {
    id: string;
    team_id: string | null;
    first_name: string;
    last_name: string;
    role: string;
    years_in_league: number | null;
    season_stats: Record<string, unknown> | null;
  };
  return {
    players: ((data ?? []) as Row[])
      .filter((p) => Number(p.season_stats?.g ?? 0) > 0)
      .map((p) => ({
        id: p.id,
        teamId: p.team_id,
        name: `${p.first_name} ${p.last_name}`,
        role: p.role,
        // In offseason l'anzianità è già cresciuta di un anno (fine stagione)
        rookie:
          p.years_in_league === null ? null : p.years_in_league === (season.phase === 'offseason' ? 1 : 0),
        stats: toStats(p.season_stats),
      })),
    live: season.current && season.phase === 'regular',
  };
}
