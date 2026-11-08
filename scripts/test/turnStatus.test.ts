// Seconda analisi, prestazioni: stato del turno in una sola lettura (public.turn_status), per la barra e la scheda
// del turno. Lega di prova del seed: anna su BOS, bruno su LAL, carla su NYK. La funzione legge con la RLS di chi
// la chiama: ognuno vede i propri avvisi e solo le leghe di cui fa parte.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { turnFromServer, type TurnStatusRow } from '../../apps/web/src/lib/turnStatus.ts';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asAnon, asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';
import { quickGame } from '../src/quick-game.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const OUTSIDER = stableUuid('user:esterno-turno');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    OUTSIDER,
    'esterno-turno@nbbgm.test',
    { name: 'Esterno' },
  ]);
}, 120_000);

const turnStatus = (user: string) =>
  asUser(
    db,
    user,
    async (tx) =>
      (await tx.query<{ s: TurnStatusRow | null }>('select public.turn_status($1) as s', [LEAGUE])).rows[0]!
        .s,
  );

const roundId = async () =>
  (
    await db.query<{ id: string }>('select current_round_id as id from public.leagues where id = $1', [
      LEAGUE,
    ])
  ).rows[0]!.id;

describe('stato del turno in una lettura', () => {
  it('solo i membri lo leggono; dall’API senza login non si chiama', async () => {
    expect(await turnStatus(OUTSIDER)).toBeNull();
    await expect(asAnon(db, (tx) => tx.query('select public.turn_status($1)', [LEAGUE]))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('turno, propria squadra, Pronto, allenatori, propri avvisi e stato delle squadre come le letture separate', async () => {
    const round = await roundId();
    await asUser(db, ANNA, (tx) => tx.query('select public.set_ready($1, true)', [BOS]));
    await asUser(db, BRUNO, (tx) =>
      tx.query(
        `insert into public.coach_delegations (team_id, league_id, active) values ($1, $2, true)
         on conflict (team_id) do update set active = true, until_round = null, until_at = null`,
        [LAL, LEAGUE],
      ),
    );
    for (const team of [BOS, LAL])
      await db.query(
        `insert into public.alerts (league_id, team_id, kind, blocking, round_id) values ($1, $2, 'trade_offer', true, $3)`,
        [LEAGUE, team, round],
      );

    const row = await turnStatus(ANNA);
    const bytes = JSON.stringify(row).length;
    console.info(`turn_status: ${bytes} byte`);
    expect(bytes).toBeLessThan(4_000);
    const s = turnFromServer(LEAGUE, row);
    expect(s.myTeamId).toBe(BOS);
    expect(s.round?.id).toBe(round);
    // Il turno ha il suo giorno (il primo della stagione) e l'anno della stagione
    expect(row?.round).toMatchObject({ day: 0, season_year: 2026 });
    // Pronti: Boston (a mano) e New York, che riposa (Pronto automatico)
    expect([...s.ready].sort()).toEqual([BOS, NYK].sort());
    expect(s.delegations.map((d) => d.teamId)).toEqual([LAL]);
    // Gli avvisi di Bruno restano suoi
    expect(s.alerts.map((a) => a.kind)).toEqual(['trade_offer']);
    expect((await turnStatus(BRUNO))?.alerts?.length).toBe(1);
    // Lo stato delle squadre è quello di round_readiness
    const server = await asUser(db, ANNA, async (tx) =>
      Object.fromEntries(
        (
          await tx.query<{ team_id: string; state: string }>('select * from public.round_readiness($1)', [
            LEAGUE,
          ])
        ).rows.map((r) => [r.team_id, r.state]),
      ),
    );
    // TODO Fase 3 (app): l'app legge anche lo stato rest; per ora lo scarta come uno stato sconosciuto
    expect(Object.fromEntries(s.teamStates ?? new Map())).toEqual(
      Object.fromEntries(Object.entries(server).filter(([, state]) => state !== 'rest')),
    );
    expect(server).toEqual({ [BOS]: 'ready', [LAL]: 'blocked', [NYK]: 'rest' });
  });

  it('dopo un turno: l’ultima partita della propria squadra; chi gioca nel turno', async () => {
    // Boston riposa il primo giorno e gioca il secondo
    for (let i = 0; i < 2; i++) {
      await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
      const r = await advanceLeague(serviceRpc(db), LEAGUE, {
        newId: randomUUID,
        playGame: quickGame,
        botProposals: false,
      });
      expect(r.advanced).toBe(true);
    }
    const s = turnFromServer(LEAGUE, await turnStatus(ANNA));
    const last = (
      await db.query<{ home_team_id: string; away_team_id: string; home_score: number }>(
        `select home_team_id, away_team_id, home_score from public.games
         where league_id = $1 and home_score is not null and $2 in (home_team_id, away_team_id)
         order by played_at desc limit 1`,
        [LEAGUE, BOS],
      )
    ).rows[0]!;
    expect(s.lastGame).toMatchObject({
      homeTeamId: last.home_team_id,
      awayTeamId: last.away_team_id,
      homeScore: last.home_score,
    });
    expect(s.playing).toBeNull();
    // Chi gioca nel turno: le squadre delle partite di quel giorno, anche in regular season
    const round = await roundId();
    const teams = (
      await db.query<{ team: string }>(
        `select unnest(array[g.home_team_id, g.away_team_id]) as team from public.games g
         join public.rounds r on r.season_id = g.season_id and r.number = g.round_number where r.id = $1`,
        [round],
      )
    ).rows.map((x) => x.team);
    expect(teams.length).toBeLessThan(30);
    expect([...((await turnStatus(ANNA))?.playing ?? [])].sort()).toEqual([...teams].sort());
    // Lo stesso turno visto come un turno di playoff: l'app guarda chi gioca
    await db.query(`update public.rounds set kind = 'playoffs' where id = $1`, [round]);
    try {
      const p = turnFromServer(LEAGUE, await turnStatus(ANNA));
      expect(p.playing?.size).toBe(teams.length);
    } finally {
      await db.query(`update public.rounds set kind = 'regular' where id = $1`, [round]);
    }
  });
});
