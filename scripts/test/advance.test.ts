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
