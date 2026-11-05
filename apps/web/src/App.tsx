// Rotte dell'app. HashRouter perché GitHub Pages non gestisce le rotte di una single page app.
import { HashRouter, Navigate, Route, Routes } from 'react-router';
import { Layout } from './components/Layout.tsx';
import { ErrorText, Spinner } from './components/ui.tsx';
import { AuthProvider, useAuth } from './lib/auth.tsx';
import { configured } from './lib/supabase.ts';
import { CreateLeaguePage } from './pages/CreateLeaguePage.tsx';
import { DraftPage } from './pages/DraftPage.tsx';
import { JoinLeaguePage } from './pages/JoinLeaguePage.tsx';
import { LeaguePage } from './pages/LeaguePage.tsx';
import { LeaguesPage } from './pages/LeaguesPage.tsx';
import { LoginPage } from './pages/LoginPage.tsx';
import { ProfilePage } from './pages/ProfilePage.tsx';

function Routed() {
  const { session, loading } = useAuth();
  if (loading)
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <Spinner />
      </div>
    );
  // Senza login si vede solo l'accesso; un link d'invito resta nell'indirizzo e si apre dopo
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
    <AuthProvider>
      <HashRouter>
        <Routed />
      </HashRouter>
    </AuthProvider>
  );
}
