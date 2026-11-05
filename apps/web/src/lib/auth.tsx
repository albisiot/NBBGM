// Sessione e profilo dell'utente, condivisi da tutta l'app.
import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { supabase } from './supabase.ts';

interface AuthState {
  session: Session | null;
  loading: boolean;
  displayName: string;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
      // Dopo il login con Google il codice resta nell'indirizzo: lo si toglie
      if (new URLSearchParams(window.location.search).has('code')) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const refreshProfile = useCallback(async () => {
    if (!userId) return setDisplayName('');
    const { data } = await supabase.from('profiles').select('display_name').eq('id', userId).maybeSingle();
    setDisplayName(data?.display_name ?? '');
  }, [userId]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return (
    <AuthContext.Provider value={{ session, loading, displayName, refreshProfile, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth fuori da AuthProvider');
  return ctx;
}

/** Id dell'utente collegato: le pagine sotto il login lo hanno sempre. */
export function useUserId(): string {
  const { session } = useAuth();
  if (!session) throw new Error('Utente non collegato');
  return session.user.id;
}
