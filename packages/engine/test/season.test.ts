import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague, generatePlayer } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { CONFIG_2026_27, luxuryTax, nextConfig } from '../src/season/config.ts';
import { botProposeTrade, tradeBalance } from '../src/season/bots.ts';
import {
  ageCurve,
  calibratePotential,
  developPlayer,
  normalizeTalent,
  talentLevel,
} from '../src/season/development.ts';
import { MAX_STANDARD, MIN_STANDARD, canSign, standardRoster, twoWayRoster } from '../src/season/finance.ts';
import {
  LOTTERY_ODDS,
  drawLottery,
  initialPicks,
  resolveDraft,
  violatesStepien,
} from '../src/season/picks.ts';
import { applyPostseasonResult, postseasonGames, startPostseason } from '../src/season/postseason.ts';
import { validateSchedule } from '../src/season/schedule.ts';
import { createLeagueState, simulateSeason } from '../src/season/season.ts';
import { rankTeams, records } from '../src/season/standings.ts';
import type { DraftSwap, GameRecord } from '../src/season/state.ts';
import { validateTrade } from '../src/season/trades.ts';
import { TEAMS } from '../src/teams.ts';
import { validateLeague } from '../src/validate.ts';
import { quickGame } from './helpers.ts';

const ids = TEAMS.map((t) => t.id);
const game = (homeId: string, awayId: string, homeScore: number, awayScore: number): GameRecord => ({
  turn: 0,
  phase: 'regular',
  homeId,
  awayId,
  homeScore,
  awayScore,
  overtimes: 0,
});

describe('classifica', () => {
  it('a parità decidono gli scontri diretti, poi la differenza punti', () => {
    const games = [
      game('BOS', 'NYK', 100, 90),
      game('NYK', 'BOS', 95, 99),
      game('PHI', 'TOR', 120, 100),
      game('TOR', 'PHI', 101, 100),
    ];
    // BOS e PHI 2-0 e 1-1: BOS meglio di PHI? No, record diverso. NYK 0-2, TOR 1-1.
    const rows = records(TEAMS, games);
    const ranked = rankTeams(['BOS', 'NYK', 'PHI', 'TOR'], rows, games, 's');
    expect(ranked[0]).toBe('BOS');
    expect(ranked[3]).toBe('NYK');
    // PHI e TOR 1-1 tra loro: decide la differenza punti (+19 contro -19)
    expect(ranked.slice(1, 3)).toEqual(['PHI', 'TOR']);
  });
});

describe('play-in e playoff', () => {
  const seeds = { East: ids.slice(0, 10), West: ids.slice(15, 25) };
  const better = (a: string, b: string) => (ids.indexOf(a) < ids.indexOf(b) ? a : b);

  it('dal play-in alla finale, sempre con la meglio classificata in casa quando tocca', () => {
    const ps = startPostseason(seeds);
    let turns = 0;
    while (ps.stage !== 'done' && turns < 40) {
      const games = postseasonGames(ps);
      for (const g of games) {
        if (g.phase === 'playoffs') {
          const s = ps.series.find((x) => x.id === g.ref)!;
          const n = s.winsHigh + s.winsLow;
          expect(g.homeId).toBe([0, 1, 4, 6].includes(n) ? s.highId : s.lowId);
        }
        applyPostseasonResult(ps, g.ref, better(g.homeId, g.awayId), better);
      }
      turns++;
    }
    expect(ps.stage).toBe('done');
    expect(ps.championId).toBe('BOS');
    expect(ps.series.filter((s) => s.round === 1)).toHaveLength(8);
    // Vince sempre la meglio classificata: 7-8 settima, 9 batte 10 e poi perde con l'8
    const east = ps.series.filter((s) => s.round === 1 && s.conference === 'East');
    expect(east.map((s) => [s.highSeed, s.lowSeed])).toEqual([
      [1, 8],
      [4, 5],
      [3, 6],
      [2, 7],
    ]);
    expect(east.find((s) => s.lowSeed === 8)!.lowId).toBe(ids[7]);
    expect(turns).toBe(2 + 4 * 4);
  });
});

describe('lottery e scelte', () => {
  it('la peggiore vince la prima scelta circa il 14% delle volte', () => {
    const teams = ids.slice(0, 14);
    let wins = 0;
    const n = 6000;
    for (let i = 0; i < n; i++) if (drawLottery(teams, `l${i}`)[0] === teams[0]) wins++;
    expect(wins / n).toBeGreaterThan(0.12);
    expect(wins / n).toBeLessThan(0.16);
    expect(LOTTERY_ODDS.reduce((a, b) => a + b, 0)).toBe(1000);
  });

  it('dalla quinta in giù si segue la classifica', () => {
    const order = drawLottery(ids.slice(0, 14), 'ordine');
    const rest = order.slice(4);
    expect(rest).toEqual(ids.slice(0, 14).filter((id) => !order.slice(0, 4).includes(id)));
  });

  it('una prima scelta protetta che cade nella fascia protetta resta e passa all’anno dopo', () => {
    const picks = initialPicks(ids, 2027);
    const p = picks.find((x) => x.id === '2027-1-ATL')!;
    p.ownerId = 'BOS';
    p.protection = 10;
    const order = ['ATL', ...ids.filter((x) => x !== 'ATL')];
    const { slots } = resolveDraft(picks, [], 2027, order, order);
    expect(slots[0]!.ownerId).toBe('ATL');
    const next = picks.find((x) => x.id === '2028-1-ATL')!;
    expect([next.ownerId, next.protection, next.deferrals]).toEqual(['BOS', 10, 1]);
    expect(picks.some((x) => x.draftYear === 2027)).toBe(false);
  });

  it('dopo tre rinvii la scelta protetta diventa la seconda scelta', () => {
    const picks = initialPicks(ids, 2027);
    const p = picks.find((x) => x.id === '2027-1-ATL')!;
    Object.assign(p, { ownerId: 'BOS', protection: 10, deferrals: 3 });
    const order = ['ATL', ...ids.filter((x) => x !== 'ATL')];
    const { slots } = resolveDraft(picks, [], 2027, order, order);
    expect(slots.find((s) => s.round === 1 && s.originalTeamId === 'ATL')!.ownerId).toBe('ATL');
    expect(slots.find((s) => s.round === 2 && s.originalTeamId === 'ATL')!.ownerId).toBe('BOS');
  });

  it('lo swap dà a chi ha il diritto la migliore delle due scelte', () => {
    const picks = initialPicks(ids, 2027);
    const swaps: DraftSwap[] = [{ id: 's', draftYear: 2027, round: 1, holderId: 'BOS', otherId: 'ATL' }];
    const order = ['ATL', ...ids.filter((x) => x !== 'ATL')];
    const { slots } = resolveDraft(picks, swaps, 2027, order, order);
    expect(slots[0]!.ownerId).toBe('BOS');
    expect(slots.find((s) => s.round === 1 && s.originalTeamId === 'BOS')!.ownerId).toBe('ATL');
  });

  it('regola Stepien: niente prima scelta in due draft consecutivi', () => {
    const picks = initialPicks(ids, 2027);
    expect(violatesStepien(picks, 'BOS', 2027)).toBe(false);
    picks.find((x) => x.id === '2028-1-BOS')!.ownerId = 'ATL';
    expect(violatesStepien(picks, 'BOS', 2027)).toBe(false);
    picks.find((x) => x.id === '2029-1-BOS')!.ownerId = 'ATL';
    expect(violatesStepien(picks, 'BOS', 2027)).toBe(true);
  });
});

describe('economia', () => {
  const c = CONFIG_2026_27;
  it('luxury tax a scaglioni e aliquote maggiorate', () => {
    expect(luxuryTax(c, c.luxuryTax - 1, false)).toBe(0);
    expect(luxuryTax(c, c.luxuryTax + 12_000_000, false)).toBe(5e6 * 1.5 + 5e6 * 1.75 + 2e6 * 2.5);
    expect(luxuryTax(c, c.luxuryTax + 22_000_000, false)).toBe(5e6 * (1.5 + 1.75 + 2.5 + 3.25) + 2e6 * 3.75);
    expect(luxuryTax(c, c.luxuryTax + 5_000_000, true)).toBe(5e6 * 2.5);
  });

  it('la stagione successiva cresce del 7%', () => {
    const n = nextConfig(c);
    expect(n.year).toBe(2027);
    expect(n.salaryCap).toBe(Math.round(c.salaryCap * 1.07));
  });

  it('sopra il cap solo minimi; con saldo negativo solo minimi per restare a 13', () => {
    const league = generateLeague(new Rng('economia'), ARCHETYPE_PROFILES);
    const state = createLeagueState(league, 'economia', { potentialOnOverallScale: true });
    const team = state.teams[0]!;
    const fa = state.players.find((p) => p.teamId === null)!;
    // Monte stipendi oltre il cap
    for (const ct of state.contracts.filter((x) => x.teamId === team.id)) ct.salaries[0] = 12_000_000;
    // Rosa a 14 per avere un posto libero
    const out = standardRoster(state, team.id)[0]!;
    out.teamId = null;
    state.contracts = state.contracts.filter((x) => x.playerId !== out.id);
    expect(canSign(state, team.id, fa, 10_000_000).ok).toBe(false);
    expect(canSign(state, team.id, fa, c.minimumSalary[0]!).ok).toBe(true);
    team.balance = -1;
    expect(canSign(state, team.id, fa, c.minimumSalary[0]!).ok).toBe(false);
  });
});

describe('crescita', () => {
  it('i giovani crescono, i veterani calano, senza superare il potenziale', () => {
    const rng = new Rng('crescita');
    const delta = (age: number) => {
      let sum = 0;
      for (let i = 0; i < 150; i++) {
        const p = generatePlayer(rng, ARCHETYPE_PROFILES, { id: `p${i}`, age, level: 0 });
        p.hidden.potential = 99;
        const { before, after } = developPlayer(p, rng);
        sum += after - before;
      }
      return sum / 150;
    };
    expect(delta(20)).toBeGreaterThan(2.5);
    expect(delta(34)).toBeLessThan(-2);
    expect(ageCurve(27)).toBe(0);
    expect(ageCurve(26)).toBeGreaterThan(0);
    expect(ageCurve(28)).toBeLessThan(0);
    const capped = generatePlayer(rng, ARCHETYPE_PROFILES, { id: 'cap', age: 20, level: 0 });
    capped.hidden.potential = overall(capped);
    const { before, after } = developPlayer(capped, rng);
    expect(after - before).toBeLessThanOrEqual(3);
  });

  it('la normalizzazione riporta il livello della lega al riferimento senza cambiare l’ordine', () => {
    const rng = new Rng('normalizza');
    const players = Array.from({ length: 300 }, (_, i) =>
      generatePlayer(rng, ARCHETYPE_PROFILES, { id: `n${i}` }),
    );
    const reference = talentLevel(players);
    for (const p of players)
      for (const k of Object.keys(p.ratings) as (keyof typeof p.ratings)[])
        p.ratings[k] = Math.min(99, p.ratings[k] + 4);
    const order = [...players]
      .sort((a, b) => overall(b) - overall(a))
      .map((p) => p.id)
      .slice(0, 20);
    expect(talentLevel(players)).toBeGreaterThan(reference + 3);
    normalizeTalent(players, reference);
    expect(Math.abs(talentLevel(players) - reference)).toBeLessThan(0.6);
    const after = [...players]
      .sort((a, b) => overall(b) - overall(a))
      .map((p) => p.id)
      .slice(0, 20);
    expect(after.filter((id) => order.includes(id)).length).toBeGreaterThanOrEqual(18);
  });

  it('il potenziale del file viene riportato sulla scala dell’overall', () => {
    const rng = new Rng('potenziale');
    const players = Array.from({ length: 300 }, (_, i) =>
      generatePlayer(rng, ARCHETYPE_PROFILES, { id: `x${i}`, age: 20 + (i % 15) }),
    );
    for (const p of players) p.hidden.potential = 60 + Math.round(overall(p) / 4); // scala diversa
    calibratePotential(players);
    for (const p of players) expect(p.hidden.potential).toBeGreaterThanOrEqual(overall(p));
    const peak = players.filter((p) => p.age >= 28 && p.age <= 33);
    const gap = peak.reduce((a, p) => a + p.hidden.potential - overall(p), 0) / peak.length;
    expect(gap).toBeLessThan(3);
  });
});

describe('stagione completa', () => {
  it('dalla prima giornata alla nuova stagione, con rose e calendario validi', () => {
    const league = generateLeague(new Rng('stagione'), ARCHETYPE_PROFILES);
    const state = createLeagueState(league, 'stagione', { potentialOnOverallScale: true });
    const summary = simulateSeason(state, quickGame);
    expect(summary.championId).not.toBeNull();
    expect(summary.lottery).toHaveLength(14);
    expect(state.history).toHaveLength(1);
    expect(state.config.year).toBe(2027);
    expect(state.phase).toBe('regular');
    expect(validateSchedule(state.teams, 2027, state.schedule)).toEqual([]);
    for (const t of state.teams) {
      const n = standardRoster(state, t.id).length;
      expect(n).toBeGreaterThanOrEqual(MIN_STANDARD);
      expect(n).toBeLessThanOrEqual(MAX_STANDARD);
      expect(twoWayRoster(state, t.id).length).toBeLessThanOrEqual(3);
      // Scelte dei prossimi 7 draft
      for (let y = 2028; y < 2035; y++)
        expect(state.picks.some((p) => p.draftYear === y && p.originalTeamId === t.id && p.round === 1)).toBe(
          true,
        );
    }
    const errors = validateLeague({
      season: '2027-28',
      teams: state.teams,
      players: state.players,
      contracts: state.contracts,
      deadMoney: state.deadMoney,
    }).filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
    // I rookie scelti hanno un contratto da rookie
    const rookies = state.players.filter((p) => p.id.startsWith('d2027-') && p.teamId !== null);
    expect(rookies.length).toBeGreaterThanOrEqual(55);
    for (const r of rookies) expect(state.contracts.find((c) => c.playerId === r.id)).toBeDefined();
    expect(state.transactions.some((t) => t.type === 'signing')).toBe(true);
  });

  it('i bot propongono agli umani scambi validi che convengono a loro', () => {
    const league = generateLeague(new Rng('proposte'), ARCHETYPE_PROFILES);
    const state = createLeagueState(league, 'proposte', {
      potentialOnOverallScale: true,
      humanTeams: ['BOS'],
    });
    const rng = new Rng('p');
    const proposals = state.teams
      .filter((t) => !t.human && t.strategy !== 'middle')
      .flatMap((t) => Array.from({ length: 3 }, () => botProposeTrade(state, t.id, 'BOS', rng)))
      .filter((x) => x !== null);
    expect(proposals.length).toBeGreaterThan(0);
    for (const trade of proposals) {
      expect(validateTrade(state, trade)).toEqual([]);
      const bot = trade.teamA === 'BOS' ? trade.teamB : trade.teamA;
      const { get, give } = tradeBalance(state, trade, bot);
      expect(get).toBeGreaterThanOrEqual(give * 1.1 - 1e-9);
    }
  });

  it('uno scambio che lascia una squadra sotto i 13 viene rifiutato', () => {
    const league = generateLeague(new Rng('scambio'), ARCHETYPE_PROFILES);
    const state = createLeagueState(league, 'scambio', { potentialOnOverallScale: true });
    const bos = standardRoster(state, 'BOS')
      .slice(0, 3)
      .map((p) => p.id);
    const problems = validateTrade(state, {
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: bos,
      playersB: [],
      picksA: [],
      picksB: [],
    });
    expect(problems).toContain('BOS: sotto 13 contratti standard');
    expect(problems).toContain('LAL: oltre 15 contratti standard');
    state.turn = 60;
    const late = validateTrade(state, {
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: [bos[0]!],
      playersB: [standardRoster(state, 'LAL')[0]!.id],
      picksA: [],
      picksB: [],
    });
    expect(late).toContain('Scambi bloccati dalla trade deadline');
  });
});
