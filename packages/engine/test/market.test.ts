// Fase 11: il mercato dei manager in un turno, nel motore.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { CONFIG_2026_27, maxSalaryFor, minimumSalaryFor, nextConfig } from '../src/season/config.ts';
import { canSign, contractOf, payroll, standardRoster } from '../src/season/finance.ts';
import { askingSalaryFor, minimumSigningPool, snapToAsk } from '../src/season/freeAgency.ts';
import {
  botProposals,
  inSeasonAsk,
  MIN_RENEWAL_MORALE,
  renewalMax,
  renewalOffer,
  runMarket,
  type MarketRequests,
} from '../src/season/market.ts';
import { startNewSeason } from '../src/season/offseason.ts';
import { createLeagueState } from '../src/season/season.ts';
import type { LeagueState } from '../src/season/state.ts';
import { tradeDeadlineDay } from '../src/season/calendar.ts';
import { validateTrade, type Trade } from '../src/season/trades.ts';

function league(): LeagueState {
  const data = generateLeague(new Rng('mercato'), ARCHETYPE_PROFILES);
  return createLeagueState(data, 'mercato', { humanTeams: ['BOS', 'LAL'], potentialOnOverallScale: true });
}

const empty = (): MarketRequests => ({ trades: [], releases: [], renewals: [], bids: [] });
const worst = (s: LeagueState, team: string) =>
  [...standardRoster(s, team)].sort((a, b) => overall(a) - overall(b));

describe('scambi', () => {
  it('uno scambio accettato si esegue; il secondo con lo stesso giocatore decade', () => {
    const s = league();
    const a = worst(s, 'BOS')[0]!;
    const b = worst(s, 'LAL')[0]!;
    const c = worst(s, 'LAL')[1]!;
    const t1: Trade = {
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: [a.id],
      playersB: [b.id],
      picksA: [],
      picksB: [],
    };
    const t2: Trade = {
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: [a.id],
      playersB: [c.id],
      picksA: [],
      picksB: [],
    };
    const out = runMarket(
      s,
      {
        ...empty(),
        trades: [
          { id: 'secondo', trade: t2, fromId: 'BOS', status: 'accepted', toBot: false, order: 2 },
          { id: 'primo', trade: t1, fromId: 'BOS', status: 'accepted', toBot: false, order: 1 },
        ],
      },
      5,
    );
    expect(out.trades).toEqual([
      { id: 'primo', status: 'executed' },
      { id: 'secondo', status: 'void' },
    ]);
    expect(s.players.find((p) => p.id === a.id)?.teamId).toBe('LAL');
    expect(contractOf(s, a.id)?.teamId).toBe('LAL');
    expect(s.players.find((p) => p.id === b.id)?.teamId).toBe('BOS');
  });

  it('senza risposta lo scambio è rifiutato; un bot accetta solo se ci guadagna', () => {
    const s = league();
    const mine = worst(s, 'BOS')[0]!;
    const star = [...standardRoster(s, 'MIA')].sort((x, y) => overall(y) - overall(x))[0]!;
    const bad: Trade = {
      teamA: 'BOS',
      teamB: 'MIA',
      playersA: [mine.id],
      playersB: [star.id],
      picksA: [],
      picksB: [],
    };
    const ignored: Trade = { ...bad, teamB: 'LAL', playersB: [worst(s, 'LAL')[0]!.id] };
    const out = runMarket(
      s,
      {
        ...empty(),
        trades: [
          { id: 'bot', trade: bad, fromId: 'BOS', status: 'pending', toBot: true, order: 1 },
          { id: 'umano', trade: ignored, fromId: 'BOS', status: 'pending', toBot: false, order: 2 },
        ],
      },
      5,
    );
    expect(out.trades).toEqual([
      { id: 'bot', status: 'rejected' },
      { id: 'umano', status: 'expired' },
    ]);
    expect(s.players.find((p) => p.id === star.id)?.teamId).toBe('MIA');
  });

  it('limiti di rosa, deadline, protezioni e regola Stepien', () => {
    const s = league();
    const two = worst(s, 'BOS').slice(0, 3);
    // BOS cederebbe 3 giocatori senza riceverne: sotto 13
    while (standardRoster(s, 'BOS').length > 13) {
      const p = worst(s, 'BOS')[0]!;
      s.contracts = s.contracts.filter((c) => c.playerId !== p.id);
      p.teamId = null;
    }
    const lopsided: Trade = {
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: two.filter((p) => p.teamId === 'BOS').map((p) => p.id),
      playersB: [],
      picksA: [],
      picksB: [],
    };
    expect(validateTrade(s, lopsided).join(' ')).toMatch(/sotto 13/);

    const firsts = s.picks.filter((k) => k.originalTeamId === 'BOS' && k.round === 1);
    const pickTrade = (ids: string[], protections?: Record<string, number>): Trade => ({
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: [],
      playersB: [],
      picksA: ids,
      picksB: [],
      protections,
    });
    // Due prime scelte di fila: regola Stepien
    expect(validateTrade(s, pickTrade([firsts[0]!.id, firsts[1]!.id])).join(' ')).toMatch(/Stepien/);
    expect(validateTrade(s, pickTrade([firsts[0]!.id], { [firsts[0]!.id]: 25 })).join(' ')).toMatch(/top 20/);
    expect(validateTrade(s, pickTrade([firsts[0]!.id], { [firsts[0]!.id]: 10 }))).toEqual([]);
    const out = runMarket(
      s,
      {
        ...empty(),
        trades: [
          {
            id: 'scelta',
            trade: pickTrade([firsts[0]!.id], { [firsts[0]!.id]: 10 }),
            fromId: 'BOS',
            status: 'accepted',
            toBot: false,
            order: 1,
          },
        ],
      },
      5,
    );
    expect(out.trades[0]?.status).toBe('executed');
    expect(s.picks.find((k) => k.id === firsts[0]!.id)).toMatchObject({ ownerId: 'LAL', protection: 10 });

    s.day = tradeDeadlineDay(s.config.year) + 1;
    expect(validateTrade(s, pickTrade([firsts[2]!.id])).join(' ')).toMatch(/deadline/);
  });

  it('regola Stepien: chi è già in difetto senza colpa può scambiare se non peggiora', () => {
    const s = league();
    const firsts = s.picks
      .filter((k) => k.originalTeamId === 'BOS' && k.round === 1)
      .sort((a, b) => a.draftYear - b.draftYear);
    // Come dopo il rinvio di una scelta protetta: le prime due prime scelte di BOS sono di LAL
    for (const k of firsts.slice(0, 2)) k.ownerId = 'LAL';
    const p = worst(s, 'BOS')[0]!;
    const q = worst(s, 'LAL')[0]!;
    const players: Trade = {
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: [p.id],
      playersB: [q.id],
      picksA: [],
      picksB: [],
    };
    expect(validateTrade(s, players)).toEqual([]);
    // Cedere un'altra prima scelta che apre un buco nuovo resta vietato
    const more: Trade = { ...players, playersA: [], playersB: [], picksA: [firsts[3]!.id, firsts[4]!.id] };
    expect(validateTrade(s, more).join(' ')).toMatch(/Stepien/);
  });

  it('regola Stepien: la propria scelta protetta tornata a casa è di nuovo libera', () => {
    const s = league();
    const firsts = s.picks
      .filter((k) => k.originalTeamId === 'BOS' && k.round === 1)
      .sort((a, b) => a.draftYear - b.draftYear);
    const [k0, k1] = firsts as [(typeof firsts)[0], (typeof firsts)[0]];
    const give = (ids: string[], protections?: Record<string, number>): Trade => ({
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: [],
      playersB: [],
      picksA: ids,
      picksB: [],
      protections,
    });
    // BOS cede la prima scelta protetta top 10, poi la riprende indietro
    runMarket(
      s,
      {
        ...empty(),
        trades: [
          {
            id: 'a',
            trade: give([k0.id], { [k0.id]: 10 }),
            fromId: 'BOS',
            status: 'accepted',
            toBot: false,
            order: 1,
          },
        ],
      },
      5,
    );
    const back: Trade = {
      teamA: 'LAL',
      teamB: 'BOS',
      playersA: [],
      playersB: [],
      picksA: [k0.id],
      picksB: [],
    };
    expect(validateTrade(s, back)).toEqual([]);
    runMarket(
      s,
      {
        ...empty(),
        trades: [{ id: 'b', trade: back, fromId: 'LAL', status: 'accepted', toBot: false, order: 1 }],
      },
      6,
    );
    expect(s.picks.find((k) => k.id === k0.id)).toMatchObject({
      ownerId: 'BOS',
      protection: null,
      deferrals: 0,
    });
    // Con la sua scelta di nuovo libera BOS può cedere quella dell'anno dopo
    expect(validateTrade(s, give([k1.id]))).toEqual([]);
  });
});

describe('tagli, rinnovi e svincolati', () => {
  it('il taglio lascia lo stipendio residuo; il rinnovo allunga il contratto', () => {
    const s = league();
    const cut = [...standardRoster(s, 'BOS')].find((p) => (contractOf(s, p.id)?.salaries.length ?? 0) >= 2)!;
    const before = payroll(s, 'BOS');
    const residual = contractOf(s, cut.id)!.salaries.reduce((a, b) => a + b, 0);
    const lastYear = standardRoster(s, 'LAL').find((p) => contractOf(s, p.id)?.salaries.length === 1)!;
    lastYear.morale = 60;
    const offer = renewalOffer(s, lastYear)!;
    expect(offer.salaries.length).toBeGreaterThan(0);
    const out = runMarket(
      s,
      {
        ...empty(),
        releases: [{ id: 'taglio', teamId: 'BOS', playerId: cut.id }],
        renewals: [{ id: 'rinnovo', teamId: 'LAL', playerId: lastYear.id, salaries: offer.salaries }],
      },
      5,
    );
    expect(out.requests).toEqual([
      { id: 'taglio', status: 'done' },
      { id: 'rinnovo', status: 'done' },
    ]);
    expect(cut.teamId).toBeNull();
    // Il monte stipendi non cambia: lo stipendio resta come residuo
    expect(payroll(s, 'BOS')).toBe(before);
    expect(s.deadMoney.find((d) => d.teamId === 'BOS')?.salaries.reduce((a, b) => a + b, 0)).toBe(residual);
    expect(contractOf(s, lastYear.id)?.salaries).toHaveLength(1 + offer.salaries.length);

    lastYear.morale = MIN_RENEWAL_MORALE - 1;
    expect(renewalOffer(s, lastYear)).toBeNull();
  });

  it('vince l’offerta migliore sopra la richiesta; sotto la richiesta non firma nessuno', () => {
    const s = league();
    for (const team of ['BOS', 'LAL']) {
      const p = worst(s, team)[0]!;
      s.contracts = s.contracts.filter((c) => c.playerId !== p.id);
      p.teamId = null;
    }
    const free = s.players.filter((p) => p.teamId === null).sort((a, b) => overall(b) - overall(a));
    const target = free[0]!;
    const other = free[1]!;
    const ask = inSeasonAsk(s, target);
    const out = runMarket(
      s,
      {
        ...empty(),
        bids: [
          { id: 'bos', teamId: 'BOS', playerId: target.id, salaries: [ask] },
          {
            id: 'lal',
            teamId: 'LAL',
            playerId: target.id,
            salaries: [Math.round(ask * 1.4), Math.round(ask * 1.47)],
          },
          { id: 'bassa', teamId: 'BOS', playerId: other.id, salaries: [1] },
        ],
      },
      5,
    );
    expect(Object.fromEntries(out.bids.map((b) => [b.id, b.status]))).toEqual({
      bos: 'lost',
      lal: 'won',
      bassa: 'lost',
    });
    expect(target.teamId).toBe('LAL');
    expect(other.teamId).toBeNull();
    expect(out.notes.find((n) => n.teamId === 'BOS' && n.text.includes('chiede almeno'))).toBeDefined();
  });

  it('chi taglia un giocatore non lo rifirma fino alla stagione dopo; le altre squadre sì', () => {
    const s = league();
    // Un posto libero per LAL, e il peggiore di BOS (chiede il minimo) da tagliare
    const spare = worst(s, 'LAL')[0]!;
    s.contracts = s.contracts.filter((c) => c.playerId !== spare.id);
    spare.teamId = null;
    const cut = worst(s, 'BOS')[0]!;
    // Taglio e nuova offerta nello stesso turno: l'offerta non vale
    const out = runMarket(
      s,
      {
        ...empty(),
        releases: [{ id: 'taglio', teamId: 'BOS', playerId: cut.id }],
        bids: [{ id: 'subito', teamId: 'BOS', playerId: cut.id, salaries: [inSeasonAsk(s, cut)] }],
      },
      5,
    );
    expect(out.bids).toEqual([{ id: 'subito', status: 'invalid' }]);
    expect(out.notes.some((n) => n.teamId === 'BOS' && /tagliato/.test(n.text))).toBe(true);
    expect(s.releases).toEqual([{ playerId: cut.id, teamId: 'BOS' }]);
    // Nei turni dopo nemmeno, e il server non lo riprende per riempire la rosa; LAL invece può
    expect(canSign(s, 'BOS', cut, inSeasonAsk(s, cut)).reason).toMatch(/tagliato/);
    expect(minimumSigningPool(s, 'BOS').map((p) => p.id)).not.toContain(cut.id);
    const bid = (id: string, teamId: string, salary: number) =>
      runMarket(s, { ...empty(), bids: [{ id, teamId, playerId: cut.id, salaries: [salary] }] }, 6).bids;
    expect(bid('bos', 'BOS', inSeasonAsk(s, cut) * 2)).toEqual([{ id: 'bos', status: 'invalid' }]);
    expect(bid('lal', 'LAL', inSeasonAsk(s, cut))).toEqual([{ id: 'lal', status: 'won' }]);
    // Dalla stagione nuova si può di nuovo
    cut.teamId = null;
    s.contracts = s.contracts.filter((c) => c.playerId !== cut.id);
    s.phase = 'offseason';
    startNewSeason(s);
    expect(s.releases).toEqual([]);
    expect(canSign(s, 'BOS', cut, minimumSalaryFor(s.config, cut.yearsInLeague)).reason ?? '').not.toMatch(
      /tagliato/,
    );
  });

  it('la cifra mostrata (arrotondata ai 10.000 $) vale come la richiesta esatta, anche per i minimi', () => {
    const minimums = [...CONFIG_2026_27.minimumSalary, ...nextConfig(CONFIG_2026_27).minimumSalary];
    for (const ask of minimums) {
      const shown = Math.round(Number((ask / 1e6).toFixed(2)) * 1e6);
      expect(snapToAsk(shown, ask)).toBe(ask);
    }
    expect(snapToAsk(1_450_000, 1_452_806)).toBe(1_452_806);
    expect(snapToAsk(1_460_000, 1_452_806)).toBe(1_460_000);
    expect(snapToAsk(1_440_000, 1_452_806)).toBe(1_440_000);
  });
});

describe('stipendio massimo', () => {
  it('richieste e rinnovi non superano il massimo per anzianità, nemmeno con il morale basso', () => {
    const s = league();
    const star = standardRoster(s, 'LAL').find((p) => contractOf(s, p.id)?.salaries.length === 1)!;
    // Un fuoriclasse: valore di mercato al massimo, che con il morale basso chiederebbe di più
    for (const k of Object.keys(star.ratings)) (star.ratings as Record<string, number>)[k] = 97;
    star.yearsInLeague = 4;
    star.morale = 0;
    const max = maxSalaryFor(s.config, star.yearsInLeague);
    expect(askingSalaryFor(s.config, star, 0)).toBe(max);
    expect(inSeasonAsk(s, star)).toBeLessThanOrEqual(max);

    star.morale = MIN_RENEWAL_MORALE;
    const offer = renewalOffer(s, star)!;
    expect(offer.salaries[0]).toBe(renewalMax(s.config, star));
    // Un rinnovo chiesto sopra il massimo (per esempio salvato prima della correzione) alla chiusura non vale
    const out = runMarket(
      s,
      {
        ...empty(),
        renewals: [
          {
            id: 'troppo',
            teamId: 'LAL',
            playerId: star.id,
            salaries: [renewalMax(s.config, star) + 1_000_000],
          },
        ],
      },
      5,
    );
    expect(out.requests).toEqual([{ id: 'troppo', status: 'invalid' }]);
    expect(contractOf(s, star.id)?.salaries).toHaveLength(1);
  });
});

describe('proposte dei bot', () => {
  it('al massimo una per squadra umana, e non due volte di fila', () => {
    const s = league();
    const rng = new Rng('proposte');
    let got = 0;
    const last = new Map<string, number>();
    for (let turn = 0; turn < 160; turn++) {
      s.turn = turn;
      for (const p of botProposals(s, rng, last, turn)) {
        expect(last.get(p.toId) === undefined || turn - (last.get(p.toId) as number) >= 10).toBe(true);
        expect(s.teams.find((t) => t.id === p.fromId)?.human).toBe(false);
        expect(validateTrade(s, p.trade)).toEqual([]);
        last.set(p.toId, turn);
        got++;
      }
    }
    expect(got).toBeGreaterThan(0);
  });
});
