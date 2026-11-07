// Tabellone di play-in e playoff. In regular season mostra chi ci andrebbe se la stagione finisse oggi; poi le
// partite di play-in e le serie al meglio di 7, giro per giro, fino alla finale: riquadri a filo d'inchiostro con
// il vincitore in grassetto. Titolo e schede di Campionato stanno in ChampionshipLayout.
import { useMemo } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorText, Kicker, Leader, SectionTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import type { LeagueTeam } from '../lib/leagues.ts';
import { seasonStandings, SERIES_ROUND_LABEL, type SeasonGame, type Series } from '../lib/results.ts';
import { INK_LINK, NOTE, SUBHEAD, winnerSide } from '../lib/tabellino.ts';
import { useSeason } from '../lib/useSeason.ts';

const CONFERENCES = ['East', 'West'] as const;
const CONFERENCE_NAME = { East: 'Eastern Conference', West: 'Western Conference' } as const;
// Ordine del tabellone fisso: 1-8, 4-5, 3-6, 2-7
const BRACKET_ORDER = [1, 4, 3, 2];

/** Riquadro a filo del tabellone (una serie o una partita di play-in). */
const BOX =
  'border border-stampa-900 bg-stampa-25 px-3 py-2 text-sm dark:border-stampa-300 dark:bg-stampa-800';

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
        <p className={NOTE}>
          Il tabellone si forma alla fine della regular season. Se la stagione finisse oggi:
        </p>
        <div className="grid gap-6 md:grid-cols-2">
          {CONFERENCES.map((c) => (
            <section key={c} className="space-y-1">
              <SectionTitle>{CONFERENCE_NAME[c]}</SectionTitle>
              <ol>
                {standings[c].slice(0, 10).map((l) => {
                  const t = team.get(l.teamId);
                  const own = l.teamId === mine;
                  return (
                    <li
                      key={l.teamId}
                      className={`${own ? 'font-bold' : ''} ${
                        l.confRank === 6
                          ? 'border-b-2 border-stampa-900 pb-1 dark:border-stampa-100'
                          : l.confRank === 7
                            ? 'pt-1'
                            : ''
                      }`}
                    >
                      <Leader
                        label={
                          <span className="flex items-center gap-1.5">
                            <span
                              className={`w-5 font-titolo ${own ? 'text-rosso-700 dark:text-rosso-300' : ''}`}
                            >
                              {l.confRank}
                            </span>
                            <b className="font-titolo font-semibold">{t?.code ?? '?'}</b>
                            <Link to={`/lega/${league.id}/squadre/${t?.code ?? ''}`} className={INK_LINK}>
                              {t?.fullName}
                            </Link>
                            {l.confRank >= 7 && <span className="sr-only">, play-in</span>}
                          </span>
                        }
                        value={
                          <span className="tabular-nums">
                            {l.w}-{l.l}
                          </span>
                        }
                      />
                    </li>
                  );
                })}
              </ol>
            </section>
          ))}
        </div>
        <p className={NOTE}>Sopra la riga piena: playoff · sotto, dal 7° al 10°: play-in.</p>
      </div>
    );

  return (
    <div className="space-y-6">
      <p className={NOTE}>Play-in a partita secca, poi serie al meglio di 7 (fattore campo 2-2-1-1-1).</p>

      {champion && (
        <section className="border-y-4 border-double border-stampa-900 py-3 text-center dark:border-stampa-100">
          <Kicker>Campioni NBA</Kicker>
          <p className="font-titolo text-3xl leading-tight font-bold tracking-wide uppercase">
            {champion.fullName}
          </p>
        </section>
      )}

      {final && (
        <section className="space-y-2">
          <SectionTitle>{SERIES_ROUND_LABEL[4]}</SectionTitle>
          <div className="sm:max-w-sm">
            <SeriesBox s={final} team={team} mine={mine} />
          </div>
        </section>
      )}

      {CONFERENCES.map((c) => {
        const seeds = standings[c].slice(0, 10).map((l) => l.teamId);
        return (
          <section key={c} className="space-y-4">
            <SectionTitle>{CONFERENCE_NAME[c]}</SectionTitle>
            {[3, 2, 1].map((round) => {
              const list = conferenceSeries(series, c, round as Series['round']);
              if (!list.length) return null;
              return (
                <section key={round} className="space-y-2">
                  <h3 className={SUBHEAD}>{SERIES_ROUND_LABEL[round as Series['round']]}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {list.map((s) => (
                      <SeriesBox key={s.id} s={s} team={team} mine={mine} />
                    ))}
                  </div>
                </section>
              );
            })}
            <PlayIn games={playIn} seeds={seeds} conference={c} team={team} mine={mine} />
          </section>
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

/** Una riga del riquadro: testa di serie, sigla, nome e numero (vittorie o punti); il vincitore in grassetto. */
function TeamLine({
  seed,
  team,
  mine,
  value,
  won,
  lost,
}: {
  seed: number;
  team: LeagueTeam | undefined;
  mine: boolean;
  value: number | string;
  won: boolean;
  lost: boolean;
}) {
  return (
    <div
      className={`flex min-h-7 items-center gap-2 ${won ? 'font-bold' : ''} ${
        lost ? 'text-stampa-600 dark:text-stampa-400' : ''
      }`}
    >
      <span className="w-4 text-right font-titolo text-xs text-stampa-600 dark:text-stampa-300">
        {seed || ''}
      </span>
      <b
        className={`w-9 shrink-0 font-titolo ${won ? 'font-bold' : 'font-semibold'} ${
          mine ? 'text-rosso-700 dark:text-rosso-300' : ''
        }`}
      >
        {team?.code ?? '?'}
      </b>
      <span className="min-w-0 flex-1 truncate">{team?.fullName}</span>
      <span className="w-6 text-right font-titolo text-base tabular-nums">{value}</span>
    </div>
  );
}

function SeriesBox({
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
    <div className={BOX}>
      {[
        { id: s.highTeamId, seed: s.highSeed, wins: s.winsHigh },
        { id: s.lowTeamId, seed: s.lowSeed, wins: s.winsLow },
      ].map((x) => (
        <TeamLine
          key={x.id}
          seed={x.seed}
          team={team.get(x.id)}
          mine={x.id === mine}
          value={x.wins}
          won={s.winnerTeamId === x.id}
          lost={s.winnerTeamId !== null && s.winnerTeamId !== x.id}
        />
      ))}
      <p className={`mt-1 border-t border-stampa-200 pt-1 dark:border-stampa-700 ${NOTE}`}>{status}</p>
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
  const confGames = games.filter((g) => team.get(g.homeTeamId)?.conference === conference);
  const pair = (a: number, b: number) =>
    confGames.find((g) => {
      const ids = new Set([g.homeTeamId, g.awayTeamId]);
      return ids.has(seeds[a - 1] as string) && ids.has(seeds[b - 1] as string);
    });
  const g78 = pair(7, 8);
  const g910 = pair(9, 10);
  const final = confGames.find((g) => g !== g78 && g !== g910);
  const rows: { label: string; game: SeasonGame | undefined }[] = [
    { label: '7ª contro 8ª: chi vince è settima', game: g78 },
    { label: '9ª contro 10ª: chi perde è eliminata', game: g910 },
    { label: 'Spareggio per l’ottavo posto', game: final },
  ];
  const seedOf = (id: string) => seeds.indexOf(id) + 1;
  return (
    <section className="space-y-2">
      <h3 className={SUBHEAD}>Play-in</h3>
      <div className="grid gap-2 sm:grid-cols-3">
        {rows.map(({ label, game }) => {
          const won = game ? winnerSide(game.awayScore, game.homeScore) : null;
          return (
            <div key={label} className={BOX}>
              <p className={`mb-1 ${NOTE}`}>{label}</p>
              {game ? (
                [game.homeTeamId, game.awayTeamId].map((tid) => {
                  const home = tid === game.homeTeamId;
                  const score = home ? game.homeScore : game.awayScore;
                  return (
                    <TeamLine
                      key={tid}
                      seed={seedOf(tid)}
                      team={team.get(tid)}
                      mine={tid === mine}
                      value={score ?? '–'}
                      won={won !== null && won === (home ? 'home' : 'away')}
                      lost={won !== null && won !== (home ? 'home' : 'away')}
                    />
                  );
                })
              ) : (
                <p className={NOTE}>Dopo le prime due partite</p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
