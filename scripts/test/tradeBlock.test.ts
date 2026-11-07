// Seconda analisi, funzioni nuove: giocatori sul mercato (public.trade_block). Lega di prova del seed: anna su BOS,
// bruno su LAL, carla su NYK. Il manager scrive solo la propria squadra, a turno aperto e con i propri giocatori; la
// lista la leggono i membri della lega; le righe spariscono quando il giocatore cambia squadra o la squadra cambia
// manager.
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asAnon, asUser, createTestDb } from '../src/db/testdb.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const OUTSIDER = stableUuid('user:esterno-mercato');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    OUTSIDER,
    'esterno-mercato@nbbgm.test',
    { name: 'Esterno' },
  ]);
}, 120_000);

const playersOf = async (team: string) =>
  (
    await db.query<{ id: string }>('select id from public.players where team_id = $1 order by id', [team])
  ).rows.map((r) => r.id);

const put = (user: string, team: string, player: string) =>
  asUser(db, user, (tx) =>
    tx.query('insert into public.trade_block (league_id, team_id, player_id) values ($1, $2, $3)', [
      LEAGUE,
      team,
      player,
    ]),
  );

const listed = async (user: string) =>
  asUser(
    db,
    user,
    async (tx) =>
      (
        await tx.query<{ team_id: string; player_id: string }>(
          'select team_id, player_id from public.trade_block order by team_id, player_id',
        )
      ).rows,
  );

describe('giocatori sul mercato', () => {
  it('il manager mette e toglie i propri giocatori; i membri leggono, gli altri no', async () => {
    const [p1, p2] = await playersOf(BOS);
    await put(ANNA, BOS, p1!);
    await put(ANNA, BOS, p2!);
    expect(await listed(BRUNO)).toEqual([p1!, p2!].sort().map((player_id) => ({ team_id: BOS, player_id })));
    expect(await listed(OUTSIDER)).toEqual([]);
    await expect(asAnon(db, (tx) => tx.query('select * from public.trade_block'))).rejects.toThrow(
      /permission denied/,
    );
    const removed = await asUser(
      db,
      ANNA,
      async (tx) =>
        (await tx.query('delete from public.trade_block where team_id = $1 and player_id = $2', [BOS, p2]))
          .affectedRows,
    );
    expect(removed).toBe(1);
    // Bruno non toglie i giocatori di Anna: la RLS non gli fa vedere la riga da cancellare
    const notMine = await asUser(
      db,
      BRUNO,
      async (tx) => (await tx.query('delete from public.trade_block where team_id = $1', [BOS])).affectedRows,
    );
    expect(notMine).toBe(0);
    expect((await listed(ANNA)).map((r) => r.player_id)).toEqual([p1]);
  });

  it('niente giocatori di altre squadre, niente squadre altrui, niente scritture a turno in chiusura', async () => {
    const [lal] = await playersOf(LAL);
    const [bos] = (await playersOf(BOS)).slice(2);
    await expect(put(ANNA, BOS, lal!)).rejects.toThrow(/row-level security/);
    await expect(put(BRUNO, BOS, bos!)).rejects.toThrow(/row-level security/);
    await db.query(
      `update public.rounds set state = 'closing', closing_started_at = now()
       where id = (select current_round_id from public.leagues where id = $1)`,
      [LEAGUE],
    );
    try {
      await expect(put(ANNA, BOS, bos!)).rejects.toThrow(/row-level security/);
      const removed = await asUser(
        db,
        ANNA,
        async (tx) =>
          (await tx.query('delete from public.trade_block where team_id = $1', [BOS])).affectedRows,
      );
      expect(removed).toBe(0);
    } finally {
      await db.query(
        `update public.rounds set state = 'open', closing_started_at = null
         where id = (select current_round_id from public.leagues where id = $1)`,
        [LEAGUE],
      );
    }
  });

  it('il giocatore che cambia squadra e la squadra che cambia manager escono dalla lista', async () => {
    const [b1, b2] = (await playersOf(BOS)).slice(3);
    const [l1] = await playersOf(LAL);
    await put(ANNA, BOS, b1!);
    await put(ANNA, BOS, b2!);
    await put(BRUNO, LAL, l1!);
    // Scambio (lo scrive il server): b1 passa ai Lakers
    await db.query('update public.players set team_id = $1 where id = $2', [LAL, b1]);
    let rows = (await listed(ANNA)).map((r) => r.player_id);
    expect(rows).not.toContain(b1);
    expect(rows).toContain(b2);
    // Un aggiornamento che non cambia squadra non tocca la lista
    await db.query('update public.players set morale = morale where id = $1', [b2]);
    expect((await listed(ANNA)).map((r) => r.player_id)).toContain(b2);
    // La squadra di Bruno torna al bot: la sua lista sparisce, quella di Anna resta
    await db.query('update public.teams set owner_id = null where id = $1', [LAL]);
    rows = (await listed(ANNA)).map((r) => r.player_id);
    expect(rows).not.toContain(l1);
    expect(rows).toContain(b2);
    await db.query('update public.teams set owner_id = $1 where id = $2', [BRUNO, LAL]);
  });
});
