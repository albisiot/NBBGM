// Schermata roster: quintetto per slot di ruolo, minuti obiettivo con la somma a 240, tattiche, pulsante Auto e
// allenatore. Le impostazioni salvate le usa il motore alla prossima partita; se nel frattempo manca qualcuno
// (ceduto, tagliato, infortunato), il bot corregge solo gli slot mancanti. Con modifiche non salvate, uscire dalla
// pagina chiede conferma e il Pronto della barra del turno propone di salvarle (lib/unsaved.ts).
import {
  autoSetup,
  BODY_PART_LABEL,
  overall,
  roleFit,
  SLOT_ROLES,
  type BodyPart,
  type Tactics,
} from '@nbbgm/engine';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useBlocker, useParams } from 'react-router';
import { Button, Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { friendlyError } from '../lib/errors.ts';
import { leagueDetail, statusLabel, type LeagueDetail } from '../lib/leagues.ts';
import { clearUnsaved, setUnsaved } from '../lib/unsaved.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';
import {
  coachDelegation,
  DEFAULT_TACTICS,
  saveTeamSettings,
  setCoachDelegation,
  settingsForRoster,
  settingsProblems,
  TACTIC_OPTIONS,
  teamRoster,
  teamSettings,
  type CoachDelegation,
  type RosterPlayer,
  type SavedTeamSettings,
} from '../lib/roster.ts';

type CoachUntil = 'round' | 'phase' | 'date' | 'forever';

export function RosterPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [settings, setSettings] = useState<SavedTeamSettings | null>(null);
  const [coach, setCoach] = useState<CoachDelegation | null>(null);
  const [dirty, setDirty] = useState(false);
  const [repaired, setRepaired] = useState(false);
  const [saved, setSaved] = useState(false);
  // Turno nuovo: si rilegge la rosa; con modifiche non salvate si chiede prima al manager
  const [tick, setTick] = useState(0);
  const [stale, setStale] = useState(false);
  useRoundChange(id, () => (dirty ? setStale(true) : setTick((t) => t + 1)));
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  // Modifiche fatte dal manager e non ancora salvate (dirty vale anche per le impostazioni mai salvate o
  // sistemate dal bot, che alla partita il motore rifà uguali: per quelle non si chiede nulla)
  const [edited, setEdited] = useState(false);

  const team = league?.teams.find((t) => t.ownerId === userId) ?? null;

  const save = useCallback(async (): Promise<boolean> => {
    if (!team || !settings || !league) return false;
    setBusy(true);
    setError(null);
    try {
      await saveTeamSettings(team.id, league.id, settings);
      setDirty(false);
      setEdited(false);
      setRepaired(false);
      setSaved(true);
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    } finally {
      setBusy(false);
    }
  }, [team, settings, league]);
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  }, [save]);

  // La barra del turno sa delle modifiche (Pronto propone di salvarle); chiudere o ricaricare la pagina chiede
  // conferma al browser; uscire dalla pagina nell'app la chiede qui sotto (useBlocker)
  useEffect(() => {
    if (!edited) return;
    const entry = { leagueId: id, save: () => saveRef.current() };
    setUnsaved(entry);
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', onUnload);
    return () => {
      clearUnsaved(entry);
      window.removeEventListener('beforeunload', onUnload);
    };
  }, [edited, id]);
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
        setSettings(fixed ?? s ?? fromAuto(mine.code, players, DEFAULT_TACTICS));
        setRepaired(fixed !== null);
        setDirty(s === null || fixed !== null);
        setEdited(false);
        setSaved(false);
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

  if (loading) return <Spinner />;
  if (!league || !team) return <ErrorText>{error ?? 'Non guidi una squadra in questa lega.'}</ErrorText>;
  if (roster.length === 0)
    return (
      <Card>
        <p className="text-sm">
          La rosa è vuota.{' '}
          {league.draftState && league.draftState !== 'done' && (
            <Link className="font-semibold text-orange-600 underline" to={`/lega/${league.id}/draft`}>
              Il draft iniziale non è ancora finito.
            </Link>
          )}
        </p>
      </Card>
    );
  if (!settings) return <Spinner />;

  const total = Object.values(settings.minutes).reduce((a, b) => a + b, 0);
  const problems = settingsProblems(
    settings,
    roster.map((p) => p.id),
  );
  const update = (s: SavedTeamSettings) => {
    setSettings(s);
    setDirty(true);
    setEdited(true);
    setSaved(false);
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
      minutes: { ...settings.minutes, [playerId]: Math.max(0, Math.min(48, Math.round(m))) },
    });

  const rotation = [...roster].sort((a, b) => {
    const sa = settings.starters.indexOf(a.id);
    const sb = settings.starters.indexOf(b.id);
    if (sa >= 0 || sb >= 0) return (sa < 0 ? 9 : sa) - (sb < 0 ? 9 : sb);
    return (
      (settings.minutes[b.id] ?? 0) - (settings.minutes[a.id] ?? 0) ||
      (ovr.get(b.id) ?? 0) - (ovr.get(a.id) ?? 0)
    );
  });

  return (
    <div className="space-y-4 pb-[calc(6rem+env(safe-area-inset-bottom))]">
      <PageTitle
        sub={
          <>
            <Link to={`/lega/${league.id}`} className="underline">
              {league.name}
            </Link>{' '}
            · {statusLabel(league.seasonYear, league.roundNumber, league.roundKind)}
          </>
        }
      >
        {team.fullName}
      </PageTitle>

      {blocker.state === 'blocked' && (
        <LeaveDialog
          busy={busy}
          canSave={problems.length === 0}
          onStay={() => blocker.reset()}
          onLeave={() => blocker.proceed()}
          onSaveAndLeave={() => void save().then((ok) => (ok ? blocker.proceed() : blocker.reset()))}
        />
      )}

      {league.roundState && league.roundState !== 'open' && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Il turno è in chiusura: le modifiche si potranno salvare quando si apre il prossimo.
        </p>
      )}

      {stale && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          <span>La lega è passata al turno successivo: la rosa potrebbe essere cambiata.</span>
          <Button variant="secondary" onClick={() => setTick((t) => t + 1)}>
            Ricarica (perdi le modifiche)
          </Button>
        </div>
      )}

      {repaired && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">
          Qualcuno non è più in squadra: il bot ha sistemato quintetto e minuti come farebbe alla partita.
          Controlla e salva.
        </p>
      )}

      <Card className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">Quintetto</h2>
          <Button
            variant="secondary"
            onClick={() => update(fromAuto(team.code, roster, settings.tactics))}
            title="Il bot propone quintetto e minuti, poi puoi cambiarli"
          >
            Auto
          </Button>
        </div>
        {SLOT_ROLES.map((slot, i) => {
          const p = byId.get(settings.starters[i] ?? '');
          const fit = p ? roleFit(p, slot) : 1;
          return (
            <label key={slot} className="flex items-center gap-3">
              <span className="w-8 shrink-0 text-sm font-bold text-slate-500 dark:text-slate-400">
                {slot}
              </span>
              <select
                className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
                value={settings.starters[i] ?? ''}
                onChange={(e) => setStarter(i, e.target.value)}
              >
                {!p && <option value="">Scegli il titolare</option>}
                {roster
                  .filter((x) => x.injury === null || x.id === settings.starters[i])
                  .map((x) => (
                    <option key={x.id} value={x.id}>
                      {x.firstName} {x.lastName} · {x.role}
                      {x.secondaryRole ? `/${x.secondaryRole}` : ''} · {ovr.get(x.id)}
                    </option>
                  ))}
              </select>
              {fit < 1 && (
                <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">
                  fuori ruolo −{Math.round((1 - fit) * 100)}%
                </span>
              )}
              {p?.injury && <span className="shrink-0 text-xs text-red-600">infortunato</span>}
            </label>
          );
        })}
      </Card>

      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-semibold">Minuti</h2>
          <span
            className={`font-mono text-sm font-semibold ${total === 240 ? 'text-green-700' : 'text-red-600'}`}
          >
            {total}/240
          </span>
        </div>
        <ul className="divide-y divide-slate-100 dark:divide-slate-700">
          {rotation.map((p) => {
            const m = settings.minutes[p.id] ?? 0;
            const starter = settings.starters.includes(p.id);
            return (
              <li key={p.id} className="flex items-center gap-2 py-2">
                <Link to={`/lega/${league.id}/giocatore/${p.id}`} className="min-w-0 flex-1">
                  <span className={`block truncate text-sm ${starter ? 'font-semibold' : ''}`}>
                    {p.firstName} {p.lastName}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {p.role}
                    {p.secondaryRole ? `/${p.secondaryRole}` : ''} · {ovr.get(p.id)} · energia{' '}
                    <EnergyBar value={p.energy} />
                    {p.injury && (
                      <span className="text-red-600">
                        {BODY_PART_LABEL[p.injury.bodyPart as BodyPart]}, {p.injury.gamesRemaining} part.
                      </span>
                    )}
                    {p.contractType === 'two-way' && <span>two-way</span>}
                  </span>
                </Link>
                <Button
                  variant="ghost"
                  className="min-w-11 px-2"
                  aria-label="Meno minuti"
                  onClick={() => setMinutes(p.id, m - 1)}
                >
                  −
                </Button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={48}
                  aria-label={`Minuti di ${p.lastName}`}
                  value={m}
                  onChange={(e) => setMinutes(p.id, Number(e.target.value))}
                  className="h-11 w-14 rounded-lg border border-slate-300 bg-white text-center text-sm dark:border-slate-600 dark:bg-slate-900"
                />
                <Button
                  variant="ghost"
                  className="min-w-11 px-2"
                  aria-label="Più minuti"
                  onClick={() => setMinutes(p.id, m + 1)}
                >
                  +
                </Button>
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="space-y-3">
        <h2 className="font-semibold">Tattiche</h2>
        {TACTIC_OPTIONS.map((t) => (
          <div key={t.key}>
            <p className="mb-1 text-sm text-slate-600 dark:text-slate-300">{t.label}</p>
            <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={t.label}>
              {t.options.map((o) => (
                <button
                  key={o.value}
                  role="radio"
                  aria-checked={settings.tactics[t.key] === o.value}
                  onClick={() =>
                    update({ ...settings, tactics: { ...settings.tactics, [t.key]: o.value } as Tactics })
                  }
                  className={`min-h-11 rounded-lg border px-3 text-sm ${
                    settings.tactics[t.key] === o.value
                      ? 'border-orange-500 bg-orange-50 font-semibold dark:bg-orange-950'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </Card>

      <CoachCard
        coach={coach}
        roundNumber={league.roundNumber}
        onChange={async (c) => {
          setError(null);
          try {
            await setCoachDelegation(team.id, league.id, c);
            setCoach(c);
          } catch (e) {
            setError(friendlyError(e));
          }
        }}
      />

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-slate-200 bg-white/95 pt-3 pr-[max(0.75rem,env(safe-area-inset-right))] pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-[max(0.75rem,env(safe-area-inset-left))] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-4xl items-center justify-between gap-3">
          <div className="min-w-0 text-sm">
            {problems.length > 0 ? (
              <span className="text-red-600">{problems[0]}</span>
            ) : saved ? (
              <span className="text-green-700">Salvato: vale dalla prossima partita.</span>
            ) : dirty ? (
              <span className="text-slate-600 dark:text-slate-300">Modifiche non salvate.</span>
            ) : (
              <span className="text-slate-500 dark:text-slate-400">Nessuna modifica.</span>
            )}
            {error && <span className="block text-red-600">{error}</span>}
          </div>
          <Button disabled={busy || problems.length > 0 || !dirty} onClick={() => void save()}>
            {busy ? 'Salvo…' : 'Salva'}
          </Button>
        </div>
      </div>
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
    <div className="fixed inset-0 z-30 flex items-end justify-center bg-slate-900/40 pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] sm:items-center">
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="uscita-titolo"
        className="m-3 w-full max-w-md space-y-3 rounded-xl bg-white p-4 shadow-lg dark:bg-slate-800"
      >
        <h2 id="uscita-titolo" className="font-semibold">
          Modifiche non salvate
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Quintetto, minuti o tattiche sono cambiati ma non li hai salvati: se esci si perdono e alla prossima
          partita si gioca con le impostazioni di prima.
        </p>
        {!canSave && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
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
      </div>
    </div>
  );
}

/** Quintetto e minuti proposti dal bot (pulsante Auto). */
function fromAuto(code: string, roster: RosterPlayer[], tactics: Tactics): SavedTeamSettings {
  const setup = autoSetup(code, roster, tactics);
  return { starters: [...setup.starters], minutes: setup.minutes, tactics };
}

function EnergyBar({ value }: { value: number }) {
  const color = value >= 85 ? 'bg-green-500' : value >= 70 ? 'bg-amber-500' : 'bg-red-500';
  return (
    <span className="inline-flex items-center gap-1" title={`Energia ${Math.round(value)}`}>
      <span className="inline-block h-1.5 w-10 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
        <span
          className={`block h-full ${color}`}
          style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
        />
      </span>
      {Math.round(value)}
    </span>
  );
}

function CoachCard({
  coach,
  roundNumber,
  onChange,
}: {
  coach: CoachDelegation | null;
  roundNumber: number | null;
  onChange: (c: CoachDelegation) => Promise<void>;
}) {
  const [until, setUntil] = useState<CoachUntil>('forever');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const active = coach?.active ?? false;
  const describe = (c: CoachDelegation) =>
    c.untilPhaseEnd
      ? 'fino alla fine della fase'
      : c.untilRound !== null
        ? `fino alla giornata ${c.untilRound + 1}`
        : c.untilAt
          ? `fino al ${new Date(c.untilAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`
          : 'finché non la riprendi';

  async function run(c: CoachDelegation) {
    setBusy(true);
    await onChange(c);
    setBusy(false);
  }

  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Allenatore</h2>
      <p className="text-sm text-slate-600 dark:text-slate-300">
        L'allenatore gestisce quintetto e minuti come il pulsante Auto, partendo dalle tue tattiche, e la
        squadra risulta pronta da sola a ogni turno. Non fa mercato e si ferma quando arriva una decisione da
        prendere.
      </p>
      {active && coach ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Squadra affidata all'allenatore {describe(coach)}.</p>
          <Button variant="secondary" disabled={busy} onClick={() => void run({ ...coach, active: false })}>
            Riprendi la squadra
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <select
            aria-label="Durata della delega"
            value={until}
            onChange={(e) => setUntil(e.target.value as CoachUntil)}
            className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm sm:w-auto dark:border-slate-600 dark:bg-slate-900"
          >
            <option value="forever">Finché non la riprendo</option>
            <option value="round">Fino al prossimo turno</option>
            <option value="phase">Fino alla fine della fase</option>
            <option value="date">Fino a una data</option>
          </select>
          {until === 'date' && (
            <input
              type="datetime-local"
              aria-label="Data di fine della delega"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm sm:ml-2 sm:w-auto dark:border-slate-600 dark:bg-slate-900"
            />
          )}
          <div>
            <Button
              disabled={busy || (until === 'date' && !date)}
              onClick={() =>
                void run({
                  active: true,
                  untilRound: until === 'round' ? (roundNumber ?? 0) : null,
                  untilAt: until === 'date' && date ? new Date(date).toISOString() : null,
                  untilPhaseEnd: until === 'phase',
                })
              }
            >
              Affida all'allenatore
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
