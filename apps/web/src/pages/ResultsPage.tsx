// Risultati di un turno come una colonna di giornale: una riga per partita con il punteggio (o da giocare), il
// vincitore in grassetto e il link a box score e cronaca; la partita della propria squadra in cima, evidenziata.
// Si passa da un turno all'altro con le frecce; di default si apre l'ultimo turno giocato. Senza spoiler i
// punteggi restano nascosti e ogni partita si apre dal vivo (l'opzione si ricorda sul dispositivo). Titolo e
// schede di Campionato stanno in ChampionshipLayout.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { ErrorText, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { readSpoilerFree, writeSpoilerFree } from '../lib/replay.ts';
import { roundLabel, type SeasonGame, type Series } from '../lib/results.ts';
import { NOTE, overtimeShort, winnerSide } from '../lib/tabellino.ts';
import { useSeason } from '../lib/useSeason.ts';

export function ResultsPage() {
  const { id = '', round } = useParams();
  const userId = useUserId();
  const { data, error, loading } = useSeason(id);
  const [spoilerFree, setSpoilerFree] = useState(readSpoilerFree);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, games, series } = data;
  const mine = league.teams.find((t) => t.ownerId === userId)?.id ?? null;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const code = (tid: string) => team.get(tid)?.code ?? '?';

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
  const label = roundLabel(selected, kind);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <div className="flex items-center">
          <RoundLink id={id} round={rounds[index - 1]} label="Turno precedente" arrow="‹" />
          <p className="text-center">
            <span className="font-titolo text-lg font-semibold tracking-wider uppercase">{label}</span>
            {kind !== 'regular' && (
              <span className={`block ${NOTE}`}>turno {selected - 81} della post-season</span>
            )}
          </p>
          <RoundLink id={id} round={rounds[index + 1]} label="Turno successivo" arrow="›" />
        </div>
        <SpoilerSwitch
          on={spoilerFree}
          onChange={(v) => {
            setSpoilerFree(v);
            writeSpoilerFree(v);
          }}
        />
      </div>
      {spoilerFree && <p className={NOTE}>Punteggi nascosti: ogni partita si guarda dal vivo.</p>}

      <section
        aria-label={`Partite: ${label}`}
        className="border-t-2 border-stampa-900 md:grid md:grid-cols-2 md:gap-x-8 dark:border-stampa-100"
      >
        {list.map((g) => {
          const hide = spoilerFree && g.homeScore !== null;
          const own = isMine(g, mine);
          // Nei playoff la situazione della serie (il play-in lo dice già il titolo del turno)
          const sub = g.kind === 'playoffs' && g.seriesId ? seriesText(g, games, series, code, hide) : null;
          const body = (
            <>
              <span className="min-w-0 flex-1">
                <ScoreLine game={g} code={code} hide={hide} size={own ? 'text-xl' : 'text-lg'} />
                {sub && <span className={`block ${NOTE}`}>{sub}</span>}
              </span>
              <span
                className={`shrink-0 text-[0.8125rem] font-semibold italic ${
                  own ? 'text-rosso-700 dark:text-rosso-300' : 'text-stampa-600 dark:text-stampa-300'
                }`}
              >
                {g.homeScore === null
                  ? own
                    ? 'la tua · da giocare'
                    : 'da giocare'
                  : `${own ? 'la tua · ' : ''}${hide ? 'guarda dal vivo' : 'box score'} ›`}
              </span>
            </>
          );
          const row = `flex min-h-12 items-center gap-2 border-b px-2 py-1 ${
            own
              ? 'border-stampa-900 bg-stampa-25 dark:border-stampa-100 dark:bg-stampa-800'
              : 'border-stampa-200 dark:border-stampa-700'
          }`;
          return g.homeScore === null ? (
            <div key={g.id} className={row}>
              {body}
            </div>
          ) : (
            <Link
              key={g.id}
              to={`/lega/${id}/partita/${g.id}${hide ? '?vista=dal-vivo' : ''}`}
              className={`${row} text-stampa-900 hover:bg-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-800`}
            >
              {body}
            </Link>
          );
        })}
      </section>
      {list.length === 0 ? (
        <p className={NOTE}>Nessuna partita in questo turno.</p>
      ) : (
        <p className={NOTE}>
          Prima la squadra in trasferta, poi quella di casa.{' '}
          {played.length ? `${played.length} partite giocate in stagione.` : 'Nessuna partita giocata.'}
        </p>
      )}
    </div>
  );
}

/**
 * "MIA 104 – 112 BOS" in Oswald, con il vincitore in grassetto e lo sconfitto in grigio; senza spoiler i punteggi
 * sono quadratini d'inchiostro, da giocare solo le sigle.
 */
export function ScoreLine({
  game,
  code,
  hide = false,
  size = 'text-lg',
}: {
  game: Pick<SeasonGame, 'awayTeamId' | 'homeTeamId' | 'awayScore' | 'homeScore' | 'overtimes'>;
  code: (teamId: string) => string;
  hide?: boolean;
  /** Corpo del testo (classe di Tailwind): più grande per la propria partita e nel titolo della partita. */
  size?: string;
}) {
  const won = hide ? null : winnerSide(game.awayScore, game.homeScore);
  const side = (s: 'away' | 'home') =>
    won === null
      ? 'font-semibold'
      : won === s
        ? 'font-bold'
        : 'font-normal text-stampa-600 dark:text-stampa-300';
  const score = (n: number | null) => (hide ? <HiddenScore /> : n);
  const ot = hide ? '' : overtimeShort(game.overtimes);
  return (
    <span className={`flex flex-wrap items-center gap-x-1.5 font-titolo tabular-nums ${size}`}>
      <span className={`inline-flex items-center gap-1.5 ${side('away')}`}>
        {code(game.awayTeamId)} {game.homeScore !== null && score(game.awayScore)}
      </span>
      <span>–</span>
      <span className={`inline-flex items-center gap-1.5 ${side('home')}`}>
        {game.homeScore !== null && score(game.homeScore)} {code(game.homeTeamId)}
      </span>
      {ot && (
        <abbr title={overtimeText(game.overtimes ?? 1)} className={`font-serif no-underline ${NOTE}`}>
          {ot}
        </abbr>
      )}
    </span>
  );
}

/** Punteggio nascosto (senza spoiler): tre quadratini d'inchiostro, letti come "punteggio nascosto". */
export function HiddenScore() {
  return (
    <span role="img" aria-label="punteggio nascosto" className="inline-flex gap-[3px] align-middle">
      {[0, 1, 2].map((i) => (
        <span key={i} className="h-[1.1em] w-[0.7em] bg-stampa-900 dark:bg-stampa-100" />
      ))}
    </span>
  );
}

/** Interruttore Senza spoiler: un vero interruttore (role switch) con la levetta d'inchiostro. */
function SpoilerSwitch({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="flex min-h-11 items-center gap-2 font-serif text-sm font-semibold text-stampa-900 italic dark:text-stampa-50"
    >
      Senza spoiler
      <span
        aria-hidden="true"
        className={`flex h-[22px] w-10 border border-stampa-900 p-0.5 dark:border-stampa-100 ${on ? 'justify-end' : ''}`}
      >
        <span
          className={`size-4 ${on ? 'bg-rosso-600 dark:bg-rosso-500' : 'bg-stampa-900 dark:bg-stampa-100'}`}
        />
      </span>
    </button>
  );
}

function isMine(g: SeasonGame, mine: string | null): boolean {
  return mine !== null && (g.homeTeamId === mine || g.awayTeamId === mine);
}

export function overtimeText(n: number): string {
  return n === 1 ? 'Finale dopo un supplementare' : `Finale dopo ${n} supplementari`;
}

/** "Gara 3 · BOS conduce 2-1" (situazione della serie dopo questa partita); senza spoiler solo "Gara 3". */
export function seriesText(
  game: SeasonGame,
  games: readonly SeasonGame[],
  series: readonly Series[],
  code: (teamId: string) => string,
  hideResult = false,
): string {
  const s = series.find((x) => x.id === game.seriesId);
  if (!s) return 'Playoff';
  const upTo = games.filter(
    (g) => g.seriesId === s.id && g.roundNumber <= game.roundNumber && g.homeScore !== null,
  );
  const n = games.filter((g) => g.seriesId === s.id && g.roundNumber <= game.roundNumber).length;
  if (game.homeScore === null || hideResult) return `Gara ${n}`;
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

/** Freccia per il turno prima o dopo; senza turno resta un segnaposto chiaro, così la giornata non si sposta. */
function RoundLink({
  id,
  round,
  label,
  arrow,
}: {
  id: string;
  round: number | undefined;
  label: string;
  arrow: string;
}) {
  const box = 'inline-flex size-11 shrink-0 items-center justify-center font-titolo text-2xl';
  if (round === undefined)
    return (
      <span aria-hidden="true" className={`${box} text-stampa-300 dark:text-stampa-600`}>
        {arrow}
      </span>
    );
  return (
    <Link
      to={`/lega/${id}/risultati/${round}`}
      aria-label={label}
      className={`${box} text-stampa-900 hover:bg-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-800`}
    >
      {arrow}
    </Link>
  );
}
