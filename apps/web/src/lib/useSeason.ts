// La stagione corrente di una lega: dettagli, partite e serie di playoff, in una lettura.
import { leagueDetail } from './leagues.ts';
import { playoffSeries, seasonGames } from './results.ts';
import { useAsync } from './useAsync.ts';

export function useSeason(leagueId: string) {
  return useAsync(async () => {
    const league = await leagueDetail(leagueId);
    if (!league?.seasonId) return null;
    const [games, series] = await Promise.all([seasonGames(league.seasonId), playoffSeries(league.seasonId)]);
    return { league, games, series };
  }, [leagueId]);
}
