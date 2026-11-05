// Intestazione con il selettore delle leghe e il profilo, poi la pagina.
import { Link, Outlet, useMatch, useNavigate } from 'react-router';
import { useAuth, useUserId } from '../lib/auth.tsx';
import { myLeagues } from '../lib/leagues.ts';
import { useAsync } from '../lib/useAsync.ts';

export const LAST_LEAGUE_KEY = 'nbbgm:ultima-lega';

export function Layout() {
  const userId = useUserId();
  const { displayName } = useAuth();
  const navigate = useNavigate();
  const match = useMatch('/lega/:id');
  const current = match?.params.id ?? '';
  const { data: leagues } = useAsync(() => myLeagues(userId), [userId, current]);

  return (
    <div className="min-h-dvh bg-slate-50 text-slate-900 dark:bg-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white/95 backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
        <div className="mx-auto flex max-w-4xl items-center gap-3 px-4 py-2">
          <Link to="/" className="text-lg font-bold text-orange-600">
            NBBGM
          </Link>
          {leagues && leagues.length > 0 && (
            <select
              aria-label="Lega"
              className="min-h-10 min-w-0 flex-1 truncate rounded-lg border border-slate-300 bg-white px-2 text-sm sm:max-w-xs sm:flex-none dark:border-slate-600 dark:bg-slate-800"
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
      </header>
      <main className="mx-auto max-w-4xl px-4 py-6">
        <Outlet />
      </main>
    </div>
  );
}
