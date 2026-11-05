// La stagione corrente di una lega: dettagli, partite e serie di playoff, in una lettura.
import { leagueDetail } from './leagues.ts';
import { playoffSeries, seasonGames } from './results.ts';
import { useAsync } from './useAsync.ts';
import { useRoundChange } from './useRoundChange.ts';

/** Si rilegge da sola quando la lega passa al turno successivo. */
export function useSeason(leagueId: string) {
  const season = useAsync(async () => {
    const league = await leagueDetail(leagueId);
    if (!league?.seasonId) return null;
    const [games, series] = await Promise.all([seasonGames(league.seasonId), playoffSeries(league.seasonId)]);
    return { league, games, series };
  }, [leagueId]);
  useRoundChange(leagueId, season.reload);
  return season;
}
