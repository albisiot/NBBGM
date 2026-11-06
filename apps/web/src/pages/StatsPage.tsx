// Statistiche individuali di regular season, per partita: si ordinano toccando l'intestazione di una colonna e
// si filtrano per squadra e per partite giocate. Le stagioni passate (?stagione=2026) vengono da quelle salvate a
// fine regular season.
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Card, ErrorText, PageTitle, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { leagueDetail } from '../lib/leagues.ts';
import { leagueSeasons, seasonLabel, seasonPlayers } from '../lib/history.ts';
import { perGame, type PlayerSeason } from '../lib/results.ts';
import { useAsync } from '../lib/useAsync.ts';

type SortKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'min' | 'g' | 'fgPct' | 'tpPct' | 'ftPct';

const COLUMNS: { key: SortKey; label: string; title: string; pct?: boolean; int?: boolean }[] = [
  { key: 'g', label: 'G', title: 'Partite giocate', int: true },
  { key: 'min', label: 'MIN', title: 'Minuti' },
  { key: 'pts', label: 'PT', title: 'Punti' },
  { key: 'reb', label: 'RIM', title: 'Rimbalzi' },
  { key: 'ast', label: 'AS', title: 'Assist' },
  { key: 'stl', label: 'RUB', title: 'Rubate' },
  { key: 'blk', label: 'STP', title: 'Stoppate' },
  { key: 'tov', label: 'PP', title: 'Palle perse' },
  { key: 'fgPct', label: '%T', title: 'Percentuale al tiro', pct: true },
  { key: 'tpPct', label: '%3', title: 'Percentuale da 3', pct: true },
  { key: 'ftPct', label: '%TL', title: 'Percentuale ai liberi', pct: true },
];

const LIMIT = 100;

// Colonna del nome fissa a sinistra quando la tabella scorre (su telefono): fondo della scheda sotto
const STICKY = 'sticky left-0 bg-white pl-1 dark:bg-slate-800';

export function StatsPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [sort, setSort] = useState<SortKey>('pts');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [minGames, setMinGames] = useState(true);
  const [search, setSearch] = useSearchParams();
  const wanted = Number(search.get('stagione')) || null;
  const { data, error, loading } = useAsync(async () => {
    const league = await leagueDetail(id);
    if (!league) return { league, players: [], seasons: [], year: null };
    const seasons = await leagueSeasons(id, league.seasonId);
    const season = seasons.find((s) => s.year === wanted) ?? seasons.find((s) => s.current) ?? seasons[0];
    if (!season) return { league, players: [], seasons, year: null };
    const { players } = await seasonPlayers(id, season);
    return {
      league,
      seasons,
      year: season.year,
      players: players.map((p) => perGame(p.id, p.teamId, p.name, p.role, { ...p.stats })),
    };
  }, [id, wanted]);

  const rows = useMemo(() => {
    if (!data) return [];
    const maxG = Math.max(0, ...data.players.map((p) => p.g));
    return (
      data.players
        .filter((p) => teamFilter === 'all' || p.teamId === teamFilter)
        // Per le classifiche servono abbastanza partite: almeno metà di quelle del più presente
        .filter((p) => !minGames || teamFilter !== 'all' || p.g >= Math.ceil(maxG / 2))
        .sort((a, b) => (b[sort] ?? -1) - (a[sort] ?? -1))
    );
  }, [data, sort, teamFilter, minGames]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data?.league) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const mine = league.teams.find((t) => t.ownerId === userId)?.id;

  return (
    <div className="space-y-4">
      <PageTitle sub="Regular season, medie per partita.">Statistiche</PageTitle>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {data.seasons.length > 1 && data.year !== null && (
          <label className="flex items-center gap-2">
            Stagione
            <select
              className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-800"
              value={data.year}
              onChange={(e) => setSearch({ stagione: e.target.value }, { replace: true })}
            >
              {data.seasons.map((s) => (
                <option key={s.id} value={s.year}>
                  {seasonLabel(s.year)}
                  {s.current ? ' (in corso)' : ''}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="flex items-center gap-2">
          Squadra
          <select
            className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 dark:border-slate-600 dark:bg-slate-800"
            value={teamFilter}
            onChange={(e) => setTeamFilter(e.target.value)}
          >
            <option value="all">Tutta la lega</option>
            {mine && <option value={mine}>La mia squadra</option>}
            {[...league.teams]
              .sort((a, b) => a.fullName.localeCompare(b.fullName, 'it'))
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.fullName}
                </option>
              ))}
          </select>
        </label>
        {teamFilter === 'all' && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              className="size-4 accent-orange-600"
              checked={minGames}
              onChange={(e) => setMinGames(e.target.checked)}
            />
            Solo chi ha giocato abbastanza
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nessuna partita giocata.</p>
      ) : (
        <Card className="!p-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
                  <th className={`${STICKY} py-1 pr-2 text-left font-medium`}>
                    <span className="inline-block w-6">#</span>Giocatore
                  </th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="px-1 py-1 text-right font-medium">
                      <button
                        type="button"
                        title={c.title}
                        onClick={() => setSort(c.key)}
                        className={`min-h-11 min-w-11 rounded px-1 ${sort === c.key ? 'font-bold text-orange-700 dark:text-orange-300' : 'hover:text-slate-900 dark:hover:text-white'}`}
                      >
                        {c.label}
                        {sort === c.key ? ' ↓' : ''}
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, LIMIT).map((p, i) => (
                  <Row
                    key={p.id}
                    p={p}
                    rank={i + 1}
                    leagueId={id}
                    code={team.get(p.teamId ?? '')?.code}
                    mine={p.teamId === mine}
                    sort={sort}
                  />
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > LIMIT && (
            <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              I primi {LIMIT} su {rows.length}.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}

function Row({
  p,
  rank,
  leagueId,
  code,
  mine,
  sort,
}: {
  p: PlayerSeason;
  rank: number;
  leagueId: string;
  code: string | undefined;
  mine: boolean;
  sort: SortKey;
}) {
  return (
    <tr className={`border-b border-slate-100 dark:border-slate-700/60 ${mine ? 'font-semibold' : ''}`}>
      <td className={`${STICKY} max-w-[13rem] truncate py-1 pr-2 sm:max-w-64`}>
        <span className="flex items-center gap-2">
          <span className="w-4 shrink-0 text-xs font-normal text-slate-500 dark:text-slate-400">{rank}</span>
          <TeamCode code={code ?? 'SV'} strong={mine} />
          <Link to={`/lega/${leagueId}/giocatore/${p.id}`} className="truncate hover:underline">
            {p.name}
          </Link>
          {/* Su telefono il ruolo lascia spazio al nome: si vede nella scheda del giocatore */}
          <span className="hidden text-xs text-slate-500 sm:inline dark:text-slate-400">{p.role}</span>
        </span>
      </td>
      {COLUMNS.map((c) => {
        const v = p[c.key];
        const text = v === null ? '–' : c.pct ? (v * 100).toFixed(1) : c.int ? String(v) : v.toFixed(1);
        return (
          <td
            key={c.key}
            className={`px-1.5 py-1 text-right font-mono ${sort === c.key ? 'font-semibold' : ''}`}
          >
            {text}
          </td>
        );
      })}
    </tr>
  );
}
