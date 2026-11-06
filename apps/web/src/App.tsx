// Rotte dell'app. HashRouter perché GitHub Pages non gestisce le rotte di una single page app.
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { Layout } from './components/Layout.tsx';
import { ErrorText, Spinner } from './components/ui.tsx';
import { UpdateBanner } from './components/UpdateBanner.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { lazyPage } from './lib/lazyPage.ts';
import { configured } from './lib/supabase.ts';
import { LoginPage } from './pages/LoginPage.tsx';

// Le pagine arrivano a pezzi quando si aprono (lib/lazyPage.ts); l'accesso no, perché è la prima cosa che si vede
const AnnualDraftPage = lazyPage(() => import('./pages/AnnualDraftPage.tsx'), 'AnnualDraftPage');
const CreateLeaguePage = lazyPage(() => import('./pages/CreateLeaguePage.tsx'), 'CreateLeaguePage');
const DraftPage = lazyPage(() => import('./pages/DraftPage.tsx'), 'DraftPage');
const GamePage = lazyPage(() => import('./pages/GamePage.tsx'), 'GamePage');
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

function Routed() {
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
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<LeaguesPage />} />
        <Route path="crea" element={<CreateLeaguePage />} />
        <Route path="entra" element={<JoinLeaguePage />} />
        <Route path="entra/:code" element={<JoinLeaguePage />} />
        <Route path="lega/:id" element={<LeaguePage />} />
        <Route path="lega/:id/draft" element={<DraftPage />} />
        <Route path="lega/:id/squadra" element={<RosterPage />} />
        <Route path="lega/:id/giocatore/:pid" element={<PlayerPage />} />
        <Route path="lega/:id/risultati" element={<ResultsPage />} />
        <Route path="lega/:id/risultati/:round" element={<ResultsPage />} />
        <Route path="lega/:id/partita/:gid" element={<GamePage />} />
        <Route path="lega/:id/classifica" element={<StandingsPage />} />
        <Route path="lega/:id/playoff" element={<PlayoffPage />} />
        <Route path="lega/:id/statistiche" element={<StatsPage />} />
        <Route path="lega/:id/mercato" element={<MarketPage />} />
        <Route path="lega/:id/draft-annuale" element={<AnnualDraftPage />} />
        <Route path="profilo" element={<ProfilePage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export function App() {
  if (!configured)
    return (
      <main className="mx-auto max-w-md p-6">
        <ErrorText>
          Manca la configurazione di Supabase: copia apps/web/.env.example in apps/web/.env.local e riempilo.
        </ErrorText>
      </main>
    );
  return (
    <>
      <ErrorBoundary>
        <AuthProvider>
          <HashRouter>
            <Routed />
          </HashRouter>
        </AuthProvider>
      </ErrorBoundary>
      <UpdateBanner />
    </>
  );
}
