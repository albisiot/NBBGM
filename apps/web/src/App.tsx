// Rotte dell'app. Router con l'hash (#/...) perché GitHub Pages non gestisce le rotte di una single page app; è un
// "data router" (createHashRouter) perché la pagina Squadra possa fermare l'uscita con modifiche non salvate
// (useBlocker).
import {
  createHashRouter,
  createRoutesFromElements,
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  useRouteError,
} from 'react-router';
import { ErrorBoundary, ErrorScreen } from './components/ErrorBoundary.tsx';
import { Layout } from './components/Layout.tsx';
import { ErrorText, Spinner } from './components/ui.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { lazyPage } from './lib/lazyPage.ts';
import { configured } from './lib/supabase.ts';
import { LoginPage } from './pages/LoginPage.tsx';

// Le pagine arrivano a pezzi quando si aprono (lib/lazyPage.ts); l'accesso no, perché è la prima cosa che si vede
const AnnualDraftPage = lazyPage(() => import('./pages/AnnualDraftPage.tsx'), 'AnnualDraftPage');
const ChroniclePage = lazyPage(() => import('./pages/ChroniclePage.tsx'), 'ChroniclePage');
const CreateLeaguePage = lazyPage(() => import('./pages/CreateLeaguePage.tsx'), 'CreateLeaguePage');
const DraftPage = lazyPage(() => import('./pages/DraftPage.tsx'), 'DraftPage');
const GamePage = lazyPage(() => import('./pages/GamePage.tsx'), 'GamePage');
const GuidePage = lazyPage(() => import('./pages/GuidePage.tsx'), 'GuidePage');
const HistoryPage = lazyPage(() => import('./pages/HistoryPage.tsx'), 'HistoryPage');
const JoinLeaguePage = lazyPage(() => import('./pages/JoinLeaguePage.tsx'), 'JoinLeaguePage');
const LeaguePage = lazyPage(() => import('./pages/LeaguePage.tsx'), 'LeaguePage');
const LeaguesPage = lazyPage(() => import('./pages/LeaguesPage.tsx'), 'LeaguesPage');
const MarketPage = lazyPage(() => import('./pages/MarketPage.tsx'), 'MarketPage');
const PlayerPage = lazyPage(() => import('./pages/PlayerPage.tsx'), 'PlayerPage');
const PlayoffPage = lazyPage(() => import('./pages/PlayoffPage.tsx'), 'PlayoffPage');
const ProfilePage = lazyPage(() => import('./pages/ProfilePage.tsx'), 'ProfilePage');
const ResultsPage = lazyPage(() => import('./pages/ResultsPage.tsx'), 'ResultsPage');
const RosterPage = lazyPage(() => import('./pages/RosterPage.tsx'), 'RosterPage');
const StandingsPage = lazyPage(() => import('./pages/StandingsPage.tsx'), 'StandingsPage');
const StatsPage = lazyPage(() => import('./pages/StatsPage.tsx'), 'StatsPage');
const TeamPage = lazyPage(() => import('./pages/TeamPage.tsx'), 'TeamPage');

function AuthGate() {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  // Senza login si vede solo l'accesso. Un link d'invito resta nell'indirizzo e si apre dopo: con il codice via
  // email la pagina non cambia, con Google si salva prima di andare e si rimette al ritorno (lib/returnTo.ts)
  if (!session) return <LoginPage />;
  return <Outlet />;
}

/** Errore durante il disegno di una pagina: lo prende il router, si mostra come quello dell'ErrorBoundary. */
function RouteError() {
  const error = useRouteError();
  console.error(error);
  return <ErrorScreen error={error instanceof Error ? error : new Error(String(error))} />;
}

const routes = createRoutesFromElements(
  <Route element={<AuthGate />} errorElement={<RouteError />}>
    <Route element={<Layout />}>
      <Route index element={<LeaguesPage />} />
      <Route path="crea" element={<CreateLeaguePage />} />
      <Route path="entra" element={<JoinLeaguePage />} />
      <Route path="entra/:code" element={<JoinLeaguePage />} />
      <Route path="lega/:id" element={<LeaguePage />} />
      <Route path="lega/:id/draft" element={<DraftPage />} />
      <Route path="lega/:id/squadra" element={<RosterPage />} />
      <Route path="lega/:id/squadre/:code" element={<TeamPage />} />
      <Route path="lega/:id/giocatore/:pid" element={<PlayerPage />} />
      <Route path="lega/:id/risultati" element={<ResultsPage />} />
      <Route path="lega/:id/risultati/:round" element={<ResultsPage />} />
      <Route path="lega/:id/partita/:gid" element={<GamePage />} />
      <Route path="lega/:id/classifica" element={<StandingsPage />} />
      <Route path="lega/:id/playoff" element={<PlayoffPage />} />
      <Route path="lega/:id/statistiche" element={<StatsPage />} />
      <Route path="lega/:id/mercato" element={<MarketPage />} />
      <Route path="lega/:id/draft-annuale" element={<AnnualDraftPage />} />
      <Route path="lega/:id/cronaca" element={<ChroniclePage />} />
      <Route path="lega/:id/storico" element={<HistoryPage />} />
      <Route path="profilo" element={<ProfilePage />} />
      <Route path="guida" element={<GuidePage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Route>
  </Route>,
);

// Il router legge l'indirizzo quando nasce: si crea al primo disegno, dopo che main.tsx ha rimesso la pagina di
// prima del login con Google (restorePage), e una volta sola anche con lo StrictMode
let router: ReturnType<typeof createHashRouter> | null = null;
const appRouter = () => (router ??= createHashRouter(routes));

export function App() {
  if (!configured)
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorText>
          Manca la configurazione di Supabase: copia apps/web/.env.example in apps/web/.env.local e riempilo.
        </ErrorText>
      </main>
    );
  // L'avviso di una versione nuova sta nell'intestazione (Layout): fuori dalle pagine dell'app si ricarica a mano
  return (
    <ErrorBoundary>
      <AuthProvider>
        <RouterProvider router={appRouter()} />
      </AuthProvider>
    </ErrorBoundary>
  );
}
