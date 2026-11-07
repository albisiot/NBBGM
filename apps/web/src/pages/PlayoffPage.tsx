// Tabellone di play-in e playoff. In regular season mostra chi ci andrebbe se la stagione finisse oggi; poi le
// partite di play-in e le serie al meglio di 7, giro per giro, fino alla finale.
import { useMemo } from 'react';
import { useParams } from 'react-router';
import { Card, ErrorText, PageTitle, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import type { LeagueTeam } from '../lib/leagues.ts';
import { seasonStandings, SERIES_ROUND_LABEL, type SeasonGame, type Series } from '../lib/results.ts';
import { useSeason } from '../lib/useSeason.ts';

const CONFERENCES = ['East', 'West'] as const;
// Ordine del tabellone fisso: 1-8, 4-5, 3-6, 2-7
const BRACKET_ORDER = [1, 4, 3, 2];

export function PlayoffPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const { data, error, loading } = useSeason(id);
  // La classifica si ricalcola solo con partite nuove
  const standings = useMemo(() => (data ? seasonStandings(data.league, data.games) : null), [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data || !standings) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, games, series } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const mine = league.teams.find((t) => t.ownerId === userId)?.id;
  const playIn = games.filter((g) => g.kind === 'play-in');
  const final = series.find((s) => s.round === 4);
  const champion = final?.winnerTeamId ? team.get(final.winnerTeamId) : null;

  if (playIn.length === 0)
    return (
      <div className="space-y-4">
        <PageTitle sub="Il tabellone si forma alla fine della regular season.">Playoff</PageTitle>
        <p className="text-sm text-stampa-600 dark:text-stampa-300">Se la stagione finisse oggi:</p>
        <div className="grid gap-4 md:grid-cols-2">
          {CONFERENCES.map((c) => (
            <Card key={c} className="space-y-3 !p-4">
              <h2 className="font-semibold">{c === 'East' ? 'Eastern' : 'Western'} Conference</h2>
              <ol className="space-y-1 text-sm">
                {standings[c].slice(0, 10).map((l) => (
                  <li key={l.teamId} className="flex items-center gap-2">
                    <span className="w-5 text-right text-xs text-stampa-500 dark:text-stampa-400">
                      {l.confRank}
                    </span>
                    <TeamCode code={team.get(l.teamId)?.code ?? '?'} strong={l.teamId === mine} />
                    <span className="min-w-0 flex-1 truncate">{team.get(l.teamId)?.fullName}</span>
                    <span className="font-mono text-xs">
                      {l.w}-{l.l}
                    </span>
                    {l.confRank === 7 && (
                      <span className="text-xs text-rosso-700 dark:text-rosso-300">play-in</span>
                    )}
                  </li>
                ))}
              </ol>
            </Card>
          ))}
        </div>
      </div>
    );

  return (
    <div className="space-y-4">
      <PageTitle sub="Play-in a partita secca, poi serie al meglio di 7 (fattore campo 2-2-1-1-1).">
        Playoff
      </PageTitle>

      {champion && (
        <Card className="border-rosso-300 bg-rosso-50 text-center dark:border-rosso-700 dark:bg-rosso-950">
          <p className="text-sm text-stampa-600 dark:text-stampa-300">Campioni NBA</p>
          <p className="text-2xl font-bold">{champion.fullName}</p>
        </Card>
      )}

      {final && (
        <Card className="space-y-2 !p-4">
          <h2 className="font-semibold">{SERIES_ROUND_LABEL[4]}</h2>
          <SeriesCard s={final} team={team} mine={mine} />
        </Card>
      )}

      {CONFERENCES.map((c) => {
        const seeds = standings[c].slice(0, 10).map((l) => l.teamId);
        return (
          <Card key={c} className="space-y-4 !p-4">
            <h2 className="font-semibold">{c === 'East' ? 'Eastern' : 'Western'} Conference</h2>
            {[3, 2, 1].map((round) => {
              const list = conferenceSeries(series, c, round as Series['round']);
              if (!list.length) return null;
              return (
                <section key={round} className="space-y-2">
                  <h3 className="text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
                    {SERIES_ROUND_LABEL[round as Series['round']]}
                  </h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((s) => (
                      <SeriesCard key={s.id} s={s} team={team} mine={mine} />
                    ))}
                  </div>
                </section>
              );
            })}
            <PlayIn games={playIn} seeds={seeds} conference={c} team={team} mine={mine} />
          </Card>
        );
      })}
    </div>
  );
}

function conferenceSeries(series: readonly Series[], c: 'East' | 'West', round: Series['round']): Series[] {
  const list = series.filter((s) => s.conference === c && s.round === round);
  // Primo turno nell'ordine del tabellone; nei giri dopo prima la metà con la testa di serie 1
  const half = (s: Series) => ([1, 4, 5, 8].includes(s.highSeed) ? 0 : 1);
  return list.sort((a, b) =>
    round === 1 ? BRACKET_ORDER.indexOf(a.highSeed) - BRACKET_ORDER.indexOf(b.highSeed) : half(a) - half(b),
  );
}

function SeriesCard({
  s,
  team,
  mine,
}: {
  s: Series;
  team: Map<string, LeagueTeam>;
  mine: string | undefined;
}) {
  const code = (id: string) => team.get(id)?.code ?? '?';
  const status = s.winnerTeamId
    ? `${code(s.winnerTeamId)} vince ${Math.max(s.winsHigh, s.winsLow)}-${Math.min(s.winsHigh, s.winsLow)}`
    : s.winsHigh === s.winsLow
      ? s.winsHigh === 0
        ? 'Da giocare'
        : `Serie in parità ${s.winsHigh}-${s.winsLow}`
      : `${code(s.winsHigh > s.winsLow ? s.highTeamId : s.lowTeamId)} conduce ${Math.max(s.winsHigh, s.winsLow)}-${Math.min(s.winsHigh, s.winsLow)}`;
  return (
    <div className="rounded-lg border border-stampa-200 p-2 text-sm dark:border-stampa-700">
      {[
        { id: s.highTeamId, seed: s.highSeed, wins: s.winsHigh },
        { id: s.lowTeamId, seed: s.lowSeed, wins: s.winsLow },
      ].map((x) => (
        <div
          key={x.id}
          className={`flex items-center gap-2 py-0.5 ${s.winnerTeamId === x.id ? 'font-semibold' : ''} ${
            s.winnerTeamId && s.winnerTeamId !== x.id ? 'text-stampa-500 dark:text-stampa-400' : ''
          }`}
        >
          <span className="w-4 text-right text-xs text-stampa-500 dark:text-stampa-400">{x.seed || ''}</span>
          <TeamCode code={code(x.id)} strong={x.id === mine} />
          <span className="min-w-0 flex-1 truncate">{team.get(x.id)?.fullName}</span>
          <span className="w-5 text-right font-mono text-base">{x.wins}</span>
        </div>
      ))}
      <p className="mt-1 text-xs text-stampa-500 dark:text-stampa-400">{status}</p>
    </div>
  );
}

function PlayIn({
  games,
  seeds,
  conference,
  team,
  mine,
}: {
  games: readonly SeasonGame[];
  seeds: string[];
  conference: 'East' | 'West';
  team: Map<string, LeagueTeam>;
  mine: string | undefined;
}) {
  const mineGames = games.filter((g) => team.get(g.homeTeamId)?.conference === conference);
  const pair = (a: number, b: number) =>
    mineGames.find((g) => {
      const ids = new Set([g.homeTeamId, g.awayTeamId]);
      return ids.has(seeds[a - 1] as string) && ids.has(seeds[b - 1] as string);
    });
  const g78 = pair(7, 8);
  const g910 = pair(9, 10);
  const final = mineGames.find((g) => g !== g78 && g !== g910);
  const rows: { label: string; game: SeasonGame | undefined }[] = [
    { label: '7ª contro 8ª: chi vince è settima', game: g78 },
    { label: '9ª contro 10ª: chi perde è eliminata', game: g910 },
    { label: 'Spareggio per l’ottavo posto', game: final },
  ];
  const seedOf = (id: string) => seeds.indexOf(id) + 1;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
        Play-in
      </h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map(({ label, game }) => (
          <div key={label} className="rounded-lg border border-stampa-200 p-2 text-sm dark:border-stampa-700">
            <p className="mb-1 text-xs text-stampa-500 dark:text-stampa-400">{label}</p>
            {game ? (
              [game.homeTeamId, game.awayTeamId].map((tid) => {
                const score = tid === game.homeTeamId ? game.homeScore : game.awayScore;
                const other = tid === game.homeTeamId ? game.awayScore : game.homeScore;
                const won = score !== null && other !== null && score > other;
                return (
                  <div key={tid} className={`flex items-center gap-2 py-0.5 ${won ? 'font-semibold' : ''}`}>
                    <span className="w-4 text-right text-xs text-stampa-500 dark:text-stampa-400">
                      {seedOf(tid) || ''}
                    </span>
                    <TeamCode code={team.get(tid)?.code ?? '?'} strong={tid === mine} />
                    <span className="min-w-0 flex-1 truncate">{team.get(tid)?.fullName}</span>
                    <span className="font-mono">{score ?? '–'}</span>
                  </div>
                );
              })
            ) : (
              <p className="text-xs text-stampa-500 dark:text-stampa-400">Dopo le prime due partite</p>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
