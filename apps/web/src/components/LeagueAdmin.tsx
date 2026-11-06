// Gestione della lega nella sua pagina: il commissario libera le squadre dei manager, li espelle o elimina la
// lega; gli altri possono lasciarla. Le azioni distruttive chiedono conferma.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import {
  deleteLeague,
  expelManager,
  freeTeam,
  leaveLeague,
  sameLeagueName,
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
      <div className="space-y-2">
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
