// Barra del turno in cima a ogni pagina della lega (tranne quella della lega, che ha la scheda del turno
// completa): turno, stato della propria squadra, pulsante Pronto e decisioni bloccanti aperte, con il link alla
// pagina della lega dove si leggono gli avvisi. Così non si torna sempre alla pagina della lega.
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import { barStatus, barView, setReady, subscribeTurn, type BarView } from '../lib/turns.ts';
import { useAsync } from '../lib/useAsync.ts';
import { refreshAppBadge } from '../lib/appBadge.ts';

const TONE: Record<BarView['badge']['tone'], string> = {
  green: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-100',
  sky: 'bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-100',
  amber: 'bg-amber-100 text-amber-900 dark:bg-amber-900 dark:text-amber-100',
  slate: 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200',
  orange: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100',
};

export function TurnBar({ leagueId, userId }: { leagueId: string; userId: string }) {
  const { data, reload } = useAsync(() => barStatus(leagueId, userId), [leagueId, userId], { keep: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Tempo reale come la scheda del turno: Pronto, allenatori, avvisi e cambio di turno
  useEffect(() => subscribeTurn(leagueId, reload), [leagueId, reload]);
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

  const view = data ? barView(data) : null;
  if (!view) return null;
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
            onClick={() => void toggle(view.action === 'ready')}
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
      {error && (
        <p role="alert" className="mt-1 text-xs text-red-700 dark:text-red-300">
          {error}
        </p>
      )}
    </div>
  );
}
