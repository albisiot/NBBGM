// Partita "dal vivo": la cronaca salvata rigiocata con punteggio e cronometro che scorrono, come un risultato di
// giornale (squadra, puntini, punteggio), con avvia e pausa, velocità, ricomincia e vai alla fine. Le regole del
// tempo stanno in lib/replay.ts. Qui anche le righe della cronaca, condivise con la vista Cronaca della partita.
import { useEffect, useRef, useState } from 'react';
import type { LeagueTeam } from '../lib/leagues.ts';
import { advanceReplay, gameLength, REPLAY_SPEEDS, replayFrame, type ReplaySpeed } from '../lib/replay.ts';
import { clock, periodLabel, type Play } from '../lib/results.ts';
import { livePartials, NOTE } from '../lib/tabellino.ts';
import { Button } from './ui.tsx';

/** Azioni mostrate sotto il tabellone, la più recente in cima. */
const FEED = 12;

export function LiveGame({
  plays,
  away,
  home,
  mine,
  onFinished,
}: {
  plays: Play[];
  away: LeagueTeam;
  home: LeagueTeam;
  mine: string | undefined;
  onFinished: () => void;
}) {
  const total = gameLength(plays);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(30);
  const finishedOnce = useRef(false);
  const frame = replayFrame(plays, t);

  // Il tempo scorre a scatti di un quarto di secondo, contando il tempo vero passato (anche se il telefono rallenta)
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    const timer = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      setT((x) => advanceReplay(x, dt, speed, total));
    }, 250);
    return () => clearInterval(timer);
  }, [playing, speed, total]);

  useEffect(() => {
    if (!frame.finished) return;
    setPlaying(false);
    if (!finishedOnce.current) {
      finishedOnce.current = true;
      onFinished();
    }
  }, [frame.finished, onFinished]);

  const feed = plays.slice(Math.max(0, frame.shown - FEED), frame.shown).reverse();
  const partials = livePartials(plays, frame.shown, frame.period, frame.finished);
  const lead = frame.away === frame.home ? null : frame.away > frame.home ? away.id : home.id;
  const action = playing ? 'Pausa' : frame.finished ? 'Rivedi' : t > 0 ? 'Riprendi' : 'Avvia';
  const status = frame.finished
    ? 'Finale'
    : t === 0
      ? 'Palla a due'
      : `${playing ? 'In diretta' : 'In pausa'} · ${periodLabel(frame.period)}, ${clock(frame.clock)}`;

  // "Boston ……… 87": il nome, i puntini e il punteggio; in rosso il punteggio di chi è avanti
  const scoreRow = (team: LeagueTeam, pts: number) => (
    <div className="flex items-baseline gap-2">
      <span
        className={`min-w-0 truncate font-titolo text-2xl leading-tight font-bold uppercase sm:text-[2.125rem] ${
          team.id === mine ? 'underline decoration-rosso-600 decoration-2 underline-offset-4' : ''
        }`}
      >
        {team.fullName}
      </span>
      <span
        aria-hidden="true"
        className="min-w-4 flex-1 border-b-2 border-dotted border-stampa-300 dark:border-stampa-600"
      />
      <span
        className={`font-titolo text-[2.75rem] leading-none font-bold tabular-nums ${
          lead === team.id ? 'text-rosso-700 dark:text-rosso-300' : ''
        }`}
      >
        {pts}
      </span>
    </div>
  );

  return (
    <section aria-label="Partita dal vivo" className="space-y-3">
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 font-titolo text-xs font-semibold tracking-[0.12em] text-rosso-700 uppercase tabular-nums dark:text-rosso-300">
          {playing && (
            <span aria-hidden="true" className="size-2 rounded-full bg-rosso-600 dark:bg-rosso-400" />
          )}
          {status}
        </p>
        {scoreRow(away, frame.away)}
        {scoreRow(home, frame.home)}
        {partials.length > 0 && (
          <p className={NOTE}>Parziali {partials.map(([a, h]) => `${a}–${h}`).join(', ')}</p>
        )}
      </div>
      <div
        className="h-1 bg-stampa-300 dark:bg-stampa-700"
        role="progressbar"
        aria-label="Avanzamento della partita"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((t / total) * 100)}
      >
        <div className="h-full bg-stampa-900 dark:bg-stampa-100" style={{ width: `${(t / total) * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2 border-y border-stampa-900 py-1.5 dark:border-stampa-100">
        {/* Il pulsante rosso: su telefono solo l'icona, il nome lo leggono i lettori di schermo */}
        <Button
          variant="accent"
          className="max-sm:w-11 max-sm:px-0"
          onClick={() => {
            if (frame.finished) setT(0);
            setPlaying((p) => !p);
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            {playing ? (
              <>
                <rect x="6" y="5" width="4" height="14" />
                <rect x="14" y="5" width="4" height="14" />
              </>
            ) : (
              <path d="M7 4.5v15l12.5-7.5z" />
            )}
          </svg>
          <span className="max-sm:sr-only">{action}</span>
        </Button>
        <div role="group" aria-label="Velocità" className="flex min-w-36 flex-1">
          {REPLAY_SPEEDS.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={speed === s}
              onClick={() => setSpeed(s)}
              className={`min-h-11 flex-1 border font-titolo text-base tabular-nums ${
                speed === s
                  ? 'border-stampa-900 bg-stampa-25 font-bold text-stampa-900 dark:border-stampa-100 dark:bg-stampa-800 dark:text-stampa-50'
                  : 'border-transparent font-medium text-stampa-700 hover:bg-stampa-100 dark:text-stampa-300 dark:hover:bg-stampa-800'
              }`}
            >
              ×{s}
            </button>
          ))}
        </div>
        <Button
          variant="ghost"
          className="px-2 disabled:opacity-50"
          disabled={frame.finished}
          onClick={() => {
            setPlaying(false);
            setT(total);
          }}
        >
          Vai alla fine
        </Button>
      </div>
      {/* Ai lettori di schermo si annuncia solo la fine, non ogni canestro */}
      <p role="status" className="sr-only">
        {frame.finished ? `Finale: ${away.code} ${frame.away}, ${home.code} ${frame.home}.` : ''}
      </p>
      {feed.length === 0 ? (
        <p className={NOTE}>Tocca Avvia: la partita riparte dalla palla a due.</p>
      ) : (
        <PlayList
          plays={feed}
          away={away}
          home={home}
          time={(p) => `${p[0] <= 4 ? `${p[0]}°` : `S${p[0] - 4}`} ${clock(p[1])}`}
          keyOf={(i) => frame.shown - i}
        />
      )}
    </section>
  );
}

/**
 * Righe della cronaca: il tempo a margine in rosso, la sigla di chi ha l'azione, il testo e il punteggio dopo
 * l'azione (prima la squadra in trasferta).
 */
export function PlayList({
  plays,
  away,
  home,
  time,
  keyOf = (i) => i,
}: {
  plays: readonly Play[];
  away: LeagueTeam;
  home: LeagueTeam;
  time: (p: Play) => string;
  keyOf?: (index: number) => number;
}) {
  return (
    <ol>
      {plays.map((p, i) => (
        <li
          key={keyOf(i)}
          className="flex gap-3 border-b border-stampa-300 py-2 text-sm leading-snug last:border-b-0 dark:border-stampa-700"
        >
          <span className="w-16 shrink-0 font-titolo text-[0.9375rem] font-semibold whitespace-nowrap text-rosso-700 tabular-nums dark:text-rosso-300">
            {time(p)}
          </span>
          <p className="min-w-0 flex-1">
            {p[2] && (
              <b className="mr-1.5 font-titolo font-semibold">{p[2] === 'h' ? home.code : away.code}</b>
            )}
            {p[3]}{' '}
            <span className="font-titolo text-[0.8125rem] font-semibold whitespace-nowrap tabular-nums">
              {p[5]}–{p[4]}
            </span>
          </p>
        </li>
      ))}
    </ol>
  );
}
