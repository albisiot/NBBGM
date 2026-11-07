// Campionato: occhiello, titolo e schede Risultati, Classifica e Playoff sopra le tre pagine, che restano alle loro
// rotte (risultati, risultati/<turno>, classifica, playoff): i link già in giro (notifiche, riepilogo condiviso,
// scheda del turno) continuano a funzionare. Titolo e schede restano al loro posto mentre la pagina arriva a pezzi.
import { Suspense } from 'react';
import { Link, Outlet, useLocation, useMatch } from 'react-router';
import { useUserId } from '../lib/auth.tsx';
import { championshipTab, championshipTabs, leagueHref } from '../lib/leagueNav.ts';
import { useTurn } from '../lib/turnStore.ts';
import { Kicker, Spinner } from './ui.tsx';

export function ChampionshipLayout() {
  const id = useMatch('/lega/:id/*')?.params.id ?? '';
  const userId = useUserId();
  const { pathname } = useLocation();
  // Il tipo del turno dallo stato condiviso con la barra del turno: nessuna lettura in più
  const { data } = useTurn(id, userId);
  const kind = data?.leagueId === id ? (data.round?.kind ?? null) : null;
  const current = championshipTab(pathname, id);
  const tabs = championshipTabs(kind, current);
  const title = tabs.find((t) => t.to === current)?.label ?? 'Campionato';

  return (
    <>
      <header className="mb-3">
        <Kicker>Campionato</Kicker>
        <h1 className="text-3xl leading-tight font-bold text-stampa-900 dark:text-stampa-50">{title}</h1>
      </header>
      {/* Le sezioni del giornale: la scheda aperta con il filetto spesso sopra quello sottile della riga */}
      <nav aria-label="Campionato" className="mb-4 border-b border-stampa-900 dark:border-stampa-100">
        <ul className="flex flex-wrap gap-x-5">
          {tabs.map((t) => (
            <li key={t.to}>
              <Link
                to={leagueHref(id, t.to)}
                aria-current={current === t.to ? 'page' : undefined}
                className={`inline-flex min-h-11 items-center border-b-[3px] font-titolo text-sm tracking-wider whitespace-nowrap uppercase ${
                  current === t.to
                    ? 'border-stampa-900 font-semibold text-stampa-900 dark:border-stampa-50 dark:text-stampa-50'
                    : 'border-transparent font-medium text-stampa-700 hover:text-stampa-900 dark:text-stampa-300 dark:hover:text-stampa-50'
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
