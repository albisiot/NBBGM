// Fase 7: draft iniziale di tutti i giocatori su PGlite. La lega nasce come nella Edge Function create-league
// (rose vuote, draft in palio) e le azioni passano come nella Edge Function draft: draft_snapshot -> planDraft
// -> apply_draft_picks. Fatto quando un draft da 30 squadre si chiude in entrambe le modalità con rose valide.
import type { PGlite } from '@electric-sql/pglite';
import {
  ARCHETYPE_PROFILES,
  createLeagueState,
  generateLeague,
  INITIAL_DRAFT_ROUNDS,
  planDraft,
  Rng,
  type DraftAction,
  type LeagueData,
} from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { applyArgs, snapshotFromRow, type DraftSnapshotRow } from '../../supabase/functions/_shared/draft.ts';
import { BASE_DATASET, keyedIds, leaguePayload } from '../../supabase/functions/_shared/league.ts';
import { stableUuid } from '../src/db/seed.ts';
import { asService, asUser, createTestDb } from '../src/db/testdb.ts';

const USERS = ['dora', 'enzo', 'fede', 'gino'].map((k) => stableUuid(`user:${k}`));
const [DORA, ENZO, FEDE, GINO] = USERS as [string, string, string, string];

let db: PGlite;
let data: LeagueData;

beforeAll(async () => {
  db = await createTestDb();
  // Lega generata con qualche two-way, come nel file vero
  data = generateLeague(new Rng('draft-iniziale'), ARCHETYPE_PROFILES, { season: BASE_DATASET });
  data.contracts.slice(0, 60).forEach((c, i) => {
    if (i % 2 === 0) Object.assign(c, { type: 'two-way', salaries: [], options: [] });
  });
  for (const [i, id] of USERS.entries())
    await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
      id,
      `draft${i}@nbbgm.test`,
      { name: ['Dora', 'Enzo', 'Fede', 'Gino'][i] },
    ]);
}, 120_000);

/** Lega in modalità draft, con il commissario su BOS. */
async function createDraftLeague(mode: 'list' | 'live', name: string) {
  const state = createLeagueState(data, randomUUID(), {
    humanTeams: ['BOS'],
    potentialOnOverallScale: true,
    emptyRosters: true,
    staff: false,
  });
  const payload = leaguePayload(state, {
    id: keyedIds(() => randomUUID()),
    name,
    commissionerId: DORA,
    owners: { BOS: DORA },
    settings: { roster_mode: 'draft', draft_mode: mode },
    initialDraft: { mode, pickSeconds: 60, contracts: data.contracts },
  });
  const r = await asService(db, (tx) =>
    tx.query<{ r: { league_id: string; invite_code: string } }>('select public.insert_league($1) as r', [
      payload,
    ]),
  );
  return r.rows[0]!.r;
}

/** Come la Edge Function draft: stato, piano del motore, scrittura. */
async function act(league: string, action: DraftAction, now = new Date()) {
  return asService(db, async (tx) => {
    const row = (await tx.query<{ s: DraftSnapshotRow }>('select public.draft_snapshot($1) as s', [league]))
      .rows[0]!.s;
    const snapshot = snapshotFromRow(row);
    const plan = planDraft(snapshot, action, now);
    const args = applyArgs(league, snapshot, plan);
    if (!args) return { snapshot, plan, next: snapshot.next };
    const r = await tx.query<{ n: number }>('select public.apply_draft_picks($1, $2, $3, $4, $5, $6) as n', [
      args.p_league,
      args.p_from,
      args.p_picks,
      args.p_deadline,
      args.p_begin,
      args.p_mode,
    ]);
    return { snapshot, plan, next: r.rows[0]!.n };
  });
}

async function draftRow(league: string) {
  return (
    await db.query<{ state: string; next_pick: number; mode: string; pick_deadline: string | null }>(
      'select state, next_pick, mode, pick_deadline from public.initial_drafts where league_id = $1',
      [league],
    )
  ).rows[0]!;
}

/** Ogni squadra ha 13 contratti standard e nessun two-way; i non scelti sono svincolati senza contratto. */
async function expectValidRosters(league: string) {
  const teams = await db.query<{ code: string; standard: number; two_way: number; players: number }>(
    `select t.code,
            count(c.player_id) filter (where c.type <> 'two-way')::int as standard,
            count(c.player_id) filter (where c.type = 'two-way')::int as two_way,
            (select count(*)::int from public.players p where p.team_id = t.id) as players
     from public.teams t left join public.contracts c on c.team_id = t.id
     where t.league_id = $1 group by t.id, t.code`,
    [league],
  );
  expect(teams.rows).toHaveLength(30);
  for (const t of teams.rows) {
    expect(t.standard, t.code).toBe(INITIAL_DRAFT_ROUNDS);
    expect(t.two_way, t.code).toBe(0);
    expect(t.players, t.code).toBe(INITIAL_DRAFT_ROUNDS);
  }
  const loose = await db.query<{ n: number }>(
    `select count(*)::int as n from public.players p
     where p.league_id = $1 and p.team_id is null
       and exists (select 1 from public.contracts c where c.player_id = p.id)`,
    [league],
  );
  expect(loose.rows[0]!.n).toBe(0);
  const picks = await db.query<{ n: number }>(
    'select count(*)::int as n from public.initial_draft_picks where league_id = $1',
    [league],
  );
  expect(picks.rows[0]!.n).toBe(30 * INITIAL_DRAFT_ROUNDS);
}

describe('lega in modalità draft', () => {
  it('nasce con le rose vuote, nessun contratto e i two-way fuori dal draft', async () => {
    const league = await createDraftLeague('list', 'Rose vuote');
    const n = async (sql: string) =>
      (await db.query<{ n: number }>(`select count(*)::int as n from (${sql}) x`, [league.league_id]))
        .rows[0]!.n;
    expect(await n('select 1 from public.players where league_id = $1 and team_id is not null')).toBe(0);
    expect(await n('select 1 from public.contracts where league_id = $1')).toBe(0);
    expect(await n('select 1 from public.dead_money where league_id = $1')).toBe(0);
    const pool = await n('select 1 from public.initial_draft_pool where league_id = $1');
    expect(pool).toBe(data.players.length - data.contracts.filter((c) => c.type === 'two-way').length);
    expect((await draftRow(league.league_id)).state).toBe('waiting');
  });
});

describe('draft in modalità lista', () => {
  let league: { league_id: string; invite_code: string };

  beforeAll(async () => {
    league = await createDraftLeague('list', 'Draft a liste');
    await asUser(db, ENZO, (tx) =>
      tx.query('select public.join_league($1, $2)', [league.invite_code, 'LAL']),
    );
    await asUser(db, FEDE, (tx) =>
      tx.query('select public.join_league($1, $2)', [league.invite_code, 'MIA']),
    );
  });

  it('ogni manager prepara la sua lista, che vede solo lui', async () => {
    const best = await db.query<{ player_id: string }>(
      'select player_id from public.initial_draft_pool where league_id = $1 order by overall desc limit 5',
      [league.league_id],
    );
    const ids = best.rows.map((r) => r.player_id);
    const lal = (
      await db.query<{ id: string }>('select id from public.teams where league_id = $1 and code = $2', [
        league.league_id,
        'LAL',
      ])
    ).rows[0]!.id;
    await asUser(db, ENZO, (tx) =>
      tx.query(
        'insert into public.initial_draft_lists (team_id, league_id, player_ids) values ($1, $2, $3)',
        [lal, league.league_id, [ids[4], ids[3]]],
      ),
    );
    expect(
      await asUser(db, FEDE, async (tx) => (await tx.query('select * from public.initial_draft_lists')).rows),
    ).toEqual([]);
    // Non si scrive la lista di un'altra squadra
    await expect(
      asUser(db, FEDE, (tx) =>
        tx.query(
          'insert into public.initial_draft_lists (team_id, league_id, player_ids) values ($1, $2, $3)',
          [lal, league.league_id, [ids[0]]],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('solo il commissario lo avvia, e il server fa tutte le 390 scelte', async () => {
    await expect(act(league.league_id, { kind: 'start', userId: ENZO })).rejects.toThrow(
      /Solo il commissario/,
    );
    const r = await act(league.league_id, { kind: 'start', userId: DORA });
    expect(r.plan.picks).toHaveLength(390);
    expect(await draftRow(league.league_id)).toMatchObject({ state: 'done', next_pick: 390 });
    await expectValidRosters(league.league_id);
    // Lakers: la prima scelta è il primo disponibile della lista di Enzo
    const lalPicks = await db.query<{ player_id: string; auto: boolean }>(
      `select k.player_id, k.auto from public.initial_draft_picks k join public.teams t on t.id = k.team_id
       where k.league_id = $1 and t.code = 'LAL' order by k.pick_no`,
      [league.league_id],
    );
    const list = (
      await db.query<{ player_ids: string[] }>('select player_ids from public.initial_draft_lists')
    ).rows[0]!.player_ids;
    const first = lalPicks.rows[0]!.player_id;
    expect(list.includes(first) || lalPicks.rows.some((p) => list.includes(p.player_id))).toBe(true);
    // A draft finito la lista non si cambia più
    await expect(
      asUser(db, ENZO, (tx) => tx.query('update public.initial_draft_lists set player_ids = $1', [[]])),
    ).resolves.toMatchObject({ affectedRows: 0 });
    // E un secondo avvio non fa nulla
    await expect(act(league.league_id, { kind: 'start', userId: DORA })).rejects.toThrow(/già partito/);
  });
});

describe('draft dal vivo', () => {
  let league: { league_id: string; invite_code: string };

  beforeAll(async () => {
    league = await createDraftLeague('live', 'Draft dal vivo');
    await asUser(db, ENZO, (tx) =>
      tx.query('select public.join_league($1, $2)', [league.invite_code, 'LAL']),
    );
    await asUser(db, GINO, (tx) =>
      tx.query('select public.join_league($1, $2)', [league.invite_code, 'NYK']),
    );
  });

  it('si chiude con scelte a mano, tempi scaduti e il passaggio alla lista', async () => {
    const t0 = new Date();
    let r = await act(league.league_id, { kind: 'start', userId: DORA }, t0);
    let row = await draftRow(league.league_id);
    expect(row.state).toBe('running');
    expect(row.pick_deadline).not.toBeNull();

    const owners = r.snapshot.owners;
    let now = t0.getTime();
    for (let i = 0; row.state === 'running' && i < 60; i++) {
      const snap = (await act(league.league_id, { kind: 'tick' }, new Date(now))).snapshot;
      const team = snap.order[snap.next] as string;
      const user = owners[team] as string;
      expect(user).not.toBeNull();
      if (i % 2 === 0) {
        const taken = new Set(snap.made.map((m) => m.playerId));
        const choice = snap.pool.find((p) => !taken.has(p.id))!.id;
        // Chi non è di turno non sceglie
        const other = USERS.find((u) => u !== user && Object.values(owners).includes(u))!;
        await expect(
          act(league.league_id, { kind: 'pick', userId: other, playerId: choice }, new Date(now)),
        ).rejects.toThrow(/Non tocca a te/);
        r = await act(league.league_id, { kind: 'pick', userId: user, playerId: choice }, new Date(now));
        expect(r.plan.picks[0]).toMatchObject({ playerId: choice, auto: false });
      } else {
        // Tempo scaduto: sceglie il server
        now += 61_000;
        r = await act(league.league_id, { kind: 'tick' }, new Date(now));
        expect(r.plan.picks[0]?.auto).toBe(true);
      }
      row = await draftRow(league.league_id);
      if (row.next_pick > 150) break;
    }
    expect(row.state).toBe('running');

    // Una richiesta rimasta indietro non scrive nulla
    await expect(
      asService(db, (tx) =>
        tx.query('select public.apply_draft_picks($1, $2, $3, $4)', [league.league_id, 0, [], null]),
      ),
    ).rejects.toThrow(/andato avanti/);

    // Il commissario passa alla modalità lista: il resto si chiude subito
    await expect(act(league.league_id, { kind: 'to-list', userId: GINO })).rejects.toThrow(
      /Solo il commissario/,
    );
    await act(league.league_id, { kind: 'to-list', userId: DORA }, new Date(now));
    expect(await draftRow(league.league_id)).toMatchObject({ state: 'done', mode: 'list', next_pick: 390 });
    const mode = await db.query<{ draft_mode: string }>(
      'select draft_mode from public.leagues where id = $1',
      [league.league_id],
    );
    expect(mode.rows[0]!.draft_mode).toBe('list');
    await expectValidRosters(league.league_id);
  });

  it('il client non legge né scrive il draft dal server', async () => {
    await expect(
      asUser(db, DORA, (tx) => tx.query('select public.draft_snapshot($1)', [league.league_id])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, DORA, (tx) =>
        tx.query('select public.apply_draft_picks($1, $2, $3, $4)', [league.league_id, 390, [], null]),
      ),
    ).rejects.toThrow(/permission denied/);
    // I membri vedono il draft e le scelte, gli altri no
    const seen = async (user: string) =>
      asUser(db, user, async (tx) => {
        const picks = await tx.query<{ n: number }>(
          'select count(*)::int as n from public.initial_draft_picks where league_id = $1',
          [league.league_id],
        );
        return picks.rows[0]!.n;
      });
    expect(await seen(GINO)).toBe(390);
    expect(await seen(FEDE)).toBe(0);
  });
});
