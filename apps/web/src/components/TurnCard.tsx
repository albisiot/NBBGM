// Turno corrente nella pagina della lega: stato, scadenza, chi è pronto (in tempo reale), il proprio Pronto,
// gli avvisi della propria squadra e, per il commissario, forza l'avanzamento e pausa.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { refreshAppBadge } from '../lib/appBadge.ts';
import { friendlyError } from '../lib/errors.ts';
import type { LeagueDetail } from '../lib/leagues.ts';
import { readSpoilerFree } from '../lib/replay.ts';
import {
  alertText,
  answerAlert,
  countsAsReady,
  forceRound,
  MAX_ROUND_ATTEMPTS,
  MEMBER_REOPEN_HOURS,
  memberReopenAt,
  PHASE_LABEL,
  readiness,
  readinessNote,
  readyAction,
  readyWarnings,
  reopenRound,
  roundPhase,
  roundTitle,
  roundError,
  setPaused,
  setReady,
  timeLeft,
  type AlertItem,
  type Readiness,
  type RoundPhase,
  type RoundTrouble,
} from '../lib/turns.ts';
import { useTurn } from '../lib/turnStore.ts';
import { useUnsaved } from '../lib/unsaved.ts';
import { useAsync } from '../lib/useAsync.ts';
import { ReadyConfirm } from './ReadyConfirm.tsx';
import { ShareTurn } from './ShareTurn.tsx';
import { Button, Card, ConfirmButton, ErrorText } from './ui.tsx';

const BADGE: Record<Readiness, { label: string; className: string }> = {
  ready: { label: 'Pronto', className: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100' },
  coach: { label: 'Allenatore', className: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100' },
  blocked: {
    label: 'Deve decidere',
    className: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  },
  waiting: {
    label: 'In attesa',
    className: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  },
  out: {
    label: 'Non gioca',
    className: 'border border-slate-200 text-slate-600 dark:border-slate-600 dark:text-slate-300',
  },
};

// Colore dello stato del turno (la stessa fase della barra in cima alle altre pagine)
const PHASE_CLASS: Record<RoundPhase, string> = {
  draft: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-100',
  late: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
  closing: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
  paused: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  open: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
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
  // Stato del turno condiviso con la barra delle altre pagine: in tempo reale, a ogni Pronto, allenatore, avviso o
  // cambio di turno
  const { data: status, error, reload } = useTurn(league.id, userId);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [askReady, setAskReady] = useState(false);
  const unsaved = useUnsaved(league.id);
  const [now, setNow] = useState(() => Date.now());
  // Con i Risultati senza spoiler anche qui il punteggio dell'ultima partita resta nascosto
  const [spoilerFree] = useState(readSpoilerFree);

  // La propria squadra è cambiata (lasciata, liberata dal commissario): avvisi e stato sono di un'altra squadra
  const myTeam = mine?.id ?? null;
  const seenTeam = useRef(myTeam);
  useEffect(() => {
    if (seenTeam.current !== myTeam) reload();
    seenTeam.current = myTeam;
  }, [myTeam, reload]);
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
  // Il numero sull'icona dell'app segue le decisioni aperte (anche qui, dove la barra del turno non c'è)
  const decisions = status?.alerts.filter((a) => a.blocking).length;
  useEffect(() => {
    if (decisions !== undefined) refreshAppBadge();
  }, [decisions]);

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
  const readyCount = inRound.filter((t) => countsAsReady(readiness(status, t.id, now))).length;
  const note = readinessNote(
    inRound.map((t) => ({
      name: t.ownerName ?? t.code,
      mine: t.ownerId === userId,
      state: readiness(status, t.id, now),
    })),
  );
  const champion = status.championId ? league.teams.find((t) => t.id === status.championId) : null;
  const code = (id: string) => league.teams.find((t) => t.id === id)?.code ?? '?';
  // Stato del turno e Pronto: la stessa regola della barra in cima alle altre pagine
  const phase = roundPhase(round, { trouble: status.trouble, paused: status.paused, draftPending }, now);
  const stuck = phase === 'failed' || phase === 'late';
  const action = mine ? readyAction(phase, myState) : null;
  const playing = phase === 'open' || phase === 'paused';
  const warnings = readyWarnings(
    status.alerts.filter((a) => a.blocking),
    { unsaved: unsaved !== null, coach: myState === 'coach' || myState === 'blocked' },
  );

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setActionError(null);
    try {
      await action();
    } catch (e) {
      setActionError(friendlyError(e));
    } finally {
      setBusy(false);
      // Anche dopo un errore: se il turno è cambiato, la scheda mostra subito quello nuovo
      reload();
    }
  }

  const title = roundTitle(round.kind, round.number, league.roundStage);

  return (
    <>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Turno</p>
            <p className="text-xl font-semibold">{title}</p>
          </div>
          <span className={`rounded-full px-3 py-1 text-xs font-semibold ${PHASE_CLASS[phase]}`}>
            {PHASE_LABEL[phase]}
          </span>
        </div>

        {status.lastGame && spoilerFree && (
          <p className="text-sm">
            <span className="text-slate-500 dark:text-slate-400">
              Ultima partita
              {status.lastGame.roundNumber < 82 ? ` (giornata ${status.lastGame.roundNumber + 1})` : ''}:
            </span>{' '}
            <span className="font-semibold">
              {code(status.lastGame.awayTeamId)} – {code(status.lastGame.homeTeamId)}
            </span>{' '}
            <Link to={`/lega/${league.id}/risultati/${status.lastGame.roundNumber}`} className={LINK}>
              Guardala senza spoiler
            </Link>
          </p>
        )}
        {status.lastGame && !spoilerFree && (
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
        {/* Riepilogo per il gruppo della lega: dopo la prima partita della squadra */}
        {mine && status.lastGame && <ShareTurn league={league} me={mine} lastGame={status.lastGame} />}
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
        {stuck && (
          <StuckRound
            leagueId={league.id}
            trouble={status.trouble}
            paused={status.paused}
            isCommissioner={isCommissioner}
            now={now}
            busy={busy}
            onReopen={(newSeed, withdraw) => void run(() => reopenRound(league.id, newSeed, withdraw))}
          />
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
          {note && open && !status.paused && !draftPending && (
            <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{note}</p>
          )}
        </div>

        {mine && playing && myState === 'out' && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            La tua squadra non gioca in questo turno: non devi fare nulla.
          </p>
        )}
        {mine && action && (
          <div className="space-y-2">
            {(myState === 'coach' || myState === 'blocked') && (
              <p className="text-sm text-sky-800 dark:text-sky-200">
                {blocked || myState === 'blocked'
                  ? 'La squadra è affidata all’allenatore, ma è fermo finché non rispondi agli avvisi qui sotto.'
                  : 'La squadra è affidata all’allenatore: risulti pronto a ogni turno.'}
              </p>
            )}
            <Button
              className="w-full sm:w-auto"
              variant={action === 'unready' ? 'secondary' : 'primary'}
              disabled={busy}
              onClick={() => {
                // Prima di segnarsi pronti: che cosa succede alle decisioni aperte se il turno si chiude
                if (action === 'ready' && warnings.length > 0) setAskReady(true);
                else void run(() => setReady(mine.id, action === 'ready', round.id));
              }}
            >
              {action === 'unready' ? 'Non sono più pronto' : 'Sono pronto'}
            </Button>
            {askReady && action === 'ready' && warnings.length > 0 && (
              <ReadyConfirm
                warnings={warnings}
                leagueId={league.id}
                alertsLink={false}
                unsaved={unsaved !== null}
                busy={busy}
                onReady={() => {
                  setAskReady(false);
                  void run(() => setReady(mine.id, true, round.id));
                }}
                onSaveAndReady={() => {
                  setAskReady(false);
                  void run(async () => {
                    if (unsaved && !(await unsaved.save()))
                      throw new Error('Salvataggio della squadra non riuscito.');
                    await setReady(mine.id, true, round.id);
                  });
                }}
                onCancel={() => setAskReady(false)}
              />
            )}
          </div>
        )}

        {isCommissioner && playing && (
          <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-3 dark:border-slate-700">
            <ConfirmButton
              variant="secondary"
              disabled={busy || round.forcedAt !== null}
              confirmLabel="Confermi? Si gioca subito"
              onConfirm={() => void run(() => forceRound(league.id))}
            >
              Forza l’avanzamento
            </ConfirmButton>
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
              onAnswer={() =>
                void run(async () => {
                  await answerAlert(a.id);
                  refreshAppBadge();
                })
              }
            />
          ))}
        </Card>
      )}
    </>
  );
}

/**
 * Turno rimasto in chiusura: il server riprova da solo ogni 5 minuti, fino a 3 tentativi; poi il turno si ferma
 * e il commissario lo riapre (vede anche l'errore), o qualsiasi membro qualche ora dopo il blocco. Riaperto,
 * torna aperto e tutti confermano di nuovo.
 */
function StuckRound({
  leagueId,
  trouble,
  paused,
  isCommissioner,
  now,
  busy,
  onReopen,
}: {
  leagueId: string;
  trouble: RoundTrouble | null;
  paused: boolean;
  isCommissioner: boolean;
  now: number;
  busy: boolean;
  onReopen: (newSeed: boolean, withdrawMarket: boolean) => void;
}) {
  const failed = trouble?.failedAt != null;
  const memberAt = memberReopenAt(trouble);
  const canReopen = isCommissioner || (memberAt !== null && now >= memberAt);
  const { data: lastError } = useAsync(
    () => (isCommissioner ? roundError(leagueId) : Promise.resolve(null)),
    [leagueId, isCommissioner, trouble?.attempts, trouble?.failedAt],
  );
  const [withdraw, setWithdraw] = useState(false);
  return (
    <div className="space-y-2 rounded-lg border border-red-300 bg-red-50 p-3 text-sm dark:border-red-800 dark:bg-red-950">
      <p className="font-semibold text-red-800 dark:text-red-100">
        {failed
          ? `La simulazione di questo turno non è riuscita (${MAX_ROUND_ATTEMPTS} tentativi).`
          : 'La simulazione di questo turno non è ancora riuscita.'}
      </p>
      <p className="text-slate-700 dark:text-slate-200">
        {failed
          ? isCommissioner
            ? 'Il turno è fermo finché non lo riapri. Non è stato scritto nulla: riaperto, torna come prima e tutti confermano di nuovo il Pronto.'
            : canReopen
              ? `Il commissario non l’ha riaperto in ${MEMBER_REOPEN_HOURS} ore: ora puoi riaprirlo tu. Non è stato scritto nulla.`
              : `Il turno è fermo finché il commissario non lo riapre${
                  memberAt !== null ? ` (dalle ${clockTime(memberAt)} potrà farlo chiunque nella lega)` : ''
                }. Non è stato scritto nulla.`
          : paused
            ? 'Il server riproverà quando la lega non sarà più in pausa.'
            : `Il server riprova da solo ogni 5 minuti${
                trouble ? ` (tentativo ${trouble.attempts} di ${MAX_ROUND_ATTEMPTS})` : ''
              }.`}
      </p>
      {isCommissioner && lastError && (
        <p className="font-mono text-xs break-words text-red-800 dark:text-red-200">Errore: {lastError}</p>
      )}
      {canReopen && (
        <label className="flex min-h-11 items-start gap-2 text-slate-700 dark:text-slate-200">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0"
            checked={withdraw}
            onChange={(e) => setWithdraw(e.target.checked)}
          />
          <span>
            Ritira anche offerte agli svincolati, scambi, tagli e rinnovi in sospeso di tutta la lega (se il
            blocco dipende dal mercato)
          </span>
        </label>
      )}
      {canReopen && (
        <div className="flex flex-wrap gap-2">
          <ConfirmButton
            variant="secondary"
            disabled={busy}
            confirmLabel="Confermi? Il turno si riapre"
            onConfirm={() => onReopen(false, withdraw)}
          >
            Riapri il turno
          </ConfirmButton>
          <ConfirmButton
            variant="ghost"
            disabled={busy}
            confirmLabel="Confermi? Risultati diversi"
            onConfirm={() => onReopen(true, withdraw)}
          >
            Riapri con una simulazione nuova
          </ConfirmButton>
        </div>
      )}
    </div>
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

/** "14:05" (o "6 nov, 14:05" se non è oggi), nell'ora del dispositivo. */
function clockTime(ms: number): string {
  const d = new Date(ms);
  const time = d.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}, ${time}`;
}
