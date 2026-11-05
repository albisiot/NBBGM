// Edge Function create-league: crea una lega nuova dai dati di partenza (tabelle base_*) per l'utente che la
// chiama, che ne diventa commissario e guida la squadra scelta. Le altre 29 squadre restano ai bot.
//
// POST { name, team, settings? }  ->  { league_id, invite_code }
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createLeagueState, TEAMS } from '../../../packages/engine/src/index.ts';
import {
  BASE_DATASET,
  DEFAULT_SETTINGS,
  keyedIds,
  leagueFromBaseRows,
  leaguePayload,
  type BaseRows,
  type LeagueSettings,
} from '../_shared/league.ts';

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

/** Impostazioni della lega dalla richiesta, con i controlli dei valori ammessi. */
function readSettings(raw: unknown): LeagueSettings {
  const s = {
    ...DEFAULT_SETTINGS,
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
  } as LeagueSettings;
  if (s.deadline_minutes !== null && !(Number.isInteger(s.deadline_minutes) && s.deadline_minutes > 0))
    throw new RequestError('Scadenza dei turni non valida');
  if (!(Number.isInteger(s.max_pace_seconds) && s.max_pace_seconds >= 0))
    throw new RequestError('Ritmo massimo non valido');
  if (s.roster_mode !== 'real')
    throw new RequestError('Il draft iniziale arriva con la Fase 7: per ora rose reali');
  if (!['list', 'live'].includes(s.draft_mode)) throw new RequestError('Modalità del draft non valida');
  if (!['generated', 'real'].includes(s.rookie_source))
    throw new RequestError('Origine dei rookie non valida');
  return {
    deadline_minutes: s.deadline_minutes,
    max_pace_seconds: s.max_pace_seconds,
    roster_mode: s.roster_mode,
    draft_mode: s.draft_mode,
    rookie_source: s.rookie_source,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  try {
    if (req.method !== 'POST') throw new RequestError('Metodo non ammesso', 405);
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // Chi chiama: il JWT dell'utente arriva nell'intestazione Authorization
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) throw new RequestError('Devi accedere per creare una lega', 401);
    const { data: auth, error: authError } = await admin.auth.getUser(token);
    if (authError || !auth.user) throw new RequestError('Accesso scaduto: entra di nuovo', 401);

    const body = (await req.json().catch(() => null)) as {
      name?: unknown;
      team?: unknown;
      settings?: unknown;
    } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (name.length < 1 || name.length > 60)
      throw new RequestError('Il nome della lega va da 1 a 60 caratteri');
    const team = typeof body?.team === 'string' ? body.team.toUpperCase() : '';
    if (!TEAMS.some((t) => t.id === team)) throw new RequestError('Squadra non valida');
    const settings = readSettings(body?.settings);

    const load = async <T>(table: string): Promise<T[]> => {
      const { data, error } = await admin.from(table).select('*').eq('dataset', BASE_DATASET);
      if (error) throw new Error(`Lettura di ${table}: ${error.message}`);
      return data as T[];
    };
    const rows: BaseRows = {
      players: await load('base_players'),
      contracts: await load('base_contracts'),
      deadMoney: await load('base_dead_money'),
    };
    if (rows.players.length === 0) throw new Error(`Nessun giocatore nel dataset ${BASE_DATASET}`);

    const state = createLeagueState(leagueFromBaseRows(rows), crypto.randomUUID(), { humanTeams: [team] });
    const payload = leaguePayload(state, {
      id: keyedIds(() => crypto.randomUUID()),
      name,
      commissionerId: auth.user.id,
      owners: { [team]: auth.user.id },
      settings,
    });
    const { data, error } = await admin.rpc('insert_league', { p_league: payload });
    if (error) throw new Error(`Scrittura della lega: ${error.message}`);
    return json(data);
  } catch (e) {
    if (e instanceof RequestError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Non è stato possibile creare la lega: riprova tra poco' }, 500);
  }
});
