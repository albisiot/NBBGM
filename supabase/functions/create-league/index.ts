// Edge Function create-league: crea una lega nuova dai dati di partenza (tabelle base_*) per l'utente che la
// chiama, che ne diventa commissario e guida la squadra scelta. Le altre 29 squadre restano ai bot.
//
// POST { name, team, settings? }  ->  { league_id, invite_code }
// settings.roster_mode 'draft': rose vuote e draft iniziale (settings.draft_mode, settings.pick_seconds).
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { createLeagueState, TEAMS } from '../../../packages/engine/src/index.ts';
import {
  BASE_DATASET,
  keyedIds,
  LEAGUE_LIMIT_MESSAGE,
  leagueFromBaseRows,
  leaguePayload,
  MAX_LEAGUES_PER_USER,
  readSettings,
  SettingsError,
  type BaseRows,
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
    let settings: ReturnType<typeof readSettings>;
    try {
      settings = readSettings(body?.settings);
    } catch (e) {
      throw e instanceof SettingsError ? new RequestError(e.message) : e;
    }

    // Il limite lo ricontrolla il database (trigger su leagues): qui si evita di preparare la lega per niente
    const { count, error: countError } = await admin
      .from('leagues')
      .select('id', { count: 'exact', head: true })
      .eq('commissioner_id', auth.user.id);
    if (countError) throw new Error(`Conteggio delle leghe: ${countError.message}`);
    if ((count ?? 0) >= MAX_LEAGUES_PER_USER) throw new RequestError(LEAGUE_LIMIT_MESSAGE, 409);

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

    // Con il draft iniziale le rose partono vuote e i contratti del file passano a chi sceglie i giocatori
    const leagueData = leagueFromBaseRows(rows);
    const draft = settings.roster_mode === 'draft';
    const state = createLeagueState(leagueData, crypto.randomUUID(), {
      humanTeams: [team],
      emptyRosters: draft,
    });
    const { pick_seconds: pickSeconds, ...leagueSettings } = settings;
    const payload = leaguePayload(state, {
      id: keyedIds(() => crypto.randomUUID()),
      name,
      commissionerId: auth.user.id,
      owners: { [team]: auth.user.id },
      settings: leagueSettings,
      initialDraft: draft
        ? { mode: settings.draft_mode, pickSeconds, contracts: leagueData.contracts }
        : undefined,
    });
    const { data, error } = await admin.rpc('insert_league', { p_league: payload });
    if (error?.hint === 'league_limit') throw new RequestError(LEAGUE_LIMIT_MESSAGE, 409);
    // Limite di tutto il database o spazio quasi esaurito: il messaggio del database è già per il manager
    if (error?.hint === 'league_limit_total' || error?.hint === 'storage_full')
      throw new RequestError(error.message, 409);
    if (error) throw new Error(`Scrittura della lega: ${error.message}`);
    return json(data);
  } catch (e) {
    if (e instanceof RequestError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Non è stato possibile creare la lega: riprova tra poco' }, 500);
  }
});
