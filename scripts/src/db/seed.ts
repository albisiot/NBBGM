// Seed di sviluppo: una lega di prova con giocatori generati (nomi inventati, si può pubblicare), tre utenti
// di test che guidano Boston, Lakers e Knicks, il calendario completo e il primo turno aperto.
// La lega si scrive con insert_league, la stessa funzione della Edge Function create-league.
// Gli id sono uuid ricavati da un nome, così il seed è sempre lo stesso e i test sanno dove guardare.
import { ARCHETYPE_PROFILES, createLeagueState, generateLeague, Rng, type LeagueState } from '@nbbgm/engine';
import { createHash } from 'node:crypto';
import { keyedIds, leaguePayload } from '../../../supabase/functions/_shared/league.ts';

/** uuid stabile (forma v4) ricavato da un nome. */
export function stableUuid(name: string): string {
  const h = createHash('md5').update(`nbbgm:${name}`).digest('hex');
  const variant = ((parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const SEED_USERS = [
  { key: 'anna', name: 'Anna', email: 'anna@nbbgm.test', team: 'BOS' },
  { key: 'bruno', name: 'Bruno', email: 'bruno@nbbgm.test', team: 'LAL' },
  { key: 'carla', name: 'Carla', email: 'carla@nbbgm.test', team: 'NYK' },
] as const;

export type SeedUser = (typeof SEED_USERS)[number]['key'];

export interface SeedIds {
  /** Id per chiave, come li usa leaguePayload. */
  key: (key: string) => string;
  league: string;
  season: string;
  round: string;
  user: (key: SeedUser) => string;
  team: (code: string) => string;
  player: (engineId: string) => string;
  game: (year: number, turn: number, homeCode: string) => string;
}

export function seedIds(leagueKey = 'prova'): SeedIds {
  const id = (s: string) => stableUuid(`${leagueKey}:${s}`);
  return {
    key: id,
    league: id('league'),
    season: id('season:2026'),
    round: id('round:2026:0'),
    user: (key) => stableUuid(`user:${key}`),
    team: (code) => id(`team:${code}`),
    player: (engineId) => id(`player:${engineId}`),
    game: (year, turn, home) => id(`game:${year}:${turn}:${home}`),
  };
}

/** Stato engine della lega di prova: sempre lo stesso a parità di seed. */
export function seedLeagueState(seed = 'nbbgm-seed'): LeagueState {
  const data = generateLeague(new Rng(seed), ARCHETYPE_PROFILES);
  return createLeagueState(data, seed, {
    humanTeams: SEED_USERS.map((u) => u.team),
    potentialOnOverallScale: true,
  });
}

function dollarQuoted(json: string): string {
  if (json.includes('$seed$')) throw new Error('Il seed contiene il delimitatore $seed$');
  return `$seed$${json}$seed$::jsonb`;
}

/** Utenti di test in auth.users: il profilo lo crea il trigger. */
export function seedUsersSql(): string {
  const ids = seedIds();
  const users = SEED_USERS.map((u) => ({
    id: ids.user(u.key),
    instance_id: '00000000-0000-0000-0000-000000000000',
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: '2026-11-05T00:00:00Z',
    raw_user_meta_data: { name: u.name },
  }));
  const cols = Object.keys(users[0] as object).join(', ');
  return (
    `insert into auth.users (${cols})\n` +
    `select ${cols} from jsonb_populate_recordset(null::auth.users, ${dollarQuoted(JSON.stringify(users))});\n\n`
  );
}

/** Argomento di insert_league per la lega di prova. */
export function seedLeaguePayload(
  state: LeagueState = seedLeagueState(),
  ids: SeedIds = seedIds(),
): Record<string, unknown> {
  return leaguePayload(state, {
    id: keyedIds(ids.key),
    name: 'Lega di prova',
    inviteCode: 'PROVA1',
    commissionerId: ids.user('anna'),
    owners: Object.fromEntries(SEED_USERS.map((u) => [u.team, ids.user(u.key)])),
    withTeamSettings: true,
  });
}

export function buildSeedSql(state: LeagueState = seedLeagueState(), ids: SeedIds = seedIds()): string {
  return (
    '-- Generato da pnpm db:seed (scripts/src/db/seed.ts): non modificare a mano.\n' +
    '-- Lega di prova con giocatori generati e tre utenti di test.\n\n' +
    seedUsersSql() +
    `select public.insert_league(${dollarQuoted(JSON.stringify(seedLeaguePayload(state, ids)))});\n`
  );
}
