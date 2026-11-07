// Cerimonia di fine stagione: campione, finale, MVP delle Finali (formula fissa, packages/engine/src/season/finals.ts)
// e premi della regular season (seasonAwards). Nella pagina della lega compare una volta per stagione (memoria del
// browser: si chiude e non torna); dallo Storico si rivede quando si vuole. Si condivide come il riepilogo del
// turno. Solo dati che i membri vedono già: box score, statistiche, serie.
import {
  AWARD_LABEL,
  finalsMvp,
  seasonAwards,
  type AwardKey,
  type FinalsBoxLine,
  type FinalsMvp,
} from '@nbbgm/engine';
import { pastSeason, seasonLabel, seasonPlayers, type LeagueSeason } from './history.ts';
import type { LeagueDetail, LeagueTeam } from './leagues.ts';
import { appLink } from './share.ts';
import { supabase } from './supabase.ts';
import { currentStandings } from './useSeason.ts';

export interface CeremonyAward {
  key: AwardKey | 'finals';
  label: string;
  playerId: string;
  name: string;
  teamCode: string;
  /** Riga sotto il nome: medie o punteggio della formula. */
  note: string;
}

export interface Ceremony {
  year: number;
  champion: LeagueTeam;
  finalist: LeagueTeam | null;
  /** Vittorie in finale: campione e finalista. */
  wins: [number, number];
  awards: CeremonyAward[];
}

const one = (x: number) => x.toFixed(1).replace('.', ',');

/** Testo da condividere, una riga per premio, con il link allo Storico di quella stagione. */
export function ceremonyText(c: Ceremony, leagueName: string, link: string): string {
  const lines = [`🏆 ${leagueName} · Stagione ${seasonLabel(c.year)}`];
  lines.push(
    `Campioni: ${c.champion.fullName}${c.finalist ? ` (${c.wins[0]}-${c.wins[1]} in finale su ${c.finalist.fullName})` : ''}`,
  );
  for (const a of c.awards) lines.push(`${a.label}: ${a.name} (${a.teamCode}), ${a.note}`);
  lines.push(link);
  return lines.join('\n');
}

/** "28,5 punti, 9,1 rimbalzi e 6,0 assist a partita in 6 partite" */
export function finalsNote(m: Pick<FinalsMvp, 'games' | 'perGame'>): string {
  return `${one(m.perGame.pts)} punti, ${one(m.perGame.reb)} rimbalzi e ${one(m.perGame.ast)} assist a partita in ${m.games} ${m.games === 1 ? 'partita' : 'partite'}`;
}

type StatRow = Omit<FinalsBoxLine, 'gameId' | 'playerId' | 'teamId'> & {
  game_id: string;
  player_id: string;
  team_id: string;
  player: { first_name: string; last_name: string } | null;
};

/**
 * Dati della cerimonia di una stagione finita (null se la finale non è finita): la serie finale con i suoi box score
 * (una decina di partite al massimo) e le statistiche della regular season per i premi.
 */
export async function loadCeremony(league: LeagueDetail, season: LeagueSeason): Promise<Ceremony | null> {
  const final = await supabase
    .from('playoff_series')
    .select('id, high_team_id, low_team_id, wins_high, wins_low, winner_team_id')
    .eq('season_id', season.id)
    .eq('round', 4)
    .maybeSingle();
  if (final.error) throw final.error;
  const s = final.data as {
    id: string;
    high_team_id: string;
    low_team_id: string;
    wins_high: number;
    wins_low: number;
    winner_team_id: string | null;
  } | null;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const champion = s?.winner_team_id ? team.get(s.winner_team_id) : undefined;
  if (!s || !champion) return null;
  const highWon = s.winner_team_id === s.high_team_id;

  const games = await supabase.from('games').select('id').eq('series_id', s.id).not('home_score', 'is', null);
  if (games.error) throw games.error;
  const gameIds = ((games.data ?? []) as { id: string }[]).map((g) => g.id);
  const [stats, regular] = await Promise.all([
    gameIds.length
      ? supabase
          .from('player_game_stats')
          .select(
            'game_id, player_id, team_id, seconds, pts, fgm, fga, tpm, tpa, ftm, fta, orb, drb, ast, stl, blk, tov, pf, player:players(first_name, last_name)',
          )
          .in('game_id', gameIds)
      : Promise.resolve({ data: [], error: null }),
    season.current && league.seasonId
      ? Promise.all([
          seasonPlayers(league.id, season),
          currentStandings({ ...league, seasonId: league.seasonId, seasonYear: season.year }),
        ]).then(([p, standings]) => ({ players: p.players, standings }))
      : pastSeason(league, season),
  ]);
  if (stats.error) throw stats.error;
  const rows = (stats.data ?? []) as unknown as StatRow[];
  const lines: FinalsBoxLine[] = rows.map((r) => ({
    ...r,
    gameId: r.game_id,
    playerId: r.player_id,
    teamId: r.team_id,
  }));
  const names = new Map<string, string>();
  for (const r of rows) if (r.player) names.set(r.player_id, `${r.player.first_name} ${r.player.last_name}`);
  for (const p of regular.players) names.set(p.id, p.name);
  const code = (teamId: string | null) => (teamId ? (team.get(teamId)?.code ?? '?') : 'svincolato');

  const awards: CeremonyAward[] = [];
  const mvp = finalsMvp(lines, champion.id);
  if (mvp)
    awards.push({
      key: 'finals',
      label: 'MVP delle Finali',
      playerId: mvp.playerId,
      name: names.get(mvp.playerId) ?? 'Giocatore',
      teamCode: code(mvp.teamId),
      note: finalsNote(mvp),
    });
  const { standings } = regular;
  const pct = new Map(
    [...standings.East, ...standings.West].map((l) => [l.teamId, l.w + l.l > 0 ? l.w / (l.w + l.l) : 0.5]),
  );
  for (const a of seasonAwards(regular.players, (t) => pct.get(t)).awards)
    awards.push({
      key: a.key,
      label: AWARD_LABEL[a.key],
      playerId: a.playerId,
      name: names.get(a.playerId) ?? 'Giocatore',
      teamCode: code(a.teamId),
      note: a.key === 'dpoy' ? `${one(a.score)} di punteggio difensivo` : `${one(a.score)} di valutazione`,
    });
  return {
    year: season.year,
    champion,
    finalist: team.get(highWon ? s.low_team_id : s.high_team_id) ?? null,
    wins: highWon ? [s.wins_high, s.wins_low] : [s.wins_low, s.wins_high],
    awards,
  };
}

/** Link allo Storico della stagione, da mettere in fondo al testo condiviso. */
export const ceremonyLink = (leagueId: string, year: number) =>
  appLink(`/lega/${leagueId}/storico?stagione=${year}`);

/** Memoria del browser: la cerimonia di quella stagione è già stata chiusa nella pagina della lega. */
export const ceremonyKey = (leagueId: string, year: number) => `nbbgm:cerimonia:${leagueId}:${year}`;

export function ceremonySeen(leagueId: string, year: number): boolean {
  try {
    return localStorage.getItem(ceremonyKey(leagueId, year)) === '1';
  } catch {
    return false;
  }
}

export function markCeremonySeen(leagueId: string, year: number): void {
  try {
    localStorage.setItem(ceremonyKey(leagueId, year), '1');
  } catch {
    // Senza memoria del browser la cerimonia ricompare alla prossima visita
  }
}
