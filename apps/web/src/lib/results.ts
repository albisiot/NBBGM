// Risultati della stagione: partite, box score e cronaca, classifica, serie di playoff, statistiche dei
// giocatori. Tutto in lettura, filtrato dalla RLS. La classifica la calcola l'app con il motore, con lo stesso
// seed pubblico (id della lega) che il server usa per gli spareggi: è la classifica che decide il tabellone.
import {
  standingsSeed,
  standingsTable,
  type Conference,
  type Division,
  type GameRecord,
  type StandingsLine,
  type Team,
} from '@nbbgm/engine';
import { allPages } from './cache.ts';
import type { LeagueDetail, LeagueTeam } from './leagues.ts';
import { supabase } from './supabase.ts';

export type GameKind = 'regular' | 'play-in' | 'playoffs';

export interface SeasonGame {
  id: string;
  roundNumber: number;
  kind: GameKind;
  homeTeamId: string;
  awayTeamId: string;
  seriesId: string | null;
  homeScore: number | null;
  awayScore: number | null;
  overtimes: number;
}

export interface Series {
  id: string;
  round: 1 | 2 | 3 | 4;
  conference: Conference | null;
  highTeamId: string;
  lowTeamId: string;
  highSeed: number;
  lowSeed: number;
  winsHigh: number;
  winsLow: number;
  winnerTeamId: string | null;
}

/** Azione della cronaca come la salva il server: [periodo, secondi alla fine, squadra, testo, casa, trasferta]. */
export type Play = [number, number, 'h' | 'a' | null, string, number, number];

export interface BoxLine {
  playerId: string;
  teamId: string;
  name: string;
  role: string;
  starter: boolean;
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
  plusMinus: number;
}

export interface GameDetail extends SeasonGame {
  quarters: { home: number[]; away: number[] } | null;
  plays: Play[];
  box: BoxLine[];
}

/** Colonne delle partite per gli elenchi: niente cronaca (play_by_play), che si legge solo nella pagina della partita. */
export const GAME_COLUMNS =
  'id, round_number, kind, home_team_id, away_team_id, series_id, home_score, away_score, overtimes';

type GameRow = {
  id: string;
  round_number: number;
  kind: GameKind;
  home_team_id: string;
  away_team_id: string;
  series_id: string | null;
  home_score: number | null;
  away_score: number | null;
  overtimes: number | null;
};

const toGame = (g: GameRow): SeasonGame => ({
  id: g.id,
  roundNumber: g.round_number,
  kind: g.kind,
  homeTeamId: g.home_team_id,
  awayTeamId: g.away_team_id,
  seriesId: g.series_id,
  homeScore: g.home_score,
  awayScore: g.away_score,
  overtimes: g.overtimes ?? 0,
});

/**
 * Tutte le partite della stagione, giocate e in calendario (1.230 di regular season più la post-season), senza la
 * cronaca: due pagine alla volta, in parallelo.
 */
export async function seasonGames(seasonId: string): Promise<SeasonGame[]> {
  return allPages(async (from, to) => {
    const { data, error } = await supabase
      .from('games')
      .select(GAME_COLUMNS)
      .eq('season_id', seasonId)
      .order('round_number')
      .order('id')
      .range(from, to);
    if (error) throw error;
    return ((data ?? []) as GameRow[]).map(toGame);
  });
}

export async function playoffSeries(seasonId: string): Promise<Series[]> {
  const { data, error } = await supabase
    .from('playoff_series')
    .select(
      'id, round, conference, high_team_id, low_team_id, high_seed, low_seed, wins_high, wins_low, winner_team_id',
    )
    .eq('season_id', seasonId);
  if (error) throw error;
  type Row = {
    id: string;
    round: Series['round'];
    conference: Conference | null;
    high_team_id: string;
    low_team_id: string;
    high_seed: number;
    low_seed: number;
    wins_high: number;
    wins_low: number;
    winner_team_id: string | null;
  };
  return ((data ?? []) as Row[]).map((s) => ({
    id: s.id,
    round: s.round,
    conference: s.conference,
    highTeamId: s.high_team_id,
    lowTeamId: s.low_team_id,
    highSeed: s.high_seed,
    lowSeed: s.low_seed,
    winsHigh: s.wins_high,
    winsLow: s.wins_low,
    winnerTeamId: s.winner_team_id,
  }));
}

export async function gameDetail(gameId: string): Promise<GameDetail | null> {
  const [game, stats] = await Promise.all([
    supabase.from('games').select(`${GAME_COLUMNS}, quarters, play_by_play`).eq('id', gameId).maybeSingle(),
    supabase
      .from('player_game_stats')
      .select(
        'player_id, team_id, starter, seconds, pts, fgm, fga, tpm, tpa, ftm, fta, orb, drb, ast, stl, blk, tov, pf, plus_minus, player:players(first_name, last_name, role)',
      )
      .eq('game_id', gameId),
  ]);
  if (game.error) throw game.error;
  if (stats.error) throw stats.error;
  if (!game.data) return null;
  const g = game.data as unknown as GameRow & {
    quarters: { home: number[]; away: number[] } | null;
    play_by_play: Play[] | null;
  };
  type StatRow = {
    player_id: string;
    team_id: string;
    starter: boolean;
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
    plus_minus: number;
    player: { first_name: string; last_name: string; role: string } | null;
  };
  const box = ((stats.data ?? []) as unknown as StatRow[])
    .map((s) => ({
      playerId: s.player_id,
      teamId: s.team_id,
      name: s.player ? `${s.player.first_name} ${s.player.last_name}` : '?',
      role: s.player?.role ?? '',
      starter: s.starter,
      seconds: s.seconds,
      pts: s.pts,
      fgm: s.fgm,
      fga: s.fga,
      tpm: s.tpm,
      tpa: s.tpa,
      ftm: s.ftm,
      fta: s.fta,
      orb: s.orb,
      drb: s.drb,
      ast: s.ast,
      stl: s.stl,
      blk: s.blk,
      tov: s.tov,
      pf: s.pf,
      plusMinus: s.plus_minus,
    }))
    // Titolari per primi, poi per minuti
    .sort((a, b) => Number(b.starter) - Number(a.starter) || b.seconds - a.seconds);
  return { ...toGame(g), quarters: g.quarters, plays: g.play_by_play ?? [], box };
}

/** Squadre nell'ordine che usa il server (per sigla): da questo dipende il sorteggio degli spareggi. */
function engineTeams(teams: readonly LeagueTeam[]): Team[] {
  return [...teams]
    .sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((t) => ({
      id: t.id,
      city: '',
      name: t.code,
      fullName: t.fullName,
      conference: t.conference,
      division: t.division as Division,
    }));
}

/** Classifica di regular season per conference, come la calcola il server. */
export function seasonStandings(
  league: Pick<LeagueDetail, 'id' | 'teams' | 'seasonYear'>,
  games: readonly SeasonGame[],
): Record<Conference, StandingsLine[]> {
  const played: GameRecord[] = games
    .filter((g) => g.kind === 'regular' && g.homeScore !== null && g.awayScore !== null)
    .map((g) => ({
      turn: g.roundNumber,
      phase: 'regular',
      homeId: g.homeTeamId,
      awayId: g.awayTeamId,
      homeScore: g.homeScore as number,
      awayScore: g.awayScore as number,
      overtimes: g.overtimes,
    }));
  return standingsTable(
    engineTeams(league.teams),
    played,
    standingsSeed(league.id, league.seasonYear ?? 2026),
  );
}

export interface PlayerSeason {
  id: string;
  teamId: string | null;
  name: string;
  role: string;
  g: number;
  min: number;
  pts: number;
  reb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  fgPct: number | null;
  tpPct: number | null;
  ftPct: number | null;
}

/** Statistiche di regular season per partita dei giocatori con almeno una presenza. */
export async function playerSeasons(leagueId: string): Promise<PlayerSeason[]> {
  const { data, error } = await supabase
    .from('players')
    .select('id, team_id, first_name, last_name, role, season_stats')
    .eq('league_id', leagueId)
    .eq('retired', false);
  if (error) throw error;
  type Row = {
    id: string;
    team_id: string | null;
    first_name: string;
    last_name: string;
    role: string;
    season_stats: Record<string, number> | null;
  };
  return ((data ?? []) as Row[])
    .filter((p) => (p.season_stats?.g ?? 0) > 0)
    .map((p) =>
      perGame(
        p.id,
        p.team_id,
        `${p.first_name} ${p.last_name}`,
        p.role,
        p.season_stats as Record<string, number>,
      ),
    );
}

/** Medie per partita dalle statistiche di stagione (players.season_stats o player_seasons.stats). */
export function perGame(
  id: string,
  teamId: string | null,
  name: string,
  role: string,
  s: Record<string, number>,
): PlayerSeason {
  const pct = (m: number, a: number) => (a > 0 ? m / a : null);
  const v = (k: string) => Number(s[k] ?? 0);
  const g = Math.max(1, v('g'));
  return {
    id,
    teamId,
    name,
    role,
    g: v('g'),
    min: v('seconds') / 60 / g,
    pts: v('pts') / g,
    reb: (v('orb') + v('drb')) / g,
    ast: v('ast') / g,
    stl: v('stl') / g,
    blk: v('blk') / g,
    tov: v('tov') / g,
    fgPct: pct(v('fgm'), v('fga')),
    tpPct: pct(v('tpm'), v('tpa')),
    ftPct: pct(v('ftm'), v('fta')),
  };
}

/** "2:35" da secondi; "12:00" all'inizio del periodo. */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "1° quarto", "4° quarto", "1° supplementare". */
export function periodLabel(period: number): string {
  return period <= 4 ? `${period}° quarto` : `${period - 4}° supplementare`;
}

/** Nome del turno: giornata della regular season o turno di post-season. */
export function roundLabel(roundNumber: number, kind: GameKind | 'offseason'): string {
  if (kind === 'regular') return `Giornata ${roundNumber + 1}`;
  if (kind === 'play-in') return 'Play-in';
  if (kind === 'playoffs') return 'Playoff';
  return 'Offseason';
}

export const SERIES_ROUND_LABEL: Record<Series['round'], string> = {
  1: 'Primo turno',
  2: 'Semifinali di conference',
  3: 'Finali di conference',
  4: 'Finale NBA',
};
