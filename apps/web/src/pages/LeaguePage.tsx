// Pagina della lega: turno corrente con chi è pronto (in tempo reale), avvisi, codice invito, squadre con i
// loro manager (o il bot) e impostazioni. Risultati, classifiche e mercato arrivano con le fasi successive.
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { TurnCard } from '../components/TurnCard.tsx';
import { Button, Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { LAST_LEAGUE_KEY } from '../components/Layout.tsx';
import { useUserId } from '../lib/auth.tsx';
import { deadlineLabel, leagueDetail, paceLabel, statusLabel, type LeagueTeam } from '../lib/leagues.ts';
import { useAsync } from '../lib/useAsync.ts';

export function LeaguePage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const userId = useUserId();
  const { data: league, error, loading, reload } = useAsync(() => leagueDetail(id), [id]);

  useEffect(() => {
    try {
      localStorage.setItem(LAST_LEAGUE_KEY, id);
    } catch {
      // Senza memoria del browser non si ricorda l'ultima lega
    }
  }, [id]);

  if (loading && !league) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!league) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;

  const mine = league.teams.find((t) => t.ownerId === userId);
  const humans = league.teams.filter((t) => t.ownerId !== null).length;
  const isCommissioner = league.commissionerId === userId;

  return (
    <div className="space-y-4">
      <PageTitle sub={statusLabel(league.seasonYear, league.roundNumber, league.roundKind)}>
        {league.name}
      </PageTitle>

      {search.get('nuova') && (
        <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-100">
          Lega creata. Manda il codice invito agli amici: ognuno sceglierà una squadra libera.
        </p>
      )}

      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500 dark:text-slate-400">Codice invito</p>
            <p className="font-mono text-2xl font-bold tracking-widest">{league.inviteCode}</p>
          </div>
          <InviteButtons code={league.inviteCode} name={league.name} />
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          {humans === 1 ? '1 manager umano' : `${humans} manager umani`} · {30 - humans} squadre guidate dai
          bot
        </p>
      </Card>

      <TurnCard league={league} userId={userId} onRoundChange={reload} />

      {league.draftState && (
        <Card className="space-y-2">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Draft iniziale · {league.draftMode === 'live' ? 'dal vivo' : 'modalità lista'}
          </p>
          <p className="text-lg font-semibold">
            {league.draftState === 'waiting'
              ? 'In attesa di partire'
              : league.draftState === 'running'
                ? 'In corso'
                : 'Concluso'}
          </p>
          <Link
            to={`/lega/${league.id}/draft`}
            className="inline-flex min-h-11 items-center rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"
          >
            {league.draftState === 'done' ? 'Vedi le rose' : 'Vai al draft'}
          </Link>
        </Card>
      )}

      {mine && (
        <Card>
          <p className="text-sm text-slate-500 dark:text-slate-400">La tua squadra</p>
          <p className="text-xl font-semibold">{mine.fullName}</p>
          <Link
            to={`/lega/${league.id}/squadra`}
            className="mt-3 inline-flex min-h-11 items-center rounded-lg bg-orange-600 px-4 text-sm font-semibold text-white hover:bg-orange-700"
          >
            Gestisci la squadra
          </Link>
        </Card>
      )}

      <Card>
        <h2 className="mb-3 font-semibold">Squadre</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {(['East', 'West'] as const).map((conf) => (
            <TeamList
              key={conf}
              title={conf === 'East' ? 'Eastern Conference' : 'Western Conference'}
              teams={league.teams.filter((t) => t.conference === conf)}
              userId={userId}
            />
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="mb-2 font-semibold">Impostazioni</h2>
        <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-4">
          <dt className="text-slate-500 dark:text-slate-400">Rose iniziali</dt>
          <dd>{league.rosterMode === 'real' ? 'Rose reali' : 'Draft di tutti i giocatori'}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Scadenza dei turni</dt>
          <dd>{deadlineLabel(league.deadlineMinutes)}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Ritmo con gli allenatori</dt>
          <dd>{paceLabel(league.maxPaceSeconds)}</dd>
          <dt className="text-slate-500 dark:text-slate-400">Rookie</dt>
          <dd>{league.rookieSource === 'generated' ? 'Generati' : 'Reali, da file'}</dd>
        </dl>
        {isCommissioner && (
          <p className="mt-3 text-xs text-slate-500 dark:text-slate-400">
            Sei il commissario di questa lega.
          </p>
        )}
      </Card>
    </div>
  );
}

function TeamList({ title, teams, userId }: { title: string; teams: LeagueTeam[]; userId: string }) {
  return (
    <div>
      <h3 className="mb-1 text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        {title}
      </h3>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {teams.map((t) => (
          <li
            key={t.id}
            className={`flex items-center justify-between gap-2 py-1.5 text-sm ${t.ownerId === userId ? 'font-semibold' : ''}`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-10 shrink-0 rounded bg-slate-100 px-1 text-center text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                {t.code}
              </span>
              <span className="truncate">{t.fullName}</span>
            </span>
            <span
              className={`shrink-0 text-xs ${t.ownerId ? 'text-orange-700 dark:text-orange-300' : 'text-slate-400'}`}
            >
              {t.ownerId === userId ? 'Tu' : (t.ownerName ?? 'Bot')}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function InviteButtons({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}#/entra/${code}`;
  const text = `Entra nella mia lega di NBBGM "${name}" con il codice ${code}: ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex gap-2">
      {typeof navigator.share === 'function' && (
        <Button
          variant="secondary"
          onClick={() => void navigator.share({ title: 'NBBGM', text }).catch(() => {})}
        >
          Condividi
        </Button>
      )}
      <Button variant="secondary" onClick={() => void copy()}>
        {copied ? 'Copiato' : 'Copia invito'}
      </Button>
    </div>
  );
}
