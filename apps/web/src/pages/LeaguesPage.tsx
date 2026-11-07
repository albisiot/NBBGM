// Le leghe dell'utente, con lo stato dal vivo di ognuna (tocca a te, umani pronti, decisioni aperte, stato della
// lega) e i pulsanti per crearne una o entrare con un codice.
import { Link } from 'react-router';
import { InstallHint } from '../components/Onboarding.tsx';
import { Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { myLeagues, statusLabel } from '../lib/leagues.ts';
import { liveBadges, useLeaguesLive } from '../lib/leaguesLive.ts';
import { TONE_CLASS } from '../lib/turns.ts';
import { useAsync } from '../lib/useAsync.ts';

const ACTION =
  'inline-flex min-h-11 items-center justify-center rounded-lg px-4 py-2 text-sm font-semibold transition-colors';

export function LeaguesPage() {
  const userId = useUserId();
  const { data: leagues, error, loading } = useAsync(() => myLeagues(userId), [userId]);
  // Stato dal vivo di tutte le leghe in una lettura, riletto al ritorno in primo piano e ogni minuto
  const live = useLeaguesLive(userId);

  return (
    <>
      <PageTitle sub="Una squadra per lega: puoi giocare in quante leghe vuoi.">Le tue leghe</PageTitle>
      <InstallHint />
      <div className="mb-6 grid gap-2 sm:grid-cols-2">
        <Link to="/crea" className={`${ACTION} bg-rosso-600 text-white hover:bg-rosso-700`}>
          Crea una lega
        </Link>
        <Link
          to="/entra"
          className={`${ACTION} border border-stampa-300 bg-stampa-25 text-stampa-800 hover:bg-stampa-50 dark:border-stampa-600 dark:bg-stampa-800 dark:text-stampa-100`}
        >
          Entra con un codice
        </Link>
      </div>
      {loading && <Spinner />}
      <ErrorText>{error}</ErrorText>
      {leagues && leagues.length === 0 && (
        <Card>
          <p className="text-sm text-stampa-600 dark:text-stampa-300">
            Non sei ancora in nessuna lega. Creane una e manda il codice invito agli amici, oppure entra con
            il codice che ti hanno dato.
          </p>
        </Card>
      )}
      <ul className="mb-6 grid gap-3">
        {leagues?.map((l) => {
          const state = live?.get(l.leagueId);
          const badges = state ? liveBadges(state) : [];
          return (
            <li key={l.leagueId}>
              <Link to={`/lega/${l.leagueId}`} className="block">
                <Card className="transition-colors hover:border-rosso-400">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h2 className="truncate text-lg font-semibold">{l.name}</h2>
                      <p className="text-sm text-stampa-600 dark:text-stampa-300">{l.teamName}</p>
                      <p className="mt-1 text-xs text-stampa-500 dark:text-stampa-400">
                        {statusLabel(l.seasonYear, l.roundNumber, l.roundKind)}
                      </p>
                    </div>
                    {l.commissioner && (
                      <span className="shrink-0 rounded-full bg-rosso-100 px-2 py-0.5 text-xs font-medium text-rosso-800 dark:bg-rosso-900 dark:text-rosso-100">
                        Commissario
                      </span>
                    )}
                  </div>
                  {badges.length > 0 && (
                    <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Stato del turno">
                      {badges.map((b) => (
                        <li
                          key={b.label}
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${TONE_CLASS[b.tone]}`}
                        >
                          {b.label}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </Link>
            </li>
          );
        })}
      </ul>
      <p className="text-sm">
        <Link to="/guida" className="font-semibold text-rosso-700 hover:underline dark:text-rosso-300">
          Come si gioca
        </Link>
      </p>
    </>
  );
}
