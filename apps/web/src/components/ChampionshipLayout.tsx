// Campionato: le schede Risultati, Classifica e Playoff sopra le tre pagine, che restano alle loro rotte
// (risultati, risultati/<turno>, classifica, playoff): i link già in giro (notifiche, riepilogo condiviso, scheda
// del turno) continuano a funzionare. Le schede restano al loro posto mentre la pagina arriva a pezzi.
import { Suspense } from 'react';
import { Link, Outlet, useLocation, useMatch } from 'react-router';
import { useUserId } from '../lib/auth.tsx';
import { championshipTab, championshipTabs, leagueHref } from '../lib/leagueNav.ts';
import { useTurn } from '../lib/turnStore.ts';
import { Spinner } from './ui.tsx';

export function ChampionshipLayout() {
  const id = useMatch('/lega/:id/*')?.params.id ?? '';
  const userId = useUserId();
  const { pathname } = useLocation();
  // Il tipo del turno dallo stato condiviso con la barra del turno: nessuna lettura in più
  const { data } = useTurn(id, userId);
  const kind = data?.leagueId === id ? (data.round?.kind ?? null) : null;
  const current = championshipTab(pathname, id);

  return (
    <>
      <nav aria-label="Campionato" className="mb-4 border-b border-slate-200 dark:border-slate-700">
        <ul className="flex gap-1 overflow-x-auto text-sm">
          {championshipTabs(kind, current).map((t) => (
            <li key={t.to}>
              <Link
                to={leagueHref(id, t.to)}
                aria-current={current === t.to ? 'page' : undefined}
                className={`-mb-px inline-flex min-h-11 items-center border-b-2 px-4 whitespace-nowrap ${
                  current === t.to
                    ? 'border-orange-600 font-semibold text-orange-700 dark:text-orange-300'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`}
              >
                {t.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <Suspense fallback={<Spinner />}>
        <Outlet />
      </Suspense>
    </>
  );
}
