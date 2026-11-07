// Seconda analisi, funzioni nuove: stato del turno di tutte le leghe dell'utente in una lettura
// (public.my_leagues_status), per l'elenco delle leghe. Lega di prova del seed: anna su BOS, bruno su LAL, carla su
// NYK. La funzione legge con la RLS di chi la chiama: ognuno vede le sue leghe e i propri avvisi.
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asAnon, asUser, createTestDb } from '../src/db/testdb.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const OUTSIDER = stableUuid('user:esterno-elenco');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');

interface Row {
  league_id: string;
  paused: boolean;
  draft_state: string | null;
  round: { id: string; number: number; kind: string; state: string; attempts: number } | null;
  my_team_id: string;
  decisions: number;
  readiness: { team_id: string; state: string }[];
}

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    OUTSIDER,
    'esterno-elenco@nbbgm.test',
    { name: 'Esterno' },
  ]);
}, 120_000);

const status = (user: string) =>
  asUser(
    db,
    user,
    async (tx) => (await tx.query<{ s: Row[] }>('select public.my_leagues_status() as s')).rows[0]!.s,
  );

describe('stato di tutte le leghe dell’utente', () => {
  it('chi non è in nessuna lega riceve un elenco vuoto; dall’API senza login non si chiama', async () => {
    expect(await status(OUTSIDER)).toEqual([]);
    await expect(asAnon(db, (tx) => tx.query('select public.my_leagues_status()'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('turno, propria squadra, decisioni aperte e stato delle squadre come round_readiness', async () => {
    const round = (
      await db.query<{ id: string }>('select current_round_id as id from public.leagues where id = $1', [
        LEAGUE,
      ])
    ).rows[0]!.id;
    await asUser(db, ANNA, (tx) => tx.query('select public.set_ready($1, true, $2)', [BOS, round]));
    await asUser(db, BRUNO, (tx) =>
      tx.query(
        `insert into public.coach_delegations (team_id, league_id, active) values ($1, $2, true)
         on conflict (team_id) do update set active = true, until_round = null, until_at = null`,
        [LAL, LEAGUE],
      ),
    );
    // Due decisioni aperte per Bruno, una chiusa e una informativa che non contano
    for (const [kind, blocking, open] of [
      ['trade_offer', true, true],
      ['renewals', true, true],
      ['roster_minimum', true, false],
      ['injury', false, true],
    ] as const)
      await db.query(
        `insert into public.alerts (league_id, team_id, kind, blocking, round_id, status)
         values ($1, $2, $3, $4, $5, $6)`,
        [LEAGUE, LAL, kind, blocking, round, open ? 'open' : 'resolved'],
      );

    const anna = await status(ANNA);
    const bytes = JSON.stringify(anna).length;
    console.info(`my_leagues_status: ${bytes} byte per una lega`);
    expect(bytes).toBeLessThan(1_000);
    expect(anna).toHaveLength(1);
    expect(anna[0]).toMatchObject({
      league_id: LEAGUE,
      paused: false,
      my_team_id: BOS,
      decisions: 0,
      round: { id: round, kind: 'regular', state: 'open', attempts: 0 },
    });
    const server = await asUser(db, ANNA, async (tx) =>
      Object.fromEntries(
        (
          await tx.query<{ team_id: string; state: string }>('select * from public.round_readiness($1)', [
            LEAGUE,
          ])
        ).rows.map((r) => [r.team_id, r.state]),
      ),
    );
    expect(Object.fromEntries(anna[0]!.readiness.map((r) => [r.team_id, r.state]))).toEqual(server);
    expect(server).toEqual({ [BOS]: 'ready', [LAL]: 'blocked', [NYK]: 'waiting' });
    // Le decisioni di Bruno restano sue
    const bruno = await status(BRUNO);
    expect(bruno[0]).toMatchObject({ my_team_id: LAL, decisions: 2 });
  });

  it('pausa e una seconda lega dello stesso utente nella stessa lettura', async () => {
    await db.query('update public.leagues set paused = true where id = $1', [LEAGUE]);
    const other = stableUuid('league:seconda-elenco');
    await db.query(
      `insert into public.leagues (id, name, invite_code, commissioner_id, seed) values ($1, 'Zeta', 'ZZZZZZ', $2, 'x')`,
      [other, ANNA],
    );
    await db.query(`insert into public.league_members (league_id, user_id) values ($1, $2)`, [other, ANNA]);
    const team = stableUuid('team:seconda-elenco');
    await db.query(
      `insert into public.teams (id, league_id, code, city, name, full_name, conference, division, owner_id)
       values ($1, $2, 'BOS', 'Boston', 'Celtics', 'Boston Celtics', 'East', 'Atlantic', $3)`,
      [team, other, ANNA],
    );
    try {
      const anna = await status(ANNA);
      expect(anna.map((r) => r.league_id)).toEqual([LEAGUE, other]);
      expect(anna[0]!.paused).toBe(true);
      // Lega senza turno: niente turno e nessuno stato delle squadre
      expect(anna[1]).toMatchObject({ my_team_id: team, round: null, readiness: [], decisions: 0 });
    } finally {
      await db.query('delete from public.leagues where id = $1', [other]);
      await db.query('update public.leagues set paused = false where id = $1', [LEAGUE]);
    }
  });
});
