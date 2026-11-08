// Fase 6: creazione delle leghe dai dati di partenza e ingresso con il codice invito, su PGlite.
// La lega si crea con gli stessi passaggi della Edge Function create-league: righe base_* -> motore ->
// leaguePayload -> insert_league.
import type { PGlite } from '@electric-sql/pglite';
import { ARCHETYPE_PROFILES, createLeagueState, generateLeague, Rng, type LeagueData } from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BASE_DATASET,
  baseRowsFromLeague,
  keyedIds,
  leagueFromBaseRows,
  leaguePayload,
  type BaseRows,
} from '../../supabase/functions/_shared/league.ts';
import { buildBaseSql } from '../src/db/base.ts';
import { stableUuid } from '../src/db/seed.ts';
import { asAnon, asService, asUser, createTestDb } from '../src/db/testdb.ts';

const GIULIA = stableUuid('user:giulia');
const MARCO = stableUuid('user:marco');
const LUCA = stableUuid('user:luca');
const ESTRANEO = stableUuid('user:estraneo-leghe');

let db: PGlite;
let base: LeagueData;

beforeAll(async () => {
  db = await createTestDb();
  base = generateLeague(new Rng('dati-di-partenza'), ARCHETYPE_PROFILES, { season: BASE_DATASET });
  // Il draft come lo dà l'import: scelto, non scelto, non noto
  base.players.forEach((p, i) => {
    p.draft =
      i === 0 ? { year: 2018, round: 1, pick: 3 } : i === 1 ? { year: null, round: null, pick: null } : null;
  });
  await db.exec(buildBaseSql(base, BASE_DATASET));
  await db.query(
    `insert into auth.users (id, email, raw_user_meta_data) values
      ($1, 'giulia@nbbgm.test', '{"name":"Giulia"}'), ($2, 'marco@nbbgm.test', '{"name":"Marco"}'),
      ($3, 'luca@nbbgm.test', '{"name":"Luca"}'), ($4, 'estraneo@nbbgm.test', '{}')`,
    [GIULIA, MARCO, LUCA, ESTRANEO],
  );
}, 120_000);

/** Come la Edge Function: legge i dati di partenza come server e crea la lega. */
async function createLeague(name: string, commissioner: string, team: string) {
  return asService(db, async (tx) => {
    const rows: BaseRows = {
      players: (
        await tx.query<BaseRows['players'][number]>('select * from public.base_players where dataset = $1', [
          BASE_DATASET,
        ])
      ).rows,
      contracts: (
        await tx.query<BaseRows['contracts'][number]>(
          'select * from public.base_contracts where dataset = $1',
          [BASE_DATASET],
        )
      ).rows,
      deadMoney: (
        await tx.query<BaseRows['deadMoney'][number]>(
          'select * from public.base_dead_money where dataset = $1',
          [BASE_DATASET],
        )
      ).rows,
    };
    const state = createLeagueState(leagueFromBaseRows(rows), randomUUID(), {
      humanTeams: [team],
      staff: false,
    });
    const payload = leaguePayload(state, {
      id: keyedIds(() => randomUUID()),
      name,
      commissionerId: commissioner,
      owners: { [team]: commissioner },
    });
    const r = await tx.query<{ r: { league_id: string; invite_code: string } }>(
      'select public.insert_league($1) as r',
      [payload],
    );
    return r.rows[0]!.r;
  });
}

const preview = (user: string, code: string) =>
  asUser(
    db,
    user,
    async (tx) =>
      (await tx.query<{ p: Preview }>('select public.league_preview($1) as p', [code])).rows[0]!.p,
  );
const join = (user: string, code: string, team: string) =>
  asUser(db, user, (tx) => tx.query('select public.join_league($1, $2)', [code, team]));
const count = async (user: string, sql: string) =>
  asUser(
    db,
    user,
    async (tx) => (await tx.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`)).rows[0]!.n,
  );

interface Preview {
  league_id: string;
  name: string;
  commissioner: string;
  already_member: boolean;
  teams: { code: string; taken: boolean }[];
}

describe('dati di partenza', () => {
  it('tornano al motore così come sono partiti', () => {
    const rows = baseRowsFromLeague(base, BASE_DATASET);
    // Come li restituisce Postgres: numeric e bigint diventano stringhe
    const asPostgres = JSON.parse(
      JSON.stringify(rows, (k, v) =>
        typeof v === 'number' && ['height_cm', 'wingspan_cm', 'weight_kg', 'guaranteed'].includes(k)
          ? String(v)
          : v,
      ),
    ) as BaseRows;
    const back = leagueFromBaseRows(asPostgres, BASE_DATASET);
    const bySlug = <T extends { id?: string; playerId?: string }>(xs: T[]) =>
      [...xs].sort((a, b) => String(a.id ?? a.playerId).localeCompare(String(b.id ?? b.playerId)));
    expect(bySlug(back.players)).toEqual(bySlug(base.players));
    expect(bySlug(back.contracts)).toEqual(bySlug(base.contracts));
    expect(back.deadMoney).toEqual(base.deadMoney);
    expect(back.teams).toHaveLength(30);
  });
});

describe('creazione della lega', () => {
  let league: { league_id: string; invite_code: string };

  beforeAll(async () => {
    league = await createLeague('Lega degli amici', GIULIA, 'BOS');
  });

  it('scrive squadre, giocatori, calendario e scelte, con il primo turno aperto', async () => {
    expect(league.invite_code).toMatch(/^[A-HJKMNP-Z2-9]{6}$/);
    const n = async (sql: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, [league.league_id]))
        .rows[0]!.n;
    expect(await n('select 1 from public.teams where league_id = $1')).toBe(30);
    expect(await n('select 1 from public.players where league_id = $1')).toBeGreaterThanOrEqual(30 * 13);
    expect(await n('select 1 from public.player_hidden where league_id = $1')).toBe(
      await n('select 1 from public.players where league_id = $1'),
    );
    expect(await n('select 1 from public.games where league_id = $1')).toBe(1230);
    expect(await n('select 1 from public.draft_picks where league_id = $1')).toBe(30 * 2 * 7);
    expect(
      await n(`select 1 from public.leagues l join public.rounds r on r.id = l.current_round_id
               where l.id = $1 and r.state = 'open' and r.number = 0`),
    ).toBe(1);
    // Il commissario guida la squadra scelta; le altre 29 sono dei bot
    expect(
      (
        await db.query<{ code: string }>(
          'select code from public.teams where league_id = $1 and owner_id is not null',
          [league.league_id],
        )
      ).rows.map((r) => r.code),
    ).toEqual(['BOS']);
  });

  it('i giocatori reali portano il loro draft, che leggono i membri', async () => {
    const draftOf = async (user: string, slug: string) =>
      asUser(
        db,
        user,
        async (tx) =>
          (
            await tx.query<{ draft: unknown }>(
              'select draft from public.players where league_id = $1 and slug = $2',
              [league.league_id, slug],
            )
          ).rows[0]?.draft,
      );
    const [first, second, third] = base.players;
    expect(await draftOf(GIULIA, first!.id)).toEqual({ year: 2018, round: 1, pick: 3 });
    expect(await draftOf(GIULIA, second!.id)).toEqual({ year: null, round: null, pick: null });
    expect(await draftOf(GIULIA, third!.id)).toBeNull();
    expect(await draftOf(ESTRANEO, first!.id)).toBeUndefined();
  });

  it('ricaricando i dati di partenza le leghe già create prendono il draft dove manca', async () => {
    const [first, , third] = base.players;
    await db.query('update public.players set draft = null where league_id = $1 and slug = $2', [
      league.league_id,
      first!.id,
    ]);
    const withThird = structuredClone(base);
    withThird.players[2]!.draft = { year: 2020, round: 2, pick: 40 };
    await db.exec(buildBaseSql(withThird, BASE_DATASET));
    const draft = async (slug: string) =>
      (
        await db.query<{ draft: unknown }>(
          'select draft from public.players where league_id = $1 and slug = $2',
          [league.league_id, slug],
        )
      ).rows[0]!.draft;
    expect(await draft(first!.id)).toEqual({ year: 2018, round: 1, pick: 3 });
    expect(await draft(third!.id)).toEqual({ year: 2020, round: 2, pick: 40 });
    await db.exec(buildBaseSql(base, BASE_DATASET));
  });

  it('solo il server la crea', async () => {
    await expect(
      asUser(db, GIULIA, (tx) => tx.query('select public.insert_league($1)', [{}])),
    ).rejects.toThrow(/permission denied/);
  });

  it('con il codice si vedono le squadre libere, senza entrare', async () => {
    const p = await preview(
      MARCO,
      ` ${league.invite_code.toLowerCase().slice(0, 3)}-${league.invite_code.slice(3)} `,
    );
    expect(p.name).toBe('Lega degli amici');
    expect(p.commissioner).toBe('Giulia');
    expect(p.already_member).toBe(false);
    expect(p.teams).toHaveLength(30);
    expect(p.teams.filter((t) => t.taken).map((t) => t.code)).toEqual(['BOS']);
    // L'anteprima non apre la lega
    expect(await count(MARCO, 'select 1 from public.teams')).toBe(0);
  });

  it('un codice sbagliato non porta da nessuna parte', async () => {
    await expect(preview(MARCO, 'ZZZZZZ')).rejects.toThrow(/Codice invito non valido/);
    await expect(join(MARCO, 'ZZZZZZ', 'LAL')).rejects.toThrow(/Codice invito non valido/);
    await expect(
      asAnon(db, (tx) => tx.query('select public.league_preview($1)', [league.invite_code])),
    ).rejects.toThrow(/permission denied/);
  });

  it('si entra prendendo una squadra libera', async () => {
    await expect(join(MARCO, league.invite_code, 'BOS')).rejects.toThrow(/non è libera/);
    await join(MARCO, league.invite_code, 'lal');
    expect(await count(MARCO, 'select 1 from public.teams')).toBe(30);
    expect(
      await count(MARCO, `select 1 from public.teams where owner_id = '${MARCO}' and code = 'LAL'`),
    ).toBe(1);
    expect((await preview(MARCO, league.invite_code)).already_member).toBe(true);
    await expect(join(MARCO, league.invite_code, 'MIA')).rejects.toThrow(/Sei già in questa lega/);
    // Chi arriva dopo non può prendere la stessa squadra
    await expect(join(LUCA, league.invite_code, 'LAL')).rejects.toThrow(/non è libera/);
    await join(LUCA, league.invite_code, 'MIA');
    // I compagni di lega si vedono per nome, gli estranei no
    expect(await count(GIULIA, 'select 1 from public.profiles')).toBe(3);
    expect(await count(ESTRANEO, 'select 1 from public.leagues')).toBe(0);
  });

  it('un utente gioca in più leghe, con una squadra per lega', async () => {
    const second = await createLeague('Seconda lega', MARCO, 'NYK');
    await join(GIULIA, second.invite_code, 'LAL');
    const leagues = await asUser(
      db,
      MARCO,
      async (tx) =>
        (
          await tx.query<{ name: string; code: string }>(
            `select l.name, t.code from public.teams t join public.leagues l on l.id = t.league_id
           where t.owner_id = auth.uid() order by l.name`,
          )
        ).rows,
    );
    expect(leagues).toEqual([
      { name: 'Lega degli amici', code: 'LAL' },
      { name: 'Seconda lega', code: 'NYK' },
    ]);
    expect(await count(GIULIA, 'select 1 from public.leagues')).toBe(2);
    expect(second.invite_code).not.toBe(league.invite_code);
  });
});
