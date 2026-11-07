// Gestione della lega nella pagina Info lega: il commissario cambia scadenza dei turni e ritmo con gli allenatori,
// libera le squadre dei manager, li espelle, passa il ruolo a un altro manager o elimina la lega; cambia il codice
// invito, invita gli amici per email e toglie i bandi. Gli altri possono lasciare la lega. Le azioni distruttive
// chiedono conferma con un secondo tocco entro 5 secondi (ConfirmButton).
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import {
  DEADLINE_OPTIONS,
  deadlineLabel,
  deleteLeague,
  expelManager,
  freeTeam,
  inviteEmail,
  LAST_LEAGUE_KEY,
  leaveLeague,
  listBans,
  listInvites,
  PACE_OPTIONS,
  paceLabel,
  regenerateInviteCode,
  removeInvite,
  sameLeagueName,
  transferCommissioner,
  unbanManager,
  updateTurnSettings,
  withCurrent,
  type LeagueDetail,
} from '../lib/leagues.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Button, Card, ConfirmButton, ErrorText, TextInput } from './ui.tsx';

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
  const [typedName, setTypedName] = useState('');
  const [heir, setHeir] = useState('');

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

  const teamAction = (teamId: string, action: 'free' | 'expel') =>
    void run(() => (action === 'free' ? freeTeam(teamId) : expelManager(teamId)), onChange);

  if (!isCommissioner)
    return (
      <Card className="space-y-2">
        <h2 className="font-semibold">Lascia la lega</h2>
        <p className="text-sm text-stampa-600 dark:text-stampa-300">
          La tua squadra torna al bot. Potrai rientrare con il codice invito, prendendo una squadra libera.
        </p>
        <ConfirmButton
          variant="secondary"
          disabled={busy}
          confirmLabel="Confermi? Esci dalla lega"
          onConfirm={() => void run(() => leaveLeague(league.id), goHome)}
        >
          Lascia la lega
        </ConfirmButton>
        <ErrorText>{error}</ErrorText>
      </Card>
    );

  return (
    <Card className="space-y-4">
      <TurnSettings league={league} onChange={onChange} />

      <Invitations league={league} onChange={onChange} />

      <div className="space-y-2 border-t border-stampa-100 pt-4 dark:border-stampa-700">
        <h2 className="font-semibold">Manager</h2>
        {managers.length === 0 ? (
          <p className="text-sm text-stampa-500 dark:text-stampa-400">
            Per ora sei l’unico manager: le altre squadre sono dei bot.
          </p>
        ) : (
          <>
            <p className="text-sm text-stampa-600 dark:text-stampa-300">
              Liberando una squadra torna al bot e il manager esce dalla lega: potrà rientrare con il codice
              invito. Chi è espulso non può più rientrare. In entrambi i casi decadono il suo Pronto,
              l’allenatore, le offerte e gli scambi in sospeso.
            </p>
            <ul className="divide-y divide-stampa-100 dark:divide-stampa-700">
              {managers.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className="w-10 shrink-0 rounded bg-stampa-100 px-1 text-center text-xs font-bold text-stampa-700 dark:bg-stampa-700 dark:text-stampa-200">
                      {t.code}
                    </span>
                    <span className="truncate">{t.ownerName ?? 'Manager'}</span>
                  </span>
                  <span className="flex gap-2">
                    <ConfirmButton
                      variant="secondary"
                      disabled={busy}
                      confirmLabel={`Confermi? ${t.code} torna al bot`}
                      onConfirm={() => teamAction(t.id, 'free')}
                    >
                      Libera
                    </ConfirmButton>
                    <ConfirmButton
                      variant="ghost"
                      disabled={busy}
                      confirmLabel="Confermi l’espulsione?"
                      onConfirm={() => teamAction(t.id, 'expel')}
                    >
                      Espelli
                    </ConfirmButton>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {managers.length > 0 && (
        <div className="space-y-2 border-t border-stampa-100 pt-4 dark:border-stampa-700">
          <h2 className="font-semibold">Passa il ruolo di commissario</h2>
          <p className="text-sm text-stampa-600 dark:text-stampa-300">
            Il nuovo commissario gestisce turni, manager e lega; tu resti in lega come manager della tua
            squadra.
          </p>
          <label className="block text-sm">
            Nuovo commissario
            <select className={SELECT} value={heir} onChange={(e) => setHeir(e.target.value)}>
              <option value="">Scegli un manager</option>
              {managers.map((t) => (
                <option key={t.id} value={t.ownerId ?? ''}>
                  {t.ownerName ?? 'Manager'} ({t.code})
                </option>
              ))}
            </select>
          </label>
          {/* Un altro manager scelto: si chiede di nuovo la conferma (key) */}
          <ConfirmButton
            key={heir}
            variant="secondary"
            disabled={busy || heir === ''}
            confirmLabel="Confermi? Non sarai più commissario"
            onConfirm={() => void run(() => transferCommissioner(league.id, heir), onChange)}
          >
            Passa il ruolo
          </ConfirmButton>
        </div>
      )}

      <form
        className="space-y-2 border-t border-stampa-100 pt-4 dark:border-stampa-700"
        onSubmit={(e) => {
          e.preventDefault();
          if (!sameLeagueName(typedName, league.name)) return;
          void run(() => deleteLeague(league.id, typedName), goHome);
        }}
      >
        <h2 className="font-semibold">Elimina la lega</h2>
        <p className="text-sm text-stampa-600 dark:text-stampa-300">
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

/**
 * Inviti: codice nuovo (il link vecchio smette di valere), email invitate (con Google ci si iscrive solo così:
 * l'iscrizione è su invito) ed esclusi, a cui il commissario può togliere il bando.
 */
function Invitations({ league, onChange }: { league: LeagueDetail; onChange: () => void }) {
  const invites = useAsync(() => listInvites(league.id), [league.id]);
  const bans = useAsync(() => listBans(league.id), [league.id]);
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(action: () => Promise<unknown>, after: () => void) {
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

  function invite(e: FormEvent) {
    e.preventDefault();
    const address = email.trim();
    if (!address) return;
    void run(
      () => inviteEmail(league.id, address),
      () => {
        setEmail('');
        invites.reload();
      },
    );
  }

  return (
    <div className="space-y-3 border-t border-stampa-100 pt-4 dark:border-stampa-700">
      <h2 className="font-semibold">Inviti</h2>
      <p className="text-sm text-stampa-600 dark:text-stampa-300">
        Ci si iscrive a NBBGM solo su invito: chi apre il link della lega si iscrive con il codice via email.
        Chi vuole entrare con Google va invitato per email.
      </p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={invite}>
        <div className="min-w-0 flex-1">
          <TextInput
            label="Invita per email"
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="amico@esempio.it"
          />
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !email.trim()}>
          Invita
        </Button>
      </form>
      {(invites.data ?? []).length > 0 && (
        <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
          {(invites.data ?? []).map((i) => (
            <li key={i.email} className="flex items-center justify-between gap-2 py-1">
              <span className="min-w-0 truncate">{i.email}</span>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run(() => removeInvite(league.id, i.email), invites.reload)}
              >
                Togli
              </Button>
            </li>
          ))}
        </ul>
      )}
      <div className="space-y-1">
        <ConfirmButton
          variant="secondary"
          disabled={busy}
          confirmLabel="Confermi? Il codice di adesso non varrà più"
          onConfirm={() => void run(() => regenerateInviteCode(league.id), onChange)}
        >
          Cambia il codice invito
        </ConfirmButton>
        <p className="text-xs text-stampa-500 dark:text-stampa-400">
          Con il codice nuovo il link vecchio non funziona più: chi è uscito dalla lega non rientra senza il
          codice nuovo.
        </p>
      </div>
      {(bans.data ?? []).length > 0 && (
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">Esclusi</h3>
          <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
            {(bans.data ?? []).map((b) => (
              <li key={b.userId} className="flex items-center justify-between gap-2 py-1">
                <span className="min-w-0 truncate">{b.name}</span>
                <ConfirmButton
                  variant="ghost"
                  disabled={busy}
                  confirmLabel="Confermi? Potrà rientrare"
                  onConfirm={() => void run(() => unbanManager(league.id, b.userId), bans.reload)}
                >
                  Togli il bando
                </ConfirmButton>
              </li>
            ))}
          </ul>
        </div>
      )}
      <ErrorText>{error ?? invites.error ?? bans.error}</ErrorText>
    </div>
  );
}

const SELECT =
  'mt-1 block min-h-11 w-full rounded-lg border border-stampa-300 bg-stampa-25 px-2 text-sm dark:border-stampa-600 dark:bg-stampa-800';

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
      <p className="text-xs text-stampa-500 dark:text-stampa-400">
        Con una scadenza il turno si chiude anche se qualcuno non è pronto (chi non ha confermato gioca con le
        ultime impostazioni salvate). Cambiandola, il turno aperto riparte da adesso.
      </p>
      <Button type="submit" variant="secondary" disabled={busy || !changed}>
        Salva
      </Button>
      {message &&
        (message.ok ? (
          <p role="status" className="text-sm text-stampa-900 italic dark:text-stampa-50">
            {message.text}
          </p>
        ) : (
          <ErrorText>{message.text}</ErrorText>
        ))}
    </form>
  );
}
