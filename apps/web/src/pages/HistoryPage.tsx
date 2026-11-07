// Storico della lega: albo d'oro (campioni e finaliste), e per ogni stagione premi, migliori della stagione e
// classifica finale di regular season. I premi seguono formule fisse (packages/engine/src/season/awards.ts); per
// la stagione in corso sono provvisori.
import { AWARD_FORMULA, AWARD_LABEL, seasonAwards, type StandingsLine } from '@nbbgm/engine';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { CeremonyCard } from '../components/CeremonyCard.tsx';
import { Card, ErrorText, PageTitle, Spinner, TeamCode } from '../components/ui.tsx';
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
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';
import { currentStandings } from '../lib/useSeason.ts';

const LINK = 'font-semibold text-rosso-700 hover:underline dark:text-rosso-300';

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
    <div className="space-y-4">
      <PageTitle sub="Campioni, premi e classifiche delle stagioni giocate.">Storico</PageTitle>

      <Card className="space-y-2 !p-4">
        <h2 className="font-semibold">Albo d’oro</h2>
        {done.length === 0 ? (
          <p className="text-sm text-stampa-500 dark:text-stampa-400">Nessuna stagione conclusa, per ora.</p>
        ) : (
          <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
            {done.map((f) => {
              const champion = team.get(f.championId ?? '');
              const finalist = team.get(f.finalistId ?? '');
              return (
                <li key={f.seasonId} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2">
                  <span className="w-16 shrink-0 font-mono text-xs">{seasonLabel(f.year)}</span>
                  <TeamCode code={champion?.code ?? '?'} strong={champion?.id === mine} />
                  <Link
                    to={`/lega/${league.id}/squadre/${champion?.code ?? ''}`}
                    className="font-semibold hover:underline"
                  >
                    {champion?.fullName}
                  </Link>
                  <span className="text-xs text-stampa-500 dark:text-stampa-400">
                    in finale su {finalist?.code ?? '?'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {seasons.length > 1 && season && (
        <label className="flex items-center gap-2 text-sm">
          Stagione
          <select
            className="min-h-11 rounded-lg border border-stampa-300 bg-stampa-25 px-2 dark:border-stampa-600 dark:bg-stampa-800"
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
      {season && <SeasonDetail key={season.id} league={league} season={season} mine={mine} />}
    </div>
  );
}

/** La cerimonia di fine stagione, da rivedere quando si vuole. */
function CeremonyButton({ league, season }: { league: LeagueDetail; season: LeagueSeason }) {
  const [open, setOpen] = useState(false);
  if (open) return <CeremonyCard league={league} season={season} inHistory onClose={() => setOpen(false)} />;
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 px-4 text-sm font-semibold text-amber-900 hover:bg-amber-100 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100 dark:hover:bg-amber-900"
    >
      <span aria-hidden="true">🏆</span> Cerimonia della stagione {seasonLabel(season.year)}
    </button>
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
    <div className="space-y-4">
      <Card className="space-y-3 !p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">
            {live ? `Corsa ai premi ${seasonLabel(season.year)}` : `Premi ${seasonLabel(season.year)}`}
          </h2>
          <Link to={`/lega/${league.id}/statistiche?stagione=${season.year}`} className={`text-sm ${LINK}`}>
            Statistiche della stagione
          </Link>
        </div>
        {live && (
          <p className="text-xs text-stampa-500 dark:text-stampa-400">
            Provvisori: si decidono con le statistiche di fine regular season.
          </p>
        )}
        {result.awards.length === 0 ? (
          <p className="text-sm text-stampa-500 dark:text-stampa-400">Nessuna partita giocata.</p>
        ) : (
          <ul className="grid gap-2 sm:grid-cols-2">
            {result.awards.map((a) => {
              const p = byId.get(a.playerId);
              const t = team.get(a.teamId ?? '');
              return (
                <li
                  key={a.key}
                  className="rounded-lg border border-stampa-200 p-3 text-sm dark:border-stampa-700"
                >
                  <p className="text-xs font-semibold tracking-wide text-rosso-700 uppercase dark:text-rosso-300">
                    {AWARD_LABEL[a.key]}
                  </p>
                  <p className="mt-1 flex items-center gap-2">
                    <TeamCode code={t?.code ?? 'SV'} strong={t?.id === mine} />
                    <Link
                      to={`/lega/${league.id}/giocatore/${a.playerId}`}
                      className="truncate font-semibold hover:underline"
                    >
                      {p?.name}
                    </Link>
                  </p>
                  <p className="mt-1 text-xs text-stampa-500 dark:text-stampa-400">
                    {p ? statLine(p) : ''} · punteggio {a.score.toFixed(1).replace('.', ',')}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        {result.awards.length > 0 && (
          <details className="text-xs text-stampa-600 dark:text-stampa-300">
            <summary className="min-h-11 cursor-pointer py-3 font-semibold">Come si calcolano</summary>
            <ul className="space-y-1">
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
      </Card>

      {result.leaders.points.length > 0 && (
        <Card className="!p-4">
          <h2 className="mb-2 font-semibold">I migliori</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {(
              [
                ['Punti', result.leaders.points],
                ['Rimbalzi', result.leaders.rebounds],
                ['Assist', result.leaders.assists],
              ] as const
            ).map(([label, list]) => (
              <div key={label}>
                <h3 className="text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
                  {label} a partita
                </h3>
                <ol className="text-sm">
                  {list.map((l, i) => (
                    <li key={l.playerId} className="flex items-center gap-2 py-0.5">
                      <span className="w-4 text-xs text-stampa-500 dark:text-stampa-400">{i + 1}</span>
                      <TeamCode code={team.get(l.teamId ?? '')?.code ?? 'SV'} strong={l.teamId === mine} />
                      <Link
                        to={`/lega/${league.id}/giocatore/${l.playerId}`}
                        className="min-w-0 flex-1 truncate hover:underline"
                      >
                        {byId.get(l.playerId)?.name}
                      </Link>
                      <span className="font-mono">{l.value.toFixed(1).replace('.', ',')}</span>
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </Card>
      )}

      {playedGames && (
        <Card className="!p-4">
          <h2 className="mb-2 font-semibold">
            {live ? 'Classifica attuale' : 'Classifica finale di regular season'}
          </h2>
          <div className="grid gap-4 md:grid-cols-2">
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
        </Card>
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
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
        {title}
      </h3>
      <ol className="text-sm">
        {lines.map((l) => {
          const t = team.get(l.teamId);
          return (
            <li
              key={l.teamId}
              className={`flex items-center gap-2 py-0.5 ${l.teamId === mine ? 'font-semibold' : ''}`}
            >
              <span className="w-5 text-xs text-stampa-500 dark:text-stampa-400">{l.confRank}</span>
              <TeamCode code={t?.code ?? '?'} strong={l.teamId === mine} />
              <Link
                to={`/lega/${leagueId}/squadre/${t?.code ?? ''}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {t?.fullName}
              </Link>
              <span className="font-mono">
                {l.w}-{l.l}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
