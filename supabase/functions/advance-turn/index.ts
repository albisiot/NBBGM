// Edge Function advance-turn: chiude e simula il turno corrente di una lega, se è il momento. La chiamano il
// database (pg_net) all'ultimo Pronto o quando il commissario forza, e pg_cron per scadenze, ritmo degli
// allenatori e riprese. Chi chiama non decide nulla: try_close_round controlla nel database se il turno va
// chiuso e lascia passare solo la prima chiamata, apply_turn scrive tutto in una sola transazione.
//
// POST { league_id }  ->  { advanced: false } | { advanced: true, reason, next_round, summary }
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { advanceLeague, type ServerDb } from '../_shared/turn.ts';

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'Metodo non ammesso' }, 405);
  const body = (await req.json().catch(() => null)) as { league_id?: unknown } | null;
  const leagueId = typeof body?.league_id === 'string' ? body.league_id : '';
  if (!/^[0-9a-f-]{36}$/i.test(leagueId)) return json({ error: 'Lega mancante' }, 400);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const db: ServerDb = {
      async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
        const { data, error } = await admin.rpc(name, args);
        if (error) throw new Error(`${name}: ${error.message}`);
        return data as T;
      },
    };
    const started = Date.now();
    const r = await advanceLeague(db, leagueId, { newId: () => crypto.randomUUID() });
    if (!r.advanced) return json({ advanced: false });
    console.log(
      `Lega ${leagueId}: giornata ${r.summary.round + 1} simulata (${r.reason}${r.reclaimed ? ', ripresa' : ''}) in ${Date.now() - started} ms`,
    );
    return json({ advanced: true, reason: r.reason, next_round: r.nextRoundId, summary: r.summary });
  } catch (e) {
    // Il turno resta in chiusura: pg_cron lo riprende fra 5 minuti con lo stesso seed
    console.error(e);
    return json({ error: 'Errore del server: il turno verrà ripreso tra poco' }, 500);
  }
});
