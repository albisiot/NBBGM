// Info lega: codice invito, squadre con i loro manager (o il bot), impostazioni e gestione della lega (il
// commissario cambia scadenza e ritmo, gestisce manager e inviti; gli altri possono lasciare la lega). Stanno qui
// e non nella pagina della lega, che comincia da quello che c'è da fare nel turno.
import { Link, useParams } from 'react-router';
import { InviteCard } from '../components/InviteCard.tsx';
import { LeagueAdmin } from '../components/LeagueAdmin.tsx';
import { Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { deadlineLabel, leagueDetail, paceLabel, type LeagueTeam } from '../lib/leagues.ts';
import { useAsync } from '../lib/useAsync.ts';

const LINK = 'font-semibold text-rosso-700 hover:underline dark:text-rosso-300';

export function LeagueInfoPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const { data: league, error, loading, reload } = useAsync(() => leagueDetail(id), [id]);

  if (loading && !league) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!league) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const isCommissioner = league.commissionerId === userId;

  return (
    <div className="space-y-4">
      <PageTitle sub={league.name}>Info lega</PageTitle>

      <InviteCard league={league} />

      <Card>
        <h2 className="mb-3 font-semibold">Squadre</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(['East', 'West'] as const).map((conf) => (
            <TeamList
              key={conf}
              title={conf === 'East' ? 'Eastern Conference' : 'Western Conference'}
              teams={league.teams.filter((t) => t.conference === conf)}
              userId={userId}
              leagueId={league.id}
            />
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Impostazioni</h2>
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-stampa-500 dark:text-stampa-400">Rose iniziali</dt>
          <dd>
            {league.rosterMode === 'real' ? 'Rose reali' : 'Draft di tutti i giocatori'}
            {/* Il draft iniziale finito non serve più nella pagina della lega: resta raggiungibile da qui */}
            {league.draftState === 'done' && (
              <>
                {' · '}
                <Link to={`/lega/${league.id}/draft`} className={LINK}>
                  vedi il draft
                </Link>
              </>
            )}
          </dd>
          <dt className="text-stampa-500 dark:text-stampa-400">Scadenza dei turni</dt>
          <dd>{deadlineLabel(league.deadlineMinutes)}</dd>
          <dt className="text-stampa-500 dark:text-stampa-400">Ritmo con gli allenatori</dt>
          <dd>{paceLabel(league.maxPaceSeconds)}</dd>
          <dt className="text-stampa-500 dark:text-stampa-400">Rookie</dt>
          <dd>{league.rookieSource === 'generated' ? 'Generati' : 'Reali, da file'}</dd>
        </dl>
        {isCommissioner && (
          <p className="mt-3 text-xs text-stampa-500 dark:text-stampa-400">
            Sei il commissario di questa lega.
          </p>
        )}
      </Card>

      <LeagueAdmin league={league} userId={userId} onChange={reload} />
    </div>
  );
}

function TeamList({
  title,
  teams,
  userId,
  leagueId,
}: {
  title: string;
  teams: LeagueTeam[];
  userId: string;
  leagueId: string;
}) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
        {title}
      </h3>
      <ul className="divide-y divide-stampa-100 dark:divide-stampa-700">
        {teams.map((t) => (
          <li
            key={t.id}
            className={`flex items-center justify-between gap-2 py-1.5 text-sm ${t.ownerId === userId ? 'font-semibold' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-10 shrink-0 rounded bg-stampa-100 px-1 text-center text-xs font-bold text-stampa-700 dark:bg-stampa-700 dark:text-stampa-200">
                {t.code}
              </span>
              <Link to={`/lega/${leagueId}/squadre/${t.code}`} className="truncate hover:underline">
                {t.fullName}
              </Link>
            </span>
            <span
              className={`shrink-0 text-xs ${t.ownerId ? 'text-rosso-700 dark:text-rosso-300' : 'text-stampa-500'}`}
            >
              {t.ownerId === userId ? 'Tu' : (t.ownerName ?? 'Bot')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
