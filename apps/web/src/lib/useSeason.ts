// La stagione corrente di una lega: dettagli, partite e serie di playoff. Partite e serie cambiano solo quando la
// lega passa al turno successivo (apply_turn le scrive insieme al turno nuovo): restano in memoria per lega,
// con la chiave di stagione e turno, e Risultati, Classifica e Playoff non le riscaricano a ogni visita. I dettagli
// della lega si leggono ogni volta: sono pochi dati e dicono qual è il turno corrente.
import { KeyedCache } from './cache.ts';
import { leagueDetail, type LeagueDetail } from './leagues.ts';
import { playoffSeries, seasonGames, type SeasonGame, type Series } from './results.ts';
import { useAsync } from './useAsync.ts';
import { useRoundChange } from './useRoundChange.ts';

interface SeasonRows {
  games: SeasonGame[];
  series: Series[];
}

const seasons = new KeyedCache<SeasonRows>();

/** Chiave dei dati del turno: stagione e turno correnti della lega. */
export function seasonKey(league: Pick<LeagueDetail, 'seasonId' | 'roundId'>): string {
  return `${league.seasonId ?? ''}:${league.roundId ?? ''}`;
}

/** Partite e serie della stagione corrente, dalla memoria se la lega è ancora allo stesso turno. */
export function seasonRows(league: LeagueDetail & { seasonId: string }): Promise<SeasonRows> {
  return seasons.get(league.id, seasonKey(league), async () => {
    const [games, series] = await Promise.all([seasonGames(league.seasonId), playoffSeries(league.seasonId)]);
    return { games, series };
  });
}

/** Si rilegge da sola quando la lega passa al turno successivo. */
export function useSeason(leagueId: string) {
  const season = useAsync(async () => {
    const league = await leagueDetail(leagueId);
    if (!league?.seasonId) return null;
    const { games, series } = await seasonRows({ ...league, seasonId: league.seasonId });
    return { league, games, series };
  }, [leagueId]);
  useRoundChange(leagueId, season.reload);
  return season;
}
