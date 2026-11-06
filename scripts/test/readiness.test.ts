// Dopo la Fase 13: stato di ogni squadra umana nel turno dato dal server (round_readiness), con la stessa regola
// che decide la chiusura del turno. Lega di prova del seed: anna su BOS, bruno su LAL, carla su NYK.
import type { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asAnon, asUser, createTestDb } from '../src/db/testdb.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const CARLA = ids.user('carla');
const OUTSIDER = stableUuid('user:esterno-readiness');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    OUTSIDER,
    'esterno@nbbgm.test',
    { name: 'Esterno' },
  ]);
}, 120_000);

/** Stato delle squadre umane come lo legge un membro dall'API. */
async function states(user = ANNA): Promise<Record<string, string>> {
  const rows = await asUser(
    db,
    user,
    async (tx) =>
      (
        await tx.query<{ team_id: string; state: string }>('select * from public.round_readiness($1)', [
          LEAGUE,
        ])
      ).rows,
  );
  return Object.fromEntries(rows.map((r) => [r.team_id, r.state]));
}

const roundId = async () =>
  (
    await db.query<{ id: string }>('select current_round_id as id from public.leagues where id = $1', [
      LEAGUE,
    ])
  ).rows[0]!.id;

const allReady = async () =>
  (await db.query<{ ok: boolean }>('select public.round_all_ready($1) as ok', [await roundId()])).rows[0]!.ok;

const ready = (user: string, team: string, value = true) =>
  asUser(db, user, (tx) => tx.query('select public.set_ready($1, $2)', [team, value]));

const coach = (user: string, team: string) =>
  asUser(db, user, (tx) =>
    tx.query(
      `insert into public.coach_delegations (team_id, league_id, active) values ($1, $2, true)
       on conflict (team_id) do update set active = true, until_round = null, until_at = null`,
      [team, LEAGUE],
    ),
  );

describe('stato delle squadre nel turno', () => {
  it('solo i membri della lega lo leggono', async () => {
    await expect(
      asUser(db, OUTSIDER, (tx) => tx.query('select * from public.round_readiness($1)', [LEAGUE])),
    ).rejects.toThrow(/Non fai parte di questa lega/);
    await expect(
      asAnon(db, (tx) => tx.query('select * from public.round_readiness($1)', [LEAGUE])),
    ).rejects.toThrow(/permission denied/);
    // La funzione interna non si chiama dall'API
    await expect(
      asUser(db, ANNA, (tx) => tx.query('select * from private.team_readiness($1)', [ids.round])),
    ).rejects.toThrow(/permission denied/);
  });

  it('pronta, con l’allenatore, in attesa di una decisione o non pronta, come la conta il server', async () => {
    expect(await states()).toEqual({ [BOS]: 'waiting', [LAL]: 'waiting', [NYK]: 'waiting' });

    await ready(ANNA, BOS);
    await coach(BRUNO, LAL);
    expect(await states(CARLA)).toEqual({ [BOS]: 'ready', [LAL]: 'coach', [NYK]: 'waiting' });
    expect(await allReady()).toBe(false);

    // Bruno riceve un avviso bloccante: con l'allenatore attivo la sua squadra non è più pronta. Gli altri lo
    // vedono, senza sapere quale avviso sia (gli avvisi di Bruno restano illeggibili)
    const alert = (
      await db.query<{ id: string }>(
        `insert into public.alerts (league_id, team_id, kind, blocking, round_id)
         values ($1, $2, 'trade_offer', true, $3) returning id`,
        [LEAGUE, LAL, await roundId()],
      )
    ).rows[0]!.id;
    await ready(CARLA, NYK);
    expect(await states(CARLA)).toEqual({ [BOS]: 'ready', [LAL]: 'blocked', [NYK]: 'ready' });
    expect(await allReady()).toBe(false);
    const seen = await asUser(db, CARLA, (tx) =>
      tx.query('select id from public.alerts where team_id = $1', [LAL]),
    );
    expect(seen.rows).toHaveLength(0);

    // Un avviso informativo non ferma l'allenatore
    await db.query(
      `insert into public.alerts (league_id, team_id, kind, blocking, round_id)
       values ($1, $2, 'injury', false, $3)`,
      [LEAGUE, LAL, await roundId()],
    );
    expect((await states())[LAL]).toBe('blocked');

    // Bruno risponde: l'allenatore riparte e il turno è completo
    const complete = await asUser(
      db,
      BRUNO,
      async (tx) =>
        (await tx.query<{ r: boolean }>('select public.answer_alert($1) as r', [alert])).rows[0]!.r,
    );
    expect(complete).toBe(true);
    expect(await states()).toEqual({ [BOS]: 'ready', [LAL]: 'coach', [NYK]: 'ready' });
    expect(await allReady()).toBe(true);

    // Con il Pronto premuto l'avviso non conta: la squadra è pronta
    await db.query(`update public.alerts set status = 'open' where id = $1`, [alert]);
    await ready(BRUNO, LAL);
    expect((await states())[LAL]).toBe('ready');
    expect(await allReady()).toBe(true);
  });

  it('in play-in e playoff chi non ha partita nel turno non deve essere pronto', async () => {
    await ready(ANNA, BOS, false);
    await ready(BRUNO, LAL, false);
    await ready(CARLA, NYK, false);
    await asUser(db, BRUNO, (tx) =>
      tx.query('update public.coach_delegations set active = false where team_id = $1', [LAL]),
    );
    const round = await roundId();
    // Il turno diventa di playoff e i Knicks restano senza partita (tutto torna indietro alla fine)
    const result = await db.transaction(async (tx) => {
      await tx.query(`update public.rounds set kind = 'playoffs' where id = $1`, [round]);
      await tx.query(
        `delete from public.games g using public.rounds r
         where r.id = $1 and g.season_id = r.season_id and g.round_number = r.number
           and $2 in (g.home_team_id, g.away_team_id)`,
        [round, NYK],
      );
      await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
        JSON.stringify({ sub: CARLA, role: 'authenticated' }),
      ]);
      await tx.exec('set local role authenticated');
      const rows = (
        await tx.query<{ team_id: string; state: string }>('select * from public.round_readiness($1)', [
          LEAGUE,
        ])
      ).rows;
      await tx.exec('reset role');
      await tx.query(
        `insert into public.ready_flags (round_id, team_id, league_id, ready) values ($1, $2, $3, true),
         ($1, $4, $3, true) on conflict (round_id, team_id) do update set ready = true`,
        [round, BOS, LEAGUE, LAL],
      );
      const ok = (await tx.query<{ ok: boolean }>('select public.round_all_ready($1) as ok', [round]))
        .rows[0]!.ok;
      await tx.rollback();
      return { states: Object.fromEntries(rows.map((r) => [r.team_id, r.state])), ok };
    });
    expect(result.states).toEqual({ [BOS]: 'waiting', [LAL]: 'waiting', [NYK]: 'out' });
    // Pronti i due che giocano: il turno è completo anche senza i Knicks
    expect(result.ok).toBe(true);
    expect(await states()).toEqual({ [BOS]: 'waiting', [LAL]: 'waiting', [NYK]: 'waiting' });
  });
});
