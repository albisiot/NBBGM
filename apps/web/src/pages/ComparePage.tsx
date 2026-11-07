// Confronto tra giocatori: fino a 3 fianco a fianco, con overall, stime (mai i valori nascosti), contratto,
// statistiche della stagione e abilità visibili, il valore migliore di ogni riga in evidenza. Ci si arriva dalla
// scheda giocatore e dal mercato; l'elenco sta nell'indirizzo (?g=a,b,c).
import { overall, RATING_FIELDS } from '@nbbgm/engine';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { Card, ErrorText, PageTitle, Spinner, TeamCode } from '../components/ui.tsx';
import {
  bestOf,
  COMPARE_MAX,
  loadCompared,
  parseCompare,
  rememberCompare,
  searchPlayers,
  withPlayer,
  type Compared,
  type CompareLine as Line,
  type FoundPlayer,
} from '../lib/compare.ts';
import { leagueDetail, type LeagueTeam } from '../lib/leagues.ts';
import { millions } from '../lib/market.ts';
import { contractSummary } from '../lib/teams.ts';
import { useAsync } from '../lib/useAsync.ts';

function perGame(c: Compared, k: string): number | null {
  const g = c.player.stats.g ?? 0;
  return g > 0 ? (c.player.stats[k] ?? 0) / g : null;
}

const one = (x: number | null) => (x === null ? '—' : x.toFixed(1).replace('.', ','));

function lines(list: readonly Compared[], teams: Map<string, LeagueTeam>): { title: string; rows: Line[] }[] {
  const row = (
    label: string,
    value: (c: Compared) => { text: string; score: number | null },
    higher: boolean | null = true,
  ): Line => ({
    label,
    values: list.map(value),
    higher,
  });
  const num = (x: number | null, text = one(x)) => ({ text, score: x });
  const txt = (text: string) => ({ text, score: null });
  const groups = [...new Set(RATING_FIELDS.map((f) => f.group))];
  return [
    {
      title: 'Scheda',
      rows: [
        row('Squadra', (c) => txt(teams.get(c.player.teamId ?? '')?.code ?? 'Svincolato'), null),
        row(
          'Ruolo',
          (c) => txt(`${c.player.role}${c.player.secondaryRole ? `/${c.player.secondaryRole}` : ''}`),
          null,
        ),
        row('Età', (c) => num(c.player.age, `${c.player.age}`), null),
        row('Altezza', (c) => num(c.player.heightCm, `${Math.round(c.player.heightCm)} cm`)),
        row('Overall', (c) => num(Math.round(overall(c.player)), `${Math.round(overall(c.player))}`)),
        row('Potenziale (stima)', (c) => num(c.scouting.potential, `${c.scouting.potential}`)),
        row('Costanza in attacco', (c) => txt(c.scouting.offensive_consistency ?? '—'), null),
        row('Costanza in difesa', (c) => txt(c.scouting.defensive_consistency ?? '—'), null),
        row('Etica del lavoro', (c) => txt(c.scouting.work_ethic ?? '—'), null),
        row(
          'A rischio',
          (c) => txt(c.scouting.risks.length ? c.scouting.risks.join(', ') : 'nessun distretto'),
          null,
        ),
        row('Contratto', (c) => txt(contractSummary(c.player, millions)), null),
      ],
    },
    {
      title: 'Stagione, a partita',
      rows: [
        row('Partite', (c) => num(c.player.stats.g ?? 0, `${c.player.stats.g ?? 0}`)),
        row('Minuti', (c) => {
          const s = perGame(c, 'seconds');
          return num(s === null ? null : s / 60);
        }),
        row('Punti', (c) => num(perGame(c, 'pts'))),
        row('Rimbalzi', (c) => {
          const o = perGame(c, 'orb');
          const d = perGame(c, 'drb');
          return num(o === null || d === null ? null : o + d);
        }),
        row('Assist', (c) => num(perGame(c, 'ast'))),
        row('Rubate', (c) => num(perGame(c, 'stl'))),
        row('Stoppate', (c) => num(perGame(c, 'blk'))),
        row('Palle perse', (c) => num(perGame(c, 'tov')), false),
      ],
    },
    ...groups.map((group) => ({
      title: group,
      rows: RATING_FIELDS.filter((f) => f.group === group).map((f) =>
        row(f.label, (c) => num(c.player.ratings[f.key], `${Math.round(c.player.ratings[f.key])}`)),
      ),
    })),
  ];
}

export function ComparePage() {
  const { id = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const ids = parseCompare(search.get('g'));
  const key = ids.join(',');
  // Il confronto aperto si ricorda per la sessione: "Confronta" da un'altra scheda aggiunge a questo
  useEffect(() => rememberCompare(id, key ? key.split(',') : []), [id, key]);
  const { data, error, loading } = useAsync(
    async () => {
      const [league, compared] = await Promise.all([
        leagueDetail(id),
        loadCompared(key ? key.split(',') : []),
      ]);
      return { league, compared };
    },
    [id, key],
    { keep: true },
  );
  const setIds = (next: string[]) => setSearch(next.length ? { g: next.join(',') } : {}, { replace: true });

  const teams = new Map((data?.league?.teams ?? []).map((t) => [t.id, t]));
  const list = data?.compared ?? [];
  return (
    <div className="space-y-4">
      <PageTitle
        sub={`Fino a ${COMPARE_MAX} giocatori fianco a fianco: in evidenza il migliore di ogni riga.`}
      >
        Confronto
      </PageTitle>
      {ids.length < COMPARE_MAX && (
        <AddPlayer leagueId={id} teams={teams} onAdd={(pid) => setIds(withPlayer(ids, pid))} />
      )}
      {loading && !data && <Spinner />}
      <ErrorText>{error}</ErrorText>
      {data && list.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Cerca un giocatore qui sopra, oppure tocca “Confronta” nella scheda di un giocatore o tra gli
          svincolati del mercato.
        </p>
      )}
      {list.length > 0 && (
        <Card className="overflow-x-auto !p-0">
          <table className="w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700">
                <th className="sticky left-0 bg-white p-2 text-left text-xs font-medium text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  <span className="sr-only">Voce</span>
                </th>
                {list.map((c) => (
                  <th key={c.player.id} className="min-w-[6.5rem] p-2 text-left align-top">
                    <Link
                      to={`/lega/${id}/giocatore/${c.player.id}`}
                      className="block font-semibold hover:underline"
                    >
                      {c.player.firstName} {c.player.lastName}
                    </Link>
                    <span className="mt-1 flex items-center gap-1">
                      <TeamCode code={teams.get(c.player.teamId ?? '')?.code ?? 'FA'} />
                      <button
                        type="button"
                        aria-label={`Togli ${c.player.firstName} ${c.player.lastName} dal confronto`}
                        onClick={() => setIds(ids.filter((x) => x !== c.player.id))}
                        className="inline-flex size-11 items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-700"
                      >
                        ✕
                      </button>
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            {lines(list, teams).map((section) => (
              <tbody key={section.title}>
                <tr>
                  <th
                    colSpan={list.length + 1}
                    className="bg-slate-50 px-2 py-1 text-left text-xs font-semibold tracking-wide text-slate-500 uppercase dark:bg-slate-900 dark:text-slate-400"
                  >
                    {section.title}
                  </th>
                </tr>
                {section.rows.map((line) => {
                  const best = bestOf(line);
                  return (
                    <tr key={line.label} className="border-b border-slate-100 dark:border-slate-700/60">
                      <th
                        scope="row"
                        className="sticky left-0 max-w-[9rem] bg-white px-2 py-1 text-left text-xs font-normal text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                      >
                        {line.label}
                      </th>
                      {line.values.map((v, i) => (
                        <td
                          key={i}
                          className={`px-2 py-1 ${best.has(i) ? 'font-semibold text-green-700 dark:text-green-300' : ''}`}
                        >
                          {v.text}
                          {best.has(i) && <span className="sr-only"> (il migliore)</span>}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            ))}
          </table>
        </Card>
      )}
      {list.length > 0 && (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Potenziale, costanza, etica del lavoro e rischi sono stime: più precise per i giocatori della tua
          squadra, i valori veri restano nascosti.
        </p>
      )}
    </div>
  );
}

function AddPlayer({
  leagueId,
  teams,
  onAdd,
}: {
  leagueId: string;
  teams: Map<string, LeagueTeam>;
  onAdd: (pid: string) => void;
}) {
  const [text, setText] = useState('');
  const [found, setFound] = useState<FoundPlayer[] | null>(null);
  // Si cerca dopo una breve pausa nella scrittura, non a ogni lettera
  useEffect(() => {
    if (text.trim().length < 2) {
      setFound(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      searchPlayers(leagueId, text)
        .then((r) => alive && setFound(r))
        .catch(() => alive && setFound([]));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [leagueId, text]);
  return (
    <div className="space-y-1">
      <input
        type="search"
        aria-label="Aggiungi un giocatore al confronto"
        placeholder="Aggiungi un giocatore: scrivi il nome"
        className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base sm:text-sm dark:border-slate-600 dark:bg-slate-800"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {found && (
        <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white text-sm dark:divide-slate-700 dark:border-slate-700 dark:bg-slate-800">
          {found.length === 0 && (
            <li className="px-3 py-2 text-slate-500 dark:text-slate-400">Nessun giocatore.</li>
          )}
          {found.map((p) => (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => {
                  onAdd(p.id);
                  setText('');
                }}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                <span className="min-w-0 flex-1 truncate">{p.name}</span>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {p.role} · {p.teamId ? (teams.get(p.teamId)?.code ?? '?') : 'svincolato'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
