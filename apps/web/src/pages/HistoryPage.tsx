// Storico della lega come l'almanacco del giornale: albo d'oro (campioni e finaliste), e per ogni stagione premi,
// migliori della stagione e classifica finale di regular season. I premi seguono formule fisse
// (packages/engine/src/season/awards.ts); per la stagione in corso sono provvisori.
import { AWARD_FORMULA, AWARD_LABEL, seasonAwards, type StandingsLine } from '@nbbgm/engine';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CeremonyCard } from '../components/CeremonyCard.tsx';
import { Button, ErrorText, Kicker, Leader, PageTitle, SectionTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import {
  defaultSeason,
  leagueFinals,
  leagueSeasons,
  pastSeason,
  seasonLabel,
  seasonPlayers,
  type LeagueSeason,
  type SeasonPlayer,
} from '../lib/history.ts';
import { leagueDetail, type LeagueDetail, type LeagueTeam } from '../lib/leagues.ts';
import { FIELD, INK_LINK, NOTE, SUBHEAD } from '../lib/tabellino.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';
import { currentStandings } from '../lib/useSeason.ts';

const RED_LINK = 'font-semibold text-rosso-700 hover:underline dark:text-rosso-300';

export function HistoryPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [search, setSearch] = useSearchParams();
  const { data, error, loading, reload } = useAsync(async () => {
    const league = await leagueDetail(id);
    if (!league) return null;
    const [seasons, finals] = await Promise.all([leagueSeasons(id, league.seasonId), leagueFinals(id)]);
    return { league, seasons, finals };
  }, [id]);
  useRoundChange(id, reload);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, seasons, finals } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const mine = league.teams.find((t) => t.ownerId === userId)?.id;
  const wanted = Number(search.get('stagione'));
  const season = seasons.find((s) => s.year === wanted) ?? defaultSeason(seasons);
  const done = finals.filter((f) => f.championId !== null);

  return (
    <div className="space-y-6">
      <PageTitle sub="Campioni, premi e classifiche delle stagioni giocate.">Storico</PageTitle>

      <section className="space-y-1">
        <SectionTitle>Albo d’oro</SectionTitle>
        {done.length === 0 ? (
          <p className={NOTE}>Nessuna stagione conclusa, per ora.</p>
        ) : (
          <ul>
            {done.map((f) => {
              const champion = team.get(f.championId ?? '');
              const finalist = team.get(f.finalistId ?? '');
              const own = champion?.id === mine;
              return (
                <li
                  key={f.seasonId}
                  className="flex items-baseline gap-3 border-b border-stampa-200 py-1.5 text-sm last:border-b-0 dark:border-stampa-700"
                >
                  <span className="w-16 shrink-0 font-titolo font-semibold tabular-nums">
                    {seasonLabel(f.year)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <b className={`mr-1.5 font-titolo ${own ? 'text-rosso-700 dark:text-rosso-300' : ''}`}>
                      {champion?.code ?? '?'}
                    </b>
                    <Link
                      to={`/lega/${league.id}/squadre/${champion?.code ?? ''}`}
                      className={`font-semibold ${INK_LINK}`}
                    >
                      {champion?.fullName}
                    </Link>{' '}
                    <i className="text-[0.8125rem] whitespace-nowrap text-stampa-600 dark:text-stampa-300">
                      in finale su {finalist?.code ?? '?'}
                    </i>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {(seasons.length > 1 || (season && done.some((f) => f.seasonId === season.id))) && (
        <div className="flex flex-wrap items-end gap-3">
          {seasons.length > 1 && season && (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-titolo text-xs font-semibold tracking-widest uppercase">Stagione</span>
              <select
                className={FIELD}
                value={season.year}
                onChange={(e) => setSearch({ stagione: e.target.value }, { replace: true })}
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.year}>
                    {seasonLabel(s.year)}
                    {s.current ? ' (in corso)' : ''}
                  </option>
                ))}
              </select>
            </label>
          )}
          {season && done.some((f) => f.seasonId === season.id) && (
            <CeremonyButton key={`cerimonia-${season.id}`} league={league} season={season} />
          )}
        </div>
      )}
      {season && <SeasonDetail key={season.id} league={league} season={season} mine={mine} />}
    </div>
  );
}

/** La cerimonia di fine stagione, da rivedere quando si vuole: un pulsante a filo, la cerimonia sotto. */
function CeremonyButton({ league, season }: { league: LeagueDetail; season: LeagueSeason }) {
  const [open, setOpen] = useState(false);
  if (open)
    return (
      <div className="w-full">
        <CeremonyCard league={league} season={season} inHistory onClose={() => setOpen(false)} />
      </div>
    );
  return (
    <Button variant="secondary" onClick={() => setOpen(true)}>
      Cerimonia della stagione {seasonLabel(season.year)}
    </Button>
  );
}

async function loadSeason(league: LeagueDetail, season: LeagueSeason) {
  // Stagione finita: dalla memoria se già vista
  if (!season.current || !league.seasonId) return { ...(await pastSeason(league, season)), live: false };
  // Stagione in corso: la classifica del turno (dalla memoria se c'è), i giocatori cambiano a ogni turno
  const [{ players, live }, standings] = await Promise.all([
    seasonPlayers(league.id, season),
    currentStandings({ ...league, seasonId: league.seasonId, seasonYear: season.year }),
  ]);
  return { players, live, standings };
}

function SeasonDetail({
  league,
  season,
  mine,
}: {
  league: LeagueDetail;
  season: LeagueSeason;
  mine: string | undefined;
}) {
  // La stagione in corso si rilegge a ogni turno nuovo (corsa ai premi e classifica attuale); le passate no
  const { data, error, loading } = useAsync(
    () => loadSeason(league, season),
    [league.id, season.id, season.current ? league.roundId : null],
  );
  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return null;
  const { players, live, standings } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const pct = new Map(
    [...standings.East, ...standings.West].map((l) => [l.teamId, l.w + l.l > 0 ? l.w / (l.w + l.l) : 0.5]),
  );
  const result = seasonAwards(players, (t) => pct.get(t));
  const byId = new Map(players.map((p) => [p.id, p]));
  const playedGames = [...standings.East, ...standings.West].some((l) => l.w + l.l > 0);

  return (
    <div className="space-y-6">
      <section className="space-y-3">
        <SectionTitle
          aside={
            <Link
              to={`/lega/${league.id}/statistiche?stagione=${season.year}`}
              className={`inline-flex min-h-11 items-center ${RED_LINK}`}
            >
              Statistiche ›
            </Link>
          }
        >
          {live ? `Corsa ai premi ${seasonLabel(season.year)}` : `Premi ${seasonLabel(season.year)}`}
        </SectionTitle>
        {live && <p className={NOTE}>Provvisori: si decidono con le statistiche di fine regular season.</p>}
        {result.awards.length === 0 ? (
          <p className={NOTE}>Nessuna partita giocata.</p>
        ) : (
          <ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
            {result.awards.map((a) => {
              const p = byId.get(a.playerId);
              const t = team.get(a.teamId ?? '');
              return (
                <li key={a.key} className="border-t border-stampa-900 pt-2 text-sm dark:border-stampa-100">
                  <Kicker>{AWARD_LABEL[a.key]}</Kicker>
                  <p className="mt-0.5 flex min-w-0 items-baseline gap-1.5 text-base">
                    <b
                      className={`shrink-0 font-titolo ${t?.id === mine ? 'text-rosso-700 dark:text-rosso-300' : ''}`}
                    >
                      {t?.code ?? 'SV'}
                    </b>
                    <Link
                      to={`/lega/${league.id}/giocatore/${a.playerId}`}
                      className={`truncate font-semibold ${INK_LINK}`}
                    >
                      {p?.name}
                    </Link>
                  </p>
                  <p className={NOTE}>
                    {p ? statLine(p) : ''} · punteggio {a.score.toFixed(1).replace('.', ',')}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {result.awards.length > 0 && (
          <details className="text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-semibold italic underline underline-offset-4">
              Come si calcolano
            </summary>
            <ul className="space-y-1 text-stampa-700 dark:text-stampa-200">
              {(['mvp', 'dpoy', 'roy', 'sixth'] as const).map((k) => (
                <li key={k}>
                  <span className="font-semibold">{AWARD_LABEL[k]}:</span> {AWARD_FORMULA[k]}.
                </li>
              ))}
              <li>
                Valutazione: punti + rimbalzi + assist + rubate + stoppate − tiri e liberi sbagliati − palle
                perse, a partita. Servono almeno {result.minGames} partite (metà di quelle del più presente).
              </li>
            </ul>
          </details>
        )}
      </section>

      {result.leaders.points.length > 0 && (
        <section className="space-y-3">
          <SectionTitle>I migliori</SectionTitle>
          <div className="grid gap-5 sm:grid-cols-3">
            {(
              [
                ['Punti', result.leaders.points],
                ['Rimbalzi', result.leaders.rebounds],
                ['Assist', result.leaders.assists],
              ] as const
            ).map(([label, list]) => (
              <div key={label} className="space-y-1">
                <h3 className={SUBHEAD}>{label} a partita</h3>
                <ol className="text-sm">
                  {list.map((l, i) => (
                    <li key={l.playerId} className={l.teamId === mine ? 'font-bold' : ''}>
                      <Leader
                        label={
                          <span className="flex items-baseline gap-1.5">
                            <span className="w-3 font-titolo text-stampa-600 dark:text-stampa-300">
                              {i + 1}
                            </span>
                            <b className="font-titolo font-semibold">
                              {team.get(l.teamId ?? '')?.code ?? 'SV'}
                            </b>
                            <Link
                              to={`/lega/${league.id}/giocatore/${l.playerId}`}
                              title={byId.get(l.playerId)?.name}
                              className={`max-w-[9rem] truncate ${INK_LINK}`}
                            >
                              {byId.get(l.playerId)?.shortName}
                            </Link>
                          </span>
                        }
                        value={<span className="tabular-nums">{l.value.toFixed(1).replace('.', ',')}</span>}
                      />
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      )}

      {playedGames && (
        <section className="space-y-3">
          <SectionTitle>{live ? 'Classifica attuale' : 'Classifica finale di regular season'}</SectionTitle>
          <div className="grid gap-6 md:grid-cols-2">
            {(['East', 'West'] as const).map((conf) => (
              <FinalTable
                key={conf}
                title={conf === 'East' ? 'Eastern Conference' : 'Western Conference'}
                lines={standings[conf]}
                team={team}
                mine={mine}
                leagueId={league.id}
              />
            ))}
          </div>
          <p className={NOTE}>Sopra la riga piena: playoff · fino alla riga a puntini: play-in.</p>
        </section>
      )}
    </div>
  );
}

/** "27,3 pt · 8,1 rim · 6,4 as in 78 partite" */
function statLine(p: SeasonPlayer): string {
  const g = Math.max(1, p.stats.g);
  const f = (x: number) => (x / g).toFixed(1).replace('.', ',');
  return `${f(p.stats.pts)} pt · ${f(p.stats.orb + p.stats.drb)} rim · ${f(p.stats.ast)} as in ${p.stats.g} partite`;
}

function FinalTable({
  title,
  lines,
  team,
  mine,
  leagueId,
}: {
  title: string;
  lines: StandingsLine[];
  team: Map<string, LeagueTeam>;
  mine: string | undefined;
  leagueId: string;
}) {
  return (
    <div className="space-y-1">
      <h3 className={SUBHEAD}>{title}</h3>
      <ol className="text-sm">
        {lines.map((l) => {
          const t = team.get(l.teamId);
          const own = l.teamId === mine;
          // Filetto pieno dopo il 6° posto (playoff), a puntini dopo il 10° (play-in)
          const rule =
            l.confRank === 6
              ? 'border-b-2 border-stampa-900 dark:border-stampa-100'
              : l.confRank === 10
                ? 'border-b-2 border-dotted border-stampa-900 dark:border-stampa-100'
                : '';
          return (
            <li key={l.teamId} className={`${rule} ${own ? 'font-bold' : ''}`}>
              <Leader
                label={
                  <span className="flex items-baseline gap-1.5">
                    <span
                      className={`w-5 font-titolo ${own ? 'text-rosso-700 dark:text-rosso-300' : 'text-stampa-600 dark:text-stampa-300'}`}
                    >
                      {l.confRank}
                    </span>
                    <b className="font-titolo font-semibold">{t?.code ?? '?'}</b>
                    <Link
                      to={`/lega/${leagueId}/squadre/${t?.code ?? ''}`}
                      className={`max-w-[11rem] truncate ${INK_LINK}`}
                    >
                      {t?.fullName}
                    </Link>
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
    </div>
  );
}
