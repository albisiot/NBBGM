// Pagina della lega come la prima pagina di un giornale. In cima l'articolo: occhiello e titolo sull'ultima partita
// della propria squadra (senza partite, il nome della lega), poi primi passi e cerimonia quando servono. Poi quello
// che c'è da fare: le decisioni aperte ("Da decidere prima del turno"), il turno con chi è pronto (in tempo reale)
// e il Pronto; infine gli avvisi da leggere e le ultime notizie. Su telefono una colonna; da lg tre, come il
// giornale sul computer: decisioni e turno a sinistra, articolo al centro, notizie a destra. Codice invito,
// squadre, impostazioni e gestione stanno in Info lega (pages/LeagueInfoPage.tsx).
import { Suspense, useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ChronicleText } from '../components/ChronicleText.tsx';
import { InviteCard } from '../components/InviteCard.tsx';
import { WelcomeCard } from '../components/Onboarding.tsx';
import { ShareTurn } from '../components/ShareTurn.tsx';
import { TurnAlerts, TurnCard } from '../components/TurnCard.tsx';
import { ErrorText, Kicker, SectionTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { chroniclePage, NEWS_TYPES, TYPE_LABEL } from '../lib/chronicle.ts';
import { gameHeadline } from '../lib/frontPage.ts';
import { LAST_LEAGUE_KEY, leagueDetail, statusLabel } from '../lib/leagues.ts';
import { lazyPart } from '../lib/lazyPage.ts';
import { LINK_BUTTON, ROW_LINK, TEXT_LINK } from '../lib/linkStyles.ts';
import { readSpoilerFree } from '../lib/replay.ts';
import { useTurn } from '../lib/turnStore.ts';
import { useAsync } from '../lib/useAsync.ts';

// La cerimonia di fine stagione arriva a pezzi (con il motore, per i premi): serve una volta l'anno
const CeremonyCard = lazyPart(() => import('../components/CeremonyCard.tsx'), 'CeremonyCard');

// Le colonne del centro e di destra, da lg: separate da un filetto verticale come sul giornale
const RULED_COLUMN = 'lg:border-l lg:border-stampa-900 lg:pl-6 lg:dark:border-stampa-100';

export function LeaguePage() {
  const { id = '' } = useParams();
  const [search] = useSearchParams();
  const userId = useUserId();
  const { data: league, error, loading, reload } = useAsync(() => leagueDetail(id), [id]);
  // Lo stato del turno condiviso con la scheda (nessuna lettura in più): l'ultima partita fa il titolo
  const { data: turn } = useTurn(id, userId);
  // Con i Risultati senza spoiler il titolo non dice il risultato
  const [spoilerFree] = useState(readSpoilerFree);

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
  const lastGame = mine && turn?.leagueId === league.id ? turn.lastGame : null;
  const headline = lastGame && mine ? gameHeadline(lastGame, league.teams, mine.id, spoilerFree) : null;
  const kicker = headline?.kicker ?? statusLabel(league.seasonYear, league.roundNumber, league.roundKind);

  return (
    <div className="grid gap-x-6 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.45fr)_minmax(0,0.95fr)] lg:items-start">
      {/* L'articolo: prima di tutto su telefono, al centro da lg */}
      <div className={`min-w-0 space-y-6 lg:col-start-2 lg:row-start-1 ${RULED_COLUMN}`}>
        <article className="space-y-1.5">
          {kicker && <Kicker>{kicker}</Kicker>}
          <h1 className="text-[1.85rem] leading-[1.05] font-bold break-words lg:text-[2.5rem]">
            {headline?.title ?? league.name}
          </h1>
          {headline && lastGame && (
            <p className="text-[0.95rem] leading-snug text-stampa-700 italic dark:text-stampa-200">
              {headline.dek}{' '}
              <Link to={`/lega/${league.id}/risultati/${lastGame.roundNumber}`} className={TEXT_LINK}>
                {spoilerFree ? 'Guardala senza spoiler' : 'Vai ai risultati'}
              </Link>
            </p>
          )}
          {/* Riepilogo per il gruppo della lega: dopo la prima partita della squadra */}
          {mine && lastGame && (
            <div className="pt-2">
              <ShareTurn league={league} me={mine} lastGame={lastGame} />
            </div>
          )}
        </article>

        {/* Subito dopo la creazione il codice invito si vede qui; poi sta in Info lega */}
        {search.get('nuova') && (
          <div className="space-y-3">
            <p className="border-l-4 border-stampa-900 pl-3 text-[0.95rem] leading-snug dark:border-stampa-100">
              <strong>Lega creata.</strong> Manda il codice invito agli amici: ognuno sceglierà una squadra
              libera. Lo ritrovi sempre in Info lega.
            </p>
            <InviteCard league={league} />
          </div>
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
      </div>

      {/* Quello che c'è da fare: decisioni, poi il turno con il Pronto (a sinistra da lg) */}
      <div className="min-w-0 space-y-6 lg:col-start-1 lg:row-start-1">
        {/* Il draft iniziale finché non è finito; dopo si rivede da Info lega */}
        {league.draftState && league.draftState !== 'done' && (
          <section className="space-y-2 border border-stampa-900 bg-stampa-25 p-3 sm:p-4 dark:border-stampa-600 dark:bg-stampa-800">
            <Kicker>Draft iniziale · {league.draftMode === 'live' ? 'dal vivo' : 'modalità lista'}</Kicker>
            <p className="font-titolo text-xl font-bold uppercase">
              {league.draftState === 'waiting' ? 'In attesa di partire' : 'In corso'}
            </p>
            {/* Finché il draft non è finito non c'è il Pronto: il rosso è per il draft */}
            <Link to={`/lega/${league.id}/draft`} className={`${LINK_BUTTON.accent} w-full`}>
              Vai al draft
            </Link>
          </section>
        )}
        <TurnAlerts league={league} userId={userId} group="todo" />
        <TurnCard league={league} userId={userId} onRoundChange={reload} />
      </div>

      {/* Le notizie: avvisi da leggere della propria squadra e ultime della lega (a destra da lg) */}
      <div className={`min-w-0 space-y-6 lg:col-start-3 lg:row-start-1 ${RULED_COLUMN}`}>
        <TurnAlerts league={league} userId={userId} group="read" />
        <LeagueNews leagueId={league.id} roundId={league.roundId} codes={league.teams.map((t) => t.code)} />
        <p className="text-[0.875rem] text-stampa-600 italic dark:text-stampa-300">
          <Link to={`/lega/${league.id}/info`} className={TEXT_LINK}>
            Info lega
          </Link>
          : codice invito per gli amici, squadre e impostazioni
          {isCommissioner ? ', gestione della lega' : ''}.
        </p>
      </div>
    </div>
  );
}

/** Ultime notizie della lega (senza draft e opzioni) in righe con i filetti, con il link alla cronaca completa. */
function LeagueNews({
  leagueId,
  roundId,
  codes,
}: {
  leagueId: string;
  roundId: string | null;
  codes: string[];
}) {
  // Si rileggono a ogni turno nuovo; intanto restano quelle di prima
  const { data } = useAsync(
    () => chroniclePage(leagueId, { types: NEWS_TYPES, team: null }, null, 5),
    [leagueId, roundId],
    { keep: true },
  );
  if (!data || data.entries.length === 0) return null;
  return (
    <section>
      <SectionTitle>Ultime notizie</SectionTitle>
      <ul>
        {data.entries.map((e) => (
          <li
            key={e.id}
            className="border-b border-stampa-300 py-2 text-[0.95rem] leading-snug dark:border-stampa-600"
          >
            <span className="mr-1.5 font-titolo text-xs font-semibold tracking-wider text-stampa-600 uppercase dark:text-stampa-300">
              {TYPE_LABEL[e.type] ?? e.type}
            </span>
            <ChronicleText
              leagueId={leagueId}
              text={e.text}
              codes={e.teamCodes.length ? e.teamCodes : codes}
            />
          </li>
        ))}
      </ul>
      <Link to={`/lega/${leagueId}/cronaca`} className={ROW_LINK}>
        Tutta la cronaca ›
      </Link>
    </section>
  );
}
