// Schermata roster nello stile Edicola: il quintetto disposto su mezzo campo (components/Court.tsx), sotto il
// riquadro del giocatore scelto con i minuti, i titolari da sistemare e la panchina; il cambio del titolare e le
// tattiche con l'allenatore stanno in pannelli dal basso (components/LineupSheets.tsx). Le impostazioni salvate le
// usa il motore alla prossima partita; se nel frattempo manca qualcuno (ceduto, tagliato, infortunato), il bot
// corregge solo gli slot mancanti. Con modifiche non salvate la barra del turno in cima mostra "Da salvare" con i
// minuti, Annulla e Salva al posto del turno e del Pronto (lib/unsaved.ts), e uscire dalla pagina chiede conferma.
import { autoSetup, overall, SLOT_ROLES, type Role, type Tactics } from '@nbbgm/engine';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { Bench, Court, PlayerPanel } from '../components/Court.tsx';
import { StarterSheet, TacticsSheet } from '../components/LineupSheets.tsx';
import {
  Button,
  Card,
  ErrorText,
  Kicker,
  Sheet,
  Spinner,
  Toast,
  type ToastMessage,
} from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { benchOrder, coachUntilText, courtIssues, slotCandidates } from '../lib/court.ts';
import { friendlyError } from '../lib/errors.ts';
import { leagueDetail, statusLabel, type LeagueDetail } from '../lib/leagues.ts';
import { clearUnsaved, setUnsaved, type Unsaved } from '../lib/unsaved.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';
import {
  coachDelegation,
  DEFAULT_TACTICS,
  saveTeamSettings,
  setCoachDelegation,
  settingsForRoster,
  settingsProblems,
  teamRoster,
  teamSettings,
  type CoachDelegation,
  type RosterPlayer,
  type SavedTeamSettings,
} from '../lib/roster.ts';

/** Le impostazioni a cui torna Annulla: quelle lette (o sistemate dal bot) o le ultime salvate. */
interface Baseline {
  settings: SavedTeamSettings;
  dirty: boolean;
  repaired: boolean;
}

export function RosterPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [settings, setSettings] = useState<SavedTeamSettings | null>(null);
  const [base, setBase] = useState<Baseline | null>(null);
  const [coach, setCoach] = useState<CoachDelegation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [repaired, setRepaired] = useState(false);
  // Turno nuovo: si rilegge la rosa; con modifiche non salvate si chiede prima al manager
  const [tick, setTick] = useState(0);
  const [stale, setStale] = useState(false);
  useRoundChange(id, () => (dirty ? setStale(true) : setTick((t) => t + 1)));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Esito di salvataggi e allenatore in un messaggio in basso (al posto della barra Salva di prima)
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const closeMessage = useCallback(() => setMessage(null), []);
  // Modifiche fatte dal manager e non ancora salvate (dirty vale anche per le impostazioni mai salvate o
  // sistemate dal bot, che alla partita il motore rifà uguali: per quelle non si chiede nulla)
  const [edited, setEdited] = useState(false);
  // Il giocatore nel riquadro sotto il campo, il posto da cambiare (pannello) e il pannello delle tattiche
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [changing, setChanging] = useState<number | null>(null);
  const [tacticsOpen, setTacticsOpen] = useState(false);

  const team = league?.teams.find((t) => t.ownerId === userId) ?? null;

  const save = useCallback(async (): Promise<boolean> => {
    if (!team || !settings || !league) return false;
    setBusy(true);
    try {
      await saveTeamSettings(team.id, league.id, settings);
      setDirty(false);
      setEdited(false);
      setRepaired(false);
      setBase({ settings, dirty: false, repaired: false });
      setMessage({ ok: true, text: 'Salvato: vale dalla prossima partita.' });
      return true;
    } catch (e) {
      setMessage({ ok: false, text: friendlyError(e) });
      return false;
    } finally {
      setBusy(false);
    }
  }, [team, settings, league]);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // Annulla: si torna alle impostazioni lette o alle ultime salvate
  const discard = useCallback(() => {
    if (!base) return;
    setSettings(base.settings);
    setDirty(base.dirty);
    setRepaired(base.repaired);
    setEdited(false);
  }, [base]);
  const discardRef = useRef(discard);
  useEffect(() => {
    discardRef.current = discard;
  }, [discard]);

  const rosterIds = useMemo(() => roster.map((p) => p.id), [roster]);
  const problems = useMemo(
    () => (settings ? settingsProblems(settings, rosterIds) : []),
    [settings, rosterIds],
  );
  const total = settings ? Object.values(settings.minutes).reduce((a, b) => a + b, 0) : 0;
  const problem = problems[0] ?? null;

  // La barra del turno sa delle modifiche: mostra "Da salvare" con i minuti, Annulla e Salva, e il Pronto propone di
  // salvarle. Il riassunto (minuti, problema) cambia a ogni tocco: la voce si rifà
  useEffect(() => {
    if (!edited) return;
    const entry: Unsaved = {
      leagueId: id,
      save: () => saveRef.current(),
      discard: () => discardRef.current(),
      minutes: total,
      problem,
    };
    setUnsaved(entry);
    return () => clearUnsaved(entry);
  }, [edited, id, total, problem]);
  // Chiudere o ricaricare la pagina chiede conferma al browser; uscire dalla pagina nell'app la chiede qui sotto
  useEffect(() => {
    if (!edited) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [edited]);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => edited && currentLocation.pathname !== nextLocation.pathname,
  );

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const l = await leagueDetail(id);
        const mine = l?.teams.find((t) => t.ownerId === userId);
        if (!alive) return;
        setLeague(l);
        if (!mine) return;
        const [players, s, c] = await Promise.all([
          teamRoster(mine.id),
          teamSettings(mine.id),
          coachDelegation(mine.id),
        ]);
        if (!alive) return;
        setRoster(players);
        setCoach(c);
        // Chi non è più in squadra lo sostituisce il bot, come alla partita: il manager controlla e salva
        const fixed = s && settingsForRoster(s, players);
        const initial = fixed ?? s ?? fromAuto(mine.code, players, DEFAULT_TACTICS);
        setSettings(initial);
        setRepaired(fixed !== null);
        setDirty(s === null || fixed !== null);
        setBase({ settings: initial, dirty: s === null || fixed !== null, repaired: fixed !== null });
        setEdited(false);
        setStale(false);
      } catch (e) {
        if (alive) setError(friendlyError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, userId, tick]);

  const byId = useMemo(() => new Map(roster.map((p) => [p.id, p])), [roster]);
  const ovr = useMemo(() => new Map(roster.map((p) => [p.id, Math.round(overall(p))])), [roster]);
  const ovrOf = useCallback((pid: string) => ovr.get(pid) ?? 0, [ovr]);

  if (loading) return <Spinner />;
  if (!league || !team) return <ErrorText>{error ?? 'Non guidi una squadra in questa lega.'}</ErrorText>;
  if (roster.length === 0)
    return (
      <Card>
        <p className="text-sm">
          La rosa è vuota.{' '}
          {league.draftState && league.draftState !== 'done' && (
            <Link className="font-semibold underline" to={`/lega/${league.id}/draft`}>
              Il draft iniziale non è ancora finito.
            </Link>
          )}
        </p>
      </Card>
    );
  if (!settings) return <Spinner />;

  const update = (s: SavedTeamSettings) => {
    setSettings(s);
    setDirty(true);
    setEdited(true);
  };
  const setStarter = (slot: number, playerId: string) => {
    const starters = [...settings.starters];
    const other = starters.indexOf(playerId);
    // Se era già titolare in un altro slot, i due si scambiano
    if (other >= 0) starters[other] = starters[slot] as string;
    starters[slot] = playerId;
    update({ ...settings, starters });
  };
  const setMinutes = (playerId: string, m: number) =>
    update({
      ...settings,
      minutes: { ...settings.minutes, [playerId]: Math.max(0, Math.min(48, Math.round(m || 0))) },
    });
  const changeCoach = async (c: CoachDelegation) => {
    try {
      await setCoachDelegation(team.id, league.id, c);
      setCoach(c);
      setMessage({
        ok: true,
        text: c.active ? `Squadra affidata all'allenatore ${coachUntilText(c)}.` : 'Hai ripreso la squadra.',
      });
    } catch (e) {
      setMessage({ ok: false, text: friendlyError(e) });
    }
  };

  const byRank = (p: RosterPlayer) => ovrOf(p.id);
  const starters = SLOT_ROLES.map((_, i) => byId.get(settings.starters[i] ?? '') ?? null);
  // Il riquadro sotto il campo: il giocatore toccato, altrimenti il primo titolare
  const selected =
    byId.get(selectedId ?? '') ?? starters.find((p): p is RosterPlayer => p !== null) ?? roster[0]!;
  const selectedSlot = settings.starters.indexOf(selected.id);
  const bench = benchOrder(roster, settings.starters, settings.minutes, byRank);
  const issues = courtIssues(team.code, roster, settings);
  const open = !league.roundState || league.roundState === 'open';
  // Nella riga sopra il titolo solo il turno ("mercoledì 21 ottobre"), senza la stagione
  const round = statusLabel(league.seasonYear, league.roundNumber, league.roundKind, league.roundDay)
    .split(' · ')
    .pop();

  return (
    <div className="space-y-4">
      {blocker.state === 'blocked' && (
        <LeaveDialog
          busy={busy}
          canSave={problems.length === 0}
          onStay={() => blocker.reset()}
          onLeave={() => blocker.proceed()}
          onSaveAndLeave={() => void save().then((ok) => (ok ? blocker.proceed() : blocker.reset()))}
        />
      )}

      <header className="flex flex-wrap items-end justify-between gap-x-3 gap-y-1">
        <div className="min-w-0">
          <Kicker muted>La formazione{round ? ` · ${round}` : ''}</Kicker>
          <h1 className="text-3xl leading-tight font-bold">{team.fullName}</h1>
        </div>
        <div className="flex">
          <Button
            variant="ghost"
            className="px-2"
            onClick={() => update(fromAuto(team.code, roster, settings.tactics))}
            title="Il bot propone quintetto e minuti, poi puoi cambiarli"
          >
            Auto
          </Button>
          <Button
            variant="ghost"
            className="px-2"
            aria-haspopup="dialog"
            onClick={() => setTacticsOpen(true)}
          >
            Tattiche
          </Button>
        </div>
      </header>

      {coach?.active && (
        <p className="text-sm italic">
          Squadra affidata all'allenatore {coachUntilText(coach)}: a ogni turno fa lui quintetto e minuti, con
          le tue tattiche. La riprendi da Tattiche.
        </p>
      )}

      {!open && (
        <Note>Il turno è in chiusura: le modifiche si potranno salvare quando si apre il prossimo.</Note>
      )}

      {stale && (
        <Note
          action={
            <Button variant="secondary" onClick={() => setTick((t) => t + 1)}>
              Ricarica (perdi le modifiche)
            </Button>
          }
        >
          La lega è passata al turno successivo: la rosa potrebbe essere cambiata.
        </Note>
      )}

      {/* Impostazioni sistemate dal bot o mai salvate: non sono modifiche del manager, quindi la barra del turno
          non le chiede; si salvano da qui */}
      {dirty && !edited && (
        <Note
          action={
            <Button variant="secondary" disabled={busy || problems.length > 0} onClick={() => void save()}>
              {busy ? 'Salvo…' : 'Salva'}
            </Button>
          }
        >
          {repaired
            ? 'Qualcuno non è più in squadra: il bot ha sistemato quintetto e minuti come farebbe alla partita. Controlla e salva.'
            : "È la formazione proposta dal bot: non l'hai mai salvata, e finché non lo fai alla partita sceglie lui."}
        </Note>
      )}

      {/* Su telefono una colonna (campo, giocatore scelto, da sistemare, panchina); da sm il campo e i problemi a
          sinistra, il giocatore scelto e la panchina a destra */}
      <div className="flex flex-col gap-4 sm:grid sm:grid-cols-2 sm:items-start sm:gap-x-6">
        <Court
          className="sm:col-start-1 sm:row-span-2 sm:row-start-1"
          starters={starters}
          ovrOf={ovrOf}
          minutes={settings.minutes}
          selectedId={selected.id}
          onSelect={setSelectedId}
          onEmpty={setChanging}
        />
        <PlayerPanel
          className="sm:col-start-2 sm:row-start-1"
          player={selected}
          ovr={ovrOf(selected.id)}
          minutes={settings.minutes[selected.id] ?? 0}
          slot={selectedSlot >= 0 ? (SLOT_ROLES[selectedSlot] as Role) : null}
          playerHref={`/lega/${league.id}/giocatore/${selected.id}`}
          onMinutes={(m) => setMinutes(selected.id, m)}
          onChange={() => setChanging(selectedSlot)}
        />
        {(problems.length > 0 || issues.length > 0) && (
          <section
            aria-labelledby="da-sistemare"
            className="border-2 border-rosso-600 bg-stampa-25 px-3 pt-2 pb-1 sm:col-start-1 sm:row-start-3 dark:border-rosso-300 dark:bg-stampa-800"
          >
            <h2
              id="da-sistemare"
              className="flex items-center gap-2 text-sm font-semibold tracking-wider text-rosso-700 dark:text-rosso-300"
            >
              Da sistemare
              <span className="bg-rosso-600 px-1.5 text-white dark:bg-rosso-500">
                {problems.length + issues.length}
              </span>
            </h2>
            <ul>
              {problems.map((p) => (
                <li
                  key={p}
                  className="border-b border-stampa-200 py-2 text-sm last:border-0 dark:border-stampa-700"
                >
                  {p}
                </li>
              ))}
              {issues.map((i) => (
                <li
                  key={i.slot}
                  className="flex items-center gap-2 border-b border-stampa-200 py-1 last:border-0 dark:border-stampa-700"
                >
                  <p className="min-w-0 flex-1 text-sm">{i.text}</p>
                  <Button
                    variant="secondary"
                    className="px-2.5 text-[0.8125rem]"
                    aria-haspopup="dialog"
                    aria-label={`Cambia il titolare: ${i.text}`}
                    onClick={() => setChanging(i.slot)}
                  >
                    Cambia
                  </Button>
                </li>
              ))}
            </ul>
          </section>
        )}
        <Bench
          className="sm:col-start-2 sm:row-span-2 sm:row-start-2"
          players={bench}
          minutes={settings.minutes}
          selectedId={selected.id}
          onSelect={setSelectedId}
        />
      </div>

      {changing !== null && (
        <StarterSheet
          slot={changing}
          current={starters[changing] ?? null}
          candidates={slotCandidates(roster, settings.starters, changing, byRank)}
          ovrOf={ovrOf}
          onPick={(pid) => {
            setStarter(changing, pid);
            setSelectedId(pid);
            setChanging(null);
          }}
          onClose={() => setChanging(null)}
        />
      )}

      {tacticsOpen && (
        <TacticsSheet
          tactics={settings.tactics}
          onTactics={(t) => update({ ...settings, tactics: t })}
          coach={coach}
          roundNumber={league.roundNumber}
          onCoach={changeCoach}
          onClose={() => setTacticsOpen(false)}
        />
      )}

      <Toast message={message} onClose={closeMessage} />
    </div>
  );
}

/** Una nota a filo d'inchiostro sopra il campo, con un'azione accanto se serve. */
function Note({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border border-stampa-900 bg-stampa-25 px-3 py-2 text-sm dark:border-stampa-600 dark:bg-stampa-800">
      <p className="min-w-0 flex-1 italic">{children}</p>
      {action}
    </div>
  );
}

/** Uscita dalla pagina con modifiche non salvate: salvarle, lasciarle o restare. */
function LeaveDialog({
  busy,
  canSave,
  onStay,
  onLeave,
  onSaveAndLeave,
}: {
  busy: boolean;
  /** Le impostazioni sono valide (minuti a 240, quintetto completo): si possono salvare. */
  canSave: boolean;
  onStay: () => void;
  onLeave: () => void;
  onSaveAndLeave: () => void;
}) {
  return (
    <Sheet kicker="Prima di uscire" title="Modifiche non salvate" onClose={onStay}>
      <p className="text-sm">
        Quintetto, minuti o tattiche sono cambiati ma non li hai salvati: se esci si perdono e alla prossima
        partita si gioca con le impostazioni di prima.
      </p>
      {!canSave && (
        <p className="text-sm text-rosso-700 dark:text-rosso-300">
          Per salvarle servono il quintetto completo e 240 minuti: resta e sistemale.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {canSave && (
          <Button disabled={busy} onClick={onSaveAndLeave}>
            Salva ed esci
          </Button>
        )}
        <Button variant="secondary" disabled={busy} onClick={onLeave}>
          Esci senza salvare
        </Button>
        <Button variant="ghost" disabled={busy} onClick={onStay}>
          Resta
        </Button>
      </div>
    </Sheet>
  );
}

/** Quintetto e minuti proposti dal bot (pulsante Auto). */
function fromAuto(code: string, roster: RosterPlayer[], tactics: Tactics): SavedTeamSettings {
  const setup = autoSetup(code, roster, tactics);
  return { starters: [...setup.starters], minutes: setup.minutes, tactics };
}
