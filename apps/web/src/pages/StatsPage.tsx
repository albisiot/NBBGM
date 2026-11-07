// Statistiche individuali di regular season, per partita, come un tabellino: si ordinano toccando l'intestazione
// di una colonna e si filtrano per squadra e per partite giocate. Le stagioni passate (?stagione=2026) vengono da
// quelle salvate a fine regular season.
import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { leagueDetail } from '../lib/leagues.ts';
import { leagueSeasons, seasonLabel, seasonPlayers } from '../lib/history.ts';
import { perGame, type PlayerSeason } from '../lib/results.ts';
import {
  FIELD,
  HEAD_ROW,
  HIGHLIGHT,
  INK_LINK,
  NOTE,
  PAPER,
  rowRule,
  STICKY,
  TABLE,
} from '../lib/tabellino.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';

type SortKey = 'pts' | 'reb' | 'ast' | 'stl' | 'blk' | 'tov' | 'min' | 'g' | 'fgPct' | 'tpPct' | 'ftPct';

const COLUMNS: { key: SortKey; label: string; title: string; pct?: boolean; int?: boolean }[] = [
  { key: 'g', label: 'G', title: 'Partite giocate', int: true },
  { key: 'min', label: 'Min', title: 'Minuti' },
  { key: 'pts', label: 'Pt', title: 'Punti' },
  { key: 'reb', label: 'Rim', title: 'Rimbalzi' },
  { key: 'ast', label: 'As', title: 'Assist' },
  { key: 'stl', label: 'Rub', title: 'Rubate' },
  { key: 'blk', label: 'Stp', title: 'Stoppate' },
  { key: 'tov', label: 'PP', title: 'Palle perse' },
  { key: 'fgPct', label: '%T', title: 'Percentuale al tiro', pct: true },
  { key: 'tpPct', label: '%3', title: 'Percentuale da 3', pct: true },
  { key: 'ftPct', label: '%TL', title: 'Percentuale ai liberi', pct: true },
];

const LIMIT = 100;

export function StatsPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [sort, setSort] = useState<SortKey>('pts');
  const [teamFilter, setTeamFilter] = useState<string>('all');
  const [minGames, setMinGames] = useState(true);
  const [search, setSearch] = useSearchParams();
  const wanted = Number(search.get('stagione')) || null;
  const { data, error, loading, reload } = useAsync(async () => {
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
  // Turno nuovo: le medie della stagione in corso cambiano
  useRoundChange(id, reload);

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
  const label = 'font-titolo text-xs font-semibold tracking-widest uppercase';

  return (
    <div className="space-y-4">
      <PageTitle
        sub={`Regular season${data.year !== null ? ` ${seasonLabel(data.year)}` : ''}, medie per partita.`}
      >
        Statistiche
      </PageTitle>
      <div className="flex flex-wrap items-end gap-3 text-sm">
        {data.seasons.length > 1 && data.year !== null && (
          <label className="flex flex-col gap-1">
            <span className={label}>Stagione</span>
            <select
              className={FIELD}
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
        <label className="flex min-w-0 flex-col gap-1">
          <span className={label}>Squadra</span>
          <select className={FIELD} value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)}>
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
          <label className="flex min-h-11 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-stampa-900 dark:accent-stampa-100"
              checked={minGames}
              onChange={(e) => setMinGames(e.target.checked)}
            />
            Solo chi ha giocato abbastanza
          </label>
        )}
      </div>

      {rows.length === 0 ? (
        <p className={NOTE}>Nessuna partita giocata.</p>
      ) : (
        <section aria-label="Statistiche dei giocatori" className="space-y-2">
          <div className="relative overflow-x-auto">
            <table className={`${TABLE} min-w-[46rem]`}>
              <thead>
                <tr className={HEAD_ROW}>
                  <th scope="col" className={`${STICKY} ${PAPER} pt-2 pr-2 pb-1 pl-1 text-left`}>
                    <span className="inline-block w-7">#</span>Giocatore
                  </th>
                  {COLUMNS.map((c) => (
                    <th
                      key={c.key}
                      scope="col"
                      aria-sort={sort === c.key ? 'descending' : undefined}
                      className="px-0.5 pt-1 pb-0 text-right"
                    >
                      <button
                        type="button"
                        title={c.title}
                        onClick={() => setSort(c.key)}
                        className={`min-h-11 min-w-11 px-1 tracking-wider uppercase ${
                          sort === c.key
                            ? 'font-bold text-rosso-700 dark:text-rosso-300'
                            : 'hover:text-stampa-900 dark:hover:text-stampa-50'
                        }`}
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
          <p className={NOTE}>
            {rows.length > LIMIT ? `I primi ${LIMIT} su ${rows.length}. ` : ''}Tocca una colonna per ordinare;
            evidenziati i giocatori della tua squadra.
          </p>
        </section>
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
    <tr className={`${rowRule('thin')} ${mine ? `${HIGHLIGHT} font-bold` : ''}`}>
      <th
        scope="row"
        className={`${STICKY} ${mine ? HIGHLIGHT : PAPER} py-1.5 pr-2 pl-1 text-left ${
          mine ? 'font-bold' : 'font-normal'
        }`}
      >
        <span className="flex max-w-[13rem] min-w-0 items-center gap-1.5 sm:max-w-72">
          <span className="w-6 shrink-0 font-titolo text-stampa-600 dark:text-stampa-300">{rank}</span>
          <b className="w-9 shrink-0 font-titolo font-semibold">{code ?? 'SV'}</b>
          <Link to={`/lega/${leagueId}/giocatore/${p.id}`} className={`truncate ${INK_LINK}`}>
            {p.name}
          </Link>
          {/* Su telefono il ruolo lascia spazio al nome: si vede nella scheda del giocatore */}
          <i className="hidden shrink-0 text-[0.8125rem] font-normal text-stampa-600 sm:inline dark:text-stampa-300">
            {p.role}
          </i>
        </span>
      </th>
      {COLUMNS.map((c) => {
        const v = p[c.key];
        const text = v === null ? '–' : c.pct ? (v * 100).toFixed(1) : c.int ? String(v) : v.toFixed(1);
        return (
          <td key={c.key} className={`px-1.5 py-1.5 text-right ${sort === c.key ? 'font-bold' : ''}`}>
            {text}
          </td>
        );
      })}
    </tr>
  );
}
