// Fase 12: offseason a turni sulla lega di prova (anna commissario su BOS, bruno su LAL, carla su NYK).
// I giorni di regular season prima dell'ultimo hanno punteggi finti; ultimo giorno, post-season e offseason li gioca
// il server, con la partita finta per fare presto. Fatto quando: la lega passa da una stagione alla successiva con rose valide,
// contratti scalati, rookie firmati e cap aggiornato.
import type { PGlite } from '@electric-sql/pglite';
import {
  askingSalary,
  CONFIG_2026_27,
  minimumSalaryFor,
  nextConfig,
  OPENING_NIGHT_GAMES,
} from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MarketAction } from '../../supabase/functions/_shared/market.ts';
import { leagueStateFromRows, type LeagueStateRows } from '../../supabase/functions/_shared/state.ts';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { checkedMarketAction } from '../src/db/marketCheck.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';
import { skipToLastRegularDay } from '../src/db/testSeason.ts';
import { quickGame } from '../src/quick-game.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');

let db: PGlite;
let initialBalance: Map<string, number>;
const rpc = () => serviceRpc(db);
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

async function current() {
  return (
    await q<{
      id: string;
      number: number;
      kind: string;
      stage: string | null;
      season_id: string;
      day: number | null;
    }>(
      `select r.id, r.number, r.kind, r.stage, r.season_id, r.day from public.leagues l
       join public.rounds r on r.id = l.current_round_id where l.id = $1`,
      [LEAGUE],
    )
  )[0]!;
}

async function nextTurn() {
  await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
  const r = await advanceLeague(rpc(), LEAGUE, {
    newId: randomUUID,
    playGame: quickGame,
    botProposals: false,
  });
  expect(r.advanced).toBe(true);
  return r;
}

/** Come la Edge Function market (stato leggero), controllando che lo stato completo dica lo stesso. */
async function act(user: string, action: MarketAction) {
  const c = await checkedMarketAction(rpc(), LEAGUE, user, action);
  return rpc().rpc<{ id: string }>('market_write', {
    p_league: LEAGUE,
    p_round: c.roundId,
    p_team: c.teamId,
    p_action: c.write,
  });
}

async function contractsOf(team: string) {
  return q<{ player_id: string; type: string; salaries: string[] }>(
    'select player_id, type, salaries from public.contracts where team_id = $1',
    [team],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  const r = await q<{ id: string; balance: string }>(
    'select id, balance from public.teams where league_id = $1',
    [LEAGUE],
  );
  initialBalance = new Map(r.map((t) => [t.id, Number(t.balance)]));
  await skipToLastRegularDay(db, LEAGUE, ids.round, 'offseason-finta');
}, 120_000);

let multiYear: { player_id: string; salaries: string[] };
let expiringBos: string;
let listTop: string;

describe('dalla finale al draft', () => {
  it('alla chiusura della finale: fine stagione, lottery, ordine del draft e classe', async () => {
    for (let i = 0; i < 120; i++) {
      const r = await current();
      if (r.kind === 'offseason') break;
      await nextTurn();
    }
    const round = await current();
    expect(round).toMatchObject({ kind: 'offseason', stage: 'draft' });
    const order = await q<{ pick_no: number; player_id: string | null }>(
      'select pick_no, player_id from public.draft_order where league_id = $1 and draft_year = 2027 order by pick_no',
      [LEAGUE],
    );
    expect(order).toHaveLength(60);
    expect(order.every((o) => o.player_id === null)).toBe(true);
    const prospects = await q<{ n: number }>(
      'select count(*)::int as n from public.players where league_id = $1 and draft_prospect = 2027',
      [LEAGUE],
    );
    expect(prospects[0]!.n).toBe(70);
    const lottery = await q<{ pick_order: string[] }>(
      'select pick_order from public.draft_lottery where league_id = $1',
      [LEAGUE],
    );
    expect(lottery[0]!.pick_order).toHaveLength(14);
    // Le scelte 2027 sono usate: escono dallo stato del motore
    const used = await q<{ n: number }>(
      'select count(*)::int as n from public.draft_picks where league_id = $1 and draft_year = 2027 and position is not null',
      [LEAGUE],
    );
    expect(used[0]!.n).toBe(60);
    // Chi ha una scelta riceve l'avviso bloccante
    const mine = await q<{ n: number }>(
      'select count(*)::int as n from public.draft_order where team_id = $1',
      [BOS],
    );
    const alerts = await q<{ kind: string }>(
      `select kind from public.alerts where team_id = $1 and status = 'open' and kind = 'draft_pick'`,
      [BOS],
    );
    expect(alerts).toHaveLength(mine[0]!.n > 0 ? 1 : 0);

    // Prima del draft: un contratto lungo e uno in scadenza di Boston, per vedere poi come scalano
    const bos = await contractsOf(BOS);
    multiYear = bos.find((c) => c.type !== 'two-way' && c.salaries.length >= 3)!;
    expiringBos = bos.find((c) => c.type !== 'two-way' && c.salaries.length === 1)?.player_id ?? '';
    expect(multiYear).toBeDefined();
  });

  it('i preferiti del manager decidono le sue scelte; i contratti scalano', async () => {
    // Anna mette in cima il prospetto meno promettente: nessun bot lo sceglie prima di lei
    const worst = await q<{ id: string }>(
      `select id from public.players where league_id = $1 and draft_prospect = 2027
       order by scouted_potential, (select avg(value::numeric) from jsonb_each_text(ratings)) limit 1`,
      [LEAGUE],
    );
    listTop = worst[0]!.id;
    await asUser(db, ANNA, (tx) =>
      tx.query('insert into public.draft_lists (team_id, league_id, player_ids) values ($1, $2, $3)', [
        BOS,
        LEAGUE,
        [listTop],
      ]),
    );
    // Bruno non può scrivere la lista di Anna
    await expect(
      asUser(db, BRUNO, (tx) =>
        tx.query('insert into public.draft_lists (team_id, league_id, player_ids) values ($1, $2, $3)', [
          NYK,
          LEAGUE,
          [listTop],
        ]),
      ),
    ).rejects.toThrow(/row-level security/);
    await nextTurn();

    const round = await current();
    expect(round).toMatchObject({ kind: 'offseason', stage: 'renewals' });
    const order = await q<{ pick_no: number; team_id: string; round: number; player_id: string | null }>(
      'select pick_no, team_id, round, player_id from public.draft_order where league_id = $1 order by pick_no',
      [LEAGUE],
    );
    expect(order.every((o) => o.player_id !== null)).toBe(true);
    const bosFirst = order.find((o) => o.team_id === BOS);
    if (bosFirst) expect(bosFirst.player_id).toBe(listTop);
    // 60 rookie firmati, dalla stagione che arriva: 4 anni al primo giro, 2 al secondo
    const rookies = await q<{ player_id: string; team_id: string; salaries: string[] }>(
      `select c.player_id, c.team_id, c.salaries from public.contracts c
       join public.draft_order d on d.player_id = c.player_id where d.league_id = $1`,
      [LEAGUE],
    );
    expect(rookies).toHaveLength(60);
    const next = nextConfig(CONFIG_2026_27);
    for (const o of order) {
      const c = rookies.find((r) => r.player_id === o.player_id)!;
      expect(c.team_id).toBe(o.team_id);
      expect(c.salaries).toHaveLength(o.round === 1 ? (next.rookieScale[0]?.length ?? 0) : 2);
    }
    const left = await q<{ n: number }>(
      'select count(*)::int as n from public.players where league_id = $1 and draft_prospect is not null',
      [LEAGUE],
    );
    expect(left[0]!.n).toBe(0);
    // Contratti scalati di un anno; chi scadeva è "in scadenza" (senza stipendi) in attesa dei rinnovi
    const after = await q<{ salaries: string[] }>(
      'select salaries from public.contracts where player_id = $1',
      [multiYear.player_id],
    );
    if (after[0]) expect(after[0].salaries).toEqual(multiYear.salaries.slice(1));
    if (expiringBos) {
      const e = await q<{ salaries: string[]; team_id: string }>(
        'select salaries, team_id from public.contracts where player_id = $1',
        [expiringBos],
      );
      if (e[0]) expect(e[0].salaries).toEqual([]);
    }
  });
});

describe('rinnovi, free agency e preparazione', () => {
  it('rinnova chi il manager sceglie; gli altri in scadenza diventano svincolati', async () => {
    const expiring = await q<{ player_id: string; team_id: string }>(
      `select player_id, team_id from public.contracts where league_id = $1 and type <> 'two-way'
       and cardinality(salaries) = 0`,
      [LEAGUE],
    );
    const annas = expiring.filter((e) => e.team_id === BOS).map((e) => e.player_id);
    const carlas = expiring.filter((e) => e.team_id === NYK).map((e) => e.player_id);
    let renewed: string | null = null;
    if (annas.length) {
      await db.query('update public.players set morale = 70 where id = $1', [annas[0]]);
      await act(ANNA, { kind: 'renew', player_id: annas[0]! });
      renewed = annas[0]!;
    }
    // Rinnovare chi non è in scadenza no
    const notExpiring = (await contractsOf(LAL)).find((c) => c.type !== 'two-way' && c.salaries.length > 0)!;
    await expect(act(BRUNO, { kind: 'renew', player_id: notExpiring.player_id })).rejects.toThrow(
      /in scadenza/,
    );
    await nextTurn();

    expect(await current()).toMatchObject({ kind: 'offseason', stage: 'fa1' });
    if (renewed) {
      const c = await q<{ salaries: string[]; type: string }>(
        'select salaries, type from public.contracts where player_id = $1',
        [renewed],
      );
      expect(c[0]!.type).toBe('standard');
      expect(c[0]!.salaries.length).toBeGreaterThan(0);
    }
    for (const id of carlas) {
      const p = await q<{ team_id: string | null }>('select team_id from public.players where id = $1', [id]);
      expect(p[0]!.team_id).toBeNull();
    }
    // Nessun contratto in scadenza resta: i bot hanno deciso anche loro
    const still = await q<{ n: number }>(
      `select count(*)::int as n from public.contracts where league_id = $1 and type <> 'two-way'
       and cardinality(salaries) = 0`,
      [LEAGUE],
    );
    expect(still[0]!.n).toBe(0);
  });

  it('quattro turni di free agency, con le offerte dei manager e dei bot', async () => {
    // Bruno offre il minimo a uno svincolato debole (si firma anche sopra il cap)
    const rows = await rpc().rpc<LeagueStateRows>('league_state', { p_league: LEAGUE });
    const { state } = leagueStateFromRows(rows);
    const weak = state.players
      .filter(
        (p) =>
          p.teamId === null &&
          !p.prospect &&
          askingSalary(state, p, 0) === minimumSalaryFor(state.config, p.yearsInLeague),
      )
      .sort((a, b) => a.age - b.age)[0];
    expect(weak).toBeDefined();
    // Saldo positivo per firmare anche sopra i 13 (con il saldo negativo si firma solo per restare a 13)
    await db.query('update public.teams set balance = balance + 1000000000 where id = $1', [LAL]);
    initialBalance.set(LAL, (initialBalance.get(LAL) ?? 0) + 1_000_000_000);
    const bid = await act(BRUNO, {
      kind: 'bid',
      player_id: weak!.id,
      salary: minimumSalaryFor(state.config, weak!.yearsInLeague),
      years: 1,
    });
    const freeBefore = (
      await q<{ n: number }>(
        'select count(*)::int as n from public.players where league_id = $1 and team_id is null and not retired',
        [LEAGUE],
      )
    )[0]!.n;
    for (const stage of ['fa1', 'fa2', 'fa3', 'fa4']) {
      expect((await current()).stage).toBe(stage);
      await nextTurn();
    }
    expect((await current()).stage).toBe('preparation');
    const status = await q<{ status: string }>('select status from public.free_agent_bids where id = $1', [
      bid.id,
    ]);
    expect(['won', 'lost']).toContain(status[0]!.status);
    const freeAfter = (
      await q<{ n: number }>(
        'select count(*)::int as n from public.players where league_id = $1 and team_id is null and not retired',
        [LEAGUE],
      )
    )[0]!.n;
    // I bot hanno firmato qualcuno
    expect(freeAfter).toBeLessThan(freeBefore);
  });

  it('dalla preparazione nasce la stagione nuova: rose valide, cap aggiornato, calendario', async () => {
    const oldSeason = (await current()).season_id;
    await nextTurn();
    const round = await current();
    expect(round).toMatchObject({ number: 0, kind: 'regular', stage: null, day: 0 });
    expect(round.season_id).not.toBe(oldSeason);
    const season = await q<{ year: number; phase: string; salary_cap: string; luxury_tax: string }>(
      'select year, phase, salary_cap, luxury_tax from public.seasons where id = $1',
      [round.season_id],
    );
    const next = nextConfig(CONFIG_2026_27);
    expect(season[0]).toMatchObject({ year: 2027, phase: 'regular' });
    expect(Number(season[0]!.salary_cap)).toBe(next.salaryCap);
    expect(Number(season[0]!.luxury_tax)).toBe(next.luxuryTax);
    const old = await q<{ phase: string }>('select phase from public.seasons where id = $1', [oldSeason]);
    expect(old[0]!.phase).toBe('offseason');
    const games = await q<{ n: number }>(
      'select count(*)::int as n from public.games where season_id = $1 and home_score is null',
      [round.season_id],
    );
    expect(games[0]!.n).toBe(1230);
    // Calendario a giorni: un giorno per turno, con le date
    const days = await q<{ turns: number; bad: number }>(
      `select count(distinct round_number)::int as turns,
              count(*) filter (where day is null)::int as bad
       from public.games where season_id = $1`,
      [round.season_id],
    );
    expect(days[0]!.turns).toBeGreaterThan(160);
    expect(days[0]!.bad).toBe(0);

    // Rose nei limiti per tutte le squadre, umane comprese
    const rosters = await q<{ team_id: string; standard: number; two_way: number }>(
      `select t.id as team_id,
              count(c.*) filter (where c.type <> 'two-way')::int as standard,
              count(c.*) filter (where c.type = 'two-way')::int as two_way
       from public.teams t left join public.contracts c on c.team_id = t.id
       where t.league_id = $1 group by t.id`,
      [LEAGUE],
    );
    expect(rosters).toHaveLength(30);
    for (const r of rosters) {
      expect(r.standard, r.team_id).toBeGreaterThanOrEqual(13);
      expect(r.standard, r.team_id).toBeLessThanOrEqual(15);
      expect(r.two_way, r.team_id).toBeLessThanOrEqual(3);
    }
    // Ogni giocatore in squadra ha un contratto con gli stipendi della stagione (o è two-way)
    const broken = await q<{ n: number }>(
      `select count(*)::int as n from public.players p left join public.contracts c on c.player_id = p.id
       where p.league_id = $1 and p.team_id is not null
         and (c.player_id is null or c.team_id <> p.team_id or (c.type <> 'two-way' and cardinality(c.salaries) = 0))`,
      [LEAGUE],
    );
    expect(broken[0]!.n).toBe(0);
    // Statistiche azzerate ed energia piena; ritirati fuori dalle squadre
    const fresh = await q<{ n: number }>(
      `select count(*)::int as n from public.players where league_id = $1 and not retired
       and (energy <> 100 or coalesce((season_stats ->> 'g')::int, 0) <> 0)`,
      [LEAGUE],
    );
    expect(fresh[0]!.n).toBe(0);
    const retired = await q<{ n: number; with_team: number }>(
      `select count(*)::int as n, count(*) filter (where team_id is not null)::int as with_team
       from public.players where league_id = $1 and retired`,
      [LEAGUE],
    );
    expect(retired[0]!.with_team).toBe(0);
    // Il saldo è ancora la somma dei movimenti
    const ledger = await q<{ id: string; balance: string; total: string }>(
      `select t.id, t.balance, coalesce(sum(l.amount), 0) as total
       from public.teams t left join public.ledger l on l.team_id = t.id where t.league_id = $1 group by t.id`,
      [LEAGUE],
    );
    for (const t of ledger) expect(Number(t.balance)).toBe((initialBalance.get(t.id) ?? 0) + Number(t.total));
  });

  it('la prima giornata della stagione nuova si gioca', async () => {
    await nextTurn();
    const round = await current();
    expect(round).toMatchObject({ number: 1, kind: 'regular', day: 1 });
    const played = await q<{ n: number }>(
      'select count(*)::int as n from public.games where season_id = $1 and round_number = 0 and home_score is not null',
      [round.season_id],
    );
    expect(played[0]!.n).toBe(OPENING_NIGHT_GAMES);
    // Con le stipendi della stagione nuova
    const ledger = await q<{ n: number }>(
      `select count(*)::int as n from public.ledger where season_id = $1 and kind = 'revenue'`,
      [round.season_id],
    );
    // Ricavi solo per chi ha giocato
    expect(ledger[0]!.n).toBe(OPENING_NIGHT_GAMES * 2);
  });
});
