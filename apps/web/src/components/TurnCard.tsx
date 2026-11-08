// Turno corrente nella pagina della lega, come una colonna del giornale: "Il turno" con quanti sono pronti, lo stato
// della simulazione (in corso, in ritardo, bloccata) o della pausa, le squadre dei manager in righe a puntini con la
// loro etichetta (in tempo reale), il Pronto rosso con la scadenza sotto e, per il commissario, forza l'avanzamento e
// pausa. Gli avvisi della propria squadra stanno in TurnAlerts: le decisioni prima del turno, le notizie da leggere
// accanto alle ultime notizie della lega.
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import { refreshAppBadge } from '../lib/appBadge.ts';
import { friendlyError } from '../lib/errors.ts';
import { closingLabel, deadlineNote, readinessMark } from '../lib/frontPage.ts';
import type { LeagueDetail, LeagueTeam } from '../lib/leagues.ts';
import { LINK_BUTTON, ROW_LINK, TEXT_LINK } from '../lib/linkStyles.ts';
import {
  alertGroups,
  alertText,
  answerAlert,
  countsAsReady,
  forceRound,
  MAX_ROUND_ATTEMPTS,
  MEMBER_REOPEN_HOURS,
  memberReopenAt,
  PAUSED_NOTE,
  PHASE_LABEL,
  readiness,
  readinessNote,
  readyAction,
  readyLabel,
  readyWarnings,
  reopenRound,
  roundPhase,
  roundTitle,
  roundError,
  setPaused,
  setReady,
  timeLeft,
  FA_OFFERS_ONLY,
  FA_ROUNDS,
  type AlertItem,
  type Readiness,
  type RoundTrouble,
} from '../lib/turns.ts';
import { useTurn } from '../lib/turnStore.ts';
import { useUnsaved } from '../lib/unsaved.ts';
import { useAsync } from '../lib/useAsync.ts';
import { ReadyConfirm } from './ReadyConfirm.tsx';
import { Button, ConfirmButton, ErrorText, Kicker, SectionTitle, Tag } from './ui.tsx';

/** Note in corsivo sotto le righe (almeno 13 px, grigio leggibile su carta e inchiostro). */
const NOTE = 'text-[0.875rem] text-stampa-600 italic dark:text-stampa-300';

// Dove si decide quello che chiede l'avviso
const ALERT_LINK: Record<string, { to: string; label: string }> = {
  trade_offer: { to: 'mercato?tab=scambi', label: 'Vai agli scambi' },
  draft_pick: { to: 'draft-annuale', label: 'Vai al draft' },
  team_options: { to: 'mercato?tab=opzioni', label: 'Vai alle opzioni' },
  renewals: { to: 'mercato?tab=rinnovi', label: 'Vai ai rinnovi' },
  free_agency: { to: 'mercato?tab=svincolati', label: 'Vai agli svincolati' },
  offer_sheet: { to: 'mercato?tab=svincolati', label: 'Vai ai tuoi RFA' },
  preparation: { to: 'squadra', label: 'Vai alla squadra' },
};

/** Che cosa si fa in ogni turno dell'offseason. */
function stageHint(stage: string | null): string {
  if (stage === 'draft')
    return 'Draft dal vivo: un turno per ogni scelta di un manager, i bot scelgono nel frattempo. Chi è di turno sceglie nella pagina del draft e preme Pronto.';
  if (stage === 'options')
    return 'Opzioni della squadra sulla prossima stagione: esercitale o declinale nel mercato. Senza risposta decadono.';
  if (stage === 'renewals')
    return 'Rinnovi: tratta con i giocatori in scadenza e fai l’offerta di qualifica agli RFA. Chi non rinnovi diventa svincolato.';
  if (stage === 'preparation')
    return 'Preparazione: rosa a 13-15 contratti standard (il Pronto aspetta che sia a posto), quintetto e tattiche. Poi riparte la regular season.';
  const fa = /^fa(\d+)$/.exec(stage ?? '');
  if (!fa) return '';
  const n = Number(fa[1]);
  if (n <= FA_OFFERS_ONLY)
    return `Free agency, turno ${n} di ${FA_ROUNDS}: si fanno solo offerte, nessuno firma fino al ${FA_OFFERS_ONLY + 1}° turno.`;
  return n === FA_ROUNDS
    ? 'Ultimo turno di free agency: le offerte che non firmano si chiudono, gli RFA senza contratto firmano la qualifica.'
    : `Free agency, turno ${n} di ${FA_ROUNDS}: si firma, e le richieste scendono di turno in turno.`;
}

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
  // Tutti pronti, ma nessuno a mano (a riposo o con l'allenatore): il server aspetta il ritmo massimo
  const waitingPace =
    inRound.length > 0 &&
    readyCount === inRound.length &&
    !inRound.some((t) => readiness(status, t.id, now) === 'ready');
  // In regular season la propria squadra quel giorno non gioca
  const resting =
    mine !== null && round.kind === 'regular' && status.today !== null && !status.today.has(mine.id);
  const note = readinessNote(
    inRound.map((t) => ({
      name: t.ownerName ?? t.code,
      mine: t.ownerId === userId,
      state: readiness(status, t.id, now),
    })),
  );
  const champion = status.championId ? league.teams.find((t) => t.id === status.championId) : null;
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

  const togglePause = () => void run(() => setPaused(league.id, !status.paused));

  return (
    <section className="space-y-3">
      <SectionTitle aside={inRound.length > 0 ? `pronti ${readyCount} su ${inRound.length}` : undefined}>
        Il turno
      </SectionTitle>
      <p className="font-titolo text-lg leading-tight font-semibold tracking-wide uppercase">
        {roundTitle(round)}
      </p>

      {phase === 'closing' && <ClosingBand label={closingLabel(round.kind, round.day, round.seasonYear)} />}
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
      {open && status.paused && !stuck && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-dashed border-stampa-600 py-2 pr-1 pl-3 dark:border-stampa-300">
          <p className="min-w-[12rem] flex-1 text-[0.95rem] leading-snug">
            <span className="block font-titolo font-semibold tracking-wider uppercase">
              {PHASE_LABEL.paused}
            </span>
            <span className="italic">{PAUSED_NOTE}</span>
          </p>
          {/* La riprende il commissario: lo stesso pulsante che prima stava tra le sue azioni */}
          {isCommissioner && phase === 'paused' && (
            <Button variant="secondary" disabled={busy} onClick={togglePause}>
              Riprendi la lega
            </Button>
          )}
        </div>
      )}

      {draftPending && <p className={NOTE}>Il primo turno parte quando il draft iniziale è finito.</p>}
      {round.kind === 'offseason' && (
        <div>
          <p className="text-[0.95rem] leading-snug">
            {champion ? `Stagione finita: campioni i ${champion.fullName}. ` : ''}
            {stageHint(league.roundStage)}
          </p>
          {/* Risultati, classifica e mercato stanno nel menu; il draft annuale no: il suo link resta qui */}
          <Link to={`/lega/${league.id}/draft-annuale`} className={ROW_LINK}>
            Vai al draft ›
          </Link>
        </div>
      )}
      {open && round.forcedAt && (
        <p className="text-[0.875rem] font-semibold text-rosso-700 italic dark:text-rosso-300">
          Il commissario ha forzato l’avanzamento.
        </p>
      )}

      <ul aria-label="Squadre dei manager">
        {humans.map((t) => (
          <TeamRow key={t.id} team={t} me={t.ownerId === userId} state={readiness(status, t.id, now)} />
        ))}
      </ul>
      {note && open && !status.paused && !draftPending && <p className={NOTE}>{note}</p>}

      {mine && playing && myState === 'out' && (
        <p className={NOTE}>
          {round.kind === 'offseason'
            ? 'In questo turno del draft non tocca a te: non devi fare nulla (puoi sistemare la tua lista).'
            : 'La tua squadra non gioca in questo turno: non devi fare nulla.'}
        </p>
      )}
      {mine && playing && resting && (
        <p className={NOTE}>
          {myState === 'rest'
            ? 'Oggi la tua squadra riposa: sei già pronto. Togli il Pronto se prima del turno vuoi fare mercato o cambiare la squadra.'
            : 'Oggi la tua squadra riposa.'}
        </p>
      )}
      {mine && action && (
        <div className="space-y-2 pt-1">
          {(myState === 'coach' || myState === 'blocked') && (
            <p className={NOTE}>
              {blocked || myState === 'blocked'
                ? 'La squadra è affidata all’allenatore, ma è fermo finché non rispondi alle decisioni prima del turno.'
                : 'La squadra è affidata all’allenatore: risulti pronto a ogni turno.'}
            </p>
          )}
          {/* Sono pronto è l'azione principale della pagina: l'unico pulsante rosso */}
          <Button
            className="min-h-12 w-full text-lg"
            variant={action === 'unready' ? 'secondary' : 'accent'}
            disabled={busy}
            onClick={() => {
              // Prima di segnarsi pronti: che cosa succede alle decisioni aperte se il turno si chiude
              if (action === 'ready' && warnings.length > 0) setAskReady(true);
              else void run(() => setReady(mine.id, action === 'ready', round.id));
            }}
          >
            {action === 'unready' && myState !== 'rest' ? 'Non sono più pronto' : readyLabel(action, myState)}
          </Button>
          {/* A riposo con tutti pronti da soli: si parte senza aspettare il ritmo massimo */}
          {myState === 'rest' && waitingPace && open && !status.paused && (
            <Button
              className="w-full"
              variant="ghost"
              disabled={busy}
              onClick={() => void run(() => setReady(mine.id, true, round.id))}
            >
              Conferma il Pronto: si gioca subito
            </Button>
          )}
        </div>
      )}
      {open && round.deadline && !status.paused && (
        <p className={`${NOTE} text-center`}>{deadlineNote(timeLeft(round.deadline, now))}</p>
      )}
      {mine && askReady && action === 'ready' && warnings.length > 0 && (
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

      {isCommissioner && playing && (
        <div className="space-y-2 border-t border-stampa-300 pt-3 dark:border-stampa-600">
          <Kicker muted>Commissario</Kicker>
          <div className="flex flex-wrap gap-2">
            <ConfirmButton
              variant="secondary"
              disabled={busy || round.forcedAt !== null}
              confirmLabel="Confermi? Si gioca subito"
              onConfirm={() => void run(() => forceRound(league.id))}
            >
              Forza l’avanzamento
            </ConfirmButton>
            {/* Con la lega in pausa "Riprendi la lega" sta nel riquadro della pausa */}
            {!status.paused && (
              <Button variant="ghost" disabled={busy} onClick={togglePause}>
                Metti in pausa
              </Button>
            )}
          </div>
        </div>
      )}
      {actionError && <ErrorText>{actionError}</ErrorText>}
    </section>
  );
}

/** Una squadra di un manager nel turno: sigla, manager, puntini e l'etichetta del suo stato. */
function TeamRow({ team, me, state }: { team: LeagueTeam; me: boolean; state: Readiness }) {
  const mark = readinessMark(state);
  return (
    <li className="flex min-h-8 items-baseline gap-2 text-[0.95rem]">
      <span className="w-10 shrink-0 font-titolo font-bold">{team.code}</span>
      <span className={`min-w-0 truncate ${me ? 'font-semibold' : ''}`}>
        {me ? 'Tu' : (team.ownerName ?? 'Manager')}
      </span>
      <span
        aria-hidden="true"
        className="min-w-4 flex-1 border-b-2 border-dotted border-stampa-300 dark:border-stampa-600"
      />
      {mark.kind === 'tag' ? (
        <span className="shrink-0">
          <Tag tone={mark.tone}>{mark.label}</Tag>
        </span>
      ) : (
        <span className="shrink-0 text-[0.875rem] text-stampa-600 italic dark:text-stampa-300">
          {mark.label}
        </span>
      )}
    </li>
  );
}

/** Simulazione in corso: la striscia d'inchiostro con i quadratini che si accendono a turno. */
function ClosingBand({ label }: { label: string }) {
  return (
    <div className="flex min-h-13 flex-wrap items-center gap-x-3 gap-y-1 bg-stampa-900 px-3 py-2 text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900">
      <span className="font-titolo text-[0.95rem] font-semibold tracking-wider uppercase">{label}</span>
      <span aria-hidden="true" className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="size-1.5 bg-current motion-safe:animate-pulse"
            style={{ animationDelay: `${i * 250}ms` }}
          />
        ))}
      </span>
      <span className="ml-auto text-[0.875rem] text-stampa-200 italic dark:text-stampa-600">
        di solito pochi secondi
      </span>
    </div>
  );
}

/**
 * Avvisi aperti della propria squadra nella pagina della lega. group 'todo': il riquadro "Da decidere prima del
 * turno", con le decisioni (avvisi bloccanti) e i loro pulsanti, da prendere prima del Pronto. group 'read': le
 * notizie da leggere (infortuni, esiti del mercato), in righe con i filetti. Niente se non ce ne sono.
 */
export function TurnAlerts({
  league,
  userId,
  group,
}: {
  league: LeagueDetail;
  userId: string;
  group: 'todo' | 'read';
}) {
  // Lo stesso stato del turno della scheda e della barra: nessuna lettura in più
  const { data: status, reload } = useTurn(league.id, userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!status?.round || status.leagueId !== league.id) return null;
  const alerts = alertGroups(status.alerts)[group];
  if (alerts.length === 0) return null;
  const open = status.round.state === 'open';

  async function answer(id: string) {
    setBusy(true);
    setError(null);
    try {
      await answerAlert(id);
      refreshAppBadge();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
      reload();
    }
  }

  if (group === 'read')
    return (
      <section>
        <SectionTitle>Da leggere</SectionTitle>
        <ul>
          {alerts.map((a) => (
            <ReadRow
              key={a.id}
              alert={a}
              leagueId={league.id}
              disabled={busy || !open}
              onAnswer={() => void answer(a.id)}
            />
          ))}
        </ul>
        {error && <ErrorText>{error}</ErrorText>}
      </section>
    );

  return (
    <section className="space-y-2 border border-stampa-900 bg-stampa-25 p-3 sm:p-4 dark:border-stampa-600 dark:bg-stampa-800">
      <h2 className="flex items-center gap-2 text-base font-semibold tracking-wider">
        Da decidere prima del turno
        <span aria-hidden="true" className="bg-rosso-600 px-1.5 text-white dark:bg-rosso-500">
          {alerts.length}
        </span>
        <span className="sr-only">({alerts.length})</span>
      </h2>
      <p className={NOTE}>Finché ci sono decisioni aperte l’allenatore è fermo.</p>
      <ul className="divide-y divide-stampa-300 dark:divide-stampa-600">
        {alerts.map((a) => (
          <DecisionRow
            key={a.id}
            alert={a}
            leagueId={league.id}
            disabled={busy || !open}
            onAnswer={() => void answer(a.id)}
          />
        ))}
      </ul>
      {error && <ErrorText>{error}</ErrorText>}
    </section>
  );
}

/**
 * Turno rimasto in chiusura: il server riprova da solo ogni 5 minuti, fino a 3 tentativi; poi il turno si ferma
 * (bordo rosso) e il commissario lo riapre (vede anche l'errore), o qualsiasi membro qualche ora dopo il blocco.
 * Riaperto, torna aperto e tutti confermano di nuovo.
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
    <div
      className={`space-y-2 border-2 bg-stampa-25 p-3 text-[0.95rem] leading-snug dark:bg-stampa-800 ${
        failed ? 'border-rosso-600 dark:border-rosso-300' : 'border-stampa-900 dark:border-stampa-100'
      }`}
    >
      <p
        className={`font-titolo font-semibold tracking-wider uppercase ${
          failed ? 'text-rosso-700 dark:text-rosso-300' : ''
        }`}
      >
        {PHASE_LABEL[failed ? 'failed' : 'late']}
      </p>
      <p className="font-semibold">
        {failed
          ? `La simulazione di questo turno non è riuscita (${MAX_ROUND_ATTEMPTS} tentativi).`
          : 'La simulazione di questo turno non è ancora riuscita.'}
      </p>
      <p>
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
        <p className="font-mono text-xs break-words text-rosso-800 dark:text-rosso-200">
          Errore: {lastError}
        </p>
      )}
      {canReopen && (
        <label className="flex min-h-11 items-start gap-2">
          <input
            type="checkbox"
            className="mt-1 size-4 shrink-0 accent-stampa-900 dark:accent-stampa-100"
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
            variant="primary"
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

/** Una decisione da prendere: titolo e spiegazione, poi dove si decide (link) e la risposta. */
function DecisionRow({
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
  const link = ALERT_LINK[alert.kind];
  // Alla proposta di scambio si risponde dalla pagina del mercato: il link è l'unica azione, d'inchiostro
  const answerable = alert.kind !== 'trade_offer';
  return (
    <li className="space-y-2 py-3 first:pt-1 last:pb-0">
      <p className="text-[0.95rem] leading-snug">
        <strong>{text.title}.</strong> {text.body}
      </p>
      <div className="flex flex-wrap gap-2">
        {link && (
          <Link
            to={`/lega/${leagueId}/${link.to}`}
            className={`min-w-[9rem] flex-1 ${answerable ? LINK_BUTTON.secondary : LINK_BUTTON.primary}`}
          >
            {link.label}
          </Link>
        )}
        {answerable && (
          <Button className="min-w-[9rem] flex-1" disabled={disabled} onClick={onAnswer}>
            {text.action}
          </Button>
        )}
      </div>
    </li>
  );
}

/** Un avviso da leggere (infortunio, esito del mercato): una riga con il filetto e il suo "Ok". */
function ReadRow({
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
  const link = ALERT_LINK[alert.kind];
  return (
    <li className="flex flex-wrap items-start gap-x-2 border-b border-stampa-300 py-2 dark:border-stampa-600">
      <p className="min-w-[12rem] flex-1 py-1 text-[0.95rem] leading-snug">
        <strong className="font-titolo font-semibold tracking-wide uppercase">{text.title}</strong>{' '}
        {text.body}
        {link && (
          <>
            {' '}
            <Link to={`/lega/${leagueId}/${link.to}`} className={TEXT_LINK}>
              {link.label}
            </Link>
          </>
        )}
      </p>
      {/* "Ok" da solo non dice a che cosa: per i lettori di schermo anche il titolo dell'avviso */}
      <Button
        variant="ghost"
        className="shrink-0 px-3"
        disabled={disabled}
        aria-label={`${text.action}: ${text.title}`}
        onClick={onAnswer}
      >
        {text.action}
      </Button>
    </li>
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
