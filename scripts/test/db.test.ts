// Fase 5: le migrazioni Supabase su PGlite. Un utente non modifica la squadra di un altro né legge i valori
// nascosti; il turno si chiude una volta sola e apply_turn scrive tutto o niente.
import type { PGlite, Transaction } from '@electric-sql/pglite';
import { playRegularTurn, simulateGame, type GameResult, type LeagueState } from '@nbbgm/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildSeedSql, seedIds, seedLeagueState, stableUuid } from '../src/db/seed.ts';
import { asAnon, asService, asUser, createTestDb } from '../src/db/testdb.ts';

const ids = seedIds();
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const CARLA = ids.user('carla');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');
const MIA = ids.team('MIA');

let db: PGlite;

async function one<T>(tx: Transaction | PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const r = await tx.query<T>(sql, params);
  return r.rows[0] as T;
}

async function count(tx: Transaction | PGlite, sql: string, params: unknown[] = []): Promise<number> {
  return (await one<{ n: number }>(tx, `select count(*)::int as n from (${sql}) x`, params)).n;
}

async function changed(tx: Transaction, sql: string, params: unknown[] = []): Promise<number> {
  return (await tx.query(sql, params)).affectedRows ?? 0;
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
}, 120_000);

describe('migrazioni e seed', () => {
  it('creano la lega di prova con il primo turno aperto', async () => {
    expect(await count(db, 'select 1 from public.teams')).toBe(30);
    expect(await count(db, 'select 1 from public.games where home_score is null')).toBe(1230);
    expect(await count(db, 'select 1 from public.profiles')).toBe(3);
    const round = await one<{ state: string; number: number }>(
      db,
      'select r.state, r.number from public.leagues l join public.rounds r on r.id = l.current_round_id',
    );
    expect(round).toEqual({ state: 'open', number: 0 });
  });
});

// Permessi di ogni ruolo su ogni tabella e funzione di public, colonne comprese
const PRIVILEGES = `
  select 'table' as kind, c.relname as name, r.role, p.priv
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace and n.nspname = 'public'
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
  cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) as p(priv)
  where c.relkind = 'r'
    and (has_table_privilege(r.role, c.oid, p.priv)
      or (p.priv <> 'DELETE' and has_any_column_privilege(r.role, c.oid, p.priv)))
  union all
  select 'function', f.oid::regprocedure::text, r.role, 'EXECUTE'
  from pg_proc f
  join pg_namespace n on n.oid = f.pronamespace and n.nspname = 'public'
  cross join (values ('anon'), ('authenticated'), ('service_role')) as r(role)
  where has_function_privilege(r.role, f.oid, 'EXECUTE')
  order by 1, 2, 3, 4`;

describe('permessi', () => {
  it('sono gli stessi con "Automatically expose new tables" acceso o spento', async () => {
    const exposed = await createTestDb({ exposeNewTables: true });
    const off = (await db.query(PRIVILEGES)).rows;
    expect((await exposed.query(PRIVILEGES)).rows).toEqual(off);
    await exposed.close();
  });

  it('il server ha tutto, anon nessuna tabella e nessuna funzione di gioco', async () => {
    const rows = (await db.query<{ kind: string; name: string; role: string; priv: string }>(PRIVILEGES))
      .rows;
    const tables = await count(db, `select 1 from pg_tables where schemaname = 'public'`);
    expect(rows.filter((r) => r.kind === 'table' && r.role === 'service_role')).toHaveLength(tables * 4);
    expect(rows.filter((r) => r.kind === 'table' && r.role === 'anon')).toEqual([]);
    // Postgres apre ogni funzione nuova a tutti: le migrazioni devono averle chiuse una per una
    const anonFunctions = rows.filter((r) => r.kind === 'function' && r.role === 'anon').map((r) => r.name);
    expect(anonFunctions).toEqual([]);
    // Dall'API il manager chiama solo set_ready; le funzioni delle policy stanno nello schema private
    const userFunctions = rows
      .filter((r) => r.kind === 'function' && r.role === 'authenticated')
      .map((r) => r.name);
    expect(userFunctions).toEqual([
      'join_league(text,text)',
      'league_preview(text)',
      'set_ready(uuid,boolean)',
    ]);
    // Il client scrive solo dove serve al manager
    const writes = rows
      .filter((r) => r.kind === 'table' && r.role === 'authenticated' && r.priv !== 'SELECT')
      .map((r) => `${r.name}:${r.priv}`);
    expect(writes).toEqual([
      'coach_delegations:DELETE',
      'coach_delegations:INSERT',
      'coach_delegations:UPDATE',
      'free_agent_bids:DELETE',
      'free_agent_bids:INSERT',
      'free_agent_bids:UPDATE',
      'leagues:UPDATE',
      'profiles:UPDATE',
      'team_settings:DELETE',
      'team_settings:INSERT',
      'team_settings:UPDATE',
      'trade_offers:INSERT',
    ]);
  });

  it('ogni chiave esterna ha un indice', async () => {
    const unindexed = await db.query<{ name: string }>(`
      select c.conname as name
      from pg_constraint c
      where c.contype = 'f' and c.connamespace = 'public'::regnamespace
        and not exists (
          select 1 from pg_index i
          where i.indrelid = c.conrelid
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] @> c.conkey
            and (i.indkey::int2[])[0:cardinality(c.conkey) - 1] <@ c.conkey
        )`);
    expect(unindexed.rows.map((r) => r.name)).toEqual([]);
  });
});

describe('valori nascosti', () => {
  it('un membro legge giocatori e contratti della lega', async () => {
    await asUser(db, ANNA, async (tx) => {
      expect(await count(tx, 'select 1 from public.leagues')).toBe(1);
      expect(await count(tx, 'select 1 from public.players')).toBe(480);
      expect(await count(tx, 'select 1 from public.contracts')).toBeGreaterThan(400);
      const p = await one<Record<string, unknown>>(tx, 'select * from public.players limit 1');
      expect(Object.keys(p)).not.toContain('hidden');
      expect(JSON.stringify(p)).not.toMatch(/"(potential|workEthic|character)"/);
    });
  });

  it('nessun utente legge player_hidden né i dati di partenza', async () => {
    for (const table of [
      'player_hidden',
      'base_players',
      'base_contracts',
      'base_teams',
      'base_dead_money',
    ]) {
      await expect(asUser(db, ANNA, (tx) => tx.query(`select * from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
      await expect(asAnon(db, (tx) => tx.query(`select * from public.${table}`))).rejects.toThrow(
        /permission denied/,
      );
    }
  });

  it('il server li legge', async () => {
    expect(await asService(db, (tx) => count(tx, 'select 1 from public.player_hidden'))).toBe(480);
  });
});

describe('la propria squadra e basta', () => {
  it('il manager cambia le impostazioni della sua squadra', async () => {
    const n = await asUser(db, ANNA, (tx) =>
      changed(
        tx,
        `update public.team_settings set tactics = tactics || '{"pace":"fast"}' where team_id = $1`,
        [BOS],
      ),
    );
    expect(n).toBe(1);
  });

  it('non tocca e non vede le impostazioni di un altro', async () => {
    await asUser(db, ANNA, async (tx) => {
      expect(
        await changed(tx, `update public.team_settings set tactics = '{"pace":"slow"}' where team_id = $1`, [
          LAL,
        ]),
      ).toBe(0);
      expect(await changed(tx, 'delete from public.team_settings where team_id = $1', [LAL])).toBe(0);
      const visible = await tx.query<{ team_id: string }>('select team_id from public.team_settings');
      expect(visible.rows.map((r) => r.team_id)).toEqual([BOS]);
    });
    const lal = await one<{ tactics: { pace: string } }>(
      db,
      'select tactics from public.team_settings where team_id = $1',
      [LAL],
    );
    expect(lal.tactics.pace).toBe('normal');
  });

  it('non crea impostazioni per una squadra del bot', async () => {
    // Impostazioni valide per Miami (5 giocatori a 48 minuti): a fermarle è la RLS, non il controllo dei minuti
    const mia = await db.query<{ id: string }>('select id from public.players where team_id = $1 limit 5', [
      MIA,
    ]);
    const starters = mia.rows.map((r) => r.id);
    const minutes = Object.fromEntries(starters.map((id) => [id, 48]));
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query(
          `insert into public.team_settings (team_id, league_id, starters, minutes, tactics) values ($1, $2, $3, $4, '{}')`,
          [MIA, ids.league, starters, minutes],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('non cambia saldo, rose, partite o bilancio', async () => {
    const attempts = [
      ['update public.teams set balance = balance + 1000000000 where id = $1', [BOS]],
      ['update public.teams set owner_id = $1 where id = $2', [ANNA, MIA]],
      ['update public.players set team_id = $1 where team_id = $2', [BOS, LAL]],
      ['update public.games set home_score = 150, away_score = 80 where home_team_id = $1', [BOS]],
      [
        `insert into public.ledger (league_id, team_id, season_id, kind, amount) values ($1, $2, $3, 'other', 1)`,
        [ids.league, BOS, ids.season],
      ],
      ['update public.rounds set state = $1', ['closing']],
      [
        'insert into public.ready_flags (round_id, team_id, league_id) values ($1, $2, $3)',
        [ids.round, LAL, ids.league],
      ],
      ['update public.leagues set seed = $1', ['x']],
    ] as const;
    for (const [sql, params] of attempts) {
      await expect(asUser(db, ANNA, (tx) => tx.query(sql, [...params]))).rejects.toThrow(/permission denied/);
    }
  });

  it('solo il commissario cambia le impostazioni della lega', async () => {
    const sql = 'update public.leagues set deadline_minutes = 720 where id = $1';
    expect(await asUser(db, BRUNO, (tx) => changed(tx, sql, [ids.league]))).toBe(0);
    expect(await asUser(db, ANNA, (tx) => changed(tx, sql, [ids.league]))).toBe(1);
    await db.query('update public.leagues set deadline_minutes = null where id = $1', [ids.league]);
  });

  it('il quintetto è della squadra e i minuti fanno 240', async () => {
    const setMinutes = (fn: (m: Record<string, number>) => void) =>
      asUser(db, ANNA, async (tx) => {
        const s = await one<{ minutes: Record<string, number> }>(
          tx,
          'select minutes from public.team_settings where team_id = $1',
          [BOS],
        );
        fn(s.minutes);
        await tx.query('update public.team_settings set minutes = $1 where team_id = $2', [s.minutes, BOS]);
      });
    await expect(
      setMinutes((m) => {
        const k = Object.keys(m)[0] as string;
        m[k] = (m[k] as number) - 1;
      }),
    ).rejects.toThrow(/somma dei minuti deve fare 240/);
    const lalPlayer = await one<{ id: string }>(
      db,
      'select id from public.players where team_id = $1 limit 1',
      [LAL],
    );
    await expect(
      setMinutes((m) => {
        const k = Object.keys(m)[0] as string;
        m[lalPlayer.id] = m[k] as number;
        delete m[k];
      }),
    ).rejects.toThrow(/non sono della squadra/);
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query('update public.team_settings set starters[1] = $1 where team_id = $2', [lalPlayer.id, BOS]),
      ),
    ).rejects.toThrow(/quintetto contiene giocatori che non sono della squadra/);
  });
});

describe('offerte agli svincolati', () => {
  it('sono a busta chiusa e solo per la propria squadra', async () => {
    const fa = await one<{ id: string }>(db, 'select id from public.players where team_id is null limit 1');
    const bid = `insert into public.free_agent_bids (league_id, round_id, team_id, player_id, salaries)
                 values ($1, $2, $3, $4, '{2000000}')`;
    await asUser(db, BRUNO, (tx) => tx.query(bid, [ids.league, ids.round, LAL, fa.id]));
    expect(await asUser(db, BRUNO, (tx) => count(tx, 'select 1 from public.free_agent_bids'))).toBe(1);
    expect(await asUser(db, ANNA, (tx) => count(tx, 'select 1 from public.free_agent_bids'))).toBe(0);
    await expect(
      asUser(db, ANNA, (tx) => tx.query(bid, [ids.league, ids.round, LAL, fa.id])),
    ).rejects.toThrow(/row-level security/);
    // Un giocatore sotto contratto non è uno svincolato
    const rostered = await one<{ id: string }>(
      db,
      'select id from public.players where team_id = $1 limit 1',
      [MIA],
    );
    await expect(
      asUser(db, ANNA, (tx) => tx.query(bid, [ids.league, ids.round, BOS, rostered.id])),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('chi non è nella lega', () => {
  it('non vede nulla', async () => {
    const outsider = stableUuid('user:estraneo');
    await db.query(`insert into auth.users (id, email) values ($1, 'estraneo@nbbgm.test')`, [outsider]);
    await asUser(db, outsider, async (tx) => {
      for (const t of [
        'leagues',
        'teams',
        'players',
        'contracts',
        'games',
        'rounds',
        'ready_flags',
        'league_members',
      ])
        expect(await count(tx, `select 1 from public.${t}`), t).toBe(0);
      // Vede solo il proprio profilo
      expect(await count(tx, 'select 1 from public.profiles')).toBe(1);
    });
    await expect(
      asUser(db, outsider, (tx) => tx.query('select public.set_ready($1)', [BOS])),
    ).rejects.toThrow(/Non è la tua squadra/);
  });

  it('senza login non si legge niente', async () => {
    await expect(asAnon(db, (tx) => tx.query('select * from public.teams'))).rejects.toThrow(
      /permission denied/,
    );
    await expect(asAnon(db, (tx) => tx.query('select public.set_ready($1)', [BOS]))).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('Pronto', () => {
  const ready = (user: string, team: string, value = true) =>
    asUser(
      db,
      user,
      async (tx) => (await one<{ r: boolean }>(tx, 'select public.set_ready($1, $2) as r', [team, value])).r,
    );
  const allReady = () =>
    asService(
      db,
      async (tx) => (await one<{ r: boolean }>(tx, 'select public.round_all_ready($1) as r', [ids.round])).r,
    );

  it('vale solo per la propria squadra', async () => {
    await expect(ready(ANNA, LAL)).rejects.toThrow(/Non è la tua squadra/);
  });

  it("il turno è completo quando l'ultimo umano è pronto", async () => {
    expect(await ready(ANNA, BOS)).toBe(false);
    expect(await ready(BRUNO, LAL)).toBe(false);
    expect(await ready(CARLA, NYK)).toBe(true);
    // Chi è pronto lo vedono tutti
    expect(await asUser(db, ANNA, (tx) => count(tx, 'select 1 from public.ready_flags where ready'))).toBe(3);
    expect(await ready(CARLA, NYK, false)).toBe(false);
  });

  it("con l'allenatore la squadra è pronta, salvo avvisi bloccanti", async () => {
    await asUser(db, CARLA, (tx) =>
      tx.query('insert into public.coach_delegations (team_id, league_id) values ($1, $2)', [
        NYK,
        ids.league,
      ]),
    );
    expect(await allReady()).toBe(true);
    await asService(db, (tx) =>
      tx.query(
        `insert into public.alerts (league_id, team_id, kind, blocking) values ($1, $2, 'trade-offer', true)`,
        [ids.league, NYK],
      ),
    );
    expect(await allReady()).toBe(false);
    await asService(db, (tx) =>
      tx.query(`update public.alerts set status = 'resolved' where team_id = $1`, [NYK]),
    );
    expect(await allReady()).toBe(true);
    // Gli altri vedono che l'allenatore è attivo
    expect(await asUser(db, ANNA, (tx) => count(tx, 'select 1 from public.coach_delegations'))).toBe(1);
  });
});

describe('chiusura del turno', () => {
  it('la chiude solo il server, una volta', async () => {
    await expect(
      asUser(db, ANNA, (tx) => tx.query('select public.close_round($1)', [ids.round])),
    ).rejects.toThrow(/permission denied/);
    const first = await asService(db, (tx) =>
      one<{ s: string | null }>(tx, 'select public.close_round($1) as s', [ids.round]),
    );
    const second = await asService(db, (tx) =>
      one<{ s: string | null }>(tx, 'select public.close_round($1) as s', [ids.round]),
    );
    expect(first.s).toMatch(/^[0-9a-f-]{36}$/);
    expect(second.s).toBeNull();
    // Un turno fermo in chiusura da più di 5 minuti si riprende con lo stesso seed
    const reclaim = () =>
      asService(db, (tx) =>
        one<{ s: string | null }>(tx, 'select public.reclaim_round($1) as s', [ids.round]),
      );
    expect((await reclaim()).s).toBeNull();
    await db.query(
      `update public.rounds set closing_started_at = now() - interval '10 minutes' where id = $1`,
      [ids.round],
    );
    expect((await reclaim()).s).toBe(first.s);
    expect((await reclaim()).s).toBeNull();
  });

  it('in chiusura non si accettano modifiche', async () => {
    expect(
      await asUser(db, ANNA, (tx) =>
        changed(
          tx,
          `update public.team_settings set tactics = tactics || '{"pace":"slow"}' where team_id = $1`,
          [BOS],
        ),
      ),
    ).toBe(0);
    await expect(
      asUser(db, ANNA, (tx) => tx.query('select public.set_ready($1, false)', [BOS])),
    ).rejects.toThrow(/in chiusura/);
  });
});

/** Gioca il primo turno con il motore e lo traduce nel risultato da passare ad apply_turn. */
function turnPayload(): Record<string, unknown> {
  const before = seedLeagueState();
  const after = seedLeagueState();
  const results: { seed: string; result: GameResult }[] = [];
  playRegularTurn(after, (home, away, seed) => {
    const result = simulateGame(home, away, seed);
    results.push({ seed, result });
    return result;
  });
  const year = before.config.year;
  const team = (code: string) => ids.team(code);
  const player = (id: string) => ids.player(id);
  const teamOf = (s: LeagueState) => new Map(s.players.map((p) => [p.id, p.teamId]));
  const beforeTeams = teamOf(before);
  const beforeBalance = new Map(before.teams.map((t) => [t.id, Math.round(t.balance)]));
  const perTurn = Math.round(before.config.revenue / 82);
  const afterContracts = new Set(after.contracts.map((c) => c.playerId));

  return {
    teams: after.teams.map((t) => ({
      id: team(t.id),
      balance: Math.round(t.balance),
      strategy: t.strategy,
      tax_history: t.taxHistory,
    })),
    player_status: after.players.map((p) => ({
      id: player(p.id),
      energy: p.energy,
      morale: p.morale,
      two_way_games: p.twoWayGames,
      season_stats: p.stats,
    })),
    player_moves: after.players
      .filter((p) => beforeTeams.get(p.id) !== p.teamId)
      .map((p) => ({ id: player(p.id), team_id: p.teamId === null ? null : team(p.teamId) })),
    contracts: after.contracts.map((c) => ({
      player_id: player(c.playerId),
      team_id: team(c.teamId),
      type: c.type,
      salaries: c.salaries,
      options: c.options,
      guaranteed: c.guaranteed,
    })),
    contracts_removed: before.contracts
      .filter((c) => !afterContracts.has(c.playerId))
      .map((c) => player(c.playerId)),
    // Scelte passate di mano negli scambi tra bot
    draft_picks: after.picks
      .filter((p) => before.picks.find((b) => b.id === p.id)?.ownerId !== p.ownerId)
      .map((p) => ({
        id: stableUuid(`prova:pick:${p.id}`),
        draft_year: p.draftYear,
        round: p.round,
        original_team_id: team(p.originalTeamId),
        owner_team_id: team(p.ownerId),
        protection: p.protection,
        deferrals: p.deferrals,
      })),
    injuries: after.players
      .filter((p) => p.injury !== null)
      .map((p) => ({
        player_id: player(p.id),
        body_part: p.injury?.bodyPart,
        severity: p.injury?.severity,
        games_remaining: p.injury?.gamesRemaining,
      })),
    games: results.map(({ seed, result: r }) => ({
      id: ids.game(year, 0, r.home.teamId),
      round_number: 0,
      kind: 'regular',
      home_team_id: team(r.home.teamId),
      away_team_id: team(r.away.teamId),
      home_score: r.home.score,
      away_score: r.away.score,
      overtimes: r.overtimes,
      quarters: { home: r.home.quarters, away: r.away.quarters },
      play_by_play: r.playByPlay,
      seed,
    })),
    player_game_stats: results.flatMap(({ result: r }) =>
      (['home', 'away'] as const).flatMap((side) =>
        r[side].box.map((l) => ({
          game_id: ids.game(year, 0, r.home.teamId),
          player_id: player(l.playerId),
          team_id: team(r[side].teamId),
          starter: l.starter,
          seconds: l.seconds,
          pts: l.pts,
          fgm: l.fgm,
          fga: l.fga,
          tpm: l.tpm,
          tpa: l.tpa,
          ftm: l.ftm,
          fta: l.fta,
          orb: l.orb,
          drb: l.drb,
          ast: l.ast,
          stl: l.stl,
          blk: l.blk,
          tov: l.tov,
          pf: l.pf,
          plus_minus: l.plusMinus,
        })),
      ),
    ),
    ledger: after.teams.flatMap((t) => [
      { team_id: team(t.id), kind: 'revenue', amount: perTurn, note: 'Ricavi della giornata 1' },
      {
        team_id: team(t.id),
        kind: 'salary',
        amount: Math.round(t.balance) - (beforeBalance.get(t.id) as number) - perTurn,
        note: 'Stipendi della giornata 1',
      },
    ]),
    transactions: after.transactions.slice(before.transactions.length).map((t) => ({
      season_year: t.year,
      round_number: t.turn,
      type: t.type,
      text: t.text,
    })),
    next_round: { number: 1, kind: 'regular' },
  };
}

describe('apply_turn', () => {
  let payload: Record<string, unknown>;
  const apply = (p: unknown) =>
    asService(
      db,
      async (tx) =>
        (await one<{ id: string }>(tx, 'select public.apply_turn($1, $2) as id', [ids.round, p])).id,
    );
  const roundState = async () =>
    (await one<{ state: string }>(db, 'select state from public.rounds where id = $1', [ids.round])).state;

  beforeAll(() => {
    payload = turnPayload();
  });

  it('non lo chiama un utente', async () => {
    await expect(
      asUser(db, ANNA, (tx) => tx.query('select public.apply_turn($1, $2)', [ids.round, payload])),
    ).rejects.toThrow(/permission denied/);
  });

  it('con un risultato sbagliato non scrive nulla', async () => {
    const stats = payload.player_game_stats as Record<string, unknown>[];
    const bad = {
      ...payload,
      player_game_stats: [...stats, { ...stats[0], player_id: stableUuid('nessuno') }],
    };
    await expect(apply(bad)).rejects.toThrow(/player_game_stats/);
    await expect(apply({ ...payload, punteggi: [] })).rejects.toThrow(/sezioni sconosciute: punteggi/);
    await expect(apply({ ...payload, next_round: undefined })).rejects.toThrow(/next_round/);
    expect(await roundState()).toBe('closing');
    expect(await count(db, 'select 1 from public.games where home_score is not null')).toBe(0);
    expect(await count(db, 'select 1 from public.player_game_stats')).toBe(0);
    expect(await count(db, 'select 1 from public.ledger')).toBe(0);
    expect(await count(db, 'select 1 from public.rounds')).toBe(1);
  });

  it('scrive partite, statistiche e bilanci e apre il turno successivo', async () => {
    const next = await apply(payload);
    expect(await roundState()).toBe('done');
    const league = await one<{ current_round_id: string }>(db, 'select current_round_id from public.leagues');
    expect(league.current_round_id).toBe(next);
    const round = await one<{ number: number; state: string }>(
      db,
      'select number, state from public.rounds where id = $1',
      [next],
    );
    expect(round).toEqual({ number: 1, state: 'open' });
    expect(
      await count(db, 'select 1 from public.games where round_number = 0 and home_score is not null'),
    ).toBe(15);
    expect(await count(db, 'select 1 from public.player_game_stats')).toBe(
      (payload.player_game_stats as unknown[]).length,
    );
    // Punti della partita = somma dei punti del box score
    expect(
      await count(
        db,
        `select g.id from public.games g join public.player_game_stats s on s.game_id = g.id
         where g.round_number = 0 group by g.id, g.home_score, g.away_score
         having sum(s.pts) <> g.home_score + g.away_score`,
      ),
    ).toBe(0);
    // Saldo = somma dei movimenti di bilancio
    expect(
      await count(
        db,
        `select t.id from public.teams t left join public.ledger l on l.team_id = t.id
         group by t.id, t.balance having t.balance <> coalesce(sum(l.amount), 0)`,
      ),
    ).toBe(0);
    // Il manager vede i risultati e il proprio bilancio, non quello degli altri
    await asUser(db, ANNA, async (tx) => {
      expect(await count(tx, 'select 1 from public.player_game_stats')).toBeGreaterThan(0);
      expect(await count(tx, 'select 1 from public.ledger where team_id <> $1', [BOS])).toBe(30 * 2 - 2);
    });
    await asUser(db, BRUNO, async (tx) => {
      expect(await count(tx, 'select 1 from public.ledger')).toBe(2);
    });
  });

  it('una seconda chiamata non duplica nulla', async () => {
    await expect(apply(payload)).rejects.toThrow(/non è in chiusura/);
    expect(await count(db, 'select 1 from public.rounds')).toBe(2);
    expect(await count(db, 'select 1 from public.ledger')).toBe(60);
  });

  it('nel turno nuovo il manager torna a poter cambiare le impostazioni', async () => {
    expect(
      await asUser(db, ANNA, (tx) =>
        changed(
          tx,
          `update public.team_settings set tactics = tactics || '{"pace":"slow"}' where team_id = $1`,
          [BOS],
        ),
      ),
    ).toBe(1);
    // Il Pronto del turno vecchio non vale per quello nuovo
    expect(
      await asUser(db, ANNA, (tx) => one<{ r: boolean }>(tx, 'select public.set_ready($1) as r', [BOS])),
    ).toEqual({
      r: false,
    });
  });
});
