// Edge Function draft: le azioni sul draft iniziale. Il motore decide le scelte (planDraft), apply_draft_picks
// le scrive se nel frattempo nessun'altra richiesta ha fatto avanzare il draft.
//
// POST { league_id, action: 'start' | 'pick' | 'tick' | 'to-list', player_id? }  ->  { next, state, picks }
// tick si può chiamare anche senza utente (pg_cron): sceglie solo se il tempo della chiamata è scaduto.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { DraftError, planDraft, type DraftAction } from '../../../packages/engine/src/index.ts';
import { applyArgs, snapshotFromRow, type DraftSnapshotRow } from '../_shared/draft.ts';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

class RequestError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

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
const USER_ERRORS = /Il draft|Questa lega|già partito|non è in corso|andato avanti/;

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.method !== 'POST') throw new RequestError('Metodo non ammesso', 405);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const body = (await req.json().catch(() => null)) as {
      league_id?: unknown;
      action?: unknown;
      player_id?: unknown;
    } | null;
    const leagueId = typeof body?.league_id === 'string' ? body.league_id : '';
    if (!leagueId) throw new RequestError('Lega mancante');

    // Il tempo scaduto lo controlla anche pg_cron, senza utente: tick sceglie solo se la scadenza è passata
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const system = body?.action === 'tick' && !token;
    let userId = '';
    if (!system) {
      if (!token) throw new RequestError('Devi accedere', 401);
      const { data: auth, error: authError } = await admin.auth.getUser(token);
      if (authError || !auth.user) throw new RequestError('Accesso scaduto: entra di nuovo', 401);
      userId = auth.user.id;
    }

    const { data: row, error } = await admin.rpc('draft_snapshot', { p_league: leagueId });
    if (error) throw new Error(`Lettura del draft: ${error.message}`);
    if (!row) throw new RequestError('Questa lega non ha un draft iniziale', 404);
    const snapshot = snapshotFromRow(row as DraftSnapshotRow);
    // Solo chi è nella lega tocca il draft
    if (!system && snapshot.commissionerId !== userId && !Object.values(snapshot.owners).includes(userId))
      throw new RequestError('Non fai parte di questa lega', 403);

    let action: DraftAction;
    switch (body?.action) {
      case 'start':
      case 'to-list':
        action = { kind: body.action, userId };
        break;
      case 'pick':
        if (typeof body.player_id !== 'string') throw new RequestError('Giocatore mancante');
        action = { kind: 'pick', userId, playerId: body.player_id };
        break;
      case 'tick':
        action = { kind: 'tick' };
        break;
      default:
        throw new RequestError('Azione non valida');
    }

    const plan = planDraft(snapshot, action, new Date());
    const args = applyArgs(leagueId, snapshot, plan);
    let next = snapshot.next;
    if (args) {
      const { data, error: applyError } = await admin.rpc('apply_draft_picks', args);
      if (applyError) {
        if (USER_ERRORS.test(applyError.message)) throw new RequestError(applyError.message, 409);
        throw new Error(`Scrittura del draft: ${applyError.message}`);
      }
      next = data as number;
    }
    return json({
      next,
      state:
        next >= snapshot.order.length
          ? 'done'
          : args?.p_begin || snapshot.state === 'running'
            ? 'running'
            : snapshot.state,
      picks: plan.picks.length,
    });
  } catch (e) {
    if (e instanceof RequestError) return json({ error: e.message }, e.status);
    if (e instanceof DraftError) return json({ error: e.message }, 400);
    console.error(e);
    return json({ error: 'Errore del server: riprova tra poco' }, 500);
  }
});
