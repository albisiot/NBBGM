// Intestazione con il selettore delle leghe e il profilo, il menu della lega aperta, poi la pagina.
import { Suspense, useEffect } from 'react';
import { Link, NavLink, Outlet, useMatch, useNavigate } from 'react-router';
import { useAuth, useUserId } from '../lib/auth.tsx';
import { refreshAppBadge } from '../lib/appBadge.ts';
import { myLeagues } from '../lib/leagues.ts';
import { lazyPart } from '../lib/lazyPage.ts';
import { onResume } from '../lib/resume.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Spinner } from './ui.tsx';

export const LAST_LEAGUE_KEY = 'nbbgm:ultima-lega';

// La barra del turno arriva a pezzi come le pagine: all'avvio (pagina d'accesso, elenco delle leghe) non serve
const TurnBar = lazyPart(() => import('./TurnBar.tsx'), 'TurnBar');

export function Layout() {
  const userId = useUserId();
  const { displayName } = useAuth();
  const navigate = useNavigate();
  const match = useMatch('/lega/:id/*');
  const current = match?.params.id ?? '';
  // Nella pagina della lega c'è la scheda del turno completa: la barra serve sulle altre
  const leagueHome = useMatch('/lega/:id') !== null;
  // Si rilegge a ogni cambio di lega (per esempio dopo esserne entrati), tenendo l'elenco intanto
  const { data: leagues } = useAsync(() => myLeagues(userId), [userId, current], { keep: true });
  // Numero delle decisioni aperte sull'icona dell'app: all'avvio e al ritorno in primo piano
  useEffect(() => {
    refreshAppBadge();
    return onResume(refreshAppBadge);
  }, [userId]);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 pt-[env(safe-area-inset-top)] pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2">
          <Link to="/" className="text-lg font-bold text-orange-600">
            NBBGM
          </Link>
          {leagues && leagues.length > 0 && (
            <select
              aria-label="Lega"
              className="min-h-11 min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-white px-2 text-sm sm:max-w-xs sm:flex-none dark:border-slate-600 dark:bg-slate-800"
              value={current}
              onChange={(e) => {
                const id = e.target.value;
                if (!id) return navigate('/');
                try {
                  localStorage.setItem(LAST_LEAGUE_KEY, id);
                } catch {
                  // Senza memoria del browser si ricomincia dall'elenco
                }
                navigate(`/lega/${id}`);
              }}
            >
              <option value="">Le tue leghe</option>
              {leagues.map((l) => (
                <option key={l.leagueId} value={l.leagueId}>
                  {l.name} · {l.teamCode}
                </option>
              ))}
            </select>
          )}
          <Link
            to="/profilo"
            className="ml-auto max-w-[40%] truncate rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            {displayName || 'Profilo'}
          </Link>
        </div>
        {current && <LeagueNav id={current} />}
      </header>
      <main className="mx-auto max-w-4xl pt-6 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        {/* Le pagine arrivano a pezzi (lib/lazyPage.ts): intanto l'intestazione resta e sotto si vede il caricamento */}
        {current && !leagueHome && (
          <Suspense fallback={null}>
            <TurnBar leagueId={current} userId={userId} />
          </Suspense>
        )}
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
    </div>
  );
}

const LEAGUE_LINKS: { to: string; label: string }[] = [
  { to: '', label: 'Lega' },
  { to: 'squadra', label: 'Squadra' },
  { to: 'mercato', label: 'Mercato' },
  { to: 'risultati', label: 'Risultati' },
  { to: 'classifica', label: 'Classifica' },
  { to: 'playoff', label: 'Playoff' },
  { to: 'statistiche', label: 'Statistiche' },
  { to: 'cronaca', label: 'Cronaca' },
  { to: 'storico', label: 'Storico' },
];

function LeagueNav({ id }: { id: string }) {
  return (
    <nav aria-label="Menu della lega" className="mx-auto max-w-4xl overflow-x-auto px-2">
      <ul className="flex gap-1 text-sm">
        {LEAGUE_LINKS.map((l) => (
          <li key={l.to}>
            <NavLink
              to={l.to ? `/lega/${id}/${l.to}` : `/lega/${id}`}
              end={l.to === ''}
              className={({ isActive }) =>
                `inline-flex min-h-11 items-center border-b-2 px-3 whitespace-nowrap ${
                  isActive
                    ? 'border-orange-600 font-semibold text-orange-700 dark:text-orange-300'
                    : 'border-transparent text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
                }`
              }
            >
              {l.label}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
