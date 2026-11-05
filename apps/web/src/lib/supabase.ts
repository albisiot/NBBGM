// Client Supabase del browser. URL e chiave publishable stanno in .env.local (vedi .env.example): sono fatti
// per stare nel browser, la sicurezza la fanno le policy RLS del database.
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

export const configured = Boolean(url && key);

export const supabase = createClient(url ?? 'http://localhost', key ?? 'manca-la-chiave', {
  auth: {
    // PKCE: dopo il login con Google il codice torna come ?code=..., che non si scontra con l'HashRouter
    flowType: 'pkce',
    detectSessionInUrl: true,
    persistSession: true,
    autoRefreshToken: true,
  },
});
