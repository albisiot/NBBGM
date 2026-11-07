// Barra del turno in cima a ogni pagina della lega (tranne quella della lega, che ha la scheda del turno
// completa): turno, stato della propria squadra, pulsante Pronto e decisioni bloccanti aperte, con il link alla
// pagina della lega dove si leggono gli avvisi. Così non si torna sempre alla pagina della lega. Prima di segnarsi
// pronti avvisa di che cosa succede alle decisioni aperte e propone di salvare le modifiche fatte in Squadra.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import { barFor, barFromTurn, barView, readyWarnings, setReady, TONE_CLASS as TONE } from '../lib/turns.ts';
import { useTurn } from '../lib/turnStore.ts';
import { useUnsaved } from '../lib/unsaved.ts';
import { refreshAppBadge } from '../lib/appBadge.ts';
import { ReadyConfirm } from './ReadyConfirm.tsx';

export function TurnBar({ leagueId, userId }: { leagueId: string; userId: string }) {
  // Stato del turno condiviso con la scheda e con le pagine (una lettura e un canale per lega). I dati sono sempre
  // della lega aperta (barFor lo ricontrolla): niente turno vecchio, niente Pronto alla lega sbagliata
  const turn = useTurn(leagueId, userId);
  const { reload } = turn;
  const data = turn.data ? barFor(barFromTurn(turn.data), leagueId) : null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  const unsaved = useUnsaved(leagueId);
  // Un'altra lega: niente conferme o errori rimasti da quella di prima
  useEffect(() => {
    setAsking(false);
    setError(null);
  }, [leagueId]);
  // Il numero sull'icona segue le decisioni aperte
  const decisions = data?.decisions.length;
  useEffect(() => {
    if (decisions !== undefined) refreshAppBadge();
  }, [decisions]);

  const toggle = useCallback(
    async (ready: boolean) => {
      if (!data?.round || !data.myTeamId) return;
      setBusy(true);
      setError(null);
      try {
        await setReady(data.myTeamId, ready, data.round.id);
      } catch (e) {
        setError(friendlyError(e));
      } finally {
        setBusy(false);
        reload();
      }
    },
    [data, reload],
  );

  const saveAndReady = useCallback(async () => {
    if (!unsaved) return;
    setBusy(true);
    const ok = await unsaved.save();
    setBusy(false);
    if (!ok) {
      setAsking(false);
      setError('Salvataggio non riuscito: guarda il messaggio in fondo alla pagina.');
      return;
    }
    setAsking(false);
    await toggle(true);
  }, [unsaved, toggle]);

  const view = data ? barView(data) : null;
  // Mentre arrivano i dati (anche cambiando lega): un segnaposto della stessa altezza, senza pulsanti
  if (!view)
    return !turn.data && !turn.error ? (
      <div
        aria-hidden="true"
        className="mb-4 min-h-[3.75rem] rounded-xl border border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-800"
      />
    ) : null;
  const warnings =
    view.action === 'ready' && data
      ? readyWarnings(data.decisions, {
          unsaved: unsaved !== null,
          coach: data.myState === 'coach' || data.myState === 'blocked',
        })
      : [];
  return (
    <div className="mb-4 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm dark:border-slate-700 dark:bg-slate-800">
      {/* Su telefono il turno sta su una riga sua (larghezza minima), decisioni e Pronto sotto, a destra */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link
          to={`/lega/${leagueId}`}
          className="flex min-h-11 min-w-[13rem] flex-1 items-center gap-2 font-semibold hover:underline"
        >
          <span className="truncate">{view.title}</span>
          <span
            className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold ${TONE[view.badge.tone]}`}
          >
            {view.badge.label}
          </span>
        </Link>
        {view.decisions > 0 && (
          <Link
            to={`/lega/${leagueId}`}
            className="inline-flex min-h-11 items-center rounded-lg bg-amber-100 px-3 text-xs font-semibold text-amber-900 hover:bg-amber-200 dark:bg-amber-900 dark:text-amber-100"
          >
            {view.decisions === 1 ? '1 decisione' : `${view.decisions} decisioni`} →
          </Link>
        )}
        {view.action && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (view.action === 'ready' && warnings.length > 0) setAsking(true);
              else void toggle(view.action === 'ready');
            }}
            className={`ml-auto inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold disabled:cursor-not-allowed ${
              view.action === 'ready'
                ? 'bg-orange-600 text-white hover:bg-orange-700 disabled:bg-orange-300'
                : 'border border-slate-300 text-slate-800 hover:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:text-slate-100 dark:hover:bg-slate-700'
            }`}
          >
            {view.action === 'ready' ? 'Sono pronto' : 'Non più pronto'}
          </button>
        )}
      </div>
      {asking && warnings.length > 0 && (
        <ReadyConfirm
          warnings={warnings}
          leagueId={leagueId}
          unsaved={unsaved !== null}
          busy={busy}
          onReady={() => {
            setAsking(false);
            void toggle(true);
          }}
          onSaveAndReady={() => void saveAndReady()}
          onCancel={() => setAsking(false)}
        />
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
