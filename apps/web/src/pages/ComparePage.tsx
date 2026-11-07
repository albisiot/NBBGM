// Confronto tra giocatori, nello stile Edicola: fino a 3 fianco a fianco in una tabella a filetti, con overall, stime
// (mai i valori nascosti), contratto, statistiche della stagione e abilità visibili; il migliore di ogni riga in
// grassetto d'inchiostro. Ci si arriva dalla scheda giocatore e dal mercato; l'elenco sta nell'indirizzo (?g=a,b,c).
import { overall, RATING_FIELDS } from '@nbbgm/engine';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { BOX, META, NOTE, RULE } from '../components/inkParts.tsx';
import { ErrorText, Kicker, Spinner, TeamCode, TextInput } from '../components/ui.tsx';
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
    <div className="space-y-5">
      <header>
        <Kicker>Giocatori</Kicker>
        <h1 className="text-3xl leading-tight font-bold">Confronto</h1>
        <p className="mt-1 text-sm text-stampa-600 italic dark:text-stampa-300">
          Fino a {COMPARE_MAX} giocatori fianco a fianco: in grassetto il migliore di ogni riga.
        </p>
      </header>
      {ids.length < COMPARE_MAX && (
        <AddPlayer leagueId={id} teams={teams} onAdd={(pid) => setIds(withPlayer(ids, pid))} />
      )}
      {loading && !data && <Spinner />}
      <ErrorText>{error}</ErrorText>
      {data && list.length === 0 && (
        <p className="text-sm">
          Cerca un giocatore qui sopra, oppure tocca “Confronta” nella scheda di un giocatore o tra gli
          svincolati del mercato.
        </p>
      )}
      {list.length > 0 && (
        // Su telefono la tabella scorre dentro il riquadro, con la colonna delle voci ferma a sinistra
        <div className={`relative overflow-x-auto ${BOX}`}>
          <table className="w-full min-w-[20rem] text-sm">
            <thead>
              <tr className="border-b-2 border-stampa-900 dark:border-stampa-100">
                <th className="sticky left-0 bg-stampa-25 p-2 text-left dark:bg-stampa-800">
                  <span className="sr-only">Voce</span>
                </th>
                {list.map((c) => (
                  <th key={c.player.id} className="min-w-[6.5rem] p-2 text-left align-top">
                    <Link
                      to={`/lega/${id}/giocatore/${c.player.id}`}
                      className="block font-serif text-[0.9375rem] leading-snug font-bold hover:underline"
                    >
                      {c.player.firstName} {c.player.lastName}
                    </Link>
                    <span className="mt-1 flex items-center gap-1">
                      <TeamCode code={teams.get(c.player.teamId ?? '')?.code ?? 'FA'} />
                      <button
                        type="button"
                        aria-label={`Togli ${c.player.firstName} ${c.player.lastName} dal confronto`}
                        onClick={() => setIds(ids.filter((x) => x !== c.player.id))}
                        className="inline-flex size-11 items-center justify-center text-stampa-600 hover:bg-stampa-100 dark:text-stampa-300 dark:hover:bg-stampa-700"
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
                    scope="rowgroup"
                    className="border-b border-stampa-900 px-2 pt-3 pb-1 text-left font-titolo text-xs font-semibold tracking-[0.12em] text-rosso-700 uppercase dark:border-stampa-100 dark:text-rosso-300"
                  >
                    {/* Il titolo resta a sinistra anche quando la tabella scorre */}
                    <span className="sticky left-2">{section.title}</span>
                  </th>
                </tr>
                {section.rows.map((line) => {
                  const best = bestOf(line);
                  return (
                    <tr key={line.label} className={`${RULE} last:border-b-0`}>
                      <th
                        scope="row"
                        className="sticky left-0 max-w-[9rem] bg-stampa-25 px-2 py-1 text-left text-[0.8125rem] font-normal text-stampa-600 dark:bg-stampa-800 dark:text-stampa-300"
                      >
                        {line.label}
                      </th>
                      {line.values.map((v, i) => (
                        <td
                          key={i}
                          className={`px-2 py-1 ${
                            best.has(i)
                              ? 'font-bold text-stampa-900 dark:text-stampa-50'
                              : 'text-stampa-700 dark:text-stampa-200'
                          }`}
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
        </div>
      )}
      {list.length > 0 && (
        <p className={NOTE}>
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
      <TextInput
        label="Aggiungi un giocatore al confronto"
        type="search"
        placeholder="Scrivi il nome o il cognome"
        value={text}
        onChange={(e) => setText(e.target.value)}
      />
      {found && (
        <ul className={BOX}>
          {found.length === 0 && <li className="px-3 py-2 text-sm">Nessun giocatore.</li>}
          {found.map((p) => (
            <li key={p.id} className={`${RULE} last:border-b-0`}>
              <button
                type="button"
                onClick={() => {
                  onAdd(p.id);
                  setText('');
                }}
                className="flex min-h-11 w-full items-center gap-2 px-3 text-left hover:bg-stampa-100 dark:hover:bg-stampa-700"
              >
                <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                <span className={META}>
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
