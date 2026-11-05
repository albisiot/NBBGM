// Risultati di un turno: le partite con il punteggio (o da giocare), con il link a box score e cronaca. Si
// passa da un turno all'altro con le frecce; di default si apre l'ultimo turno giocato.
import { Link, useParams } from 'react-router';
import { Card, ErrorText, PageTitle, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { roundLabel, type SeasonGame, type Series } from '../lib/results.ts';
import { useSeason } from '../lib/useSeason.ts';

export function ResultsPage() {
  const { id = '', round } = useParams();
  const userId = useUserId();
  const { data, error, loading } = useSeason(id);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, games, series } = data;
  const mine = league.teams.find((t) => t.ownerId === userId)?.id ?? null;
  const team = new Map(league.teams.map((t) => [t.id, t]));

  const rounds = [...new Set(games.map((g) => g.roundNumber))].sort((a, b) => a - b);
  const played = games.filter((g) => g.homeScore !== null);
  const last = played.length ? Math.max(...played.map((g) => g.roundNumber)) : (rounds[0] ?? 0);
  const selected = round !== undefined && rounds.includes(Number(round)) ? Number(round) : last;
  const index = rounds.indexOf(selected);
  const list = games
    .filter((g) => g.roundNumber === selected)
    // La partita della propria squadra in cima
    .sort((a, b) => Number(isMine(b, mine)) - Number(isMine(a, mine)));
  const kind = list[0]?.kind ?? 'regular';

  return (
    <div className="space-y-4">
      <PageTitle
        sub={played.length ? `${played.length} partite giocate in stagione` : 'Nessuna partita giocata'}
      >
        Risultati
      </PageTitle>

      <div className="flex items-center justify-between gap-2">
        <RoundLink id={id} round={rounds[index - 1]} label="← Precedente" />
        <p className="text-center font-semibold">
          {roundLabel(selected, kind)}
          {kind !== 'regular' && (
            <span className="block text-xs font-normal text-slate-500 dark:text-slate-400">
              turno {selected - 81} della post-season
            </span>
          )}
        </p>
        <RoundLink id={id} round={rounds[index + 1]} label="Successivo →" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {list.map((g) => (
          <Card key={g.id} className="space-y-2 !p-4">
            {g.kind === 'playoffs' && g.seriesId && (
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {seriesText(g, games, series, (tid) => team.get(tid)?.code ?? '?')}
              </p>
            )}
            {g.kind === 'play-in' && <p className="text-xs text-slate-500 dark:text-slate-400">Play-in</p>}
            {[g.awayTeamId, g.homeTeamId].map((tid) => {
              const score = tid === g.homeTeamId ? g.homeScore : g.awayScore;
              const other = tid === g.homeTeamId ? g.awayScore : g.homeScore;
              const won = score !== null && other !== null && score > other;
              return (
                <div key={tid} className={`flex items-center gap-2 ${won ? 'font-semibold' : ''}`}>
                  <TeamCode code={team.get(tid)?.code ?? '?'} strong={tid === mine} />
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {team.get(tid)?.fullName}
                    {tid === g.homeTeamId && (
                      <span className="ml-1 text-xs font-normal text-slate-400">casa</span>
                    )}
                  </span>
                  <span className="w-10 text-right font-mono text-lg">{score ?? '–'}</span>
                </div>
              );
            })}
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-500 dark:text-slate-400">
                {g.homeScore === null ? 'Da giocare' : g.overtimes ? overtimeText(g.overtimes) : 'Finale'}
              </span>
              {g.homeScore !== null && (
                <Link
                  to={`/lega/${id}/partita/${g.id}`}
                  className="rounded px-2 py-1 font-semibold text-orange-700 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950"
                >
                  Box score e cronaca
                </Link>
              )}
            </div>
          </Card>
        ))}
      </div>
      {list.length === 0 && <p className="text-sm text-slate-500">Nessuna partita in questo turno.</p>}
    </div>
  );
}

function isMine(g: SeasonGame, mine: string | null): boolean {
  return mine !== null && (g.homeTeamId === mine || g.awayTeamId === mine);
}

export function overtimeText(n: number): string {
  return n === 1 ? 'Finale dopo un supplementare' : `Finale dopo ${n} supplementari`;
}

/** "Gara 3 · BOS conduce 2-1" (situazione della serie dopo questa partita). */
export function seriesText(
  game: SeasonGame,
  games: readonly SeasonGame[],
  series: readonly Series[],
  code: (teamId: string) => string,
): string {
  const s = series.find((x) => x.id === game.seriesId);
  if (!s) return 'Playoff';
  const upTo = games.filter(
    (g) => g.seriesId === s.id && g.roundNumber <= game.roundNumber && g.homeScore !== null,
  );
  const n = games.filter((g) => g.seriesId === s.id && g.roundNumber <= game.roundNumber).length;
  if (game.homeScore === null) return `Gara ${n}`;
  const wins = (tid: string) =>
    upTo.filter(
      (g) => ((g.homeScore as number) > (g.awayScore as number) ? g.homeTeamId : g.awayTeamId) === tid,
    ).length;
  const h = wins(s.highTeamId);
  const l = wins(s.lowTeamId);
  const lead =
    h === l
      ? `serie ${h}-${l}`
      : h > l
        ? `${code(s.highTeamId)} ${h === 4 ? 'vince' : 'conduce'} ${h}-${l}`
        : `${code(s.lowTeamId)} ${l === 4 ? 'vince' : 'conduce'} ${l}-${h}`;
  return `Gara ${n} · ${lead}`;
}

function RoundLink({ id, round, label }: { id: string; round: number | undefined; label: string }) {
  if (round === undefined) return <span className="min-w-24" />;
  return (
    <Link
      to={`/lega/${id}/risultati/${round}`}
      className="inline-flex min-h-11 min-w-24 items-center justify-center rounded-lg border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
    >
      {label}
    </Link>
  );
}
