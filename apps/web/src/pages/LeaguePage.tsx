// Pagina della lega: prima quello che c'è da fare nel turno. Primi passi e cerimonia quando servono, poi le
// decisioni aperte (riquadro "Da fare"), il turno con chi è pronto (in tempo reale) e il Pronto, gli avvisi da
// leggere, le ultime notizie e il draft iniziale finché non è finito. Codice invito, squadre, impostazioni e
// gestione stanno in Info lega (pages/LeagueInfoPage.tsx).
import { Suspense, useEffect } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { LatestNews } from '../components/ChronicleText.tsx';
import { InviteCard } from '../components/InviteCard.tsx';
import { WelcomeCard } from '../components/Onboarding.tsx';
import { TurnAlerts, TurnCard } from '../components/TurnCard.tsx';
import { Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { LAST_LEAGUE_KEY, leagueDetail, statusLabel } from '../lib/leagues.ts';
import { lazyPart } from '../lib/lazyPage.ts';
import { useAsync } from '../lib/useAsync.ts';

// La cerimonia di fine stagione arriva a pezzi (con il motore, per i premi): serve una volta l'anno
const CeremonyCard = lazyPart(() => import('../components/CeremonyCard.tsx'), 'CeremonyCard');

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
  const isCommissioner = league.commissionerId === userId;

  return (
    <div className="space-y-4">
      <PageTitle sub={statusLabel(league.seasonYear, league.roundNumber, league.roundKind)}>
        {league.name}
      </PageTitle>

      {/* Subito dopo la creazione il codice invito si vede qui; poi sta in Info lega */}
      {search.get('nuova') && (
        <>
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800 dark:bg-green-950 dark:text-green-100">
            Lega creata. Manda il codice invito agli amici: ognuno sceglierà una squadra libera. Lo ritrovi
            sempre in Info lega.
          </p>
          <InviteCard league={league} />
        </>
      )}

      {mine && <WelcomeCard leagueId={league.id} teamName={mine.fullName} />}

      {/* Dopo la finale: campione e premi, finché il manager non la chiude (poi resta nello Storico) */}
      {league.roundKind === 'offseason' && league.seasonId && league.seasonYear !== null && (
        <Suspense fallback={null}>
          <CeremonyCard
            key={league.seasonId}
            league={league}
            season={{
              id: league.seasonId,
              year: league.seasonYear,
              phase: league.seasonPhase ?? 'offseason',
              current: true,
            }}
          />
        </Suspense>
      )}

      {/* Prima le decisioni da prendere, poi il turno con il Pronto, poi le notizie */}
      <TurnAlerts league={league} userId={userId} group="todo" />
      <TurnCard league={league} userId={userId} onRoundChange={reload} />
      <TurnAlerts league={league} userId={userId} group="read" />

      <LatestNews key={league.roundId ?? ''} leagueId={league.id} codes={league.teams.map((t) => t.code)} />

      {/* Il draft iniziale finché non è finito; dopo si rivede da Info lega */}
      {league.draftState && league.draftState !== 'done' && (
        <Card className="space-y-2">
          <p className="text-sm text-stampa-500 dark:text-stampa-400">
            Draft iniziale · {league.draftMode === 'live' ? 'dal vivo' : 'modalità lista'}
          </p>
          <p className="text-lg font-semibold">
            {league.draftState === 'waiting' ? 'In attesa di partire' : 'In corso'}
          </p>
          <Link
            to={`/lega/${league.id}/draft`}
            className="inline-flex min-h-11 items-center rounded-lg bg-rosso-600 px-4 text-sm font-semibold text-white hover:bg-rosso-700"
          >
            Vai al draft
          </Link>
        </Card>
      )}

      <p className="text-sm text-stampa-600 dark:text-stampa-300">
        <Link
          to={`/lega/${league.id}/info`}
          className="font-semibold text-rosso-700 hover:underline dark:text-rosso-300"
        >
          Info lega
        </Link>
        : codice invito per gli amici, squadre e impostazioni
        {isCommissioner ? ', gestione della lega' : ''}.
      </p>
    </div>
  );
}
