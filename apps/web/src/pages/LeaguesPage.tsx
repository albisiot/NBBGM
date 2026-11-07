// Le leghe dell'utente come il sommario di un giornale: per ognuna il nome, la sigla della propria squadra e lo
// stato dal vivo (tocca a te in rosso, si gioca d'inchiostro, in pausa in corsivo, umani pronti e decisioni
// aperte), poi i pulsanti per crearne una o entrare con un codice e il suggerimento per installare l'app.
import { Link } from 'react-router';
import { InstallHint } from '../components/Onboarding.tsx';
import { Card, ErrorText, PageTitle, Spinner, Tag } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { leagueListLine } from '../lib/leagueList.ts';
import { myLeagues, type MyLeague } from '../lib/leagues.ts';
import { useLeaguesLive, type LeagueLive } from '../lib/leaguesLive.ts';
import { LINK_BUTTON, ROW_LINK } from '../lib/linkStyles.ts';
import { useAsync } from '../lib/useAsync.ts';

export function LeaguesPage() {
  const userId = useUserId();
  const { data: leagues, error, loading } = useAsync(() => myLeagues(userId), [userId]);
  // Stato dal vivo di tutte le leghe in una lettura, riletto al ritorno in primo piano e ogni minuto
  const live = useLeaguesLive(userId);

  return (
    <div className="space-y-6">
      <PageTitle>Le tue leghe</PageTitle>
      {loading && !leagues && <Spinner />}
      <ErrorText>{error}</ErrorText>
      {leagues && leagues.length === 0 && (
        <Card>
          <p className="text-[0.95rem] leading-snug">
            Non sei ancora in nessuna lega. Creane una e manda il codice invito agli amici, oppure entra con
            il codice che ti hanno dato. Una squadra per lega: puoi giocare in quante leghe vuoi.
          </p>
        </Card>
      )}
      {leagues && leagues.length > 0 && (
        <ul className="border-t-2 border-stampa-900 dark:border-stampa-100">
          {leagues.map((l) => (
            <LeagueItem key={l.leagueId} league={l} live={live?.get(l.leagueId) ?? null} />
          ))}
        </ul>
      )}
      {/* Niente rosso qui: in questa pagina non c'è un'azione principale da segnalare */}
      <div className="grid grid-cols-2 gap-2">
        <Link to="/crea" className={`${LINK_BUTTON.primary} min-h-12`}>
          Crea una lega
        </Link>
        <Link to="/entra" className={`${LINK_BUTTON.secondary} min-h-12`}>
          Ho un codice
        </Link>
      </div>
      <InstallHint />
      <p className="flex flex-wrap justify-center gap-x-5 text-[0.95rem]">
        <Link to="/guida" className={ROW_LINK}>
          Come si gioca
        </Link>
        <Link to="/profilo" className={ROW_LINK}>
          Profilo e notifiche
        </Link>
      </p>
    </div>
  );
}

/** Una lega: nome e sigla della propria squadra, sotto lo stato del turno. Tutta la riga porta alla lega. */
function LeagueItem({ league, live }: { league: MyLeague; live: LeagueLive | null }) {
  const line = leagueListLine(league, live);
  const parts = [...line.parts, ...(league.commissioner ? ['sei il commissario'] : [])];
  return (
    <li className="border-b border-stampa-300 dark:border-stampa-600">
      <Link
        to={`/lega/${league.leagueId}`}
        className="group flex flex-col gap-1.5 py-3 hover:bg-stampa-100/60 dark:hover:bg-stampa-800/60"
      >
        <span className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 font-titolo text-[1.375rem] leading-tight font-bold break-words uppercase group-hover:underline">
            {league.name}
          </span>
          <span className="shrink-0 font-titolo text-sm font-semibold tracking-wide">
            <span aria-hidden="true">{league.teamCode}</span>
            <span className="sr-only">{league.teamName}</span>
          </span>
        </span>
        <span
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.875rem] ${
            line.quiet ? 'text-stampa-600 italic dark:text-stampa-300' : ''
          }`}
        >
          {line.tag && <Tag tone={line.tag.tone}>{line.tag.label}</Tag>}
          <span>
            {parts.join(' · ')}
            {line.decisions && (
              <>
                {' · '}
                <strong>{line.decisions}</strong>
              </>
            )}
          </span>
        </span>
      </Link>
    </li>
  );
}
