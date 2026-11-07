// Una partita come sul giornale: risultato con i parziali, poi il box score come un tabellino (titolari,
// panchina, totale), la cronaca azione per azione con il tempo a margine e la partita "dal vivo" (la cronaca
// rigiocata con punteggio e cronometro che scorrono). La cronaca si scarica solo quando si apre una delle due viste
// che la usano. Con i Risultati senza spoiler, dal vivo il punteggio finale resta nascosto finché la partita non
// finisce (o si apre il box score).
import { useCallback, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { LiveGame, PlayList } from '../components/LiveGame.tsx';
import { ErrorText, Kicker, Segmented, SectionTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { leagueDetail, type LeagueTeam } from '../lib/leagues.ts';
import { readSpoilerFree } from '../lib/replay.ts';
import {
  clock,
  gameDetail,
  gamePlays,
  periodLabel,
  roundLabel,
  type BoxLine,
  type Play,
} from '../lib/results.ts';
import {
  boxTotals,
  HEAD_ROW,
  INK_LINK,
  NOTE,
  PAPER,
  partialsText,
  rowRule,
  shotLine,
  STICKY,
  TABLE,
  teamHighs,
} from '../lib/tabellino.ts';
import { useAsync } from '../lib/useAsync.ts';
import { HiddenScore, overtimeText, ScoreLine } from './ResultsPage.tsx';

type View = 'box' | 'cronaca' | 'dal-vivo';
const VIEWS: readonly View[] = ['box', 'cronaca', 'dal-vivo'];
const VIEW_LABEL: Record<View, string> = { box: 'Box score', cronaca: 'Cronaca', 'dal-vivo': 'Dal vivo' };

export function GamePage() {
  const { id = '', gid = '' } = useParams();
  const userId = useUserId();
  const [search] = useSearchParams();
  const asked = search.get('vista') as View | null;
  const view: View = asked && VIEWS.includes(asked) ? asked : 'box';
  const { data, error, loading } = useAsync(async () => {
    const [league, game] = await Promise.all([leagueDetail(id), gameDetail(gid)]);
    return { league, game };
  }, [id, gid]);
  // La cronaca (circa 20 KB) solo quando serve, poi resta per la partita
  const [wantPlays, setWantPlays] = useState(view !== 'box');
  useEffect(() => {
    if (view !== 'box') setWantPlays(true);
  }, [view]);
  const plays = useAsync(() => (wantPlays ? gamePlays(gid) : Promise.resolve(undefined)), [gid, wantPlays]);
  // Senza spoiler: il punteggio finale si vede solo a fine replay o aprendo box score e cronaca
  const [spoilerFree] = useState(readSpoilerFree);
  // Rivelato per quella partita: passando a un'altra (la pagina resta montata) si riparte nascosti
  const [revealedFor, setRevealedFor] = useState<string | null>(null);
  const reveal = useCallback(() => setRevealedFor(gid), [gid]);
  useEffect(() => {
    if (view !== 'dal-vivo') setRevealedFor(gid);
  }, [view, gid]);
  const hidden = spoilerFree && view === 'dal-vivo' && revealedFor !== gid;
  // Squadra del box score su telefono (sul computer si vedono tutte e due)
  const [boxTeam, setBoxTeam] = useState<string | null>(null);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data?.league || !data.game) return <ErrorText>Partita non trovata.</ErrorText>;
  const { league, game } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const home = team.get(game.homeTeamId);
  const away = team.get(game.awayTeamId);
  const mine = league.teams.find((t) => t.ownerId === userId)?.id;
  const back = (
    <Link
      to={`/lega/${league.id}/risultati/${game.roundNumber}`}
      className="inline-flex min-h-11 items-center text-sm font-semibold text-rosso-700 italic hover:underline dark:text-rosso-300"
    >
      ‹ Risultati
    </Link>
  );
  if (game.homeScore === null || !home || !away)
    return (
      <div className="space-y-3">
        {back}
        <header>
          <Kicker>{roundLabel(game.roundNumber, game.kind)} · da giocare</Kicker>
          <h1 className="text-3xl leading-tight font-bold">
            {away?.fullName} – {home?.fullName}
          </h1>
        </header>
        <p className={NOTE}>La partita non è ancora stata giocata.</p>
      </div>
    );

  const code = (tid: string) => team.get(tid)?.code ?? '?';
  const shownTeam = boxTeam ?? (mine === home.id ? home.id : away.id);
  const partials = partialsText(game.quarters);

  return (
    <div className="space-y-3">
      {back}
      <header>
        <Kicker>
          {hidden
            ? roundLabel(game.roundNumber, game.kind)
            : `${game.overtimes ? overtimeText(game.overtimes) : 'Finale'} · ${roundLabel(game.roundNumber, game.kind)}`}
        </Kicker>
        <h1 className="text-[2rem] leading-tight font-bold">
          {hidden ? (
            <span className="flex flex-wrap items-center gap-x-2 font-titolo tabular-nums">
              {away.code} <HiddenScore /> – <HiddenScore /> {home.code}
            </span>
          ) : (
            <ScoreLine game={{ ...game, overtimes: 0 }} code={code} size="text-[2rem]" />
          )}
        </h1>
        {!hidden && partials && <p className={NOTE}>Parziali {partials}</p>}
      </header>

      <nav aria-label="Vista della partita" className="border-b border-stampa-900 dark:border-stampa-100">
        <ul className="flex flex-wrap gap-x-5">
          {VIEWS.map((v) => (
            <li key={v}>
              <Link
                to={{ search: v === 'box' ? '' : `?vista=${v}` }}
                replace
                aria-current={view === v ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center border-b-[3px] font-titolo text-sm tracking-wider whitespace-nowrap uppercase ${
                  view === v
                    ? 'border-stampa-900 font-semibold text-stampa-900 dark:border-stampa-50 dark:text-stampa-50'
                    : 'border-transparent font-medium text-stampa-700 hover:text-stampa-900 dark:text-stampa-300 dark:hover:text-stampa-50'
                }`}
              >
                {VIEW_LABEL[v]}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {view === 'box' && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2 md:hidden">
            <Segmented
              label="Squadra"
              value={shownTeam}
              onChange={setBoxTeam}
              options={[away, home].map((t) => ({ label: t.code, value: t.id }))}
            />
            <span className={NOTE}>scorri → per le altre colonne</span>
          </div>
          {[away, home].map((t) => (
            <section
              key={t.id}
              aria-label={`Tabellino di ${t.fullName}`}
              className={`space-y-2 md:block ${t.id === shownTeam ? '' : 'hidden'}`}
            >
              <div className="hidden md:block">
                <SectionTitle
                  aside={t.id === mine ? 'la tua squadra' : t.id === home.id ? 'in casa' : 'in trasferta'}
                >
                  <Link to={`/lega/${league.id}/squadre/${t.code}`} className={INK_LINK}>
                    {t.fullName}
                  </Link>
                </SectionTitle>
              </div>
              <BoxTable leagueId={league.id} lines={game.box.filter((l) => l.teamId === t.id)} />
            </section>
          ))}
          <p className={NOTE}>
            Tiri, da 3 e liberi: segnati/tentati. In grassetto il migliore della squadra in punti, rimbalzi e
            assist.
          </p>
        </>
      )}
      {view !== 'box' && plays.loading && !plays.data && <Spinner label="Carico la cronaca…" />}
      {view !== 'box' && <ErrorText>{plays.error}</ErrorText>}
      {view !== 'box' && plays.data === null && <NoPlays />}
      {view === 'cronaca' && plays.data && <Plays plays={plays.data} away={away} home={home} />}
      {view === 'dal-vivo' && plays.data && (
        <LiveGame key={gid} plays={plays.data} away={away} home={home} mine={mine} onFinished={reveal} />
      )}
    </div>
  );
}

function NoPlays() {
  return (
    <p className="border border-dashed border-stampa-600 px-3 py-2 text-sm dark:border-stampa-400">
      Cronaca non disponibile: si conserva solo per la stagione in corso, quindi questa partita non si può
      rivedere dal vivo. <i>Punteggio, parziali e box score restano.</i>
    </p>
  );
}

const COLUMNS = ['Min', 'Pt', 'Rim', 'As', 'Rub', 'Stp', 'PP', 'Tiri', 'Da 3', 'TL', 'F', '+/-'] as const;
const COLUMN_TITLE: Partial<Record<(typeof COLUMNS)[number], string>> = {
  Min: 'Minuti',
  Pt: 'Punti',
  Rim: 'Rimbalzi',
  As: 'Assist',
  Rub: 'Rubate',
  Stp: 'Stoppate',
  PP: 'Palle perse',
  TL: 'Tiri liberi',
  F: 'Falli',
  '+/-': 'Più/meno',
};

/** Tabellino di una squadra: titolari, panchina e totale, con la colonna del nome fissa su telefono. */
function BoxTable({ leagueId, lines }: { leagueId: string; lines: BoxLine[] }) {
  const total = boxTotals(lines);
  const high = teamHighs(lines);
  const starters = lines.filter((l) => l.starter);
  const bench = lines.filter((l) => !l.starter);
  const td = 'px-1.5 py-1.5 text-right';
  const best = (v: number, max: number) => (max > 0 && v === max ? 'font-bold' : '');
  const row = (l: BoxLine, i: number, group: BoxLine[]) => (
    <tr
      key={l.playerId}
      className={`${rowRule(i === group.length - 1 ? 'solid' : 'thin')} ${
        l.seconds === 0 ? 'text-stampa-600 dark:text-stampa-400' : ''
      }`}
    >
      <th scope="row" className={`${STICKY} ${PAPER} py-1.5 pr-2 pl-1 text-left`}>
        <span className="flex max-w-[10rem] min-w-0 items-baseline gap-1 sm:max-w-56">
          <Link
            to={`/lega/${leagueId}/giocatore/${l.playerId}`}
            className={`truncate ${l.starter ? 'font-bold' : 'font-normal'} ${INK_LINK}`}
          >
            {l.name}
          </Link>
          <i className="shrink-0 text-[0.8125rem] font-normal text-stampa-600 dark:text-stampa-300">
            {l.role}
          </i>
        </span>
      </th>
      {l.seconds === 0 ? (
        <td colSpan={COLUMNS.length} className="px-1.5 py-1.5 text-[0.8125rem] italic">
          non entrato
        </td>
      ) : (
        <>
          <td className={td}>{Math.round(l.seconds / 60)}</td>
          <td className={`${td} ${best(l.pts, high.pts)}`}>{l.pts}</td>
          <td className={`${td} ${best(l.orb + l.drb, high.reb)}`}>{l.orb + l.drb}</td>
          <td className={`${td} ${best(l.ast, high.ast)}`}>{l.ast}</td>
          <td className={td}>{l.stl}</td>
          <td className={td}>{l.blk}</td>
          <td className={td}>{l.tov}</td>
          <td className={td}>{shotLine(l.fgm, l.fga)}</td>
          <td className={td}>{shotLine(l.tpm, l.tpa)}</td>
          <td className={td}>{shotLine(l.ftm, l.fta)}</td>
          <td className={td}>{l.pf}</td>
          <td className={td}>{l.plusMinus > 0 ? `+${l.plusMinus}` : l.plusMinus}</td>
        </>
      )}
    </tr>
  );
  const groupHead = (label: string, cols: boolean) => (
    <tr className={HEAD_ROW}>
      <th scope="col" className={`${STICKY} ${PAPER} pt-2 pr-2 pb-1 pl-1 text-left`}>
        {label}
      </th>
      {COLUMNS.map((c) => (
        <th key={c} scope="col" title={COLUMN_TITLE[c]} className="px-1.5 pt-2 pb-1 text-right">
          {cols ? c : <span className="sr-only">{c}</span>}
        </th>
      ))}
    </tr>
  );
  return (
    <div className="relative overflow-x-auto">
      <table className={`${TABLE} min-w-[42rem]`}>
        <thead>{groupHead('Titolari', true)}</thead>
        <tbody>{starters.map((l, i) => row(l, i, starters))}</tbody>
        {bench.length > 0 && (
          <tbody>
            {groupHead('Panchina', false)}
            {bench.map((l, i) => row(l, i, bench))}
          </tbody>
        )}
        <tfoot>
          <tr className="font-bold">
            <th
              scope="row"
              className={`${STICKY} ${PAPER} py-1.5 pr-2 pl-1 text-left font-titolo tracking-wider uppercase`}
            >
              Totale
            </th>
            <td className={td}>{total.minutes}</td>
            <td className={td}>{total.pts}</td>
            <td className={td}>{total.reb}</td>
            <td className={td}>{total.ast}</td>
            <td className={td}>{total.stl}</td>
            <td className={td}>{total.blk}</td>
            <td className={td}>{total.tov}</td>
            <td className={td}>{shotLine(total.fgm, total.fga)}</td>
            <td className={td}>{shotLine(total.tpm, total.tpa)}</td>
            <td className={td}>{shotLine(total.ftm, total.fta)}</td>
            <td className={td}>{total.pf}</td>
            <td className={td} />
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/** Cronaca di un periodo: il tempo a margine in rosso, la sigla di chi ha l'azione e il punteggio in fondo. */
function Plays({ plays, away, home }: { plays: Play[]; away: LeagueTeam; home: LeagueTeam }) {
  const periods = [...new Set(plays.map((p) => p[0]))].sort((a, b) => a - b);
  const [period, setPeriod] = useState(periods[0] ?? 1);
  return (
    <section className="space-y-3">
      <Segmented
        label="Periodo"
        value={period}
        onChange={setPeriod}
        options={periods.map((p) => ({ label: p <= 4 ? `${p}° q` : `S${p - 4}`, value: p }))}
      />
      <SectionTitle aside={`punteggio ${away.code}–${home.code}`}>{periodLabel(period)}</SectionTitle>
      <PlayList
        plays={plays.filter((p) => p[0] === period)}
        away={away}
        home={home}
        time={(p) => clock(p[1])}
      />
    </section>
  );
}
