// Seed di sviluppo: una lega di prova con giocatori generati (nomi inventati, si può pubblicare), tre utenti
// di test che guidano Boston, Lakers e Knicks, il calendario completo e il primo turno aperto.
// Gli id sono uuid ricavati da un nome, così il seed è sempre lo stesso e i test sanno dove guardare.
import {
  ARCHETYPE_PROFILES,
  autoSetup,
  createLeagueState,
  generateLeague,
  roster,
  Rng,
  type LeagueState,
} from '@nbbgm/engine';
import { createHash } from 'node:crypto';

/** uuid stabile (forma v4) ricavato da un nome. */
export function stableUuid(name: string): string {
  const h = createHash('md5').update(`nbbgm:${name}`).digest('hex');
  const variant = ((parseInt(h[16] as string, 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export const SEED_USERS = [
  { key: 'anna', name: 'Anna', email: 'anna@nbbgm.test', team: 'BOS', role: 'commissioner' },
  { key: 'bruno', name: 'Bruno', email: 'bruno@nbbgm.test', team: 'LAL', role: 'manager' },
  { key: 'carla', name: 'Carla', email: 'carla@nbbgm.test', team: 'NYK', role: 'manager' },
] as const;

export type SeedUser = (typeof SEED_USERS)[number]['key'];

export interface SeedIds {
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

/** Righe json come insert ... select da jsonb_populate_recordset: niente problemi di apici nei nomi. */
function insertRows(table: string, rows: readonly Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0] as Record<string, unknown>);
  const json = '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]';
  if (json.includes('$seed$')) throw new Error('Il seed contiene il delimitatore $seed$');
  return (
    `insert into ${table} (${cols.join(', ')})\n` +
    `select ${cols.join(', ')} from jsonb_populate_recordset(null::${table}, $seed$${json}$seed$::jsonb);\n\n`
  );
}

export function buildSeedSql(state: LeagueState = seedLeagueState(), ids: SeedIds = seedIds()): string {
  const year = state.config.year;
  const owner = new Map<string, string>(SEED_USERS.map((u) => [u.team, ids.user(u.key)]));
  const playerId = (id: string) => ids.player(id);
  const teamId = (code: string | null) => (code === null ? null : ids.team(code));
  let sql =
    '-- Generato da pnpm db:seed (scripts/src/db/seed.ts): non modificare a mano.\n' +
    '-- Lega di prova con giocatori generati e tre utenti di test.\n\n';

  sql += insertRows(
    'auth.users',
    SEED_USERS.map((u) => ({
      id: ids.user(u.key),
      instance_id: '00000000-0000-0000-0000-000000000000',
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      email_confirmed_at: '2026-11-05T00:00:00Z',
      raw_user_meta_data: { name: u.name },
    })),
  );
  // Il profilo lo crea il trigger su auth.users
  sql += insertRows('public.leagues', [
    {
      id: ids.league,
      name: 'Lega di prova',
      invite_code: 'PROVA1',
      commissioner_id: ids.user('anna'),
      deadline_minutes: null,
      max_pace_seconds: 60,
      roster_mode: 'real',
      draft_mode: 'list',
      rookie_source: 'generated',
      paused: false,
      seed: state.seed,
      talent_reference: state.talentReference,
    },
  ]);
  sql += insertRows(
    'public.league_members',
    SEED_USERS.map((u) => ({ league_id: ids.league, user_id: ids.user(u.key), role: u.role })),
  );
  const c = state.config;
  sql += insertRows('public.seasons', [
    {
      id: ids.season,
      league_id: ids.league,
      year,
      phase: 'regular',
      salary_cap: c.salaryCap,
      luxury_tax: c.luxuryTax,
      first_apron: c.firstApron,
      second_apron: c.secondApron,
      minimum_team_salary: c.minimumTeamSalary,
      minimum_salary: c.minimumSalary,
      rookie_scale: c.rookieScale,
      revenue: c.revenue,
      growth: c.growth,
    },
  ]);
  sql += insertRows(
    'public.teams',
    state.teams.map((t) => ({
      id: ids.team(t.id),
      league_id: ids.league,
      code: t.id,
      city: t.city,
      name: t.name,
      full_name: t.fullName,
      conference: t.conference,
      division: t.division,
      owner_id: owner.get(t.id) ?? null,
      balance: Math.round(t.balance),
      strategy: t.strategy,
      tax_history: t.taxHistory,
    })),
  );
  sql += insertRows(
    'public.players',
    state.players.map((p) => ({
      id: playerId(p.id),
      league_id: ids.league,
      slug: p.id,
      team_id: teamId(p.teamId),
      first_name: p.firstName,
      last_name: p.lastName,
      nationality: p.nationality,
      role: p.role,
      secondary_role: p.secondaryRole,
      hand: p.hand,
      archetype: p.archetype,
      age: p.age,
      height_cm: p.heightCm,
      wingspan_cm: p.wingspanCm,
      weight_kg: p.weightKg,
      years_in_league: p.yearsInLeague,
      ratings: p.ratings,
      tendencies: p.tendencies,
      energy: p.energy,
      morale: p.morale,
      scouted_potential: p.scoutedPotential,
      two_way_games: p.twoWayGames,
      season_stats: p.stats,
      retired: false,
    })),
  );
  sql += insertRows(
    'public.player_hidden',
    state.players.map((p) => ({ player_id: playerId(p.id), league_id: ids.league, hidden: p.hidden })),
  );
  sql += insertRows(
    'public.injuries',
    state.players
      .filter((p) => p.injury !== null)
      .map((p) => ({
        player_id: playerId(p.id),
        league_id: ids.league,
        body_part: p.injury?.bodyPart,
        severity: p.injury?.severity,
        games_remaining: p.injury?.gamesRemaining,
      })),
  );
  sql += insertRows(
    'public.contracts',
    state.contracts.map((k) => ({
      player_id: playerId(k.playerId),
      league_id: ids.league,
      team_id: ids.team(k.teamId),
      type: k.type,
      salaries: k.salaries,
      options: k.options,
      guaranteed: k.guaranteed,
    })),
  );
  sql += insertRows(
    'public.dead_money',
    state.deadMoney.map((d, i) => ({
      id: stableUuid(`prova:dead:${i}`),
      league_id: ids.league,
      team_id: ids.team(d.teamId),
      player_name: d.playerName,
      salaries: d.salaries,
    })),
  );
  sql += insertRows(
    'public.draft_picks',
    state.picks.map((p) => ({
      id: stableUuid(`prova:pick:${p.id}`),
      league_id: ids.league,
      draft_year: p.draftYear,
      round: p.round,
      original_team_id: ids.team(p.originalTeamId),
      owner_team_id: ids.team(p.ownerId),
      protection: p.protection,
      deferrals: p.deferrals,
    })),
  );
  sql += insertRows('public.rounds', [
    {
      id: ids.round,
      league_id: ids.league,
      season_id: ids.season,
      number: 0,
      kind: 'regular',
      state: 'open',
    },
  ]);
  sql += insertRows(
    'public.games',
    state.schedule.map((g) => ({
      id: ids.game(year, g.turn, g.homeId),
      league_id: ids.league,
      season_id: ids.season,
      round_number: g.turn,
      kind: 'regular',
      home_team_id: ids.team(g.homeId),
      away_team_id: ids.team(g.awayId),
    })),
  );
  // Impostazioni salvate delle squadre umane: quelle del pulsante Auto
  sql += insertRows(
    'public.team_settings',
    SEED_USERS.map((u) => {
      const team = state.teams.find((t) => t.id === u.team);
      const setup = autoSetup(u.team, roster(state, u.team), team?.tactics);
      return {
        team_id: ids.team(u.team),
        league_id: ids.league,
        starters: setup.starters.map(playerId),
        minutes: Object.fromEntries(Object.entries(setup.minutes).map(([id, m]) => [playerId(id), m])),
        tactics: setup.tactics,
      };
    }),
  );
  sql +=
    `update public.leagues set current_season_id = '${ids.season}', current_round_id = '${ids.round}'\n` +
    `where id = '${ids.league}';\n`;
  return sql;
}
