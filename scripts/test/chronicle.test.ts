// Dopo la Fase 13: cronaca della lega (transactions). Le sigle delle squadre citate le ricava il database dal
// testo; gli infortuni medi e gravi li scrive il turno; la leggono solo i membri della lega.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GameResult, TeamSetup } from '../../packages/engine/src/index.ts';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asService, asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';
import { quickGame } from '../src/quick-game.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const OUTSIDER = stableUuid('user:esterno-cronaca');

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    OUTSIDER,
    'esterno-cronaca@nbbgm.test',
    { name: 'Esterno' },
  ]);
}, 120_000);

const insertTx = (text: string, type = 'trade') =>
  asService(db, async (tx) => {
    const r = await tx.query<{ team_codes: string[] }>(
      `insert into public.transactions (league_id, season_year, round_number, type, text)
       values ($1, 2026, 3, $2, $3) returning team_codes`,
      [LEAGUE, type, text],
    );
    return r.rows[0]!.team_codes;
  });

describe('cronaca della lega', () => {
  it('le sigle delle squadre citate si ricavano dal testo, come parole intere', async () => {
    expect(await insertTx('Scambio: LAL cede Mario Rossi a BOS per una scelta')).toEqual(['BOS', 'LAL']);
    expect(await insertTx('Mario Rossi si ritira a 37 anni', 'retirement')).toEqual([]);
    // BOSTON non è BOS, nyk minuscolo non è NYK
    expect(await insertTx('Ritorno a BOSTON per nyk', 'signing')).toEqual([]);
  });

  it('solo i membri della lega la leggono', async () => {
    const read = (user: string) =>
      asUser(
        db,
        user,
        async (tx) =>
          (await tx.query('select id from public.transactions where league_id = $1', [LEAGUE])).rows.length,
      );
    expect(await read(ANNA)).toBeGreaterThan(0);
    expect(await read(OUTSIDER)).toBe(0);
  });

  it('il turno scrive gli infortuni da 4 partite in su, non quelli leggeri', async () => {
    // Il primo giorno (3 partite) gioca LAL
    const bos = 'LAL';
    // Partita finta con un infortunio grave per chi gioca in casa contro o con LAL e uno leggero per gli altri
    const playGame = (home: TeamSetup, away: TeamSetup, seed: string): GameResult => {
      const r = quickGame(home, away, seed);
      const heavy = home.teamId === bos || away.teamId === bos;
      const player = home.starters[0]!;
      r.injuries.push({
        playerId: player,
        team: 'home',
        bodyPart: 'knees',
        severity: heavy ? 'severe' : 'light',
        games: heavy ? 20 : 2,
        elapsed: 600,
      });
      return r;
    };
    const before = (await db.query<{ n: number }>(`select count(*)::int as n from public.transactions`))
      .rows[0]!.n;
    const r = await advanceLeague(serviceRpc(db), LEAGUE, {
      newId: randomUUID,
      playGame,
      botProposals: false,
    });
    expect(r.advanced).toBe(false);
    // Il turno parte solo se è il momento: lo forza il commissario (anna)
    await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
    const done = await advanceLeague(serviceRpc(db), LEAGUE, {
      newId: randomUUID,
      playGame,
      botProposals: false,
    });
    expect(done.advanced).toBe(true);
    const rows = (
      await db.query<{ text: string; team_codes: string[]; round_number: number }>(
        `select text, team_codes, round_number from public.transactions
         where league_id = $1 and type = 'injury' order by id`,
        [LEAGUE],
      )
    ).rows;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toMatch(/si infortuna \(ginocchia\), fuori 20 partite$/);
    expect(rows[0]!.round_number).toBe(0);
    expect(rows[0]!.team_codes.length).toBeGreaterThan(0);
    const after = (await db.query<{ n: number }>(`select count(*)::int as n from public.transactions`))
      .rows[0]!.n;
    expect(after).toBeGreaterThan(before);
  }, 60_000);
});
