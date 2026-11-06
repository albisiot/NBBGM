// Gestione della lega nella sua pagina: il commissario cambia scadenza dei turni e ritmo con gli allenatori,
// libera le squadre dei manager, li espelle o elimina la lega; gli altri possono lasciarla. Le azioni
// distruttive chiedono conferma.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import {
  DEADLINE_OPTIONS,
  deadlineLabel,
  deleteLeague,
  expelManager,
  freeTeam,
  leaveLeague,
  PACE_OPTIONS,
  paceLabel,
  sameLeagueName,
  updateTurnSettings,
  withCurrent,
  type LeagueDetail,
} from '../lib/leagues.ts';
import { LAST_LEAGUE_KEY } from './Layout.tsx';
import { Button, Card, ErrorText, TextInput } from './ui.tsx';

type Pending = { teamId: string; action: 'free' | 'expel' } | null;

export function LeagueAdmin({
  league,
  userId,
  onChange,
}: {
  league: LeagueDetail;
  userId: string;
  onChange: () => void;
}) {
  const navigate = useNavigate();
  const isCommissioner = league.commissionerId === userId;
  const managers = league.teams.filter((t) => t.ownerId !== null && t.ownerId !== userId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [typedName, setTypedName] = useState('');

  async function run(action: () => Promise<void>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  // Dopo l'uscita o l'eliminazione la lega non si vede più: si torna all'elenco
  const goHome = () => {
    try {
      if (localStorage.getItem(LAST_LEAGUE_KEY) === league.id) localStorage.removeItem(LAST_LEAGUE_KEY);
    } catch {
      // Senza memoria del browser non c'è niente da togliere
    }
    navigate('/', { replace: true });
  };

  function teamAction(teamId: string, action: 'free' | 'expel') {
    if (pending?.teamId !== teamId || pending.action !== action) return setPending({ teamId, action });
    setPending(null);
    void run(() => (action === 'free' ? freeTeam(teamId) : expelManager(teamId)), onChange);
  }

  if (!isCommissioner)
    return (
      <Card className="space-y-2">
        <h2 className="font-semibold">Lascia la lega</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          La tua squadra torna al bot. Potrai rientrare con il codice invito, prendendo una squadra libera.
        </p>
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() => {
            if (!confirmLeave) return setConfirmLeave(true);
            setConfirmLeave(false);
            void run(() => leaveLeague(league.id), goHome);
          }}
        >
          {confirmLeave ? 'Confermi? Esci dalla lega' : 'Lascia la lega'}
        </Button>
        <ErrorText>{error}</ErrorText>
      </Card>
    );

  return (
    <Card className="space-y-4">
      <TurnSettings league={league} onChange={onChange} />

      <div className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-700">
        <h2 className="font-semibold">Manager</h2>
        {managers.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Per ora sei l’unico manager: le altre squadre sono dei bot.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Liberando una squadra torna al bot e il manager esce dalla lega: potrà rientrare con il codice
              invito. Chi è espulso non può più rientrare. In entrambi i casi decadono il suo Pronto,
              l’allenatore, le offerte e gli scambi in sospeso.
            </p>
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {managers.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-10 shrink-0 rounded bg-slate-100 px-1 text-center text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                      {t.code}
                    </span>
                    <span className="truncate">{t.ownerName ?? 'Manager'}</span>
                  </span>
                  <span className="flex gap-2">
                    <Button variant="secondary" disabled={busy} onClick={() => teamAction(t.id, 'free')}>
                      {pending?.teamId === t.id && pending.action === 'free' ? 'Confermi?' : 'Libera'}
                    </Button>
                    <Button variant="ghost" disabled={busy} onClick={() => teamAction(t.id, 'expel')}>
                      {pending?.teamId === t.id && pending.action === 'expel'
                        ? 'Confermi l’espulsione?'
                        : 'Espelli'}
                    </Button>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <form
        className="space-y-2 border-t border-slate-100 pt-4 dark:border-slate-700"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sameLeagueName(typedName, league.name)) return;
          void run(() => deleteLeague(league.id, typedName), goHome);
        }}
      >
        <h2 className="font-semibold">Elimina la lega</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Spariscono squadre, partite, statistiche e bilanci, per tutti i manager. Non si può annullare.
        </p>
        <TextInput
          label={`Per confermare scrivi il nome della lega: ${league.name}`}
          value={typedName}
          onChange={(e) => setTypedName(e.target.value)}
          autoComplete="off"
        />
        <Button type="submit" variant="danger" disabled={busy || !sameLeagueName(typedName, league.name)}>
          Elimina definitivamente
        </Button>
      </form>
      <ErrorText>{error}</ErrorText>
    </Card>
  );
}

const SELECT =
  'mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-800';

/** Scadenza dei turni e ritmo massimo con gli allenatori, che il commissario può cambiare quando vuole. */
function TurnSettings({ league, onChange }: { league: LeagueDetail; onChange: () => void }) {
  const [deadline, setDeadline] = useState(league.deadlineMinutes);
  const [pace, setPace] = useState(league.maxPaceSeconds);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const changed = deadline !== league.deadlineMinutes || pace !== league.maxPaceSeconds;
  const deadlines = withCurrent(DEADLINE_OPTIONS, league.deadlineMinutes, deadlineLabel);
  const paces = withCurrent(PACE_OPTIONS, league.maxPaceSeconds, paceLabel);

  async function save() {
    setBusy(true);
    setMessage(null);
    try {
      await updateTurnSettings(league.id, { deadline_minutes: deadline, max_pace_seconds: pace });
      setMessage({
        ok: true,
        text:
          deadline !== league.deadlineMinutes && deadline !== null
            ? 'Salvato: la scadenza del turno aperto riparte da adesso.'
            : 'Salvato.',
      });
      onChange();
    } catch (e) {
      setMessage({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <h2 className="font-semibold">Turni</h2>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm">
          Scadenza dei turni
          <select
            className={SELECT}
            value={deadline === null ? '' : String(deadline)}
            onChange={(e) => setDeadline(e.target.value === '' ? null : Number(e.target.value))}
          >
            {deadlines.map((o) => (
              <option key={String(o.value)} value={o.value === null ? '' : String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Ritmo massimo con tutti gli allenatori
          <select className={SELECT} value={pace} onChange={(e) => setPace(Number(e.target.value))}>
            {paces.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Con una scadenza il turno si chiude anche se qualcuno non è pronto (chi non ha confermato gioca con le
        ultime impostazioni salvate). Cambiandola, il turno aperto riparte da adesso.
      </p>
      <Button type="submit" variant="secondary" disabled={busy || !changed}>
        Salva
      </Button>
      {message &&
        (message.ok ? (
          <p role="status" className="text-sm text-green-700 dark:text-green-300">
            {message.text}
          </p>
        ) : (
          <ErrorText>{message.text}</ErrorText>
        ))}
    </form>
  );
}
