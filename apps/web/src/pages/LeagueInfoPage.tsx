// Info lega: codice invito, squadre con i loro manager (o il bot), impostazioni e gestione della lega (il
// commissario cambia scadenza e ritmo, gestisce manager e inviti; gli altri possono lasciare la lega). Stanno qui
// e non nella pagina della lega, che comincia da quello che c'è da fare nel turno.
import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { InviteCard } from '../components/InviteCard.tsx';
import { LeagueAdmin } from '../components/LeagueAdmin.tsx';
import { ErrorText, PageTitle, SectionTitle, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { deadlineLabel, leagueDetail, paceLabel, type LeagueTeam } from '../lib/leagues.ts';
import { TEXT_LINK } from '../lib/linkStyles.ts';
import { useAsync } from '../lib/useAsync.ts';

export function LeagueInfoPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const { data: league, error, loading, reload } = useAsync(() => leagueDetail(id), [id]);

  if (loading && !league) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!league) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const isCommissioner = league.commissionerId === userId;

  return (
    <div className="space-y-6">
      <PageTitle sub={league.name}>Info lega</PageTitle>

      <InviteCard league={league} />

      <section className="space-y-3">
        <SectionTitle>Squadre</SectionTitle>
        <div className="grid gap-5 md:grid-cols-2">
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
      </section>

      <section className="space-y-2">
        <SectionTitle>Impostazioni</SectionTitle>
        <dl className="text-[0.95rem]">
          <Setting label="Rose iniziali">
            {league.rosterMode === 'real' ? 'Rose reali' : 'Draft di tutti i giocatori'}
            {/* Il draft iniziale finito non serve più nella pagina della lega: resta raggiungibile da qui */}
            {league.draftState === 'done' && (
              <>
                {' · '}
                <Link to={`/lega/${league.id}/draft`} className={TEXT_LINK}>
                  vedi il draft
                </Link>
              </>
            )}
          </Setting>
          <Setting label="Scadenza dei turni">{deadlineLabel(league.deadlineMinutes)}</Setting>
          <Setting label="Ritmo con gli allenatori">{paceLabel(league.maxPaceSeconds)}</Setting>
          <Setting label="Rookie">
            {league.rookieSource === 'generated' ? 'Generati' : 'Reali, da file'}
          </Setting>
        </dl>
        {isCommissioner && (
          <p className="text-[0.875rem] text-stampa-600 italic dark:text-stampa-300">
            Sei il commissario di questa lega.
          </p>
        )}
      </section>

      <LeagueAdmin league={league} userId={userId} onChange={reload} />
    </div>
  );
}

/** Una voce delle impostazioni: nome, puntini e valore, come nei tabellini del giornale. */
function Setting({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex min-h-8 flex-wrap items-baseline gap-x-2">
      <dt className="shrink-0">{label}</dt>
      <span
        aria-hidden="true"
        className="min-w-4 flex-1 border-b-2 border-dotted border-stampa-300 dark:border-stampa-600"
      />
      <dd className="text-right font-semibold">{children}</dd>
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
      <h3 className="mb-1 font-titolo text-sm font-semibold tracking-wider uppercase">{title}</h3>
      <ul className="divide-y divide-stampa-300 border-t border-stampa-900 dark:divide-stampa-600 dark:border-stampa-100">
        {teams.map((t) => {
          const me = t.ownerId === userId;
          return (
            <li key={t.id} className="flex min-h-11 items-center justify-between gap-2 py-1 text-[0.95rem]">
              <span className="flex min-w-0 items-center gap-2">
                <TeamCode code={t.code} strong={me} />
                <Link
                  to={`/lega/${leagueId}/squadre/${t.code}`}
                  className={`truncate hover:underline ${me ? 'font-semibold' : ''}`}
                >
                  {t.fullName}
                </Link>
              </span>
              {/* I manager in chiaro, i bot in corsivo */}
              <span
                className={`shrink-0 text-[0.875rem] ${
                  t.ownerId ? 'font-semibold' : 'text-stampa-600 italic dark:text-stampa-300'
                }`}
              >
                {me ? 'Tu' : (t.ownerName ?? 'bot')}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
