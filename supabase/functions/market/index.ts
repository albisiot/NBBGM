// Edge Function market: le azioni di mercato del manager (offerte agli svincolati, proposte e risposte agli
// scambi, tagli e rinnovi). Controlla l'utente, legge lo stato della lega, controlla l'azione con il motore
// (checkMarketAction) e la scrive con market_write, che la accetta solo a turno aperto. Si esegue tutto alla
// chiusura del turno.
//
// POST { league_id, action }  ->  { id }
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { checkMarketAction, MarketError, type MarketAction } from '../_shared/market.ts';
import type { LeagueStateRows } from '../_shared/state.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

function serverKey(): string {
  const secrets = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
  const key = secrets.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('Manca la chiave del server');
  return key;
}

// Errori del database che il manager deve leggere così come sono
const USER_ERRORS =
  /turno è già in chiusura|non trovata|già decisa|già chiusa|Niente da cambiare|Squadra non/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.method !== 'POST') return json({ error: 'Metodo non ammesso' }, 405);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return json({ error: 'Devi accedere' }, 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) return json({ error: 'Accesso scaduto: entra di nuovo' }, 401);

    const body = (await req.json().catch(() => null)) as { league_id?: unknown; action?: unknown } | null;
    const leagueId = typeof body?.league_id === 'string' ? body.league_id : '';
    if (!leagueId || typeof body?.action !== 'object' || body.action === null)
      return json({ error: 'Richiesta non valida' }, 400);

    const { data: rows, error } = await admin.rpc('league_state', { p_league: leagueId });
    if (error) throw new Error(`Lettura della lega: ${error.message}`);
    if (!rows) return json({ error: 'Lega non trovata' }, 404);
    const checked = checkMarketAction(rows as LeagueStateRows, auth.user.id, body.action as MarketAction);
    const { data, error: writeError } = await admin.rpc('market_write', {
      p_league: leagueId,
      p_round: checked.roundId,
      p_team: checked.teamId,
      p_action: checked.write,
    });
    if (writeError) {
      if (USER_ERRORS.test(writeError.message)) return json({ error: writeError.message }, 409);
      if (/duplicate key/.test(writeError.message))
        return json({ error: 'Richiesta già fatta in questo turno' }, 409);
      throw new Error(`Scrittura: ${writeError.message}`);
    }
    return json(data);
  } catch (e) {
    if (e instanceof MarketError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'Errore del server: riprova tra poco' }, 500);
  }
});
