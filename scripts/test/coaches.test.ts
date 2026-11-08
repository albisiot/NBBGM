// Allenatori e proprietari sul database (fase 2), sulla lega di prova (anna commissario su BOS, bruno su LAL, carla su
// NYK): la lega nasce con gli allenatori e i proprietari dei bot, i membri li leggono, il turno paga l'allenatore
// partita per partita, il manager cambia allenatore dal mercato e l'esonerato resta da pagare. Le leghe create prima,
// senza allenatori, giocano come allora.
import type { PGlite } from '@electric-sql/pglite';
import {
  ARCHETYPE_PROFILES,
  coachAsk,
  createLeagueState,
  generateLeague,
  OWNER_GOALS,
  Rng,
  type SeasonConfig,
} from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { keyedIds, leaguePayload } from '../../supabase/functions/_shared/league.ts';
import { MarketError, type MarketAction } from '../../supabase/functions/_shared/market.ts';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { checkedMarketAction } from '../src/db/marketCheck.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asAnon, asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';
import { quickGame } from '../src/quick-game.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const CARLA = ids.user('carla');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');

let db: PGlite;
let initialBalance: Map<string, number>;
const rpc = () => serviceRpc(db);
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

interface CoachRow {
  id: string;
  team_id: string | null;
  first_name: string;
  last_name: string;
  age: number;
  ratings: { tactics: number; development: number; motivation: number };
  salaries: string[];
}

const coachOf = async (team: string) =>
  (await q<CoachRow>('select * from public.coaches where team_id = $1', [team]))[0];

async function config(league = LEAGUE): Promise<SeasonConfig> {
  const s = (
    await q<{ year: number; salary_cap: string }>(
      `select s.year, s.salary_cap from public.seasons s join public.leagues l on l.current_season_id = s.id
       where l.id = $1`,
      [league],
    )
  )[0]!;
  return { year: s.year, salaryCap: Number(s.salary_cap) } as SeasonConfig;
}

async function act(user: string, action: MarketAction, league = LEAGUE) {
  const c = await checkedMarketAction(rpc(), league, user, action);
  return rpc().rpc<{ id: string }>('market_write', {
    p_league: league,
    p_round: c.roundId,
    p_team: c.teamId,
    p_action: c.write,
  });
}

/** Il commissario forza il turno e il server lo gioca (con la partita finta, per fare presto). */
async function nextTurn(league = LEAGUE) {
  await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [league]));
  const r = await advanceLeague(rpc(), league, {
    newId: randomUUID,
    playGame: quickGame,
    botProposals: false,
  });
  expect(r.advanced).toBe(true);
  return r;
}

async function balancesMatchLedger(league = LEAGUE, start = initialBalance) {
  const rows = await q<{ id: string; balance: string; total: string }>(
    `select t.id, t.balance, coalesce(sum(l.amount), 0) as total
     from public.teams t left join public.ledger l on l.team_id = t.id
     where t.league_id = $1 group by t.id`,
    [league],
  );
  for (const t of rows) expect(Number(t.balance), t.id).toBe((start.get(t.id) ?? 0) + Number(t.total));
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  const r = await q<{ id: string; balance: string }>(
    'select id, balance from public.teams where league_id = $1',
    [LEAGUE],
  );
  initialBalance = new Map(r.map((t) => [t.id, Number(t.balance)]));
});

describe('lega nuova', () => {
  it('un allenatore per squadra, 12 liberi, un proprietario per squadra e le vittorie attese', async () => {
    const coaches = await q<CoachRow>('select * from public.coaches where league_id = $1', [LEAGUE]);
    expect(coaches).toHaveLength(42);
    expect(coaches.filter((c) => c.team_id === null)).toHaveLength(12);
    const teams = await q<{
      id: string;
      owner_profile: { goal: string } | null;
      expected_wins: number | null;
    }>('select id, owner_profile, expected_wins from public.teams where league_id = $1', [LEAGUE]);
    for (const t of teams) {
      expect(
        coaches.filter((c) => c.team_id === t.id),
        t.id,
      ).toHaveLength(1);
      expect(OWNER_GOALS).toContain(t.owner_profile?.goal);
      expect(t.expected_wins).toBeGreaterThan(0);
    }
    // Un allenatore per squadra anche a mano
    await expect(
      db.query('update public.coaches set team_id = $1 where team_id is null', [BOS]),
    ).rejects.toThrow(/coaches_one_per_team/);
  });

  it('i membri leggono allenatori, esonerati e proprietari; da fuori nessuno', async () => {
    await asUser(db, CARLA, async (tx) => {
      expect((await tx.query('select id, salaries, ratings from public.coaches')).rows).toHaveLength(42);
      expect((await tx.query('select owner_profile, expected_wins from public.teams')).rows).toHaveLength(30);
      await tx.query('select * from public.coach_buyouts');
      await expect(tx.query('update public.coaches set age = 30')).rejects.toThrow(/permission denied/);
    });
    await asAnon(db, async (tx) => {
      await expect(tx.query('select id from public.coaches')).rejects.toThrow(/permission denied/);
    });
  });
});

describe('il turno', () => {
  it("paga l'allenatore partita per partita, e il saldo resta la somma dei movimenti", async () => {
    await nextTurn();
    const coach = await q<{ team_id: string; amount: string; salary: string }>(
      `select l.team_id, l.amount, c.salaries[1] as salary from public.ledger l
       join public.coaches c on c.team_id = l.team_id where l.kind = 'coach'`,
    );
    expect(coach.length).toBeGreaterThan(0);
    for (const x of coach) expect(Number(x.amount)).toBe(-Math.round(Number(x.salary) / 82));
    // Chi gioca ha i suoi tre movimenti, chi riposa nessuno
    const kinds = await q<{ team_id: string; kinds: string[] }>(
      `select team_id, array_agg(kind order by kind) as kinds from public.ledger group by team_id`,
    );
    for (const k of kinds) expect(k.kinds).toEqual(['coach', 'revenue', 'salary']);
    await balancesMatchLedger();
  });
});

describe('cambio di allenatore', () => {
  it('il manager lo chiede dal mercato: uno per turno, e lo vede solo lui', async () => {
    const free = await q<CoachRow>(
      'select * from public.coaches where league_id = $1 and team_id is null order by id',
      [LEAGUE],
    );
    const first = await act(ANNA, { kind: 'hire_coach', coach_id: free[0]!.id });
    const second = await act(ANNA, { kind: 'hire_coach', coach_id: free[1]!.id });
    const requests = await q<{ id: string; status: string }>(
      'select id, status from public.coach_requests where team_id = $1 order by created_at',
      [BOS],
    );
    expect(requests.map((r) => [r.id, r.status])).toEqual([
      [first.id, 'withdrawn'],
      [second.id, 'pending'],
    ]);
    expect(
      await asUser(db, CARLA, async (tx) => (await tx.query('select 1 from public.coach_requests')).rows),
    ).toEqual([]);
    // Uno che allena già non si prende; un id che non esiste nemmeno
    await expect(act(ANNA, { kind: 'hire_coach', coach_id: (await coachOf(LAL))!.id })).rejects.toThrow(
      /allena già LAL/,
    );
    await expect(act(ANNA, { kind: 'hire_coach', coach_id: randomUUID() })).rejects.toThrow(MarketError);
  });

  it("alla chiusura del turno arriva il nuovo, l'esonerato resta da pagare", async () => {
    const before = (await coachOf(BOS))!;
    const wanted = (
      await q<{ coach_id: string }>(
        `select coach_id from public.coach_requests where team_id = $1 and status = 'pending'`,
        [BOS],
      )
    )[0]!.coach_id;
    const cfg = await config();
    await nextTurn();
    const now = (await coachOf(BOS))!;
    expect(now.id).toBe(wanted);
    expect(now.salaries.map(Number)).toEqual(coachAsk(cfg, { ratings: now.ratings, age: now.age }));
    const old = (await q<CoachRow>('select * from public.coaches where id = $1', [before.id]))[0]!;
    expect(old.team_id).toBeNull();
    const buyouts = await q<{ team_id: string; coach_id: string; salaries: string[] }>(
      'select team_id, coach_id, salaries from public.coach_buyouts',
    );
    expect(buyouts).toEqual([{ team_id: BOS, coach_id: before.id, salaries: before.salaries }]);
    expect(
      (
        await q<{ status: string }>(`select status from public.coach_requests where coach_id = $1`, [wanted])
      )[0]?.status,
    ).toBe('done');
    // L'esito arriva al manager e va nella cronaca
    const alerts = await q<{ payload: { text: string } }>(
      `select payload from public.alerts where team_id = $1 and kind = 'market'`,
      [BOS],
    );
    expect(alerts.some((a) => /nuovo allenatore/.test(a.payload.text))).toBe(true);
    const news = await q<{ text: string }>(`select text from public.transactions where type = 'coach'`);
    expect(news.map((n) => n.text).join('\n')).toMatch(/BOS esonera l'allenatore/);
  });

  it("nelle partite seguenti paga il nuovo e l'esonerato", async () => {
    // Fino a quando BOS gioca
    for (let i = 0; i < 4; i++) {
      const before = Number(
        (
          await q<{ n: string }>(
            `select count(*) as n from public.ledger where team_id = $1 and kind = 'coach'`,
            [BOS],
          )
        )[0]!.n,
      );
      await nextTurn();
      const rows = await q<{ amount: string }>(
        `select amount from public.ledger where team_id = $1 and kind = 'coach' order by id`,
        [BOS],
      );
      if (rows.length === before) continue;
      const coach = (await coachOf(BOS))!;
      const buyout = (
        await q<{ salaries: string[] }>('select salaries from public.coach_buyouts where team_id = $1', [BOS])
      )[0]!;
      expect(Number(rows.at(-1)!.amount)).toBe(
        -Math.round((Number(coach.salaries[0]) + Number(buyout.salaries[0])) / 82),
      );
      break;
    }
    await balancesMatchLedger();
  });

  it('una squadra liberata ritira il cambio chiesto', async () => {
    const free = (
      await q<CoachRow>('select * from public.coaches where league_id = $1 and team_id is null limit 1', [
        LEAGUE,
      ])
    )[0]!;
    const r = await act(BRUNO, { kind: 'hire_coach', coach_id: free.id });
    await asUser(db, ANNA, (tx) => tx.query('select public.free_team($1)', [LAL]));
    expect(
      (await q<{ status: string }>('select status from public.coach_requests where id = $1', [r.id]))[0]!
        .status,
    ).toBe('withdrawn');
  });
});

describe('le leghe create prima', () => {
  it('senza allenatori giocano come allora: niente allenatori, niente movimento, niente cambi', async () => {
    const key = seedIds('vecchia');
    const state = createLeagueState(generateLeague(new Rng('vecchia'), ARCHETYPE_PROFILES), 'vecchia', {
      humanTeams: ['BOS'],
      potentialOnOverallScale: true,
      staff: false,
    });
    const payload = leaguePayload(state, {
      id: keyedIds(key.key),
      name: 'Lega di prima',
      commissionerId: ANNA,
      owners: { BOS: ANNA },
    });
    await db.query('select public.insert_league($1)', [payload]);
    const league = key.league;
    const start = new Map(
      (
        await q<{ id: string; balance: string }>(
          'select id, balance from public.teams where league_id = $1',
          [league],
        )
      ).map((t) => [t.id, Number(t.balance)]),
    );
    expect(await q('select 1 from public.coaches where league_id = $1', [league])).toEqual([]);
    await nextTurn(league);
    expect(
      await q(
        `select 1 from public.ledger l join public.teams t on t.id = l.team_id where t.league_id = $1 and l.kind = 'coach'`,
        [league],
      ),
    ).toEqual([]);
    expect(await q('select 1 from public.coaches where league_id = $1', [league])).toEqual([]);
    await balancesMatchLedger(league, start);
    const someCoach = (await q<{ id: string }>('select id from public.coaches limit 1'))[0]!;
    await expect(act(ANNA, { kind: 'hire_coach', coach_id: someCoach.id }, league)).rejects.toThrow(
      /non ci sono allenatori/,
    );
  });
});
