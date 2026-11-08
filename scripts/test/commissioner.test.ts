// Dopo la Fase 13: strumenti del commissario (liberare una squadra, espellere un manager), uscita dalla lega,
// cancellazione della lega e dell'account, limite delle leghe per utente e pulizia notturna del database, su
// PGlite. Le leghe si creano come nella Edge Function create-league (vedi leagues.test.ts).
import type { PGlite } from '@electric-sql/pglite';
import { ARCHETYPE_PROFILES, createLeagueState, generateLeague, Rng } from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_DATASET,
  keyedIds,
  leagueFromBaseRows,
  leaguePayload,
  MAX_LEAGUES_PER_USER,
  type BaseRows,
} from '../../supabase/functions/_shared/league.ts';
import { buildBaseSql } from '../src/db/base.ts';
import { stableUuid } from '../src/db/seed.ts';
import { asService, asUser, createTestDb } from '../src/db/testdb.ts';

const USERS = ['giulia', 'marco', 'luca', 'nicola', 'paolo', 'sara'] as const;
const U = Object.fromEntries(USERS.map((u) => [u, stableUuid(`user:${u}-commissario`)])) as Record<
  (typeof USERS)[number],
  string
>;

let db: PGlite;
let base: BaseRows;

beforeAll(async () => {
  db = await createTestDb();
  const data = generateLeague(new Rng('dati-commissario'), ARCHETYPE_PROFILES, { season: BASE_DATASET });
  await db.exec(buildBaseSql(data, BASE_DATASET));
  for (const u of USERS)
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      U[u],
      `${u}@nbbgm.test`,
      { name: u[0]!.toUpperCase() + u.slice(1) },
    ]);
  const rows = async <T>(table: string) =>
    (await db.query<T>(`select * from public.${table} where dataset = $1`, [BASE_DATASET])).rows;
  base = {
    players: await rows('base_players'),
    contracts: await rows('base_contracts'),
    deadMoney: await rows('base_dead_money'),
  };
}, 120_000);

/** Come la Edge Function create-league, con insert_league come server. */
async function createLeague(name: string, commissioner: string, team: string) {
  const state = createLeagueState(leagueFromBaseRows(base), randomUUID(), {
    humanTeams: [team],
  });
  const payload = leaguePayload(state, {
    id: keyedIds(() => randomUUID()),
    name,
    commissionerId: commissioner,
    owners: { [team]: commissioner },
  });
  return asService(
    db,
    async (tx) =>
      (
        await tx.query<{ r: { league_id: string; invite_code: string } }>(
          'select public.insert_league($1) as r',
          [payload],
        )
      ).rows[0]!.r,
  );
}

const join = (user: string, code: string, team: string) =>
  asUser(db, user, (tx) => tx.query('select public.join_league($1, $2)', [code, team]));
const call = (user: string, sql: string, params: unknown[]) =>
  asUser(db, user, (tx) => tx.query(sql, params));
const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0]!;
const teamId = async (league: string, code: string) =>
  (
    await one<{ id: string }>('select id from public.teams where league_id = $1 and code = $2', [
      league,
      code,
    ])
  ).id;
const isMember = async (league: string, user: string) =>
  (
    await one<{ n: number }>(
      'select count(*)::int as n from public.league_members where league_id = $1 and user_id = $2',
      [league, user],
    )
  ).n === 1;

describe('squadre liberate, manager espulsi e uscite', () => {
  let league: { league_id: string; invite_code: string };
  let LAL: string;
  let MIA: string;

  beforeAll(async () => {
    league = await createLeague('Lega del commissario', U.giulia, 'BOS');
    await join(U.marco, league.invite_code, 'LAL');
    await join(U.luca, league.invite_code, 'MIA');
    LAL = await teamId(league.league_id, 'LAL');
    MIA = await teamId(league.league_id, 'MIA');
  });

  /** Luca ha cose in sospeso: Pronto, allenatore, un avviso, un'offerta, un taglio e uno scambio con Marco. */
  async function pending() {
    const round = await one<{ id: string }>(
      'select current_round_id as id from public.leagues where id = $1',
      [league.league_id],
    );
    await call(U.luca, 'select public.set_ready($1, true)', [MIA]);
    await db.query(
      `insert into public.coach_delegations (team_id, league_id, active) values ($1, $2, true)
       on conflict (team_id) do update set active = true`,
      [MIA, league.league_id],
    );
    await db.query(
      `insert into public.alerts (league_id, team_id, kind, blocking, round_id) values ($1, $2, 'injury', false, $3)`,
      [league.league_id, MIA, round.id],
    );
    const free = await one<{ id: string }>(
      'select id from public.players where league_id = $1 and team_id is null limit 1',
      [league.league_id],
    );
    await db.query(
      `insert into public.free_agent_bids (league_id, round_id, team_id, player_id, salaries)
       values ($1, $2, $3, $4, '{1500000}')`,
      [league.league_id, round.id, MIA, free.id],
    );
    const mine = await one<{ id: string }>('select id from public.players where team_id = $1 limit 1', [MIA]);
    await db.query(
      `insert into public.roster_requests (league_id, team_id, round_id, player_id, kind)
       values ($1, $2, $3, $4, 'release')`,
      [league.league_id, MIA, round.id, mine.id],
    );
    const trade = await one<{ id: string }>(
      `insert into public.trade_offers (league_id, from_team_id, to_team_id, players_from, created_round_id)
       values ($1, $2, $3, $4, $5) returning id`,
      [league.league_id, MIA, LAL, [mine.id], round.id],
    );
    await db.query(
      `insert into public.alerts (league_id, team_id, kind, blocking, round_id, payload)
       values ($1, $2, 'trade_offer', true, $3, $4)`,
      [league.league_id, LAL, round.id, { trade_id: trade.id }],
    );
    return trade.id;
  }

  it('solo il commissario libera le squadre, e non la propria', async () => {
    await expect(call(U.marco, 'select public.free_team($1)', [MIA])).rejects.toThrow(/Solo il commissario/);
    await expect(call(U.marco, 'select public.expel_manager($1)', [MIA])).rejects.toThrow(
      /Solo il commissario/,
    );
    const bos = await teamId(league.league_id, 'BOS');
    await expect(call(U.giulia, 'select public.free_team($1)', [bos])).rejects.toThrow(/propria squadra/);
    await expect(
      call(U.giulia, 'select public.free_team($1)', [await teamId(league.league_id, 'NYK')]),
    ).rejects.toThrow(/già guidata dal bot/);
  });

  it('non mentre il turno si simula', async () => {
    await db.query(
      `update public.rounds set state = 'closing', closing_started_at = now()
       where id = (select current_round_id from public.leagues where id = $1)`,
      [league.league_id],
    );
    await expect(call(U.giulia, 'select public.free_team($1)', [MIA])).rejects.toThrow(/si sta simulando/);
    await expect(call(U.luca, 'select public.leave_league($1)', [league.league_id])).rejects.toThrow(
      /si sta simulando/,
    );
    await db.query(
      `update public.rounds set state = 'open', closing_started_at = null
       where id = (select current_round_id from public.leagues where id = $1)`,
      [league.league_id],
    );
  });

  it('la squadra liberata torna al bot e il manager esce, con le sue cose in sospeso', async () => {
    const trade = await pending();
    await call(U.giulia, 'select public.free_team($1)', [MIA]);
    expect(
      (await one<{ owner_id: string | null }>('select owner_id from public.teams where id = $1', [MIA]))
        .owner_id,
    ).toBeNull();
    expect(await isMember(league.league_id, U.luca)).toBe(false);
    // Luca non vede più la lega
    const seen = await call(U.luca, 'select id from public.leagues', []);
    expect(seen.rows).toEqual([]);
    const counts = await one<Record<string, number>>(
      `select
         (select count(*)::int from public.ready_flags where team_id = $1) as ready,
         (select count(*)::int from public.coach_delegations where team_id = $1) as coach,
         (select count(*)::int from public.alerts where team_id = $1 and status = 'open') as alerts,
         (select count(*)::int from public.free_agent_bids where team_id = $1 and status = 'pending') as bids,
         (select count(*)::int from public.roster_requests where team_id = $1 and status = 'pending') as requests,
         (select count(*)::int from public.alerts where team_id = $2 and status = 'open') as other_alerts`,
      [MIA, LAL],
    );
    expect(counts).toEqual({ ready: 0, coach: 0, alerts: 0, bids: 0, requests: 0, other_alerts: 0 });
    expect(
      (await one<{ status: string }>('select status from public.trade_offers where id = $1', [trade])).status,
    ).toBe('withdrawn');
    // Rientra con il codice invito, anche nella stessa squadra
    await join(U.luca, league.invite_code, 'MIA');
    expect(await isMember(league.league_id, U.luca)).toBe(true);
  });

  it('il manager espulso non rientra', async () => {
    await call(U.giulia, 'select public.expel_manager($1)', [MIA]);
    expect(await isMember(league.league_id, U.luca)).toBe(false);
    await expect(join(U.luca, league.invite_code, 'MIA')).rejects.toThrow(/ti ha escluso/);
    await expect(join(U.luca, league.invite_code, 'CHI')).rejects.toThrow(/ti ha escluso/);
    // L'elenco degli esclusi non si legge dal client
    await expect(call(U.giulia, 'select * from public.league_bans', [])).rejects.toThrow(/permission denied/);
  });

  it('un manager lascia la lega, il commissario no', async () => {
    await expect(call(U.giulia, 'select public.leave_league($1)', [league.league_id])).rejects.toThrow(
      /commissario non può lasciare/,
    );
    await expect(call(U.sara, 'select public.leave_league($1)', [league.league_id])).rejects.toThrow(
      /Non fai parte/,
    );
    await call(U.marco, 'select public.leave_league($1)', [league.league_id]);
    expect(await isMember(league.league_id, U.marco)).toBe(false);
    expect(
      (await one<{ owner_id: string | null }>('select owner_id from public.teams where id = $1', [LAL]))
        .owner_id,
    ).toBeNull();
  });
});

describe('leghe per utente', () => {
  it(`al massimo ${MAX_LEAGUES_PER_USER} leghe create`, async () => {
    // Leghe già create da Nicola, scritte direttamente (basta la riga di leagues per il conteggio)
    for (let i = 0; i < MAX_LEAGUES_PER_USER; i++)
      await db.query(
        `insert into public.leagues (name, invite_code, commissioner_id, seed) values ($1, $2, $3, 'x')`,
        [`Vecchia ${i}`, `VECCH${i}`, U.nicola],
      );
    await expect(createLeague('Una di troppo', U.nicola, 'BOS')).rejects.toThrow(
      new RegExp(`Hai già creato ${MAX_LEAGUES_PER_USER} leghe`),
    );
    // Eliminata una, se ne crea un'altra
    await db.query(`delete from public.leagues where invite_code = 'VECCH0'`);
    const created = await createLeague('Al posto della vecchia', U.nicola, 'BOS');
    expect(created.league_id).toBeTruthy();
  });
});

describe('eliminare una lega', () => {
  it('solo il commissario, ripetendo il nome; sparisce tutto quello che contiene', async () => {
    const league = await createLeague('Da eliminare', U.giulia, 'BOS');
    await join(U.marco, league.invite_code, 'LAL');
    const L = league.league_id;
    // Una partita giocata, una serie e un box score: righe che puntano alle squadre senza on delete
    const g = await one<{ id: string; season_id: string; home_team_id: string; away_team_id: string }>(
      'select id, season_id, home_team_id, away_team_id from public.games where league_id = $1 limit 1',
      [L],
    );
    await db.query(
      `insert into public.playoff_series (league_id, season_id, round, high_team_id, low_team_id, high_seed, low_seed)
       values ($1, $2, 1, $3, $4, 1, 8)`,
      [L, g.season_id, g.home_team_id, g.away_team_id],
    );
    const p = await one<{ id: string }>('select id from public.players where team_id = $1 limit 1', [
      g.home_team_id,
    ]);
    await db.query(
      `insert into public.player_game_stats (game_id, player_id, team_id, league_id, pts) values ($1, $2, $3, $4, 10)`,
      [g.id, p.id, g.home_team_id, L],
    );

    await expect(call(U.marco, 'select public.delete_league($1, $2)', [L, 'Da eliminare'])).rejects.toThrow(
      /Solo il commissario/,
    );
    await expect(call(U.giulia, 'select public.delete_league($1, $2)', [L, 'Un altro nome'])).rejects.toThrow(
      /nome esatto/,
    );
    await call(U.giulia, 'select public.delete_league($1, $2)', [L, '  da ELIMINARE ']);

    const tables = await db.query<{ table_name: string }>(
      `select table_name from information_schema.columns
       where table_schema = 'public' and column_name = 'league_id' order by table_name`,
    );
    expect(tables.rows.length).toBeGreaterThan(20);
    for (const { table_name } of tables.rows) {
      const n = await one<{ n: number }>(
        `select count(*)::int as n from public.${table_name} where league_id = $1`,
        [L],
      );
      expect(n.n, table_name).toBe(0);
    }
    expect(
      (await one<{ n: number }>('select count(*)::int as n from public.leagues where id = $1', [L])).n,
    ).toBe(0);
  });
});

describe('account cancellato', () => {
  it('le leghe del commissario passano a chi è entrato per primo, o spariscono', async () => {
    const shared = await createLeague('Di Paolo con amici', U.paolo, 'BOS');
    await join(U.sara, shared.invite_code, 'LAL');
    await join(U.giulia, shared.invite_code, 'MIA');
    const alone = await createLeague('Di Paolo da solo', U.paolo, 'NYK');
    await db.query('delete from auth.users where id = $1', [U.paolo]);
    const l = await one<{ commissioner_id: string }>(
      'select commissioner_id from public.leagues where id = $1',
      [shared.league_id],
    );
    expect(l.commissioner_id).toBe(U.sara);
    const role = await one<{ role: string }>(
      'select role from public.league_members where league_id = $1 and user_id = $2',
      [shared.league_id, U.sara],
    );
    expect(role.role).toBe('commissioner');
    expect(
      (
        await one<{ owner_id: string | null }>(
          'select owner_id from public.teams where league_id = $1 and code = $2',
          [shared.league_id, 'BOS'],
        )
      ).owner_id,
    ).toBeNull();
    expect(
      (
        await one<{ n: number }>('select count(*)::int as n from public.leagues where id = $1', [
          alone.league_id,
        ])
      ).n,
    ).toBe(0);
  });
});

describe('pulizia notturna', () => {
  it('toglie lo storico vecchio di pg_cron e la cronaca delle stagioni passate', async () => {
    const league = await createLeague('Tre stagioni', U.giulia, 'BOS');
    const L = league.league_id;
    // Due stagioni passate, con una partita giocata ciascuna, e una partita giocata in quella in corso
    const current = await one<{ id: string; year: number }>(
      `select s.id, s.year from public.leagues l join public.seasons s on s.id = l.current_season_id where l.id = $1`,
      [L],
    );
    const play = [[1, 700, 'h', 'Canestro', 2, 0]];
    const seasons: Record<string, string> = { current: current.id };
    for (const [key, back] of [
      ['previous', 1],
      ['old', 2],
    ] as const) {
      seasons[key] = (
        await one<{ id: string }>(
          `insert into public.seasons (league_id, year, phase, salary_cap, luxury_tax, first_apron, second_apron,
             minimum_team_salary, minimum_salary, rookie_scale, revenue, growth)
           select league_id, year - $2, 'offseason', salary_cap, luxury_tax, first_apron, second_apron,
             minimum_team_salary, minimum_salary, rookie_scale, revenue, growth
           from public.seasons where id = $1 returning id`,
          [current.id, back],
        )
      ).id;
    }
    const teams = await db.query<{ id: string }>('select id from public.teams where league_id = $1 limit 2', [
      L,
    ]);
    for (const season of Object.values(seasons))
      await db.query(
        `insert into public.games (league_id, season_id, round_number, home_team_id, away_team_id, home_score,
           away_score, play_by_play)
         values ($1, $2, 500, $3, $4, 100, 90, $5)`,
        [L, season, teams.rows[0]!.id, teams.rows[1]!.id, JSON.stringify(play)],
      );
    // Lo storico di pg_cron (su PGlite non c'è: lo si imita)
    await db.exec(`
      create schema if not exists cron;
      create table if not exists cron.job_run_details (runid bigserial primary key, end_time timestamptz);
      insert into cron.job_run_details (end_time) values (now() - interval '10 days'), (now() - interval '1 hour');
    `);

    const r = await one<{
      r: { cron_runs: number; play_by_play: number; database_mb: number; warned: number };
    }>('select private.daily_cleanup() as r');
    expect(r.r.cron_runs).toBe(1);
    expect(r.r.play_by_play).toBeGreaterThanOrEqual(2);
    // Il database di prova è piccolo: nessun avviso
    expect(r.r.database_mb).toBeGreaterThan(0);
    expect(r.r.warned).toBe(0);
    const kept = await db.query<{ season_id: string; kept: boolean }>(
      `select season_id, play_by_play is not null as kept from public.games
       where league_id = $1 and round_number = 500`,
      [L],
    );
    const bySeason = Object.fromEntries(kept.rows.map((g) => [g.season_id, g.kept]));
    // Resta solo la cronaca della stagione in corso
    expect(bySeason).toEqual({ [seasons.current!]: true, [seasons.previous!]: false, [seasons.old!]: false });
    // I punteggi restano
    const old = await one<{ home_score: number }>(
      'select home_score from public.games where season_id = $1 and round_number = 500',
      [seasons.old],
    );
    expect(old.home_score).toBe(100);
    expect((await one<{ n: number }>('select count(*)::int as n from cron.job_run_details')).n).toBe(1);
    await db.exec('drop schema cron cascade');
  });

  it('il client non la chiama', async () => {
    await expect(call(U.giulia, 'select private.daily_cleanup()', [])).rejects.toThrow(/permission denied/);
  });
});

/** Cambia per un momento una funzione di soglia del database (come owner), poi la rimette com'era. */
async function withFunction<T>(name: string, body: string, fn: () => Promise<T>): Promise<T> {
  const def = await one<{ d: string }>('select pg_get_functiondef($1::regprocedure) as d', [name]);
  const returns = (await one<{ r: string }>('select pg_get_function_result($1::regprocedure) as r', [name]))
    .r;
  await db.exec(
    `create or replace function ${name} returns ${returns} language sql stable set search_path = '' as $f$ ${body} $f$`,
  );
  try {
    return await fn();
  } finally {
    await db.exec(def.d);
  }
}

describe('spazio del database', () => {
  it('da 400 MB avvisa i commissari una volta e non lascia creare leghe nuove', async () => {
    const league = await createLeague('Lega dello spazio', U.luca, 'BOS');
    const bos = await teamId(league.league_id, 'BOS');
    const storageAlerts = async () =>
      (
        await one<{ n: number }>(
          `select count(*)::int as n from public.alerts where team_id = $1 and kind = 'storage' and status = 'open'`,
          [bos],
        )
      ).n;
    await withFunction('private.database_mb()', 'select 431.5::numeric', async () => {
      const first = await one<{ r: { database_mb: number; warned: number } }>(
        'select private.daily_cleanup() as r',
      );
      expect(first.r.database_mb).toBe(431.5);
      expect(first.r.warned).toBeGreaterThanOrEqual(1);
      expect(await storageAlerts()).toBe(1);
      const payload = await one<{ payload: { mb: number; limit_mb: number }; blocking: boolean }>(
        `select payload, blocking from public.alerts where team_id = $1 and kind = 'storage'`,
        [bos],
      );
      expect(payload).toEqual({ payload: { mb: 431.5, limit_mb: 500 }, blocking: false });
      // La notte dopo, con l'avviso non ancora letto, non se ne aggiunge un altro
      const again = await one<{ r: { warned: number } }>('select private.daily_cleanup() as r');
      expect(again.r.warned).toBe(0);
      expect(await storageAlerts()).toBe(1);
      await expect(createLeague('Una in più', U.sara, 'BOS')).rejects.toThrow(/quasi pieno/);
    });
    const ok = await createLeague('Con lo spazio tornato', U.sara, 'BOS');
    expect(ok.league_id).toBeTruthy();
  });

  it('in tutto il database al massimo un numero fisso di leghe', async () => {
    const total = (await one<{ n: number }>('select count(*)::int as n from public.leagues')).n;
    await withFunction('private.max_leagues_total()', `select ${total}`, async () => {
      await expect(createLeague('Oltre il limite', U.sara, 'BOS')).rejects.toThrow(/Il server ha già/);
    });
    expect((await one<{ n: number }>('select private.max_leagues_total() as n')).n).toBe(30);
  });
});

describe('iscrizioni su invito', () => {
  let league: { league_id: string; invite_code: string };
  const hook = async (user: Record<string, unknown>) =>
    (
      await one<{ r: { error?: { http_code: number; message: string } } }>(
        'select public.hook_before_user_created($1) as r',
        [{ metadata: { name: 'before-user-created' }, user: { user_metadata: {}, ...user } }],
      )
    ).r;

  beforeAll(async () => {
    league = await createLeague('Lega degli inviti', U.giulia, 'BOS');
    await join(U.marco, league.invite_code, 'LAL');
  });

  it('senza invito l’iscrizione è rifiutata', async () => {
    const r = await hook({ email: 'sconosciuto@esempio.it', app_metadata: { provider: 'email' } });
    expect(r.error?.http_code).toBe(403);
    expect(r.error?.message).toMatch(/solo su invito/);
    expect(
      await hook({ email: 'sconosciuto@esempio.it', user_metadata: { invite_code: 'ZZZZZZ' } }),
    ).toHaveProperty('error');
  });

  it('con il codice di una lega si entra, scritto in qualunque modo', async () => {
    const messy = `${league.invite_code.slice(0, 3).toLowerCase()}-${league.invite_code.slice(3)}`;
    expect(await hook({ email: 'nuovo@esempio.it', user_metadata: { invite_code: messy } })).toEqual({});
  });

  it('il commissario invita per email; chi si iscrive consuma l’invito', async () => {
    await expect(
      call(U.marco, 'select public.invite_email($1, $2)', [league.league_id, 'amico@esempio.it']),
    ).rejects.toThrow(/Solo il commissario/);
    await expect(
      call(U.giulia, 'select public.invite_email($1, $2)', [league.league_id, 'non è una email']),
    ).rejects.toThrow(/non valido/);
    await call(U.giulia, 'select public.invite_email($1, $2)', [league.league_id, '  Amico@Esempio.IT ']);
    // Due volte lo stesso: niente doppioni
    await call(U.giulia, 'select public.invite_email($1, $2)', [league.league_id, 'amico@esempio.it']);
    const seen = await call(U.giulia, 'select email from public.signup_invites where league_id = $1', [
      league.league_id,
    ]);
    expect(seen.rows).toEqual([{ email: 'amico@esempio.it' }]);
    // Gli altri manager non vedono gli inviti
    const hidden = await call(U.marco, 'select email from public.signup_invites', []);
    expect(hidden.rows).toEqual([]);
    // Anche con Google, che non manda metadati
    expect(
      await hook({ email: 'AMICO@esempio.it', app_metadata: { provider: 'google', providers: ['google'] } }),
    ).toEqual({});
    await db.query(`insert into auth.users (id, email) values (gen_random_uuid(), 'amico@esempio.it')`);
    const left = await one<{ n: number }>(
      `select count(*)::int as n from public.signup_invites where email = 'amico@esempio.it'`,
    );
    expect(left.n).toBe(0);
  });

  it('gli inviti si tolgono e hanno un limite per lega', async () => {
    await call(U.giulia, 'select public.invite_email($1, $2)', [league.league_id, 'uno@esempio.it']);
    await call(U.giulia, 'select public.remove_invite($1, $2)', [league.league_id, 'UNO@esempio.it']);
    expect((await hook({ email: 'uno@esempio.it' })).error).toBeTruthy();
    await withFunction('private.max_invites_per_league()', 'select 2', async () => {
      await call(U.giulia, 'select public.invite_email($1, $2)', [league.league_id, 'a@esempio.it']);
      await call(U.giulia, 'select public.invite_email($1, $2)', [league.league_id, 'b@esempio.it']);
      await expect(
        call(U.giulia, 'select public.invite_email($1, $2)', [league.league_id, 'c@esempio.it']),
      ).rejects.toThrow(/già 2 inviti/);
    });
  });

  it('l’hook lo chiama solo Supabase Auth', async () => {
    const can = async (role: string) =>
      (
        await one<{ ok: boolean }>(
          `select has_function_privilege($1, 'public.hook_before_user_created(jsonb)', 'EXECUTE') as ok`,
          [role],
        )
      ).ok;
    expect(await can('supabase_auth_admin')).toBe(true);
    for (const role of ['anon', 'authenticated', 'service_role']) expect(await can(role), role).toBe(false);
    const schema = await one<{ ok: boolean }>(
      `select has_schema_privilege('supabase_auth_admin', 'public', 'USAGE') as ok`,
    );
    expect(schema.ok).toBe(true);
  });
});

describe('codice invito nuovo e bandi', () => {
  let league: { league_id: string; invite_code: string };
  beforeAll(async () => {
    league = await createLeague('Lega del codice', U.giulia, 'BOS');
    await join(U.nicola, league.invite_code, 'LAL');
  });

  it('il commissario cambia il codice: quello vecchio non vale più', async () => {
    await expect(
      call(U.nicola, 'select public.regenerate_invite_code($1)', [league.league_id]),
    ).rejects.toThrow(/Solo il commissario/);
    const fresh = (await call(U.giulia, 'select public.regenerate_invite_code($1) as c', [league.league_id]))
      .rows[0] as { c: string };
    expect(fresh.c).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    expect(fresh.c).not.toBe(league.invite_code);
    await expect(join(U.sara, league.invite_code, 'MIA')).rejects.toThrow(/Codice invito non valido/);
    await join(U.sara, fresh.c, 'MIA');
    expect(await isMember(league.league_id, U.sara)).toBe(true);
    league.invite_code = fresh.c;
  });

  it('il commissario vede gli esclusi e toglie il bando', async () => {
    await call(U.giulia, 'select public.expel_manager($1)', [await teamId(league.league_id, 'LAL')]);
    await expect(join(U.nicola, league.invite_code, 'LAL')).rejects.toThrow(/ti ha escluso/);
    await expect(
      call(U.sara, 'select * from public.league_bans_list($1)', [league.league_id]),
    ).rejects.toThrow(/Solo il commissario/);
    const bans = await call(U.giulia, 'select user_id, display_name from public.league_bans_list($1)', [
      league.league_id,
    ]);
    expect(bans.rows).toEqual([{ user_id: U.nicola, display_name: 'Nicola' }]);
    await expect(
      call(U.sara, 'select public.unban_manager($1, $2)', [league.league_id, U.nicola]),
    ).rejects.toThrow(/Solo il commissario/);
    await call(U.giulia, 'select public.unban_manager($1, $2)', [league.league_id, U.nicola]);
    await join(U.nicola, league.invite_code, 'LAL');
    expect(await isMember(league.league_id, U.nicola)).toBe(true);
  });
});

describe('cambi di squadra durante una simulazione', () => {
  let league: { league_id: string; invite_code: string };
  const setRound = (sql: string) =>
    db.query(
      `update public.rounds set ${sql}
       where id = (select current_round_id from public.leagues where id = $1)`,
      [league.league_id],
    );

  beforeAll(async () => {
    league = await createLeague('Lega del lock', U.giulia, 'BOS');
    await db.query(`insert into auth.users (id, email) values ($1, 'tommaso@nbbgm.test')`, [
      stableUuid('user:tommaso-commissario'),
    ]);
  });

  it('non si entra mentre il turno si simula; con il turno fermo sì', async () => {
    await setRound(`state = 'closing', closing_started_at = now(), attempts = 1`);
    await expect(join(U.marco, league.invite_code, 'DAL')).rejects.toThrow(/si sta simulando/);
    expect(await isMember(league.league_id, U.marco)).toBe(false);
    // Fermo dopo l'ultimo tentativo: nessuno sta scrivendo, si entra (la ripresa leggerà lo stato nuovo)
    await setRound(`attempts = 3, failed_at = now()`);
    await join(U.marco, league.invite_code, 'DAL');
    expect(await isMember(league.league_id, U.marco)).toBe(true);
    // Lo stesso per il commissario che libera una squadra con il turno bloccato
    await call(U.giulia, 'select public.free_team($1)', [await teamId(league.league_id, 'DAL')]);
    expect(await isMember(league.league_id, U.marco)).toBe(false);
    // In chiusura da più di 5 minuti: anche
    await setRound(`failed_at = null, closing_started_at = now() - interval '6 minutes'`);
    await join(U.marco, league.invite_code, 'DAL');
    expect(await isMember(league.league_id, U.marco)).toBe(true);
  });

  it('un account non si cancella mentre una sua lega simula il turno', async () => {
    const tommaso = stableUuid('user:tommaso-commissario');
    await setRound(`state = 'open', closing_started_at = null, attempts = 0, failed_at = null`);
    await join(tommaso, league.invite_code, 'PHX');
    await setRound(`state = 'closing', closing_started_at = now(), attempts = 1`);
    await expect(db.query('delete from auth.users where id = $1', [tommaso])).rejects.toThrow(
      /si sta simulando/,
    );
    expect(await isMember(league.league_id, tommaso)).toBe(true);
    await setRound(`state = 'open', closing_started_at = null, attempts = 0`);
    await db.query('delete from auth.users where id = $1', [tommaso]);
    expect(await isMember(league.league_id, tommaso)).toBe(false);
    const phx = await one<{ owner_id: string | null }>('select owner_id from public.teams where id = $1', [
      await teamId(league.league_id, 'PHX'),
    ]);
    expect(phx.owner_id).toBeNull();
  });
});
