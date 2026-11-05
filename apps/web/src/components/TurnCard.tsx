// Turno corrente nella pagina della lega: stato, scadenza, chi è pronto (in tempo reale), il proprio Pronto,
// gli avvisi della propria squadra e, per il commissario, forza l'avanzamento e pausa.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import type { LeagueDetail } from '../lib/leagues.ts';
import { STAGE_LABEL } from '../lib/market.ts';
import {
  alertText,
  answerAlert,
  forceRound,
  readiness,
  setPaused,
  setReady,
  subscribeTurn,
  timeLeft,
  turnStatus,
  type AlertItem,
  type Readiness,
} from '../lib/turns.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Button, Card, ErrorText } from './ui.tsx';

const BADGE: Record<Readiness, { label: string; className: string }> = {
  ready: { label: 'Pronto', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' },
  coach: { label: 'Allenatore', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100' },
  waiting: {
    label: 'In attesa',
    className: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
  },
  out: { label: 'Non gioca', className: 'bg-slate-50 text-slate-400 dark:bg-slate-800 dark:text-slate-500' },
};

const LINK = 'font-semibold text-orange-700 hover:underline dark:text-orange-300';

// Dove si decide quello che chiede l'avviso
const ALERT_LINK: Record<string, { to: string; label: string }> = {
  trade_offer: { to: 'mercato?tab=scambi', label: 'Vai agli scambi' },
  draft_pick: { to: 'draft-annuale', label: 'Vai al draft' },
  renewals: { to: 'mercato?tab=rinnovi', label: 'Vai ai rinnovi' },
  free_agency: { to: 'mercato?tab=svincolati', label: 'Vai agli svincolati' },
  preparation: { to: 'squadra', label: 'Vai alla squadra' },
};

const STAGE_HINT: Record<string, string> = {
  draft: 'Ordina i tuoi preferiti nella pagina del draft: alla chiusura del turno si fanno le 60 scelte.',
  renewals: 'Decidi chi rinnovare tra i giocatori in scadenza: gli altri diventano svincolati.',
  fa1: 'Free agency: offerte a busta chiusa agli svincolati.',
  fa2: 'Free agency: le richieste degli svincolati sono scese.',
  fa3: 'Free agency: le richieste degli svincolati sono scese ancora.',
  fa4: 'Ultimo turno di free agency.',
  preparation: 'Sistema rosa, quintetto e tattiche: poi riparte la regular season.',
};

export function TurnCard({
  league,
  userId,
  onRoundChange,
}: {
  league: LeagueDetail;
  userId: string;
  onRoundChange: () => void;
}) {
  const mine = league.teams.find((t) => t.ownerId === userId) ?? null;
  const isCommissioner = league.commissionerId === userId;
  const {
    data: status,
    error,
    reload,
  } = useAsync(() => turnStatus(league.id, mine?.id ?? null), [league.id, mine?.id]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Tempo reale: a ogni Pronto, allenatore, avviso o cambio di turno si rilegge
  useEffect(() => subscribeTurn(league.id, reload), [league.id, reload]);
  // Il conto alla rovescia della scadenza
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(t);
  }, []);
  // Turno nuovo: anche il resto della pagina va riletto
  const roundId = status?.round?.id;
  const lastRound = useRef(roundId);
  useEffect(() => {
    if (roundId && lastRound.current && roundId !== lastRound.current) onRoundChange();
    lastRound.current = roundId;
  }, [roundId, onRoundChange]);

  if (error) return <ErrorText>{error}</ErrorText>;
  if (!status?.round) return null;
  const round = status.round;
  const humans = league.teams.filter((t) => t.ownerId !== null);
  const open = round.state === 'open';
  const draftPending = league.draftState !== null && league.draftState !== 'done';
  const myState = mine ? readiness(status, mine.id, now) : null;
  const blocked = status.alerts.some((a) => a.blocking);
  // In play-in e playoff contano solo le squadre che giocano
  const inRound = humans.filter((t) => readiness(status, t.id, now) !== 'out');
  const readyCount = inRound.filter((t) => readiness(status, t.id, now) !== 'waiting').length;
  const champion = status.championId ? league.teams.find((t) => t.id === status.championId) : null;
  const code = (id: string) => league.teams.find((t) => t.id === id)?.code ?? '?';

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
      reload();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const title =
    round.kind === 'regular'
      ? `Giornata ${round.number + 1} di 82`
      : round.kind === 'play-in'
        ? 'Play-in'
        : round.kind === 'playoffs'
          ? 'Playoff'
          : `Offseason · ${STAGE_LABEL[league.roundStage ?? ''] ?? ''}`;

  return (
    <>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Turno</p>
            <p className="text-xl font-semibold">{title}</p>
          </div>
          <span
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              !open
                ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100'
                : status.paused
                  ? 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
                  : 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100'
            }`}
          >
            {!open ? 'Simulazione in corso…' : status.paused ? 'Lega in pausa' : 'Aperto'}
          </span>
        </div>

        {status.lastGame && (
          <p className="text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              Ultima partita
              {status.lastGame.roundNumber < 82 ? ` (giornata ${status.lastGame.roundNumber + 1})` : ''}:
            </span>{' '}
            <span className="font-semibold">
              {code(status.lastGame.awayTeamId)} {status.lastGame.awayScore} – {status.lastGame.homeScore}{' '}
              {code(status.lastGame.homeTeamId)}
            </span>
            {status.lastGame.overtimes > 0 &&
              ` (${status.lastGame.overtimes > 1 ? `${status.lastGame.overtimes} ` : ''}supplementari)`}
          </p>
        )}

        {draftPending && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Il primo turno parte quando il draft iniziale è finito.
          </p>
        )}
        {round.kind === 'offseason' && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {champion ? `Stagione finita: campioni i ${champion.fullName}. ` : ''}
            {STAGE_HINT[league.roundStage ?? ''] ?? ''}
          </p>
        )}
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <Link to={`/lega/${league.id}/risultati`} className={LINK}>
            Risultati
          </Link>
          <Link to={`/lega/${league.id}/classifica`} className={LINK}>
            Classifica
          </Link>
          {round.kind !== 'regular' && (
            <Link to={`/lega/${league.id}/playoff`} className={LINK}>
              Tabellone
            </Link>
          )}
          {round.kind === 'offseason' && (
            <Link to={`/lega/${league.id}/draft-annuale`} className={LINK}>
              Draft
            </Link>
          )}
          {round.kind === 'offseason' && league.roundStage !== 'draft' && (
            <Link to={`/lega/${league.id}/mercato`} className={LINK}>
              Mercato
            </Link>
          )}
        </p>
        {open && round.deadline && !status.paused && (
          <p className="text-sm">
            Scadenza del turno: <span className="font-semibold">{timeLeft(round.deadline, now)}</span>
          </p>
        )}
        {open && round.forcedAt && (
          <p className="text-sm text-orange-700 dark:text-orange-300">
            Il commissario ha forzato l’avanzamento.
          </p>
        )}

        <div>
          <p className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            Pronti {readyCount} su {inRound.length}
          </p>
          <ul className="divide-y divide-slate-100 dark:divide-slate-700">
            {humans.map((t) => {
              const r = readiness(status, t.id, now);
              return (
                <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-10 shrink-0 rounded bg-slate-100 px-1 text-center text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {t.code}
                    </span>
                    <span className={`truncate ${t.ownerId === userId ? 'font-semibold' : ''}`}>
                      {t.ownerId === userId ? 'Tu' : (t.ownerName ?? 'Manager')}
                    </span>
                  </span>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[r].className}`}
                  >
                    {BADGE[r].label}
                  </span>
                </li>
              );
            })}
          </ul>
          {readyCount === inRound.length && open && !status.paused && !draftPending && (
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {inRound.every((t) => readiness(status, t.id, now) === 'coach')
                ? 'Tutti con l’allenatore: la lega avanza da sola, al ritmo scelto dal commissario.'
                : 'Tutti pronti: il turno parte a momenti.'}
            </p>
          )}
        </div>

        {mine && open && myState === 'out' && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            La tua squadra non gioca in questo turno: non devi fare nulla.
          </p>
        )}
        {mine && open && myState !== 'out' && (
          <div className="space-y-2">
            {myState === 'coach' && (
              <p className="text-sm text-sky-800 dark:text-sky-200">
                {blocked
                  ? 'La squadra è affidata all’allenatore, ma è fermo finché non rispondi agli avvisi qui sotto.'
                  : 'La squadra è affidata all’allenatore: risulti pronto a ogni turno.'}
              </p>
            )}
            <Button
              className="w-full sm:w-auto"
              variant={myState === 'ready' ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => void run(() => setReady(mine.id, myState !== 'ready'))}
            >
              {myState === 'ready' ? 'Non sono più pronto' : 'Sono pronto'}
            </Button>
          </div>
        )}

        {isCommissioner && open && !draftPending && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
            <Button
              variant="secondary"
              disabled={busy || round.forcedAt !== null}
              onClick={() => {
                if (!confirmForce) return setConfirmForce(true);
                setConfirmForce(false);
                void run(() => forceRound(league.id));
              }}
            >
              {confirmForce ? 'Confermi? Si gioca subito' : 'Forza l’avanzamento'}
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => setPaused(league.id, !status.paused))}
            >
              {status.paused ? 'Riprendi la lega' : 'Metti in pausa'}
            </Button>
          </div>
        )}
        {actionError && <ErrorText>{actionError}</ErrorText>}
      </Card>

      {status.alerts.length > 0 && (
        <Card className="space-y-3">
          <h2 className="font-semibold">Avvisi</h2>
          {status.alerts.map((a) => (
            <AlertRow
              key={a.id}
              alert={a}
              leagueId={league.id}
              disabled={busy || !open}
              onAnswer={() => void run(() => answerAlert(a.id))}
            />
          ))}
        </Card>
      )}
    </>
  );
}

function AlertRow({
  alert,
  leagueId,
  disabled,
  onAnswer,
}: {
  alert: AlertItem;
  leagueId: string;
  disabled: boolean;
  onAnswer: () => void;
}) {
  const text = alertText(alert);
  return (
    <div
      className={`rounded-lg border p-3 text-sm ${
        alert.blocking
          ? 'border-orange-300 bg-orange-50 dark:border-orange-700 dark:bg-orange-950'
          : 'border-slate-200 dark:border-slate-700'
      }`}
    >
      <p className="font-semibold">
        {text.title}
        {alert.blocking && (
          <span className="ml-2 text-xs text-orange-700 dark:text-orange-300">blocca l’allenatore</span>
        )}
      </p>
      <p className="mt-1 text-slate-700 dark:text-slate-200">{text.body}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {ALERT_LINK[alert.kind] && (
          <Link
            to={`/lega/${leagueId}/${ALERT_LINK[alert.kind]?.to}`}
            className={`inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold ${
              alert.kind === 'trade_offer'
                ? 'bg-orange-600 text-white hover:bg-orange-700'
                : 'border border-slate-300 hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800'
            }`}
          >
            {ALERT_LINK[alert.kind]?.label}
          </Link>
        )}
        {/* Alla proposta di scambio si risponde dalla pagina del mercato: accettarla o rifiutarla chiude l'avviso */}
        {alert.kind !== 'trade_offer' && (
          <Button variant={alert.blocking ? 'primary' : 'secondary'} disabled={disabled} onClick={onAnswer}>
            {text.action}
          </Button>
        )}
      </div>
    </div>
  );
}
