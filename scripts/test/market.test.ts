// Fase 11: mercato ed economia sulla lega di prova (anna commissario su BOS, bruno su LAL, carla su NYK). act()
// fa quello che fa la Edge Function market: legge lo stato, controlla l'azione con il motore e la scrive con
// market_write. Fatto quando: uno scambio che sfora i limiti o arriva dopo la deadline viene rifiutato dal
// server anche chiamando l'API a mano, e il saldo di fine stagione coincide con la somma dei movimenti.
import type { PGlite } from '@electric-sql/pglite';
import { TRADE_DEADLINE_TURN } from '@nbbgm/engine';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { checkMarketAction, type MarketAction } from '../../supabase/functions/_shared/market.ts';
import type { LeagueStateRows } from '../../supabase/functions/_shared/state.ts';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';
import { quickGame } from '../src/quick-game.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const CARLA = ids.user('carla');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');
const MIA = ids.team('MIA');

let db: PGlite;
let initialBalance: Map<string, number>;
const rpc = () => serviceRpc(db);

/** Come la Edge Function market. */
async function act(user: string, action: MarketAction): Promise<string> {
  const rows = await rpc().rpc<LeagueStateRows>('league_state', { p_league: LEAGUE });
  const c = checkMarketAction(rows, user, action);
  const r = await rpc().rpc<{ id: string }>('market_write', {
    p_league: LEAGUE,
    p_round: c.roundId,
    p_team: c.teamId,
    p_action: c.write,
  });
  return r.id;
}

/** Il commissario forza il turno e il server lo gioca (con la partita finta, per fare presto). */
async function nextTurn(opts: { botProposals?: boolean } = {}) {
  await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
  const r = await advanceLeague(rpc(), LEAGUE, {
    newId: randomUUID,
    playGame: quickGame,
    botProposals: opts.botProposals ?? false,
  });
  expect(r.advanced).toBe(true);
  return r;
}

const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

async function standard(team: string): Promise<{ id: string; salaries: string[] }[]> {
  return q(
    `select p.id, c.salaries from public.players p join public.contracts c on c.player_id = p.id
     where p.team_id = $1 and c.type <> 'two-way' order by p.id`,
    [team],
  );
}

async function balancesMatchLedger() {
  const rows = await q<{ id: string; balance: string; total: string }>(
    `select t.id, t.balance, coalesce(sum(l.amount), 0) as total
     from public.teams t left join public.ledger l on l.team_id = t.id
     where t.league_id = $1 group by t.id`,
    [LEAGUE],
  );
  for (const t of rows)
    expect(Number(t.balance), t.id).toBe((initialBalance.get(t.id) ?? 0) + Number(t.total));
}

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  const r = await q<{ id: string; balance: string }>(
    'select id, balance from public.teams where league_id = $1',
    [LEAGUE],
  );
  initialBalance = new Map(r.map((t) => [t.id, Number(t.balance)]));
}, 120_000);

describe('il server rifiuta', () => {
  it('le scritture dirette del client su scambi e offerte, e market_write chiamata dal client', async () => {
    const [mine] = await standard(BOS);
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query(
          `insert into public.trade_offers (league_id, from_team_id, to_team_id, players_from) values ($1, $2, $3, $4)`,
          [LEAGUE, BOS, LAL, [mine!.id]],
        ),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query(`select public.market_write($1, $2, $3, '{"kind":"release"}')`, [LEAGUE, ids.round, BOS]),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('il saldo di un’altra squadra (lo vede solo il suo manager e il commissario)', async () => {
    const balance = (user: string, team: string) =>
      asUser(
        db,
        user,
        async (tx) =>
          (await tx.query<{ b: { balance: number } | null }>('select public.team_balance($1) as b', [team]))
            .rows[0]!.b,
      );
    expect(await balance(BRUNO, LAL)).not.toBeNull();
    expect(await balance(BRUNO, BOS)).toBeNull();
    // Anna è il commissario
    expect(await balance(ANNA, LAL)).not.toBeNull();
    await expect(
      asUser(db, BRUNO, (tx) => tx.query('select balance from public.teams where id = $1', [BOS])),
    ).rejects.toThrow(/permission denied/);
  });

  it('uno scambio che sfora i limiti di rosa', async () => {
    const mine = await standard(BOS);
    // Boston ne cede tanti da scendere sotto 13 senza riceverne
    const give = mine.slice(0, mine.length - 12).map((p) => p.id);
    await expect(act(ANNA, { kind: 'propose_trade', to_team_id: LAL, players_from: give })).rejects.toThrow(
      /sotto 13/,
    );
    // E uno scambio con giocatori di un'altra squadra
    const [theirs] = await standard(NYK);
    await expect(
      act(ANNA, { kind: 'propose_trade', to_team_id: LAL, players_from: [theirs!.id] }),
    ).rejects.toThrow(/non è di BOS/);
  });

  it('due prime scelte di fila (regola Stepien) e protezioni fuori scala', async () => {
    const picks = await q<{ id: string }>(
      `select id from public.draft_picks where original_team_id = $1 and round = 1 order by draft_year limit 2`,
      [BOS],
    );
    await expect(
      act(ANNA, { kind: 'propose_trade', to_team_id: MIA, picks_from: picks.map((p) => p.id) }),
    ).rejects.toThrow(/Stepien/);
    await expect(
      act(ANNA, {
        kind: 'propose_trade',
        to_team_id: MIA,
        picks_from: [picks[0]!.id],
        protections: { [picks[0]!.id]: 30 },
      }),
    ).rejects.toThrow(/top 20/);
  });
});

describe('scambi', () => {
  it('tra umani: proposta, avviso bloccante, risposta, esecuzione alla chiusura', async () => {
    const [a] = await standard(BOS);
    const [b] = await standard(LAL);
    // Bruno era pronto: la proposta gli toglie il Pronto, perché la veda
    await asUser(db, BRUNO, (tx) => tx.query('select public.set_ready($1)', [LAL]));
    const offer = await act(ANNA, {
      kind: 'propose_trade',
      to_team_id: LAL,
      players_from: [a!.id],
      players_to: [b!.id],
    });
    const flag = await q<{ ready: boolean }>('select ready from public.ready_flags where team_id = $1', [
      LAL,
    ]);
    expect(flag[0]?.ready).toBe(false);
    const alert = await asUser(
      db,
      BRUNO,
      async (tx) =>
        (
          await tx.query<{ blocking: boolean; status: string }>(
            `select blocking, status from public.alerts where team_id = $1 and kind = 'trade_offer'`,
            [LAL],
          )
        ).rows,
    );
    expect(alert).toEqual([{ blocking: true, status: 'open' }]);
    // Carla non vede lo scambio
    const seen = await asUser(db, CARLA, (tx) => tx.query('select id from public.trade_offers'));
    expect(seen.rows).toHaveLength(0);
    // Solo Bruno può rispondere
    await expect(act(ANNA, { kind: 'respond_trade', offer_id: offer, accept: true })).rejects.toThrow(
      /non trovata/,
    );
    await act(BRUNO, { kind: 'respond_trade', offer_id: offer, accept: true });

    // Carla propone a Bruno ma lui non risponde: alla chiusura è rifiutata
    const [c] = await standard(NYK);
    const [d] = (await standard(LAL)).filter((p) => p.id !== b!.id);
    const ignored = await act(CARLA, {
      kind: 'propose_trade',
      to_team_id: LAL,
      players_from: [c!.id],
      players_to: [d!.id],
    });
    await nextTurn();

    const status = await q<{ id: string; status: string }>('select id, status from public.trade_offers');
    expect(Object.fromEntries(status.map((s) => [s.id, s.status]))).toMatchObject({
      [offer]: 'executed',
      [ignored]: 'expired',
    });
    const teamOf = async (id: string) =>
      (await q<{ team_id: string }>('select team_id from public.players where id = $1', [id]))[0]!.team_id;
    expect(await teamOf(a!.id)).toBe(LAL);
    expect(await teamOf(b!.id)).toBe(BOS);
    const contract = await q<{ team_id: string }>(
      'select team_id from public.contracts where player_id = $1',
      [a!.id],
    );
    expect(contract[0]!.team_id).toBe(LAL);
    const notes = await q<{ text: string }>(
      `select payload ->> 'text' as text from public.alerts where team_id = $1 and kind = 'market'`,
      [NYK],
    );
    expect(notes.map((n) => n.text).join(' ')).toMatch(/non ha risposto/);
    await balancesMatchLedger();
  });

  it('con un bot: decide alla chiusura, con il suo margine', async () => {
    const mine = await standard(BOS);
    const theirs = await q<{ id: string }>(
      `select p.id from public.players p join public.contracts c on c.player_id = p.id
       where p.team_id = $1 and c.type <> 'two-way'
       order by (select avg(value::numeric) from jsonb_each_text(p.ratings)) desc limit 1`,
      [MIA],
    );
    // Il peggiore di Boston per il migliore di Miami: il bot rifiuta
    const bad = await act(ANNA, {
      kind: 'propose_trade',
      to_team_id: MIA,
      players_from: [mine[0]!.id],
      players_to: [theirs[0]!.id],
    });
    await nextTurn();
    const s = await q<{ status: string }>('select status from public.trade_offers where id = $1', [bad]);
    // Rifiutato dal bot (o decaduto, se nel frattempo non stava più nel bilancio di Miami)
    expect(['rejected', 'void']).toContain(s[0]!.status);
    const still = await q<{ team_id: string }>('select team_id from public.players where id = $1', [
      theirs[0]!.id,
    ]);
    expect(still[0]!.team_id).toBe(MIA);
  });
});

describe('tagli, rinnovi e svincolati', () => {
  it('il taglio lascia lo stipendio residuo a bilancio; il rinnovo allunga il contratto', async () => {
    const mine = await standard(BOS);
    const cut = mine.find((p) => p.salaries.length >= 2)!;
    const last = mine.find((p) => p.salaries.length === 1 && p.id !== cut.id);
    await act(ANNA, { kind: 'release', player_id: cut.id });
    // Due volte nello stesso turno no
    await expect(act(ANNA, { kind: 'release', player_id: cut.id })).rejects.toThrow();
    let renewed: string | null = null;
    if (last) {
      await db.query('update public.players set morale = 70 where id = $1', [last.id]);
      await act(ANNA, { kind: 'renew', player_id: last.id });
      renewed = last.id;
    }
    // Rinnovare chi ha ancora più anni di contratto no
    const long = mine.find((p) => p.salaries.length >= 2 && p.id !== cut.id);
    if (long) await expect(act(ANNA, { kind: 'renew', player_id: long.id })).rejects.toThrow(/ultimo anno/);
    await nextTurn();

    const p = await q<{ team_id: string | null }>('select team_id from public.players where id = $1', [
      cut.id,
    ]);
    expect(p[0]!.team_id).toBeNull();
    // Chi l'ha tagliato non lo rifirma per il resto della stagione, nemmeno offrendo di più
    const rows = await rpc().rpc<LeagueStateRows>('league_state', { p_league: LEAGUE });
    expect(rows.releases).toEqual([{ player_id: cut.id, team_id: BOS }]);
    await expect(
      act(ANNA, { kind: 'bid', player_id: cut.id, salary: Number(cut.salaries[0]) * 2, years: 2 }),
    ).rejects.toThrow(/tagliato/);
    const dead = await q<{ salaries: string[] }>(
      'select salaries from public.dead_money where team_id = $1',
      [BOS],
    );
    const residual = cut.salaries.map(Number).reduce((a, b) => a + b, 0);
    expect(dead.map((d) => d.salaries.map(Number).reduce((a, b) => a + b, 0))).toContain(residual);
    if (renewed) {
      const c = await q<{ salaries: string[] }>(
        'select salaries from public.contracts where player_id = $1',
        [renewed],
      );
      expect(c[0]!.salaries.length).toBeGreaterThan(1);
    }
    const req = await q<{ status: string }>('select status from public.roster_requests where team_id = $1', [
      BOS,
    ]);
    expect(req.every((r) => r.status === 'done')).toBe(true);
    await balancesMatchLedger();
  });

  it('offerte a busta chiusa: sotto la richiesta rifiutate subito, poi vince una sola squadra', async () => {
    const { inSeasonAsk, minimumSalaryFor } = await import('@nbbgm/engine');
    const { leagueStateFromRows } = await import('../../supabase/functions/_shared/state.ts');
    // Uno svincolato debole (il peggiore di Miami): chiede il minimo, quindi si firma anche sopra il cap
    const weak = (
      await q<{ id: string }>(
        `select p.id from public.players p join public.contracts c on c.player_id = p.id
         where p.team_id = $1 and c.type <> 'two-way'
         order by (select avg(value::numeric) from jsonb_each_text(p.ratings)) limit 1`,
        [MIA],
      )
    )[0]!.id;
    await db.query('delete from public.contracts where player_id = $1', [weak]);
    await db.query('update public.players set team_id = null where id = $1', [weak]);
    // Con il saldo negativo si firma al minimo solo per restare a 13: Lakers e Knicks ricevono 50 milioni (fuori
    // dai movimenti, quindi si aggiorna anche il saldo di partenza) e un posto libero in rosa
    for (const team of [LAL, NYK]) {
      await db.query('update public.teams set balance = balance + 50000000 where id = $1', [team]);
      initialBalance.set(team, (initialBalance.get(team) ?? 0) + 50_000_000);
      const roster = await standard(team);
      if (roster.length >= 15) {
        await db.query('delete from public.contracts where player_id = $1', [roster[0]!.id]);
        await db.query('update public.players set team_id = null where id = $1', [roster[0]!.id]);
      }
    }
    const { state } = leagueStateFromRows(
      await rpc().rpc<LeagueStateRows>('league_state', { p_league: LEAGUE }),
    );
    const p = state.players.find((x) => x.id === weak)!;
    const ask = inSeasonAsk(state, p);
    expect(ask).toBe(minimumSalaryFor(state.config, p.yearsInLeague));
    // La cifra mostrata dall'app (arrotondata ai 10.000 $, anche per difetto) vale come la richiesta esatta
    const rows = await rpc().rpc<LeagueStateRows>('league_state', { p_league: LEAGUE });
    for (const shown of [Math.round(Number((ask / 1e6).toFixed(2)) * 1e6), ask - 5_000, ask + 5_000]) {
      const c = checkMarketAction(rows, BRUNO, { kind: 'bid', player_id: weak, salary: shown, years: 1 });
      expect(c.write).toMatchObject({ salaries: [ask] });
    }
    expect(() =>
      checkMarketAction(rows, BRUNO, { kind: 'bid', player_id: weak, salary: ask - 10_000, years: 1 }),
    ).toThrow(/minimo/);
    await expect(act(BRUNO, { kind: 'bid', player_id: weak, salary: 1, years: 1 })).rejects.toThrow(/minimo/);
    await expect(act(BRUNO, { kind: 'bid', player_id: weak, salary: ask, years: 9 })).rejects.toThrow(
      /da 1 a 5/,
    );
    const fromBruno = await act(BRUNO, { kind: 'bid', player_id: weak, salary: ask, years: 1 });
    const fromCarla = await act(CARLA, { kind: 'bid', player_id: weak, salary: ask, years: 2 });
    // Le offerte le vede solo chi le fa
    const seen = await asUser(db, BRUNO, (tx) => tx.query('select id from public.free_agent_bids'));
    expect(seen.rows).toHaveLength(1);
    await nextTurn();

    const bids = await q<{ id: string; status: string; team_id: string }>(
      'select id, status, team_id from public.free_agent_bids where id in ($1, $2)',
      [fromBruno, fromCarla],
    );
    expect(bids.map((b) => b.status).sort()).toEqual(['lost', 'won']);
    const winner = bids.find((b) => b.status === 'won')!.team_id;
    const signed = await q<{ team_id: string; salaries: string[] }>(
      'select team_id, salaries from public.contracts where player_id = $1',
      [weak],
    );
    expect(signed[0]!.team_id).toBe(winner);
    expect(Number(signed[0]!.salaries[0])).toBe(ask);
    await balancesMatchLedger();
  });
});

describe('stagione intera', () => {
  it('con le proposte dei bot, il saldo di fine stagione è la somma dei movimenti', async () => {
    let proposals = 0;
    for (let i = 0; i < 90; i++) {
      const round = (
        await q<{ number: number; kind: string }>(
          `select r.number, r.kind from public.leagues l join public.rounds r on r.id = l.current_round_id where l.id = $1`,
          [LEAGUE],
        )
      )[0]!;
      if (round.kind !== 'regular') break;
      if (round.number === TRADE_DEADLINE_TURN + 1) {
        // Dopo la deadline uno scambio è rifiutato subito
        const [a] = await standard(BOS);
        const [b] = await standard(LAL);
        await expect(
          act(ANNA, { kind: 'propose_trade', to_team_id: LAL, players_from: [a!.id], players_to: [b!.id] }),
        ).rejects.toThrow(/deadline/);
      }
      const r = await nextTurn({ botProposals: true });
      if (r.advanced)
        proposals = (
          await q<{ n: number }>(
            `select count(*)::int as n from public.trade_offers o join public.teams t on t.id = o.from_team_id
         where t.owner_id is null and o.league_id = $1`,
            [LEAGUE],
          )
        )[0]!.n;
    }
    const end = await q<{ phase: string }>(
      `select s.phase from public.leagues l join public.seasons s on s.id = l.current_season_id where l.id = $1`,
      [LEAGUE],
    );
    expect(end[0]!.phase).toBe('play-in');
    await balancesMatchLedger();
    // A fine regular season: tassa per chi è sopra la soglia, differenza per chi è sotto il minimo
    const settled = await q<{ n: number }>(
      `select count(*)::int as n from public.ledger where league_id = $1 and kind in ('tax', 'minimum-shortfall')`,
      [LEAGUE],
    );
    expect(settled[0]!.n).toBeGreaterThan(0);
    // I bot hanno proposto scambi, e senza risposta sono scaduti
    expect(proposals).toBeGreaterThan(0);
    const open = await q<{ n: number }>(
      `select count(*)::int as n from public.trade_offers where league_id = $1 and status = 'pending'
       and created_round_id <> (select current_round_id from public.leagues where id = $1)`,
      [LEAGUE],
    );
    expect(open[0]!.n).toBe(0);
  }, 600_000);

  it('dopo la trade deadline uno scambio è rifiutato', async () => {
    // Siamo al play-in: scambi bloccati fino alla fine dei playoff
    const [a] = await standard(BOS);
    const [b] = await standard(LAL);
    await expect(
      act(ANNA, { kind: 'propose_trade', to_team_id: LAL, players_from: [a!.id], players_to: [b!.id] }),
    ).rejects.toThrow(/deadline/);
    expect(TRADE_DEADLINE_TURN).toBeLessThan(81);
  });
});
