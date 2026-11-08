// Offseason sulla lega di prova (anna commissario su BOS, bruno su LAL, carla su NYK): dalla finale alla stagione
// nuova, con l'offseason nuova (Fase 12, poi "Offseason nuova"). I giorni di regular season prima dell'ultimo hanno
// punteggi finti; ultimo giorno, post-season e offseason li gioca il server, con la partita finta per fare presto.
//   draft dal vivo: un turno per ogni scelta di un manager, pronto deve essere solo lui
//   opzioni della squadra decise dai manager; senza risposta decadono
//   rinnovi con trattativa (risposta subito) e offerta di qualifica agli RFA
//   free agency in 15 turni: 5 di sole offerte, offerte che restano, pareggio degli RFA
//   preparazione: il Pronto aspetta una rosa nei limiti; il server corregge quello che resta
import type { PGlite } from '@electric-sql/pglite';
import {
  askingSalary,
  CONFIG_2026_27,
  FA_MORATORIUM_ROUNDS,
  FREE_AGENCY_ROUNDS,
  maxSalaryFor,
  minimumSalaryFor,
  nextConfig,
  OPENING_NIGHT_GAMES,
  overall,
  qualifyingOfferFor,
} from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import type { MarketAction, RenewalAnswer } from '../../supabase/functions/_shared/market.ts';
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
const CARLA = ids.user('carla');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');
const OWNER: Record<string, string> = { [BOS]: ANNA, [LAL]: BRUNO, [NYK]: CARLA };

let db: PGlite;
let initialBalance: Map<string, number>;
const rpc = () => serviceRpc(db);
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

interface Round {
  id: string;
  number: number;
  kind: string;
  stage: string | null;
  season_id: string;
  day: number | null;
  draft_pick: number | null;
  draft_team_id: string | null;
}

async function current(): Promise<Round> {
  return (
    await q<Round>(
      `select r.id, r.number, r.kind, r.stage, r.season_id, r.day, r.draft_pick, r.draft_team_id
       from public.leagues l join public.rounds r on r.id = l.current_round_id where l.id = $1`,
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
async function act(user: string, action: MarketAction): Promise<{ id: string; reply?: RenewalAnswer }> {
  const c = await checkedMarketAction(rpc(), LEAGUE, user, action);
  const res = await rpc().rpc<{ id: string }>('market_write', {
    p_league: LEAGUE,
    p_round: c.roundId,
    p_team: c.teamId,
    p_action: c.write,
  });
  return { ...res, ...(c.reply ? { reply: c.reply } : {}) };
}

async function readiness(user: string) {
  return asUser(db, user, async (tx) => {
    const r = await tx.query<{ team_id: string; state: string }>('select * from public.round_readiness($1)', [
      LEAGUE,
    ]);
    return new Map(r.rows.map((x) => [x.team_id, x.state]));
  });
}

async function openAlerts(team: string, kind: string) {
  return q<{ id: string; blocking: boolean; payload: Record<string, unknown> }>(
    `select id, blocking, payload from public.alerts where team_id = $1 and kind = $2 and status = 'open'`,
    [team, kind],
  );
}

async function contractsOf(team: string) {
  return q<{ player_id: string; type: string; salaries: string[]; options: (string | null)[] }>(
    'select player_id, type, salaries, options from public.contracts where team_id = $1 order by player_id',
    [team],
  );
}

async function engineState() {
  return leagueStateFromRows(await rpc().rpc<LeagueStateRows>('league_state', { p_league: LEAGUE })).state;
}

async function freeAgents(): Promise<number> {
  return (
    await q<{ n: number }>(
      'select count(*)::int as n from public.players where league_id = $1 and team_id is null and not retired',
      [LEAGUE],
    )
  )[0]!.n;
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
/** Opzione della squadra sulla stagione che arriva: BOS la esercita, LAL non risponde. */
let bosOption: string;
let lalOption: string;
let bosChoice: string | null = null;

describe('dalla finale al draft dal vivo', () => {
  it('alla chiusura della finale: lottery, ordine, classe e scelte dei bot fino alla prima di un manager', async () => {
    for (let i = 0; i < 120; i++) {
      const r = await current();
      if (r.kind === 'offseason') break;
      await nextTurn();
    }
    const round = await current();
    expect(round).toMatchObject({ kind: 'offseason', stage: 'draft' });
    expect([BOS, LAL, NYK]).toContain(round.draft_team_id);
    const order = await q<{ pick_no: number; team_id: string; player_id: string | null }>(
      'select pick_no, team_id, player_id from public.draft_order where league_id = $1 and draft_year = 2027 order by pick_no',
      [LEAGUE],
    );
    expect(order).toHaveLength(60);
    // Prima della chiamata del turno hanno scelto i bot, dopo nessuno
    for (const o of order)
      expect(o.player_id === null, String(o.pick_no)).toBe(o.pick_no >= round.draft_pick!);
    expect(order.find((o) => o.pick_no === round.draft_pick)!.team_id).toBe(round.draft_team_id);
    const lottery = await q<{ pick_order: string[] }>(
      'select pick_order from public.draft_lottery where league_id = $1',
      [LEAGUE],
    );
    expect(lottery[0]!.pick_order).toHaveLength(14);
    // Pronto deve essere solo chi sceglie; gli altri non giocano il turno
    const states = await readiness(ANNA);
    for (const t of [BOS, LAL, NYK])
      expect(states.get(t), t).toBe(t === round.draft_team_id ? 'waiting' : 'out');
    for (const t of [BOS, LAL, NYK])
      expect(await openAlerts(t, 'draft_pick'), t).toHaveLength(t === round.draft_team_id ? 1 : 0);

    // Prima che i contratti scalino: un contratto lungo di Boston e due opzioni della squadra sulla stagione che arriva
    const bos = await contractsOf(BOS);
    multiYear = bos.find((c) => c.type !== 'two-way' && c.salaries.length >= 4)!;
    expect(multiYear).toBeDefined();
    const withOption = async (team: string, skip: string) => {
      const c = (await contractsOf(team)).find(
        (x) => x.type !== 'two-way' && x.salaries.length >= 3 && x.player_id !== skip,
      )!;
      const options = c.salaries.map((_, i) => (i === 1 ? 'team' : null));
      await db.query('update public.contracts set options = $2 where player_id = $1', [c.player_id, options]);
      return c.player_id;
    };
    bosOption = await withOption(BOS, multiYear.player_id);
    lalOption = await withOption(LAL, '');
  });

  it('un turno per ogni scelta di un manager: sceglie lui, poi i bot fino alla prossima', async () => {
    let turns = 0;
    for (;;) {
      const round = await current();
      if (round.stage !== 'draft') break;
      expect(++turns).toBeLessThan(10);
      const team = round.draft_team_id!;
      const other = [ANNA, BRUNO, CARLA].find((u) => u !== OWNER[team])!;
      const prospects = await q<{ id: string }>(
        `select id from public.players where league_id = $1 and draft_prospect = 2027
         order by scouted_potential, (select avg(value::numeric) from jsonb_each_text(ratings)), id`,
        [LEAGUE],
      );
      // Solo chi è di turno sceglie
      await expect(act(other, { kind: 'draft_pick', player_id: prospects[0]!.id })).rejects.toThrow(
        /non tocca a te|Non hai una squadra/,
      );
      // Anna sceglie il prospetto meno promettente (nessun bot lo prenderebbe); gli altri lasciano fare alla lista
      if (team === BOS && bosChoice === null) {
        bosChoice = prospects[0]!.id;
        await act(ANNA, { kind: 'draft_pick', player_id: prospects[1]!.id });
        await act(ANNA, { kind: 'draft_pick', player_id: bosChoice });
      }
      const pick = round.draft_pick!;
      await nextTurn();
      const made = await q<{ team_id: string; player_id: string | null }>(
        'select team_id, player_id from public.draft_order where league_id = $1 and pick_no = $2',
        [LEAGUE, pick],
      );
      expect(made[0]!.player_id).not.toBeNull();
      if (team === BOS && made[0]!.player_id === bosChoice) bosChoice = made[0]!.player_id;
    }
    expect(turns).toBeGreaterThan(0);
    expect(bosChoice).not.toBeNull();
    const order = await q<{ team_id: string; player_id: string | null }>(
      'select team_id, player_id from public.draft_order where league_id = $1 and player_id = $2',
      [LEAGUE, bosChoice],
    );
    expect(order[0]?.team_id).toBe(BOS);
    // La scelta sostituita è ritirata, quella fatta eseguita
    const requests = await q<{ player_id: string; status: string }>(
      `select player_id, status from public.roster_requests where team_id = $1 and kind = 'draft_pick'`,
      [BOS],
    );
    expect(requests.find((r) => r.player_id === bosChoice)?.status).toBe('done');
    expect(requests.some((r) => r.status === 'withdrawn')).toBe(true);
  });

  it('a draft finito: rookie firmati, contratti scalati, opzioni dei manager da decidere', async () => {
    expect(await current()).toMatchObject({ kind: 'offseason', stage: 'options', draft_pick: null });
    const order = await q<{ pick_no: number; team_id: string; round: number; player_id: string | null }>(
      'select pick_no, team_id, round, player_id from public.draft_order where league_id = $1 order by pick_no',
      [LEAGUE],
    );
    expect(order.every((o) => o.player_id !== null)).toBe(true);
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
    const after = await q<{ salaries: string[] }>(
      'select salaries from public.contracts where player_id = $1',
      [multiYear.player_id],
    );
    if (after[0]) expect(after[0].salaries).toEqual(multiYear.salaries.slice(1));
    // Le opzioni della squadra dei manager restano da decidere, con l'ultimo stipendio
    for (const id of [bosOption, lalOption]) {
      const c = await q<{ options: (string | null)[]; last_salary: string | null }>(
        'select options, last_salary from public.contracts where player_id = $1',
        [id],
      );
      expect(c[0]!.options[0]).toBe('team');
      expect(Number(c[0]!.last_salary)).toBeGreaterThan(0);
    }
    expect(await openAlerts(BOS, 'team_options')).toHaveLength(1);
    expect(await openAlerts(LAL, 'team_options')).toHaveLength(1);
  });
});

let negotiated: string;
let rfa: string;
let qualifying: number;

describe('opzioni e rinnovi', () => {
  it('il manager esercita l’opzione; senza risposta decade e il giocatore va in scadenza', async () => {
    await expect(
      act(ANNA, { kind: 'option', player_id: multiYear.player_id, exercise: true }),
    ).rejects.toThrow(/opzione della squadra/);
    await act(ANNA, { kind: 'option', player_id: bosOption, exercise: true });
    await nextTurn();
    expect(await current()).toMatchObject({ kind: 'offseason', stage: 'renewals' });
    const bos = await q<{ options: (string | null)[]; salaries: string[]; last_salary: string | null }>(
      'select options, salaries, last_salary from public.contracts where player_id = $1',
      [bosOption],
    );
    expect(bos[0]!.options[0]).toBeNull();
    expect(bos[0]!.salaries.length).toBeGreaterThan(0);
    expect(bos[0]!.last_salary).toBeNull();
    const lal = await q<{ salaries: string[]; last_salary: string | null }>(
      'select salaries, last_salary from public.contracts where player_id = $1',
      [lalOption],
    );
    expect(lal[0]!.salaries).toEqual([]);
    expect(Number(lal[0]!.last_salary)).toBeGreaterThan(0);
  });

  it('trattativa: un’offerta bassa toglie morale e porta una controproposta, che poi si accetta', async () => {
    // Due giocatori di Boston in scadenza: uno da rinnovare, uno giovane (RFA) per l'offerta di qualifica
    const state = await engineState();
    const bos = state.players
      .filter((p) => {
        const c = state.contracts.find((x) => x.playerId === p.id);
        return (
          p.teamId === 'BOS' &&
          c &&
          c.type !== 'two-way' &&
          c.salaries.length > 0 &&
          p.id !== bosOption &&
          p.id !== multiYear.player_id
        );
      })
      .sort((a, b) => overall(b) - overall(a));
    negotiated = bos[0]!.id;
    rfa = bos[1]!.id;
    await db.query(
      `update public.contracts set salaries = '{}', options = '{}', last_salary = 12000000 where player_id = $1`,
      [negotiated],
    );
    await db.query(
      `update public.contracts set type = 'rookie', salaries = '{}', options = '{}', last_salary = 4000000
       where player_id = $1`,
      [rfa],
    );
    await db.query('update public.players set morale = 70 where id = any($1)', [[negotiated, rfa]]);
    const first = await act(ANNA, {
      kind: 'renew_offer',
      player_id: negotiated,
      salary: minimumSalaryFor(state.config, bos[0]!.yearsInLeague),
      years: 2,
    });
    expect(first.reply?.kind).toBe('counter');
    if (first.reply?.kind !== 'counter') return;
    expect(first.reply.lowball).toBe(true);
    expect(first.reply.attemptsLeft).toBe(2);
    const morale = await q<{ morale: string }>('select morale from public.players where id = $1', [
      negotiated,
    ]);
    expect(Number(morale[0]!.morale)).toBe(67);
    const talk = await asUser(db, ANNA, (tx) =>
      tx.query<{ refusals: number }>('select refusals from public.renewal_talks where player_id = $1', [
        negotiated,
      ]),
    );
    expect(talk.rows[0]!.refusals).toBe(1);
    // La trattativa degli altri non si vede
    const hidden = await asUser(db, BRUNO, (tx) =>
      tx.query('select * from public.renewal_talks where player_id = $1', [negotiated]),
    );
    expect(hidden.rows).toHaveLength(0);
    const counter = first.reply.counter;
    const second = await act(ANNA, { kind: 'renew_offer', player_id: negotiated, ...counter });
    expect(second.reply?.kind).toBe('accept');
    const request = await q<{ payload: { salaries: string[] } }>(
      `select payload from public.roster_requests where player_id = $1 and kind = 'renew' and status = 'pending'`,
      [negotiated],
    );
    expect(request).toHaveLength(1);
    expect(request[0]!.payload.salaries.map(Number)[0]).toBe(counter.salary);
  });

  it('offerta di qualifica all’RFA: resta legato a Boston in free agency', async () => {
    await expect(
      act(ANNA, { kind: 'qualify', player_id: multiYear.player_id, qualify: true }),
    ).rejects.toThrow(/in scadenza/);
    await act(ANNA, { kind: 'qualify', player_id: rfa, qualify: true });
    const state = await engineState();
    qualifying = qualifyingOfferFor(
      state.config,
      state.players.find((p) => p.id === rfa)!,
      4_000_000,
    );
    await nextTurn();
    expect(await current()).toMatchObject({ kind: 'offseason', stage: 'fa1' });
    const renewed = await q<{ salaries: string[]; type: string }>(
      'select salaries, type from public.contracts where player_id = $1',
      [negotiated],
    );
    expect(renewed[0]!.type).toBe('standard');
    expect(renewed[0]!.salaries.length).toBeGreaterThan(0);
    const rights = await asUser(db, BRUNO, (tx) =>
      tx.query<{ team_id: string; qualifying_offer: string }>(
        'select team_id, qualifying_offer from public.restricted_rights where player_id = $1',
        [rfa],
      ),
    );
    expect(rights.rows.map((r) => ({ ...r, qualifying_offer: Number(r.qualifying_offer) }))).toEqual([
      { team_id: BOS, qualifying_offer: qualifying },
    ]);
    const p = await q<{ team_id: string | null }>('select team_id from public.players where id = $1', [rfa]);
    expect(p[0]!.team_id).toBeNull();
    // Nessun contratto in scadenza resta: i bot hanno deciso anche loro
    const still = await q<{ n: number }>(
      `select count(*)::int as n from public.contracts where league_id = $1 and type <> 'two-way'
       and cardinality(salaries) = 0`,
      [LEAGUE],
    );
    expect(still[0]!.n).toBe(0);
    // La free agency comincia: avviso informativo
    const fa = await openAlerts(LAL, 'free_agency');
    expect(fa).toHaveLength(1);
    expect(fa[0]!.blocking).toBe(false);
  });
});

let lowBid: string;
let lowTarget: string;
let sheetTeam: string;

describe('free agency in 15 turni', () => {
  it('nei primi 5 turni nessuno firma; le offerte restano sul tavolo', async () => {
    // Spazio per LAL sotto la tassa e saldo positivo
    await db.query(
      `update public.contracts set salaries[1] = 2000000 where team_id = $1 and cardinality(salaries) > 0`,
      [LAL],
    );
    await db.query('update public.teams set balance = balance + 1000000000 where id = $1', [LAL]);
    initialBalance.set(LAL, (initialBalance.get(LAL) ?? 0) + 1_000_000_000);
    const state = await engineState();
    const p = state.players.find((x) => x.id === rfa)!;
    const max = maxSalaryFor(state.config, p.yearsInLeague);
    await act(BRUNO, { kind: 'bid', player_id: rfa, salary: max, years: 3 });
    // Un'offerta sotto la richiesta (al minimo) a uno svincolato che chiede di più
    const target = state.players.find(
      (x) =>
        x.teamId === null &&
        !x.prospect &&
        x.id !== rfa &&
        x.injury === null &&
        x.age < 30 &&
        askingSalary(state, x, 0) > minimumSalaryFor(state.config, x.yearsInLeague) * 1.5,
    )!;
    const min = minimumSalaryFor(state.config, target.yearsInLeague);
    lowTarget = target.id;
    lowBid = (await act(BRUNO, { kind: 'bid', player_id: lowTarget, salary: min, years: 1 })).id;
    // Rilanciare sostituisce l'offerta, non ne aggiunge un'altra
    await act(BRUNO, { kind: 'bid', player_id: lowTarget, salary: min, years: 2 });
    const bids = await q<{ id: string; salaries: string[] }>(
      `select id, salaries from public.free_agent_bids where team_id = $1 and player_id = $2 and status = 'pending'`,
      [LAL, lowTarget],
    );
    expect(bids).toHaveLength(1);
    expect(bids[0]!.salaries).toHaveLength(2);
    const free = await freeAgents();
    for (let round = 1; round <= FA_MORATORIUM_ROUNDS; round++) {
      expect((await current()).stage).toBe(`fa${round}`);
      await nextTurn();
      expect(await freeAgents()).toBe(free);
      const status = await q<{ status: string }>(
        `select status from public.free_agent_bids where team_id = $1 and status = 'pending'`,
        [LAL],
      );
      expect(status).toHaveLength(2);
    }
    const notes = await q<{ payload: { text: string } }>(
      `select payload from public.alerts where team_id = $1 and kind = 'market' order by created_at desc limit 1`,
      [LAL],
    );
    expect(notes[0]!.payload.text).toMatch(/Offerte ancora sul tavolo/);
    // La nota di ogni turno sostituisce quella di prima: ne resta aperta una sola
    const open = await q<{ n: number }>(
      `select count(*)::int as n from public.alerts where team_id = $1 and kind = 'market' and status = 'open'
       and payload ->> 'text' like 'Offerte ancora sul tavolo%'`,
      [LAL],
    );
    expect(open[0]!.n).toBe(1);
    expect((await current()).stage).toBe(`fa${FA_MORATORIUM_ROUNDS + 1}`);
    // Avviso informativo: da questo turno si firma
    const fa = await openAlerts(LAL, 'free_agency');
    expect(fa.some((a) => a.payload.round === FA_MORATORIUM_ROUNDS + 1 && !a.blocking)).toBe(true);
  });

  it('dal 6° turno si firma: l’RFA sceglie un’offerta e Boston la pareggia', async () => {
    await nextTurn();
    const sheet = await asUser(db, CARLA, (tx) =>
      tx.query<{ team_id: string; rights_team_id: string; salaries: string[] }>(
        'select team_id, rights_team_id, salaries from public.offer_sheets where player_id = $1',
        [rfa],
      ),
    );
    expect(sheet.rows).toHaveLength(1);
    expect(sheet.rows[0]!.rights_team_id).toBe(BOS);
    sheetTeam = sheet.rows[0]!.team_id;
    const alert = await openAlerts(BOS, 'offer_sheet');
    expect(alert).toHaveLength(1);
    expect(alert[0]!.blocking).toBe(true);
    expect(alert[0]!.payload.player_id).toBe(rfa);
    // Nessun altro gli fa offerte mentre aspetta; solo Boston pareggia
    await expect(act(BRUNO, { kind: 'match', player_id: rfa, match: true })).rejects.toThrow(
      /Nessuna offerta/,
    );
    await act(ANNA, { kind: 'match', player_id: rfa, match: true });
    await nextTurn();
    const p = await q<{ team_id: string | null }>('select team_id from public.players where id = $1', [rfa]);
    expect(p[0]!.team_id).toBe(BOS);
    const c = await q<{ salaries: string[] }>('select salaries from public.contracts where player_id = $1', [
      rfa,
    ]);
    expect(c[0]!.salaries).toEqual(sheet.rows[0]!.salaries);
    expect(await q('select * from public.restricted_rights where league_id = $1', [LEAGUE])).toEqual([]);
    expect(await q('select * from public.offer_sheets where league_id = $1', [LEAGUE])).toEqual([]);
    if (sheetTeam === LAL) {
      const bid = await q<{ status: string }>(
        `select status from public.free_agent_bids where team_id = $1 and player_id = $2`,
        [LAL, rfa],
      );
      expect(bid[0]!.status).toBe('lost');
    }
  });

  it('fino al 15° turno, poi le offerte rimaste chiudono', async () => {
    for (let round = FA_MORATORIUM_ROUNDS + 3; round <= FREE_AGENCY_ROUNDS; round++) {
      expect((await current()).stage).toBe(`fa${round}`);
      await nextTurn();
    }
    expect((await current()).stage).toBe('preparation');
    const status = await q<{ status: string }>('select status from public.free_agent_bids where id = $1', [
      lowBid,
    ]);
    expect(['won', 'lost']).toContain(status[0]!.status);
    const pending = await q<{ n: number }>(
      `select count(*)::int as n from public.free_agent_bids where league_id = $1 and status = 'pending'`,
      [LEAGUE],
    );
    expect(pending[0]!.n).toBe(0);
    expect(lowTarget).toBeDefined();
  });
});

describe('preparazione e stagione nuova', () => {
  it('il Pronto aspetta una rosa nei limiti', async () => {
    const standard = async (team: string) =>
      (await contractsOf(team)).filter((c) => c.type !== 'two-way').map((c) => c.player_id);
    // Boston a 17 contratti standard
    const free = await q<{ id: string }>(
      `select id from public.players where league_id = $1 and team_id is null and not retired order by id limit 20`,
      [LEAGUE],
    );
    let i = 0;
    while ((await standard(BOS)).length < 17) {
      const id = free[i++]!.id;
      await db.query('update public.players set team_id = $1 where id = $2', [BOS, id]);
      await db.query(
        `insert into public.contracts (player_id, league_id, team_id, type, salaries, options)
         values ($1, $2, $3, 'standard', '{1500000}', '{null}')`,
        [id, LEAGUE, BOS],
      );
    }
    const ready = (user: string, team: string) =>
      asUser(db, user, (tx) => tx.query('select public.set_ready($1, true)', [team]));
    await expect(ready(ANNA, BOS)).rejects.toThrow(/Devi tagliare 2 giocatori per stare dentro ai 15/);
    const mine = await standard(BOS);
    await act(ANNA, { kind: 'release', player_id: mine[0]! });
    await expect(ready(ANNA, BOS)).rejects.toThrow(/Devi tagliare un giocatore/);
    await act(ANNA, { kind: 'release', player_id: mine[1]! });
    await ready(ANNA, BOS);
    // Le offerte fatte contano come se firmassero: con 15 contratti un'offerta in più chiede un taglio
    const state = await engineState();
    const cheap = state.players.find(
      (p) =>
        p.teamId === null &&
        !p.prospect &&
        p.injury === null &&
        askingSalary(state, p, FREE_AGENCY_ROUNDS - 1) === minimumSalaryFor(state.config, p.yearsInLeague),
    )!;
    const bid = await act(ANNA, {
      kind: 'bid',
      player_id: cheap.id,
      salary: minimumSalaryFor(state.config, cheap.yearsInLeague),
      years: 1,
    });
    await expect(ready(ANNA, BOS)).rejects.toThrow(/Devi tagliare un giocatore.*contando le offerte/);
    await act(ANNA, { kind: 'withdraw_bid', bid_id: bid.id });
    await ready(ANNA, BOS);
    // Los Angeles a 11: non sistema, il server firma al minimo a inizio stagione
    const lal = await standard(LAL);
    for (const id of lal.slice(11)) {
      await db.query('delete from public.contracts where player_id = $1', [id]);
      await db.query('update public.players set team_id = null where id = $1', [id]);
    }
    await expect(ready(BRUNO, LAL)).rejects.toThrow(/Devi firmare 2 giocatori per averne almeno 13/);
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
    expect(rosters.find((r) => r.team_id === BOS)!.standard).toBe(15);
    expect(rosters.find((r) => r.team_id === LAL)!.standard).toBe(13);
    // Chi non ha sistemato la rosa lo sa
    const fixed = await q<{ payload: { text: string } }>(
      `select payload from public.alerts where team_id = $1 and kind = 'market' and status = 'open'
       and payload ->> 'text' like 'La rosa non era nei limiti%'`,
      [LAL],
    );
    expect(fixed).toHaveLength(1);
    expect(fixed[0]!.payload.text).toMatch(/firmati al minimo/);
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
    const retired = await q<{ with_team: number }>(
      `select count(*) filter (where team_id is not null)::int as with_team
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
    // Allenatori: uno per squadra con il contratto, e 12 liberi; le vittorie attese della stagione nuova
    const coaches = await q<{ team_id: string | null; salaries: string[] }>(
      'select team_id, salaries from public.coaches where league_id = $1',
      [LEAGUE],
    );
    for (const t of rosters) {
      const mine = coaches.filter((c) => c.team_id === t.team_id);
      expect(mine, t.team_id).toHaveLength(1);
      expect(mine[0]!.salaries.length, t.team_id).toBeGreaterThan(0);
    }
    expect(coaches.filter((c) => c.team_id === null).length).toBeGreaterThanOrEqual(12);
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
    const ledger = await q<{ n: number }>(
      `select count(*)::int as n from public.ledger where season_id = $1 and kind = 'revenue'`,
      [round.season_id],
    );
    expect(ledger[0]!.n).toBe(OPENING_NIGHT_GAMES * 2);
  });
});
