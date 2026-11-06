// Le leghe dell'utente, con i pulsanti per crearne una o entrare con un codice.
import { Link } from 'react-router';
import { InstallHint } from '../components/Onboarding.tsx';
import { Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { myLeagues, statusLabel } from '../lib/leagues.ts';
import { useAsync } from '../lib/useAsync.ts';

const ACTION =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors';

export function LeaguesPage() {
  const userId = useUserId();
  const { data: leagues, error, loading } = useAsync(() => myLeagues(userId), [userId]);

  return (
    <>
      <PageTitle sub="Una squadra per lega: puoi giocare in quante leghe vuoi.">Le tue leghe</PageTitle>
      <InstallHint />
      <div className="mb-6 grid gap-2 sm:grid-cols-2">
        <Link to="/crea" className={`${ACTION} bg-orange-600 text-white hover:bg-orange-700`}>
          Crea una lega
        </Link>
        <Link
          to="/entra"
          className={`${ACTION} border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100`}
        >
          Entra con un codice
        </Link>
      </div>
      {loading && <Spinner />}
      <ErrorText>{error}</ErrorText>
      {leagues && leagues.length === 0 && (
        <Card>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Non sei ancora in nessuna lega. Creane una e manda il codice invito agli amici, oppure entra con
            il codice che ti hanno dato.
          </p>
        </Card>
      )}
      <ul className="mb-6 grid gap-3">
        {leagues?.map((l) => (
          <li key={l.leagueId}>
            <Link to={`/lega/${l.leagueId}`} className="block">
              <Card className="transition-colors hover:border-orange-400">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-lg font-semibold">{l.name}</h2>
                    <p className="text-sm text-slate-600 dark:text-slate-300">{l.teamName}</p>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {statusLabel(l.seasonYear, l.roundNumber, l.roundKind)}
                    </p>
                  </div>
                  {l.commissioner && (
                    <span className="shrink-0 rounded-full bg-orange-100 px-2 py-0.5 text-xs font-medium text-orange-800 dark:bg-orange-900 dark:text-orange-100">
                      Commissario
                    </span>
                  )}
                </div>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
      <p className="text-sm">
        <Link to="/guida" className="font-semibold text-orange-700 hover:underline dark:text-orange-300">
          Come si gioca
        </Link>
      </p>
    </>
  );
}
