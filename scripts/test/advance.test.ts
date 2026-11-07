// Fase 9: avanzamento dei turni sulla lega di prova, con i tre account del seed (anna commissario su BOS,
// bruno su LAL, carla su NYK). advanceLeague è la logica della Edge Function advance-turn; pg_net e pg_cron non
// ci sono su PGlite, quindi qui la si chiama a mano dove su Supabase la chiamerebbe il database.
// Fatto quando: il turno avanza solo all'ultimo Pronto o quando il commissario forza, e da solo alla scadenza
// solo se impostata; due chiamate non duplicano nulla; con tutti gli allenatori la lega avanza da sola e si
// ferma al primo avviso bloccante.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { LeagueStateRows } from '../../supabase/functions/_shared/state.ts';
import { advanceLeague, serverTurn, type TurnClaim } from '../../supabase/functions/_shared/turn.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const CARLA = ids.user('carla');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');
const MANAGERS = [
  [ANNA, BOS],
  [BRUNO, LAL],
  [CARLA, NYK],
] as const;

let db: PGlite;
let initialBalance: Map<string, number>;

const advance = () => advanceLeague(serviceRpc(db), LEAGUE, { newId: randomUUID, botProposals: false });

async function current(): Promise<{ id: string; number: number; state: string }> {
  const r = await db.query<{ id: string; number: number; state: string }>(
    `select r.id, r.number, r.state from public.leagues l join public.rounds r on r.id = l.current_round_id
     where l.id = $1`,
    [LEAGUE],
  );
  return r.rows[0] as { id: string; number: number; state: string };
}

const ready = (user: string, team: string, value = true) =>
  asUser(
    db,
    user,
    async (tx) =>
      (await tx.query<{ r: boolean }>('select public.set_ready($1, $2) as r', [team, value])).rows[0]!.r,
  );

const allReady = async () => {
  for (const [user, team] of MANAGERS) await ready(user, team);
};

/** Il turno corrente è aperto da più del ritmo massimo (60 secondi). */
const pastPace = async () =>
  db.query(
    `update public.rounds set created_at = now() - interval '2 minutes'
     where id = (select current_round_id from public.leagues where id = $1)`,
    [LEAGUE],
  );

async function standardCount(team: string): Promise<number> {
  const r = await db.query<{ n: number }>(
    `select count(*)::int as n from public.contracts where team_id = $1 and type <> 'two-way'`,
    [team],
  );
  return r.rows[0]!.n;
}

/** Toglie n giocatori con contratto standard alla squadra, come un taglio senza residui. */
async function dropPlayers(team: string, n: number): Promise<void> {
  await db.query(
    `with x as (
       select player_id from public.contracts where team_id = $1 and type <> 'two-way' order by player_id limit $2
     ), d as (delete from public.contracts c using x where c.player_id = x.player_id returning c.player_id)
     update public.players p set team_id = null from d where p.id = d.player_id`,
    [team, n],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  const r = await db.query<{ id: string; balance: string }>(
    'select id, balance from public.teams where league_id = $1',
    [LEAGUE],
  );
  initialBalance = new Map(r.rows.map((t) => [t.id, Number(t.balance)]));
}, 120_000);

describe('Pronto', () => {
  it('il turno avanza solo all’ultimo Pronto', async () => {
    expect(await ready(ANNA, BOS)).toBe(false);
    expect((await advance()).advanced).toBe(false);
    expect(await ready(BRUNO, LAL)).toBe(false);
    // Togliere il Pronto si può finché il turno è aperto
    expect(await ready(ANNA, BOS, false)).toBe(false);
    expect(await ready(ANNA, BOS)).toBe(false);
    expect((await advance()).advanced).toBe(false);
    expect((await current()).number).toBe(0);

    expect(await ready(CARLA, NYK)).toBe(true);
    const r = await advance();
    expect(r).toMatchObject({ advanced: true, reason: 'ready', reclaimed: false });
    const now = await current();
    expect(now).toMatchObject({ number: 1, state: 'open' });

    const games = await db.query<{ id: string; home_score: number; away_score: number }>(
      `select id, home_score, away_score from public.games where league_id = $1 and round_number = 0`,
      [LEAGUE],
    );
    expect(games.rows).toHaveLength(15);
    for (const g of games.rows) {
      expect(g.home_score).not.toBe(g.away_score);
      // Punti = somma dei punti del box score
      const pts = await db.query<{ team: string; pts: number }>(
        `select s.team_id = g.home_team_id as team, sum(s.pts)::int as pts
         from public.player_game_stats s join public.games g on g.id = s.game_id
         where s.game_id = $1 group by 1`,
        [g.id],
      );
      const byHome = new Map(pts.rows.map((x) => [String(x.team), x.pts]));
      expect(byHome.get('true')).toBe(g.home_score);
      expect(byHome.get('false')).toBe(g.away_score);
    }
    // Nuovo turno: nessuno è pronto
    const flags = await db.query('select * from public.ready_flags where round_id = $1', [now.id]);
    expect(flags.rows).toHaveLength(0);
  });

  it('il Pronto vale per il turno che il manager vede: su un turno già chiuso è rifiutato', async () => {
    const now = await current();
    const old = (
      await db.query<{ id: string }>(
        `select id from public.rounds where league_id = $1 and id <> $2 order by created_at desc limit 1`,
        [LEAGUE, now.id],
      )
    ).rows[0]!.id;
    const readyFor = (round: string) =>
      asUser(
        db,
        ANNA,
        async (tx) =>
          (await tx.query<{ r: boolean }>('select public.set_ready($1, true, $2) as r', [BOS, round]))
            .rows[0]!.r,
      );
    // L'app è ferma al turno vecchio: niente Pronto sul turno nuovo, che il manager non ha visto
    await expect(readyFor(old)).rejects.toThrow(/turno è cambiato/);
    const flags = await db.query('select * from public.ready_flags where round_id = $1', [now.id]);
    expect(flags.rows).toHaveLength(0);
    // Sul turno giusto vale; senza turno (app già installate) vale per il turno corrente
    expect(await readyFor(now.id)).toBe(false);
    expect(await ready(ANNA, BOS, false)).toBe(false);
  });

  it('a turno in chiusura non si cambia nulla', async () => {
    await allReady();
    const claim = await serviceRpc(db).rpc<TurnClaim | null>('try_close_round', { p_league: LEAGUE });
    expect(claim).not.toBeNull();
    await expect(ready(ANNA, BOS, false)).rejects.toThrow(/già in chiusura/);
    // La RLS non lascia passare la modifica: nessuna riga aggiornata
    const update = await asUser(db, ANNA, (tx) =>
      tx.query(`update public.team_settings set tactics = '{"pace":"fast"}' where team_id = $1`, [BOS]),
    );
    expect(update.affectedRows).toBe(0);
    // La chiusura è fatta, la simulazione no: la Edge Function non risponde più (simulazione fallita)
    expect((await advance()).advanced).toBe(false);
  });
});

describe('una sola simulazione per turno', () => {
  it('un turno fermo in chiusura si riprende con lo stesso seed e lo stesso risultato', async () => {
    const round = await current();
    expect(round.state).toBe('closing');
    const rows = await serviceRpc(db).rpc<LeagueStateRows>('league_state', { p_league: LEAGUE });
    const seed = rows.round?.seed as string;
    const claim: TurnClaim = {
      round_id: round.id,
      number: round.number,
      kind: 'regular',
      seed,
      reason: 'ready',
      reclaimed: false,
    };
    // Le righe nuove (per esempio una proposta di un bot a un umano) prendono un id nuovo a ogni simulazione:
    // per il confronto gli id sono in sequenza, così conta solo il caso, che viene tutto dal seed
    const ids = () => {
      let n = 0;
      return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
    };
    const first = serverTurn(rows, claim, { newId: ids() });
    const again = serverTurn(rows, claim, { newId: ids() });
    expect(JSON.stringify(again.payload)).toBe(JSON.stringify(first.payload));
    // Le stesse righe in un altro ordine danno lo stesso turno: il motore le rimette in ordine fisso
    const reversed = <T>(xs: T[]): T[] => [...xs].reverse();
    const shuffled: LeagueStateRows = {
      ...rows,
      teams: reversed(rows.teams),
      players: reversed(rows.players),
      contracts: reversed(rows.contracts),
      dead_money: reversed(rows.dead_money),
      injuries: reversed(rows.injuries),
      draft_picks: reversed(rows.draft_picks),
      draft_swaps: reversed(rows.draft_swaps),
      team_settings: reversed(rows.team_settings),
    };
    expect(rows.contracts.length).toBeGreaterThan(100);
    expect(rows.draft_picks.length).toBeGreaterThan(100);
    expect(JSON.stringify(serverTurn(shuffled, claim, { newId: ids() }).payload)).toBe(
      JSON.stringify(first.payload),
    );
    // E il database le dà già in ordine, con l'id come ultimo criterio
    const sorted = (xs: string[]) => [...xs].sort();
    for (const [name, list] of [
      ['contracts', rows.contracts.map((c) => c.player_id)],
      ['draft_picks', rows.draft_picks.map((k) => k.id)],
      ['draft_swaps', rows.draft_swaps.map((w) => w.id)],
      ['injuries', rows.injuries.map((i) => i.player_id)],
      ['team_settings', rows.team_settings.map((x) => x.team_id)],
      ['coach_delegations', (rows.coach_delegations ?? []).map((d) => d.team_id)],
      ['draft_lists', (rows.draft_lists ?? []).map((d) => d.team_id)],
    ] as const)
      expect(list, name).toEqual(sorted([...list]));

    // Prima dei 5 minuti nessuno la riprende
    expect((await advance()).advanced).toBe(false);
    await db.query(
      `update public.rounds set closing_started_at = now() - interval '6 minutes' where id = $1`,
      [round.id],
    );
    const r = await advance();
    expect(r).toMatchObject({ advanced: true, reclaimed: true });
    const scores = await db.query<{ id: string; home_score: number; away_score: number }>(
      `select id, home_score, away_score from public.games where league_id = $1 and round_number = $2`,
      [LEAGUE, round.number],
    );
    const expected = (first.payload.games as { id: string; home_score: number; away_score: number }[]).map(
      (g) => [g.id, g.home_score, g.away_score],
    );
    expect(scores.rows.map((g) => [g.id, g.home_score, g.away_score]).sort()).toEqual(expected.sort());
  });

  it('due chiamate insieme simulano una volta sola', async () => {
    const round = await current();
    await allReady();
    const [a, b] = await Promise.all([advance(), advance()]);
    expect([a.advanced, b.advanced].filter(Boolean)).toHaveLength(1);
    const games = await db.query<{ n: number }>(
      `select count(*)::int as n from public.games where league_id = $1 and round_number = $2 and home_score is not null`,
      [LEAGUE, round.number],
    );
    expect(games.rows[0]!.n).toBe(15);
    const stats = await db.query<{ n: number }>(
      `select count(distinct game_id)::int as n from public.player_game_stats s
       join public.games g on g.id = s.game_id where g.league_id = $1 and g.round_number = $2`,
      [LEAGUE, round.number],
    );
    expect(stats.rows[0]!.n).toBe(15);
    // Una terza chiamata e un apply_turn ripetuto non fanno nulla
    expect((await advance()).advanced).toBe(false);
    await expect(
      serviceRpc(db).rpc('apply_turn', {
        p_round: round.id,
        p_payload: { next_round: { number: 99, kind: 'regular' } },
      }),
    ).rejects.toThrow(/non è in chiusura/);
    expect((await current()).number).toBe(round.number + 1);
  });
});

describe('commissario', () => {
  it('forza l’avanzamento; gli altri no', async () => {
    await ready(BRUNO, LAL);
    await expect(
      asUser(db, BRUNO, (tx) => tx.query('select public.force_round($1)', [LEAGUE])),
    ).rejects.toThrow(/Solo il commissario/);
    expect((await advance()).advanced).toBe(false);
    await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
    expect(await advance()).toMatchObject({ advanced: true, reason: 'forced' });
  });

  it('senza scadenza si aspetta; con la scadenza il turno si chiude da solo quando passa', async () => {
    const round = await current();
    expect((await advance()).advanced).toBe(false);
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set deadline_minutes = 15 where id = $1', [LEAGUE]),
    );
    const d = await db.query<{ left: number }>(
      `select extract(epoch from deadline - now())::int as left from public.rounds where id = $1`,
      [round.id],
    );
    expect(d.rows[0]!.left).toBeGreaterThan(14 * 60);
    expect((await advance()).advanced).toBe(false);

    await db.query(`update public.rounds set deadline = now() - interval '1 minute' where id = $1`, [
      round.id,
    ]);
    // pg_cron se ne accorge
    const due = await db.query<{ n: number }>('select private.cron_tick() as n');
    expect(due.rows[0]!.n).toBe(1);
    expect(await advance()).toMatchObject({ advanced: true, reason: 'deadline' });
    const next = await db.query<{ deadline: string | null }>(
      'select deadline from public.rounds where id = (select current_round_id from public.leagues where id = $1)',
      [LEAGUE],
    );
    expect(next.rows[0]!.deadline).not.toBeNull();

    // Tolta la scadenza, il turno aperto non ne ha più
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set deadline_minutes = null where id = $1', [LEAGUE]),
    );
    const none = await db.query<{ deadline: string | null }>(
      'select deadline from public.rounds where id = (select current_round_id from public.leagues where id = $1)',
      [LEAGUE],
    );
    expect(none.rows[0]!.deadline).toBeNull();
    expect((await db.query<{ n: number }>('select private.cron_tick() as n')).rows[0]!.n).toBe(0);
  });

  it('in pausa la lega non avanza, salvo se il commissario forza', async () => {
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set paused = true where id = $1', [LEAGUE]),
    );
    await allReady();
    expect((await advance()).advanced).toBe(false);
    await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
    expect(await advance()).toMatchObject({ advanced: true, reason: 'forced' });
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set paused = false where id = $1', [LEAGUE]),
    );
  });

  it('la pausa ferma la scadenza: alla ripresa riparte da adesso', async () => {
    const round = await current();
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set deadline_minutes = 15, paused = true where id = $1', [LEAGUE]),
    );
    // La scadenza passa mentre la lega è in pausa
    await db.query(`update public.rounds set deadline = now() - interval '1 hour' where id = $1`, [round.id]);
    expect((await advance()).advanced).toBe(false);
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set paused = false where id = $1', [LEAGUE]),
    );
    const d = await db.query<{ left: number }>(
      `select extract(epoch from deadline - now())::int as left from public.rounds where id = $1`,
      [round.id],
    );
    expect(d.rows[0]!.left).toBeGreaterThan(14 * 60);
    expect((await advance()).advanced).toBe(false);
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set deadline_minutes = null where id = $1', [LEAGUE]),
    );
  });
});

describe('allenatore delegato', () => {
  it('con tutti gli allenatori la lega avanza da sola al ritmo massimo', async () => {
    // Anna salva un quintetto di riserve: con l'allenatore gioca quello del pulsante Auto
    const roster = await db.query<{ id: string }>(
      `select p.id from public.players p join public.contracts c on c.player_id = p.id
       where p.team_id = $1 and c.type <> 'two-way' order by p.id`,
      [BOS],
    );
    const bench = roster.rows.slice(-5).map((r) => r.id);
    const rest = roster.rows.slice(0, 5).map((r) => r.id);
    const minutes = Object.fromEntries([...bench, ...rest].map((id) => [id, 24]));
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.team_settings set starters = $1, minutes = $2 where team_id = $3', [
        bench,
        minutes,
        BOS,
      ]),
    );
    for (const [user, team] of MANAGERS)
      await asUser(db, user, (tx) =>
        tx.query(
          `insert into public.coach_delegations (team_id, league_id, active) values ($1, $2, true)
           on conflict (team_id) do update set active = true, until_round = null, until_at = null`,
          [team, LEAGUE],
        ),
      );
    const round = await current();
    // Tutti pronti, ma il turno è appena aperto: si aspetta il ritmo massimo
    expect((await advance()).advanced).toBe(false);
    await pastPace();
    expect(await advance()).toMatchObject({ advanced: true, reason: 'coach' });

    const starters = await db.query<{ player_id: string }>(
      `select s.player_id from public.player_game_stats s join public.games g on g.id = s.game_id
       where g.league_id = $1 and g.round_number = $2 and s.team_id = $3 and s.starter`,
      [LEAGUE, round.number, BOS],
    );
    expect(starters.rows).toHaveLength(5);
    expect(starters.rows.map((r) => r.player_id).sort()).not.toEqual([...bench].sort());
  });

  it('si ferma al primo avviso bloccante e riparte quando il manager risponde', async () => {
    // Boston scende a 11 contratti standard: alla chiusura del turno arriva l'avviso bloccante
    await dropPlayers(BOS, (await standardCount(BOS)) - 11);
    await pastPace();
    expect(await advance()).toMatchObject({ advanced: true, reason: 'coach' });
    const round = await current();
    const alerts = await asUser(
      db,
      ANNA,
      async (tx) =>
        (
          await tx.query<{ id: string; kind: string; blocking: boolean; status: string; round_id: string }>(
            `select id, kind, blocking, status, round_id from public.alerts where team_id = $1 and kind = 'roster_minimum'`,
            [BOS],
          )
        ).rows,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ blocking: true, status: 'open', round_id: round.id });
    // Gli altri non vedono gli avvisi di Boston
    const seen = await asUser(db, BRUNO, (tx) =>
      tx.query('select id from public.alerts where team_id = $1', [BOS]),
    );
    expect(seen.rows).toHaveLength(0);

    await pastPace();
    expect((await advance()).advanced).toBe(false);
    expect((await db.query<{ n: number }>('select private.cron_tick() as n')).rows[0]!.n).toBe(0);

    // Anna risponde: l'allenatore riparte e alla chiusura il server completa la rosa al minimo
    const allReadyNow = await asUser(
      db,
      ANNA,
      async (tx) =>
        (await tx.query<{ r: boolean }>('select public.answer_alert($1) as r', [alerts[0]!.id])).rows[0]!.r,
    );
    expect(allReadyNow).toBe(true);
    expect(await advance()).toMatchObject({ advanced: true, reason: 'coach' });
    expect(await standardCount(BOS)).toBe(13);
    const signed = await db.query<{ salaries: string[] }>(
      `select c.salaries from public.contracts c join public.players p on p.id = c.player_id
       where c.team_id = $1 and array_length(c.salaries, 1) = 1
         and exists (select 1 from public.transactions t where t.league_id = $2 and t.type = 'signing'
                     and t.text like '%BOS firma ' || p.first_name || ' ' || p.last_name || '%')`,
      [BOS, LEAGUE],
    );
    expect(signed.rows).toHaveLength(2);
    const after = await db.query<{ status: string }>('select status from public.alerts where id = $1', [
      alerts[0]!.id,
    ]);
    expect(after.rows[0]!.status).toBe('resolved');
  });

  it('senza risposta, se il commissario forza decide il server', async () => {
    await dropPlayers(LAL, (await standardCount(LAL)) - 12);
    await pastPace();
    expect((await advance()).advanced).toBe(true);
    // Bruno non risponde: la lega resta ferma finché Anna non forza
    await pastPace();
    expect((await advance()).advanced).toBe(false);
    await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
    expect(await advance()).toMatchObject({ advanced: true, reason: 'forced' });
    expect(await standardCount(LAL)).toBe(13);
    const alert = await db.query<{ status: string }>(
      `select status from public.alerts where team_id = $1 and kind = 'roster_minimum'`,
      [LAL],
    );
    expect(alert.rows.map((a) => a.status)).toEqual(['expired']);
  });

  it('la delega fino a un turno scade dopo quel turno', async () => {
    const round = await current();
    await asUser(db, CARLA, (tx) =>
      tx.query('update public.coach_delegations set until_round = $1 where team_id = $2', [
        round.number,
        NYK,
      ]),
    );
    await pastPace();
    expect((await advance()).advanced).toBe(true);
    const d = await db.query<{ active: boolean }>(
      'select active from public.coach_delegations where team_id = $1',
      [NYK],
    );
    expect(d.rows[0]!.active).toBe(false);
    // Carla non ha più l'allenatore: senza il suo Pronto la lega si ferma
    await pastPace();
    expect((await advance()).advanced).toBe(false);
    expect(await ready(CARLA, NYK)).toBe(true);
    expect(await advance()).toMatchObject({ advanced: true, reason: 'ready' });
  });
});

describe('dopo i turni', () => {
  it('classifica, bilancio e statistiche tornano con le partite giocate', async () => {
    const round = await current();
    const played = await db.query<{ n: number }>(
      `select count(*)::int as n from public.games where league_id = $1 and home_score is not null`,
      [LEAGUE],
    );
    expect(played.rows[0]!.n).toBe(15 * round.number);
    // Ogni squadra ha giocato una partita a turno
    const perTeam = await db.query<{ n: number }>(
      `select count(*)::int as n from public.games g join public.teams t on t.id in (g.home_team_id, g.away_team_id)
       where g.league_id = $1 and g.home_score is not null group by t.id`,
      [LEAGUE],
    );
    expect(new Set(perTeam.rows.map((r) => r.n))).toEqual(new Set([round.number]));
    // Il saldo è il saldo di partenza più la somma dei movimenti
    const ledger = await db.query<{ id: string; balance: string; total: string }>(
      `select t.id, t.balance, coalesce(sum(l.amount), 0) as total
       from public.teams t left join public.ledger l on l.team_id = t.id
       where t.league_id = $1 group by t.id`,
      [LEAGUE],
    );
    for (const t of ledger.rows)
      expect(Number(t.balance)).toBe((initialBalance.get(t.id) ?? 0) + Number(t.total));
    // Le statistiche di stagione sono la somma dei box score
    const check = await db.query<{
      player_id: string;
      pts: number;
      season: number;
      g: number;
      games: number;
    }>(
      `select s.player_id, sum(s.pts)::int as pts, (p.season_stats ->> 'pts')::int as season,
              (p.season_stats ->> 'g')::int as g, count(*) filter (where s.seconds > 0)::int as games
       from public.player_game_stats s join public.players p on p.id = s.player_id
       where s.league_id = $1 group by s.player_id, p.season_stats`,
      [LEAGUE],
    );
    expect(check.rows.length).toBeGreaterThan(300);
    for (const r of check.rows) {
      expect(r.season).toBe(r.pts);
      expect(r.g).toBe(r.games);
    }
    // Nessun turno resta in chiusura
    expect(round.state).toBe('open');
  });
});

describe('turni bloccati in chiusura', () => {
  // Una simulazione che fallisce sempre, come un errore del motore
  const failing = () =>
    advanceLeague(serviceRpc(db), LEAGUE, {
      newId: randomUUID,
      botProposals: false,
      playGame: () => {
        throw new Error('motore rotto');
      },
    });
  const roundRow = async (id: string) =>
    (
      await db.query<{
        state: string;
        attempts: number;
        last_error: string | null;
        failed_at: string | null;
        seed: string | null;
      }>('select state, attempts, last_error, failed_at, seed from public.rounds where id = $1', [id])
    ).rows[0]!;
  const fiveMinutesAgo = (id: string) =>
    db.query(`update public.rounds set closing_started_at = now() - interval '6 minutes' where id = $1`, [
      id,
    ]);
  const reopen = (user: string, newSeed = false) =>
    asUser(db, user, (tx) => tx.query('select public.reopen_round($1, $2)', [LEAGUE, newSeed]));
  const roundError = (user: string) =>
    asUser(
      db,
      user,
      async (tx) =>
        (await tx.query<{ e: string | null }>('select public.round_error($1) as e', [LEAGUE])).rows[0]!.e,
    );

  it('dopo 3 tentativi falliti il turno si ferma e il commissario lo riapre', async () => {
    await allReady();
    const round = await current();
    await expect(failing()).rejects.toThrow(/motore rotto/);
    expect(await roundRow(round.id)).toMatchObject({
      state: 'closing',
      attempts: 1,
      last_error: 'motore rotto',
      failed_at: null,
    });
    // Nulla di scritto: le partite del turno sono ancora da giocare
    const unplayed = await db.query<{ n: number }>(
      `select count(*)::int as n from public.games
       where league_id = $1 and round_number = $2 and home_score is null`,
      [LEAGUE, round.number],
    );
    expect(unplayed.rows[0]!.n).toBe(15);
    // Nei primi 5 minuti la simulazione potrebbe essere ancora in corso: non si riapre
    await expect(reopen(ANNA)).rejects.toThrow(/in corso/);

    // In pausa la ripresa automatica aspetta
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set paused = true where id = $1', [LEAGUE]),
    );
    await fiveMinutesAgo(round.id);
    expect((await advance()).advanced).toBe(false);
    expect((await roundRow(round.id)).attempts).toBe(1);
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.leagues set paused = false where id = $1', [LEAGUE]),
    );

    await expect(failing()).rejects.toThrow(/motore rotto/);
    expect(await roundRow(round.id)).toMatchObject({ attempts: 2, failed_at: null });
    await fiveMinutesAgo(round.id);
    await expect(failing()).rejects.toThrow(/motore rotto/);
    // Al terzo tentativo fallito il turno si ferma subito
    expect((await roundRow(round.id)).failed_at).not.toBeNull();
    await fiveMinutesAgo(round.id);
    expect((await advance()).advanced).toBe(false);
    expect((await roundRow(round.id)).attempts).toBe(3);

    // Tutti vedono che il turno è fermo; l'errore e lo sblocco sono del commissario
    const seen = await asUser(db, BRUNO, (tx) =>
      tx.query<{ failed_at: string | null }>('select failed_at, attempts from public.rounds where id = $1', [
        round.id,
      ]),
    );
    expect(seen.rows[0]!.failed_at).not.toBeNull();
    await expect(
      asUser(db, BRUNO, (tx) => tx.query('select last_error from public.rounds where id = $1', [round.id])),
    ).rejects.toThrow(/permission denied/);
    await expect(roundError(BRUNO)).rejects.toThrow(/Solo il commissario/);
    await expect(reopen(BRUNO)).rejects.toThrow(/Solo il commissario/);
    expect(await roundError(ANNA)).toBe('motore rotto');

    // Il commissario lo riapre con un seed nuovo: Pronto da rifare
    const before = (await roundRow(round.id)).seed;
    await reopen(ANNA, true);
    expect(await roundRow(round.id)).toMatchObject({
      state: 'open',
      attempts: 0,
      failed_at: null,
      last_error: null,
      seed: null,
    });
    expect(before).not.toBeNull();
    const flags = await db.query<{ n: number }>(
      'select count(*)::int as n from public.ready_flags where round_id = $1',
      [round.id],
    );
    expect(flags.rows[0]!.n).toBe(0);
    expect((await advance()).advanced).toBe(false);
    await allReady();
    expect(await advance()).toMatchObject({ advanced: true, reason: 'ready', reclaimed: false });
    expect((await current()).number).toBe(round.number + 1);
  });

  it('se la Edge Function muore senza salvare l’errore il turno si ferma lo stesso', async () => {
    await allReady();
    const round = await current();
    await expect(failing()).rejects.toThrow(/motore rotto/);
    // Tre tentativi già fatti, l'ultimo senza traccia (per esempio un timeout)
    await db.query(`update public.rounds set attempts = 3, last_error = null where id = $1`, [round.id]);
    await fiveMinutesAgo(round.id);
    expect((await advance()).advanced).toBe(false);
    expect((await roundRow(round.id)).failed_at).not.toBeNull();
    // Riaperto con lo stesso seed, il turno riparte
    const seed = (await roundRow(round.id)).seed;
    await reopen(ANNA);
    expect((await roundRow(round.id)).seed).toBe(seed);
    await allReady();
    expect(await advance()).toMatchObject({ advanced: true, reason: 'ready' });
  });
});

describe('turni bloccati senza commissario', () => {
  const claim = () => serviceRpc(db).rpc<TurnClaim | null>('try_close_round', { p_league: LEAGUE });
  const row = async (id: string) =>
    (
      await db.query<{ state: string; failed_at: string | null; last_error: string | null; age: number }>(
        `select state, failed_at, last_error, extract(epoch from now() - created_at)::int as age
         from public.rounds where id = $1`,
        [id],
      )
    ).rows[0]!;
  /** Un turno chiuso la cui Edge Function è morta tre volte senza salvare nulla (tempo o memoria). */
  async function killedThreeTimes() {
    await allReady();
    const round = await current();
    expect(await claim()).toMatchObject({ round_id: round.id, reclaimed: false });
    await db.query(
      `update public.rounds set attempts = 3, closing_started_at = now() - interval '6 minutes' where id = $1`,
      [round.id],
    );
    expect((await advance()).advanced).toBe(false);
    return round;
  }
  const reopen = (user: string, newSeed = false, withdraw = false) =>
    asUser(db, user, (tx) => tx.query('select public.reopen_round($1, $2, $3)', [LEAGUE, newSeed, withdraw]));

  it('una simulazione interrotta lascia il suo errore alla ripresa', async () => {
    const round = await killedThreeTimes();
    const r = await row(round.id);
    expect(r.failed_at).not.toBeNull();
    expect(r.last_error).toMatch(/Simulazione interrotta/);
    expect(r.last_error).toMatch(/tempo o la memoria/);
    // Un tentativo che ha salvato il suo errore non diventa "interrotto": la ripresa lo rifà e basta
    await reopen(ANNA);
    await allReady();
    await expect(
      advanceLeague(serviceRpc(db), LEAGUE, {
        newId: randomUUID,
        botProposals: false,
        playGame: () => {
          throw new Error('motore rotto');
        },
      }),
    ).rejects.toThrow(/motore rotto/);
    await db.query(
      `update public.rounds set closing_started_at = now() - interval '6 minutes' where id = $1`,
      [round.id],
    );
    expect(await claim()).toMatchObject({ round_id: round.id, reclaimed: true });
    expect((await row(round.id)).last_error).toBe('motore rotto');
    // Questo tentativo invece muore senza dire nulla: l'ultimo errore è di prima del suo inizio
    await db.query(
      `update public.rounds set last_error_at = now() - interval '10 minutes',
         closing_started_at = now() - interval '6 minutes' where id = $1`,
      [round.id],
    );
    expect(await advance()).toMatchObject({ advanced: true, reclaimed: true });
    expect((await row(round.id)).last_error).toMatch(/Simulazione interrotta/);
  });

  it('dopo 6 ore dal blocco qualsiasi membro riapre, anche ritirando il mercato in sospeso', async () => {
    const round = await killedThreeTimes();
    // Una proposta di scambio a Carla (con il suo avviso) e un'offerta di Bruno a uno svincolato
    const offer = await db.query<{ id: string }>(
      `insert into public.trade_offers (league_id, from_team_id, to_team_id, status, created_round_id)
       values ($1, $2, $3, 'pending', $4) returning id`,
      [LEAGUE, LAL, NYK, round.id],
    );
    await db.query(
      `insert into public.alerts (league_id, team_id, kind, blocking, payload, round_id)
       values ($1, $2, 'trade_offer', true, jsonb_build_object('trade_id', $3::text), $4)`,
      [LEAGUE, NYK, offer.rows[0]!.id, round.id],
    );
    const free = await db.query<{ id: string }>(
      'select id from public.players where league_id = $1 and team_id is null and not retired limit 1',
      [LEAGUE],
    );
    await db.query(
      `insert into public.free_agent_bids (league_id, round_id, team_id, player_id, salaries)
       values ($1, $2, $3, $4, '{1500000}')`,
      [LEAGUE, round.id, LAL, free.rows[0]!.id],
    );

    // Appena fermo lo riapre solo il commissario
    await expect(reopen(BRUNO)).rejects.toThrow(/Solo il commissario.*6 ore/);
    await db.query(`update public.rounds set failed_at = now() - interval '5 hours' where id = $1`, [
      round.id,
    ]);
    await expect(reopen(CARLA)).rejects.toThrow(/Solo il commissario/);
    // Chi non è nella lega mai
    await expect(reopen('00000000-0000-0000-0000-0000000000aa')).rejects.toThrow(/Non fai parte/);
    await db.query(`update public.rounds set failed_at = now() - interval '7 hours' where id = $1`, [
      round.id,
    ]);
    await reopen(BRUNO, false, true);

    const r = await row(round.id);
    expect(r.state).toBe('open');
    // Anche l'orologio del ritmo riparte da adesso
    expect(r.age).toBeLessThan(5);
    const status = async (sql: string) =>
      (await db.query<{ s: string }>(sql, [offer.rows[0]!.id])).rows[0]!.s;
    expect(await status('select status as s from public.trade_offers where id = $1')).toBe('withdrawn');
    expect(
      await status(
        `select status as s from public.alerts where kind = 'trade_offer' and payload ->> 'trade_id' = $1::text`,
      ),
    ).toBe('expired');
    const bids = await db.query<{ status: string }>(
      'select status from public.free_agent_bids where round_id = $1',
      [round.id],
    );
    expect(bids.rows.map((b) => b.status)).toEqual(['withdrawn']);
    await allReady();
    expect(await advance()).toMatchObject({ advanced: true, reason: 'ready' });
  });

  it('con tutti gli allenatori il turno riaperto aspetta di nuovo il ritmo massimo', async () => {
    for (const [, team] of MANAGERS)
      await db.query(
        `insert into public.coach_delegations (team_id, league_id, active) values ($1, $2, true)
         on conflict (team_id) do update set active = true, until_round = null, until_at = null`,
        [team, LEAGUE],
      );
    await pastPace();
    const round = await current();
    expect(await claim()).toMatchObject({ round_id: round.id, reason: 'coach' });
    await db.query(
      `update public.rounds set attempts = 3, closing_started_at = now() - interval '6 minutes' where id = $1`,
      [round.id],
    );
    expect((await advance()).advanced).toBe(false);
    await reopen(ANNA);
    // Prima tornava subito in chiusura: il ritmo si contava dall'apertura vera del turno
    expect((await advance()).advanced).toBe(false);
    expect((await current()).state).toBe('open');
    await pastPace();
    expect(await advance()).toMatchObject({ advanced: true, reason: 'coach' });
    await db.query('delete from public.coach_delegations where league_id = $1', [LEAGUE]);
  });
});

describe('passaggio del commissario', () => {
  const transfer = (user: string, to: string) =>
    asUser(db, user, (tx) => tx.query('select public.transfer_commissioner($1, $2)', [LEAGUE, to]));
  const roles = async () =>
    Object.fromEntries(
      (
        await db.query<{ user_id: string; role: string }>(
          'select user_id, role from public.league_members where league_id = $1',
          [LEAGUE],
        )
      ).rows.map((r) => [r.user_id, r.role]),
    );

  it('il commissario passa il ruolo a un manager; poi è un manager come gli altri', async () => {
    await expect(transfer(BRUNO, CARLA)).rejects.toThrow(/Solo il commissario/);
    await expect(transfer(ANNA, ANNA)).rejects.toThrow(/un altro manager/);
    await expect(transfer(ANNA, '00000000-0000-0000-0000-0000000000aa')).rejects.toThrow(
      /solo un manager della lega/,
    );
    await transfer(ANNA, BRUNO);
    const league = await db.query<{ c: string }>(
      'select commissioner_id as c from public.leagues where id = $1',
      [LEAGUE],
    );
    expect(league.rows[0]!.c).toBe(BRUNO);
    expect(await roles()).toMatchObject({ [ANNA]: 'manager', [BRUNO]: 'commissioner', [CARLA]: 'manager' });
    // Ora forza Bruno, non più Anna
    await expect(
      asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE])),
    ).rejects.toThrow(/Solo il commissario/);
    await transfer(BRUNO, ANNA);
    expect(await roles()).toMatchObject({ [ANNA]: 'commissioner', [BRUNO]: 'manager' });
  });
});
