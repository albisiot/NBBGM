// Dopo la Fase 13: storico delle stagioni. Alla chiusura dell'ultimo giorno di regular season il turno salva le statistiche di
// regular season di ogni giocatore (player_seasons); le stagioni giocate prima si ricostruiscono dai box score
// con le stesse regole. Le leggono solo i membri della lega.
import type { PGlite } from '@electric-sql/pglite';
import { seasonAwards, type SeasonStats } from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asService, asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';
import { skipToLastRegularDay } from '../src/db/testSeason.ts';
import { quickGame } from '../src/quick-game.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const OUTSIDER = stableUuid('user:esterno-storico');

let db: PGlite;
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    OUTSIDER,
    'esterno-storico@nbbgm.test',
    { name: 'Esterno' },
  ]);
  // I giorni prima dell'ultimo con punteggi finti (senza box score), come nel test dell'offseason
  await skipToLastRegularDay(db, LEAGUE, ids.round, 'storico-finto');
}, 120_000);

type Snapshot = { player_id: string; team_id: string | null; rookie: boolean | null; stats: SeasonStats };

const snapshot = (season: string) =>
  q<Snapshot>(
    'select player_id, team_id, rookie, stats from public.player_seasons where season_id = $1 order by player_id',
    [season],
  );

describe('storico delle stagioni', () => {
  let season: string;

  it('la chiusura dell’ultimo giorno salva le statistiche di regular season', async () => {
    season = (
      await q<{ id: string }>('select current_season_id as id from public.leagues where id = $1', [LEAGUE])
    )[0]!.id;
    await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
    const r = await advanceLeague(serviceRpc(db), LEAGUE, {
      newId: randomUUID,
      playGame: quickGame,
      botProposals: false,
    });
    expect(r.advanced).toBe(true);
    const rows = await snapshot(season);
    const players = await q<{
      id: string;
      team_id: string | null;
      years_in_league: number | null;
      season_stats: SeasonStats;
    }>(
      `select id, team_id, years_in_league, season_stats from public.players
       where league_id = $1 and (season_stats ->> 'g')::int > 0 order by id`,
      [LEAGUE],
    );
    expect(rows.length).toBeGreaterThanOrEqual(240);
    expect(rows.map((x) => x.player_id)).toEqual(players.map((p) => p.id));
    for (const [i, p] of players.entries()) {
      // Le partite a disposizione (av) restano solo nei giocatori: servono all'opzione del giocatore
      expect(rows[i]!.stats).toEqual({ ...p.season_stats, av: undefined });
      expect(rows[i]!.team_id).toBe(p.team_id);
      expect(rows[i]!.rookie).toBe(p.years_in_league === null ? null : p.years_in_league === 0);
    }
    // I premi si calcolano dalle righe salvate
    const awards = seasonAwards(
      rows.map((x) => ({ id: x.player_id, teamId: x.team_id, rookie: x.rookie, stats: x.stats })),
      () => 0.5,
    );
    expect(awards.awards.map((a) => a.key)).toContain('mvp');
  }, 60_000);

  it('le stagioni giocate prima si ricostruiscono dai box score con gli stessi numeri', async () => {
    const saved = await snapshot(season);
    await asService(db, (tx) => tx.query('delete from public.player_seasons where season_id = $1', [season]));
    const n = (await q<{ n: number }>('select private.rebuild_player_seasons($1) as n', [season]))[0]!.n;
    expect(n).toBe(saved.length);
    expect(await snapshot(season)).toEqual(saved);
    // Una seconda volta non cambia nulla
    expect((await q<{ n: number }>('select private.rebuild_player_seasons($1) as n', [season]))[0]!.n).toBe(
      0,
    );
  });

  it('le leggono solo i membri della lega, e nessuno le scrive dall’API', async () => {
    const read = (user: string) =>
      asUser(db, user, async (tx) => (await tx.query('select 1 from public.player_seasons')).rows.length);
    expect(await read(ANNA)).toBeGreaterThan(0);
    expect(await read(OUTSIDER)).toBe(0);
    await expect(
      asUser(db, ANNA, (tx) => tx.query('delete from public.player_seasons where season_id = $1', [season])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, (tx) => tx.query('select private.rebuild_player_seasons($1)', [season])),
    ).rejects.toThrow(/permission denied/);
  });
});
