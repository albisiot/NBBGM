// Fase 10: una post-season completa sulla lega di prova, come la gioca la Edge Function advance-turn.
// Le prime 81 giornate hanno punteggi finti scritti a mano (per fare presto); l'ultima e tutta la post-season le
// gioca il server. Fatto quando: i totali di classifica coincidono con le partite giocate e una post-season
// completa si gioca senza errori.
import type { PGlite } from '@electric-sql/pglite';
import {
  Rng,
  standingsSeed,
  standingsTable,
  type Conference,
  type Division,
  type GameRecord,
  type Team,
} from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const MANAGERS = new Map([
  [ids.team('BOS'), ids.user('anna')],
  [ids.team('LAL'), ids.user('bruno')],
  [ids.team('NYK'), ids.user('carla')],
]);

let db: PGlite;

const advance = () => advanceLeague(serviceRpc(db), LEAGUE, { newId: randomUUID });

async function current() {
  const r = await db.query<{ id: string; number: number; kind: string; state: string }>(
    `select r.id, r.number, r.kind, r.state from public.leagues l join public.rounds r on r.id = l.current_round_id
     where l.id = $1`,
    [LEAGUE],
  );
  return r.rows[0]!;
}

/** Le squadre umane che giocano nel turno premono Pronto; le altre non devono fare nulla. */
async function readyPlaying(roundNumber: number): Promise<number> {
  const playing = await db.query<{ team: string }>(
    `select t.id as team from public.games g join public.teams t on t.id in (g.home_team_id, g.away_team_id)
     where g.league_id = $1 and g.round_number = $2 and t.owner_id is not null`,
    [LEAGUE, roundNumber],
  );
  for (const { team } of playing.rows)
    await asUser(db, MANAGERS.get(team) as string, (tx) => tx.query('select public.set_ready($1)', [team]));
  return playing.rows.length;
}

const allReady = async (roundId: string) =>
  (await db.query<{ ok: boolean }>('select public.round_all_ready($1) as ok', [roundId])).rows[0]!.ok;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  // 81 giornate con punteggi finti (niente pareggi), poi il turno aperto diventa l'ultima giornata
  const rng = new Rng('post-season-finta');
  const games = await db.query<{ id: string }>(
    `select id from public.games where league_id = $1 and round_number < 81 order by id`,
    [LEAGUE],
  );
  const values = games.rows.map((g) => {
    const h = 95 + Math.floor(rng.next() * 40);
    let a = 95 + Math.floor(rng.next() * 40);
    if (a === h) a++;
    return `('${g.id}'::uuid, ${h}, ${a})`;
  });
  await db.exec(`
    update public.games g set home_score = v.h, away_score = v.a, overtimes = 0, played_at = now()
    from (values ${values.join(',')}) as v(id, h, a) where g.id = v.id;
    update public.rounds set number = 81 where id = '${ids.round}';
  `);
}, 120_000);

describe('dall’ultima giornata alla finale', () => {
  it('il server gioca l’ultima giornata e mette in calendario il play-in', async () => {
    const round = await current();
    expect(round).toMatchObject({ number: 81, kind: 'regular' });
    for (const [team, user] of MANAGERS)
      await asUser(db, user, (tx) => tx.query('select public.set_ready($1)', [team]));
    expect(await advance()).toMatchObject({
      advanced: true,
      summary: { next: { number: 82, kind: 'play-in' } },
    });
    const next = await current();
    expect(next).toMatchObject({ number: 82, kind: 'play-in', state: 'open' });
    const phase = await db.query<{ phase: string }>(
      'select s.phase from public.seasons s join public.leagues l on l.current_season_id = s.id where l.id = $1',
      [LEAGUE],
    );
    expect(phase.rows[0]!.phase).toBe('play-in');
    const playIn = await db.query<{ n: number }>(
      `select count(*)::int as n from public.games where league_id = $1 and round_number = 82 and kind = 'play-in'
       and home_score is null`,
      [LEAGUE],
    );
    expect(playIn.rows[0]!.n).toBe(4);
  });

  it('play-in e playoff si giocano fino al campione; chi non gioca non deve essere pronto', async () => {
    let champion: string | null = null;
    for (let i = 0; i < 40; i++) {
      const round = await current();
      if (round.kind === 'offseason') break;
      const humansPlaying = await readyPlaying(round.number);
      expect(await allReady(round.id)).toBe(true);
      if (humansPlaying === 0) {
        // Nessun umano in campo: la lega va avanti da sola, al ritmo massimo
        await db.query(`update public.rounds set created_at = now() - interval '2 minutes' where id = $1`, [
          round.id,
        ]);
      }
      const r = await advance();
      expect(r.advanced, `turno ${round.number}`).toBe(true);
      if (r.advanced && r.summary.championId) champion = r.summary.championId;
    }
    const end = await current();
    expect(end.kind).toBe('offseason');
    expect(champion).not.toBeNull();

    // Play-in: 6 partite, 2 turni
    const playIn = await db.query<{ n: number; rounds: number }>(
      `select count(*)::int as n, count(distinct round_number)::int as rounds from public.games
       where league_id = $1 and kind = 'play-in' and home_score is not null`,
      [LEAGUE],
    );
    expect(playIn.rows[0]).toEqual({ n: 6, rounds: 2 });

    // 15 serie chiuse, ognuna con le vittorie delle sue partite
    const series = await db.query<{
      id: string;
      round: number;
      high_team_id: string;
      low_team_id: string;
      wins_high: number;
      wins_low: number;
      winner_team_id: string;
    }>('select * from public.playoff_series where league_id = $1', [LEAGUE]);
    expect(series.rows).toHaveLength(15);
    expect(series.rows.filter((s) => s.round === 4)).toHaveLength(1);
    for (const s of series.rows) {
      expect(Math.max(s.wins_high, s.wins_low)).toBe(4);
      const won = await db.query<{ high: number; low: number; open: number }>(
        `select count(*) filter (where (home_score > away_score) = (home_team_id = $2))::int as high,
                count(*) filter (where (home_score > away_score) = (home_team_id = $3))::int as low,
                count(*) filter (where home_score is null)::int as open
         from public.games where series_id = $1`,
        [s.id, s.high_team_id, s.low_team_id],
      );
      expect(won.rows[0]).toEqual({ high: s.wins_high, low: s.wins_low, open: 0 });
    }
    const final = series.rows.find((s) => s.round === 4)!;
    expect(final.winner_team_id).toBe(champion);

    // L'offseason non si gioca ancora
    expect((await advance()).advanced).toBe(false);
    await expect(
      asUser(db, ids.user('anna'), (tx) => tx.query('select public.force_round($1)', [LEAGUE])),
    ).rejects.toThrow(/offseason/);
  });

  it('la classifica ha i totali delle partite e decide il tabellone', async () => {
    const teams = await db.query<{
      id: string;
      code: string;
      city: string;
      name: string;
      full_name: string;
      conference: Conference;
      division: Division;
    }>(
      'select id, code, city, name, full_name, conference, division from public.teams where league_id = $1 order by code',
      [LEAGUE],
    );
    const engineTeams: Team[] = teams.rows.map((t) => ({
      id: t.id,
      city: t.city,
      name: t.name,
      fullName: t.full_name,
      conference: t.conference,
      division: t.division,
    }));
    const games = await db.query<{
      round_number: number;
      home_team_id: string;
      away_team_id: string;
      home_score: number;
      away_score: number;
    }>(
      `select round_number, home_team_id, away_team_id, home_score, away_score from public.games
       where league_id = $1 and kind = 'regular' and home_score is not null`,
      [LEAGUE],
    );
    expect(games.rows).toHaveLength(1230);
    const records: GameRecord[] = games.rows.map((g) => ({
      turn: g.round_number,
      phase: 'regular',
      homeId: g.home_team_id,
      awayId: g.away_team_id,
      homeScore: g.home_score,
      awayScore: g.away_score,
      overtimes: 0,
    }));
    // Come la calcola l'app: seed pubblico (id della lega) e anno della stagione
    const table = standingsTable(engineTeams, records, standingsSeed(LEAGUE, 2026));
    const lines = [...table.East, ...table.West];
    expect(lines.reduce((a, l) => a + l.w, 0)).toBe(1230);
    expect(lines.reduce((a, l) => a + l.l, 0)).toBe(1230);
    for (const l of lines) expect(l.w + l.l).toBe(82);

    // Le prime 6 di ogni conference sono le teste di serie 1-6 del primo turno, 7-10 hanno giocato il play-in
    const r1 = await db.query<{
      conference: Conference;
      high_team_id: string;
      low_team_id: string;
      high_seed: number;
      low_seed: number;
    }>(
      'select conference, high_team_id, low_team_id, high_seed, low_seed from public.playoff_series where league_id = $1 and round = 1',
      [LEAGUE],
    );
    const playIn = await db.query<{ home_team_id: string; away_team_id: string }>(
      `select home_team_id, away_team_id from public.games where league_id = $1 and kind = 'play-in'`,
      [LEAGUE],
    );
    const playInTeams = new Set(playIn.rows.flatMap((g) => [g.home_team_id, g.away_team_id]));
    for (const c of ['East', 'West'] as Conference[]) {
      const order = table[c].map((l) => l.teamId);
      for (const s of r1.rows.filter((x) => x.conference === c)) {
        expect(order[s.high_seed - 1]).toBe(s.high_team_id);
        if (s.low_seed <= 6) expect(order[s.low_seed - 1]).toBe(s.low_team_id);
      }
      for (const id of order.slice(6, 10)) expect(playInTeams.has(id)).toBe(true);
      for (const id of order.slice(10)) expect(playInTeams.has(id)).toBe(false);
    }
  });
});
