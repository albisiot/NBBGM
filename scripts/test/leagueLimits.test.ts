// Terza analisi, correzioni urgenti, parte del database: minimi di scadenza e ritmo (anche per le leghe già in
// corso), liste del draft annuale limitate, pausa automatica delle leghe abbandonate e ripresa con il primo Pronto.
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MIN_DEADLINE_MINUTES,
  MIN_PACE_SECONDS,
  readSettings,
  SettingsError,
} from '../../supabase/functions/_shared/league.ts';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asUser, createTestDb, migrationFiles, serviceRpc } from '../src/db/testdb.ts';
import { quickGame } from '../src/quick-game.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const CARLA = ids.user('carla');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');
const MIGRATION = '20261107110000_league_limits.sql';

let db: PGlite;
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const advance = () =>
  advanceLeague(serviceRpc(db), LEAGUE, { newId: randomUUID, playGame: quickGame, botProposals: false });

async function league() {
  return (
    await q<{ paused: boolean; auto_paused_at: string | null; idle_rounds: number; round: string }>(
      'select paused, auto_paused_at, idle_rounds, current_round_id as round from public.leagues where id = $1',
      [LEAGUE],
    )
  )[0]!;
}

/** La scadenza del turno aperto è passata. */
const expire = async () =>
  db.query(
    `update public.rounds set deadline = now() - interval '1 minute'
     where id = (select current_round_id from public.leagues where id = $1)`,
    [LEAGUE],
  );

const ready = (user: string, team: string, value = true) =>
  asUser(db, user, (tx) => tx.query('select public.set_ready($1, $2)', [team, value]));

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
}, 120_000);

describe('scadenza e ritmo con un minimo', () => {
  it('il database rifiuta una scadenza sotto i 15 minuti e un ritmo sotto i 60 secondi', async () => {
    const set = (sql: string) => asUser(db, ANNA, (tx) => tx.query(sql, [LEAGUE]));
    await expect(set('update public.leagues set deadline_minutes = 1 where id = $1')).rejects.toThrow(
      /leagues_deadline_minutes_check/,
    );
    await expect(set('update public.leagues set max_pace_seconds = 0 where id = $1')).rejects.toThrow(
      /leagues_max_pace_seconds_check/,
    );
    await set('update public.leagues set deadline_minutes = 15, max_pace_seconds = 60 where id = $1');
    await set('update public.leagues set deadline_minutes = null where id = $1');
  });

  it('create-league fa gli stessi controlli', () => {
    expect([MIN_DEADLINE_MINUTES, MIN_PACE_SECONDS]).toEqual([15, 60]);
    expect(() => readSettings({ deadline_minutes: 1 })).toThrow(SettingsError);
    expect(() => readSettings({ deadline_minutes: 14 })).toThrow('almeno 15 minuti');
    expect(() => readSettings({ max_pace_seconds: 0 })).toThrow(SettingsError);
    expect(() => readSettings({ max_pace_seconds: 59.5 })).toThrow(SettingsError);
    expect(readSettings({ deadline_minutes: 15, max_pace_seconds: 60 })).toMatchObject({
      deadline_minutes: 15,
      max_pace_seconds: 60,
    });
    expect(readSettings(null)).toMatchObject({ deadline_minutes: null, max_pace_seconds: 60 });
  });

  it('la migrazione porta al minimo le leghe in corso e accorcia le liste del draft troppo lunghe', async () => {
    const old = await PGlite.create();
    await old.exec(readFileSync(new URL('../src/db/shim.sql', import.meta.url), 'utf8'));
    const files = migrationFiles();
    const at = files.findIndex((f) => basename(f) === MIGRATION);
    expect(at).toBeGreaterThan(0);
    for (const f of files.slice(0, at)) await old.exec(readFileSync(f, 'utf8'));
    await old.exec(buildSeedSql());
    // Una lega con la scadenza di un minuto e il ritmo a 0, e una lista di BOS lunghissima: prima i doppioni e
    // gli id di chi non è un prospetto, poi tre prospetti
    const prospects = (
      await old.query<{ id: string }>(
        `update public.players set draft_prospect = 2027
         where id in (select id from public.players where team_id is null order by id limit 3) returning id`,
      )
    ).rows.map((r) => r.id);
    const noise = Array.from({ length: 300 }, () => randomUUID());
    await old.query(`update public.leagues set deadline_minutes = 1, max_pace_seconds = 0 where id = $1`, [
      LEAGUE,
    ]);
    await old.query(
      `insert into public.draft_lists (team_id, league_id, player_ids) values ($1, $2, $3), ($4, $2, $5)`,
      [BOS, LEAGUE, [...noise, prospects[2], prospects[0], prospects[2], prospects[1]], LAL, [prospects[1]]],
    );
    await old.exec(readFileSync(files[at] as string, 'utf8'));
    const l = await old.query<{ deadline_minutes: number; max_pace_seconds: number }>(
      'select deadline_minutes, max_pace_seconds from public.leagues where id = $1',
      [LEAGUE],
    );
    expect(l.rows[0]).toEqual({ deadline_minutes: 15, max_pace_seconds: 60 });
    const lists = await old.query<{ team_id: string; player_ids: string[] }>(
      'select team_id, player_ids from public.draft_lists order by team_id = $1 desc',
      [BOS],
    );
    expect(lists.rows).toEqual([
      { team_id: BOS, player_ids: [prospects[2], prospects[0], prospects[1]] },
      { team_id: LAL, player_ids: [prospects[1]] },
    ]);
    await old.close();
  }, 120_000);
});

describe('liste del draft annuale', () => {
  it('al massimo 100 giocatori; l’ora dell’ultima modifica la mette il server', async () => {
    const players = (await q<{ id: string }>('select id from public.players order by id limit 101')).map(
      (r) => r.id,
    );
    await expect(
      q('insert into public.draft_lists (team_id, league_id, player_ids) values ($1, $2, $3)', [
        BOS,
        LEAGUE,
        players,
      ]),
    ).rejects.toThrow(/draft_lists_player_ids_check/);
    await asUser(db, ANNA, (tx) =>
      tx.query(
        `insert into public.draft_lists (team_id, league_id, player_ids, updated_at) values ($1, $2, $3, '2000-01-01')`,
        [BOS, LEAGUE, players.slice(0, 100)],
      ),
    );
    const row = await q<{ old: boolean }>(
      `select updated_at < now() - interval '1 day' as old from public.draft_lists where team_id = $1`,
      [BOS],
    );
    expect(row[0]!.old).toBe(false);
    await q('delete from public.draft_lists where team_id = $1', [BOS]);
  });
});

describe('pausa automatica delle leghe abbandonate', () => {
  it('dopo 3 turni scaduti senza nessuno, alla quarta scadenza la lega si ferma e lo dice al commissario', async () => {
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set deadline_minutes = 15 where id = $1', [LEAGUE]),
    );
    for (let i = 1; i <= 3; i++) {
      await expire();
      expect(await advance()).toMatchObject({ advanced: true, reason: 'deadline' });
      expect((await league()).idle_rounds).toBe(i);
    }
    const before = await league();
    await expire();
    expect((await advance()).advanced).toBe(false);
    const after = await league();
    expect(after).toMatchObject({ paused: true, idle_rounds: 0, round: before.round });
    expect(after.auto_paused_at).not.toBeNull();
    const round = await q<{ state: string }>('select state from public.rounds where id = $1', [before.round]);
    expect(round[0]!.state).toBe('open');
    const alerts = await q<{ team_id: string; blocking: boolean; payload: { rounds: number } }>(
      `select team_id, blocking, payload from public.alerts where league_id = $1 and kind = 'league_paused'`,
      [LEAGUE],
    );
    expect(alerts).toEqual([{ team_id: BOS, blocking: false, payload: { rounds: 3 } }]);
    // In pausa non avanza più, nemmeno con pg_cron
    expect((await q<{ n: number }>('select private.cron_tick() as n'))[0]!.n).toBe(0);
    expect((await advance()).advanced).toBe(false);
    // Tutti i membri vedono che si è fermata da sola
    const seen = await asUser(db, CARLA, (tx) =>
      tx.query<{ auto_paused_at: string | null }>('select auto_paused_at from public.leagues where id = $1', [
        LEAGUE,
      ]),
    );
    expect(seen.rows[0]!.auto_paused_at).not.toBeNull();
  });

  it('il primo Pronto la riprende, con la scadenza da adesso', async () => {
    await ready(BRUNO, LAL);
    const l = await league();
    expect(l).toMatchObject({ paused: false, auto_paused_at: null });
    const d = await q<{ left: number }>(
      'select extract(epoch from deadline - now())::int as left from public.rounds where id = $1',
      [l.round],
    );
    expect(d[0]!.left).toBeGreaterThan(14 * 60);
    // Con il Pronto di Bruno il turno ha avuto attività: alla scadenza si chiude e il conto riparte
    await expire();
    expect(await advance()).toMatchObject({ advanced: true, reason: 'deadline' });
    expect((await league()).idle_rounds).toBe(0);
  });

  it('ogni attività umana, o una chiusura non per scadenza, rimette il conto a zero', async () => {
    const idleClose = async () => {
      await expire();
      expect(await advance()).toMatchObject({ advanced: true, reason: 'deadline' });
    };
    await idleClose();
    await idleClose();
    expect((await league()).idle_rounds).toBe(2);
    // Carla cambia le tattiche: il turno non è senza nessuno
    await asUser(db, CARLA, async (tx) => {
      const roster = (
        await tx.query<{ id: string }>(
          `select p.id from public.players p join public.contracts c on c.player_id = p.id
           where p.team_id = $1 and c.type <> 'two-way' order by p.id limit 10`,
          [NYK],
        )
      ).rows.map((r) => r.id);
      const minutes = Object.fromEntries(roster.map((id) => [id, 24]));
      await tx.query(
        `insert into public.team_settings (team_id, league_id, starters, minutes, tactics) values ($1, $2, $3, $4, '{}')
         on conflict (team_id) do update set starters = excluded.starters, minutes = excluded.minutes`,
        [NYK, LEAGUE, roster.slice(0, 5), JSON.stringify(minutes)],
      );
    });
    await idleClose();
    expect((await league()).idle_rounds).toBe(0);
    await idleClose();
    expect((await league()).idle_rounds).toBe(1);
    // Il commissario forza: chiusura non per scadenza
    await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
    expect(await advance()).toMatchObject({ advanced: true, reason: 'forced' });
    expect((await league()).idle_rounds).toBe(0);
  });

  it('la pausa messa dal commissario non la toglie un Pronto', async () => {
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set paused = true where id = $1', [LEAGUE]),
    );
    await ready(BRUNO, LAL);
    expect(await league()).toMatchObject({ paused: true, auto_paused_at: null });
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set paused = false where id = $1', [LEAGUE]),
    );
    // Il client non scrive il conto né l'ora della pausa automatica
    await expect(
      asUser(db, ANNA, (tx) => tx.query('update public.leagues set idle_rounds = 9 where id = $1', [LEAGUE])),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query('update public.leagues set auto_paused_at = now() where id = $1', [LEAGUE]),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
