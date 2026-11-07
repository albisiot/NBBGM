// Partita "dal vivo": la cronaca salvata rigiocata con punteggio e cronometro che scorrono, con avvia e pausa,
// velocità, ricomincia e vai alla fine. Le regole del tempo stanno in lib/replay.ts.
import { useEffect, useRef, useState } from 'react';
import type { LeagueTeam } from '../lib/leagues.ts';
import { advanceReplay, gameLength, REPLAY_SPEEDS, replayFrame, type ReplaySpeed } from '../lib/replay.ts';
import { clock, periodLabel, type Play } from '../lib/results.ts';
import { Button, Card, Segmented, TeamCode } from './ui.tsx';

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
  const score = (team: LeagueTeam, pts: number, lead: boolean) => (
    <div className="flex flex-col items-center gap-1">
      <TeamCode code={team.code} strong={team.id === mine} />
      <span className={`font-mono text-4xl tabular-nums ${lead ? 'font-bold' : ''}`}>{pts}</span>
    </div>
  );

  return (
    <Card className="space-y-4 !p-4">
      <div className="grid grid-cols-3 items-center gap-2">
        {score(away, frame.away, frame.away > frame.home)}
        <div className="text-center">
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {frame.finished ? 'Finale' : periodLabel(frame.period)}
          </p>
          <p className="font-mono text-2xl tabular-nums">{clock(frame.clock)}</p>
        </div>
        {score(home, frame.home, frame.home > frame.away)}
      </div>
      <div
        className="h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700"
        role="progressbar"
        aria-label="Avanzamento della partita"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((t / total) * 100)}
      >
        <div className="h-full bg-orange-500" style={{ width: `${(t / total) * 100}%` }} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={() => {
            if (frame.finished) setT(0);
            setPlaying((p) => !p);
          }}
        >
          {playing ? 'Pausa' : frame.finished ? 'Rivedi' : t > 0 ? 'Riprendi' : 'Avvia'}
        </Button>
        <Button
          variant="secondary"
          disabled={frame.finished}
          onClick={() => {
            setPlaying(false);
            setT(total);
          }}
        >
          Vai alla fine
        </Button>
        <Segmented
          label="Velocità"
          value={speed}
          onChange={setSpeed}
          options={REPLAY_SPEEDS.map((s) => ({ label: `×${s}`, value: s }))}
        />
      </div>
      {/* Ai lettori di schermo si annuncia solo la fine, non ogni canestro */}
      <p role="status" className="sr-only">
        {frame.finished ? `Finale: ${away.code} ${frame.away}, ${home.code} ${frame.home}.` : ''}
      </p>
      <ol className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
        {feed.length === 0 && (
          <li className="py-1.5 text-slate-500 dark:text-slate-400">
            Tocca Avvia: la partita riparte dalla palla a due.
          </li>
        )}
        {feed.map((p, i) => (
          <li key={frame.shown - i} className="flex items-start gap-2 py-1.5">
            <span className="w-14 shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
              {p[0] <= 4 ? `${p[0]}q` : `S${p[0] - 4}`} {clock(p[1])}
            </span>
            <span className="w-11 shrink-0">
              {p[2] && <TeamCode code={p[2] === 'h' ? home.code : away.code} />}
            </span>
            <span className="min-w-0 flex-1">{p[3]}</span>
            <span className="shrink-0 font-mono text-xs text-slate-600 dark:text-slate-300">
              {p[5]}-{p[4]}
            </span>
          </li>
        ))}
      </ol>
    </Card>
  );
}
