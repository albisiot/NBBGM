// Seconda analisi, sezione 2: l'economia sulle stagioni lunghe. Stipendi come quelli veri, firme in rosso fino al
// monte stipendi minimo, bot che spendono lo spazio sotto il cap guardando i ruoli, strategie con classifica e monte
// stipendi, forza della squadra per gli svincolati con la classifica, un solo scambio tra bot per turno, cessioni
// dei contratti pesanti che convengono anche a chi cede.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { botSalaryDump, draftRanking, updateStrategies } from '../src/season/bots.ts';
import { CONFIG_2026_27, maxSalaryFor, minimumSalaryFor } from '../src/season/config.ts';
import {
  MARKET_FLOOR_LEVEL,
  MARKET_MAX_LEVEL,
  canSign,
  contractOf,
  marketValue,
  payroll,
  roster,
  standardRoster,
} from '../src/season/finance.ts';
import { APPEAL_MIN_GAMES, askingSalary, botOffers, roleNeed, teamAppeal } from '../src/season/freeAgency.ts';
import { createLeagueState, playRegularTurn } from '../src/season/season.ts';
import type { GameRecord, LeagueState, PlayerState } from '../src/season/state.ts';
import { quickGame } from './helpers.ts';

function league(seed = 'economia'): LeagueState {
  const data = generateLeague(new Rng(seed), ARCHETYPE_PROFILES);
  return createLeagueState(data, seed, { potentialOnOverallScale: true });
}

const win = (homeId: string, awayId: string, turn: number): GameRecord => ({
  turn,
  phase: 'regular',
  homeId,
  awayId,
  homeScore: 110,
  awayScore: 100,
  overtimes: 0,
});

describe('valore di mercato', () => {
  const c = CONFIG_2026_27;
  const at = (p: PlayerState, age: number) => marketValue(c, { ...p, age });

  it('dal minimo al massimo per anzianità in linea retta, con un punto in meno per anno oltre i 31', () => {
    const s = league();
    for (const p of s.players.slice(0, 200)) {
      const min = minimumSalaryFor(c, p.yearsInLeague);
      const max = maxSalaryFor(c, p.yearsInLeague);
      const v = at(p, 28);
      expect(v).toBeGreaterThanOrEqual(min - 10_000);
      expect(v).toBeLessThanOrEqual(max + 10_000);
      const t = Math.max(
        0,
        Math.min(1, (overall(p) - MARKET_FLOOR_LEVEL) / (MARKET_MAX_LEVEL - MARKET_FLOOR_LEVEL)),
      );
      expect(Math.abs(v - (min + (max - min) * t))).toBeLessThanOrEqual(5_000);
      // Fino a 31 anni l'età non conta, dopo sì
      expect(at(p, 31)).toBe(v);
      if (t > 0 && t < 1) expect(at(p, 34)).toBeLessThan(v);
    }
  });

  it('una rosa normale vale circa il cap, non la metà', () => {
    const s = league();
    const values = s.teams
      .map((t) => standardRoster(s, t.id).reduce((a, p) => a + marketValue(s.config, p), 0))
      .sort((a, b) => a - b);
    const median = (values[14]! + values[15]!) / 2;
    expect(median).toBeGreaterThan(s.config.salaryCap * 0.85);
    expect(median).toBeLessThan(s.config.luxuryTax * 1.1);
  });
});

describe('bilancio in rosso', () => {
  it('si firma fino al monte stipendi minimo (si pagherebbe comunque), oltre solo minimi per restare a 13', () => {
    const s = league();
    const team = s.teams[0]!;
    const fa = s.players.find((p) => p.teamId === null)!;
    const out = standardRoster(s, team.id)[0]!;
    out.teamId = null;
    s.contracts = s.contracts.filter((x) => x.playerId !== out.id);
    team.balance = -1;
    // Monte stipendi di 120 milioni: altri 10 milioni stanno sotto il minimo (148), 35 no
    const mine = s.contracts.filter((x) => x.teamId === team.id && x.type !== 'two-way');
    for (const ct of mine) ct.salaries[0] = 120_000_000 / mine.length;
    s.deadMoney = s.deadMoney.filter((d) => d.teamId !== team.id);
    expect(payroll(s, team.id)).toBeCloseTo(120_000_000, -2);
    expect(canSign(s, team.id, fa, 10_000_000).ok).toBe(true);
    expect(canSign(s, team.id, fa, 35_000_000).ok).toBe(false);
    expect(canSign(s, team.id, fa, 35_000_000).reason).toMatch(/monte stipendi minimo/);
  });
});

describe('offerte dei bot agli svincolati', () => {
  it('il ruolo scoperto conta di più, quello già pieno di meno', () => {
    const s = league();
    const team = s.teams[0]!.id;
    const byRole = (role: PlayerState['role']) => standardRoster(s, team).filter((p) => p.role === role);
    const centers = byRole('C');
    for (const p of centers) {
      p.teamId = null;
      s.contracts = s.contracts.filter((x) => x.playerId !== p.id);
    }
    expect(roleNeed(s, team, { role: 'C' })).toBe(1.15);
    // Quattro playmaker sono uno in più dei tre che servono
    const free = s.players.filter((p) => p.teamId === null && p.role === 'PG');
    while (byRole('PG').length < 4) free.pop()!.teamId = team;
    expect(roleNeed(s, team, { role: 'PG' })).toBe(0.8);
  });

  it('con spazio sotto il cap il bot prende il migliore che può pagare, non il più conveniente', () => {
    const s = league();
    s.phase = 'offseason';
    const bot = s.teams.find((t) => !t.human)!;
    // Rosa a 12 con un monte stipendi basso e saldo positivo: molto spazio
    for (const p of [...standardRoster(s, bot.id)].sort((a, b) => overall(a) - overall(b)).slice(0, 3)) {
      p.teamId = null;
      s.contracts = s.contracts.filter((x) => x.playerId !== p.id);
    }
    for (const ct of s.contracts.filter((x) => x.teamId === bot.id)) ct.salaries = ct.salaries.map(() => 5e6);
    s.deadMoney = s.deadMoney.filter((d) => d.teamId !== bot.id);
    bot.balance = 50e6;
    const space = s.config.salaryCap - payroll(s, bot.id);
    // Lo svincolato migliore, con una richiesta alta ma dentro lo spazio
    const star = [...s.players.filter((p) => p.teamId === null)].sort((a, b) => overall(b) - overall(a))[0]!;
    const ask = askingSalary(s, star, 0);
    expect(ask).toBeLessThan(space);
    expect(ask).toBeGreaterThan(minimumSalaryFor(s.config, star.yearsInLeague) * 3);
    const offers = botOffers(s, 0, new Rng('offerte'), { fillTo: 15 }).filter((o) => o.teamId === bot.id);
    expect(offers.map((o) => o.playerId)).toContain(star.id);
    // Lo spazio non si supera
    const total = offers.reduce(
      (a, o) => a + ((o.salaries[0] ?? 0) > minimumSalaryFor(s.config, 0) * 1.5 ? (o.salaries[0] ?? 0) : 0),
      0,
    );
    expect(total).toBeLessThanOrEqual(space);
  });

  it('in rosso il bot spende solo fino al monte stipendi minimo', () => {
    const s = league();
    s.phase = 'offseason';
    const bot = s.teams.find((t) => !t.human)!;
    bot.balance = -10e6;
    for (const p of [...standardRoster(s, bot.id)].sort((a, b) => overall(a) - overall(b)).slice(0, 3)) {
      p.teamId = null;
      s.contracts = s.contracts.filter((x) => x.playerId !== p.id);
    }
    for (const ct of s.contracts.filter((x) => x.teamId === bot.id)) ct.salaries = ct.salaries.map(() => 9e6);
    s.deadMoney = s.deadMoney.filter((d) => d.teamId !== bot.id);
    const room = s.config.minimumTeamSalary - payroll(s, bot.id);
    expect(room).toBeGreaterThan(0);
    const offers = botOffers(s, 0, new Rng('rosso'), { fillTo: 15 }).filter((o) => o.teamId === bot.id);
    const spent = offers.reduce((a, o) => a + (o.salaries[0] ?? 0), 0);
    expect(offers.length).toBeGreaterThan(0);
    // Al più lo spazio fino al minimo, più i minimi di chi chiede il minimo
    expect(spent).toBeLessThanOrEqual(room + offers.length * minimumSalaryFor(s.config, 10));
    for (const o of offers) {
      const p = s.players.find((x) => x.id === o.playerId)!;
      expect(canSign(s, bot.id, p, o.salaries[0] ?? 0).ok).toBe(true);
    }
  });
});

describe('forza della squadra e strategie con la classifica', () => {
  it('per gli svincolati conta anche la classifica, da 10 partite giocate', () => {
    const s = league();
    const team = s.teams[0]!.id;
    const others = s.teams.slice(1).map((t) => t.id);
    const before = teamAppeal(s).get(team)!;
    for (let i = 0; i < APPEAL_MIN_GAMES - 1; i++) s.games.push(win(team, others[i]!, i));
    expect(teamAppeal(s).get(team)).toBeCloseTo(before);
    s.games.push(win(team, others[APPEAL_MIN_GAMES]!, APPEAL_MIN_GAMES));
    // Tutte vinte: metà forza, metà classifica (100%)
    expect(teamAppeal(s).get(team)).toBeCloseTo(0.5 * before + 0.5);
    for (let i = 0; i < 12; i++) s.games.push(win(others[0]!, others[1]!, 20 + i));
    expect(teamAppeal(s).get(others[1]!)).toBeLessThan(teamAppeal(s).get(team)!);
  });

  it('chi vince è in corsa anche se sulla carta è debole', () => {
    const s = league();
    const ranking = draftRanking(s);
    const weak = ranking[29]!;
    expect(s.teams.find((t) => t.id === weak)!.strategy).toBe('rebuild');
    const others = s.teams.map((t) => t.id).filter((id) => id !== weak);
    for (let i = 0; i < 30; i++) s.games.push(win(weak, others[i % others.length]!, i));
    s.turn = 30;
    updateStrategies(s);
    expect(s.teams.find((t) => t.id === weak)!.strategy).toBe('contend');
  });

  it('sopra la tassa e in rosso non si è in corsa se non tra le prime 6, e fuori dalle prime 12 si ricostruisce', () => {
    const s = league();
    const ranking = draftRanking(s);
    const squeeze = (id: string) => {
      const team = s.teams.find((t) => t.id === id)!;
      team.balance = -1;
      const mine = s.contracts.filter((x) => x.teamId === id && x.type !== 'two-way');
      for (const ct of mine) ct.salaries[0] = (s.config.luxuryTax * 1.1) / mine.length;
      return team;
    };
    const eighth = squeeze(ranking[7]!);
    const fourteenth = squeeze(ranking[13]!);
    const third = squeeze(ranking[2]!);
    updateStrategies(s);
    expect(draftRanking(s).slice(0, 14)).toEqual(ranking.slice(0, 14));
    expect(third.strategy).toBe('contend');
    expect(eighth.strategy).toBe('middle');
    expect(fourteenth.strategy).toBe('rebuild');
  });
});

describe('scambi tra bot', () => {
  /**
   * Bot in ricostruzione, in rosso e sopra la tassa (per il contratto del migliore, che si tiene), con un solo altro
   * contratto pesante: il secondo migliore della rosa, con età e stipendi dati.
   */
  function squeezed(age: number, salary: (s: LeagueState, p: PlayerState) => number, better = 0) {
    const s = league('cessioni');
    const seller = s.teams.find((t) => !t.human)!;
    seller.strategy = 'rebuild';
    seller.balance = -1;
    const mine = [...standardRoster(s, seller.id)].sort((a, b) => overall(b) - overall(a));
    for (const p of mine) {
      contractOf(s, p.id)!.salaries = [2e6, 2e6];
      const r = p.ratings as Record<string, number>;
      for (const k of Object.keys(r)) r[k] = Math.min(99, (r[k] as number) + better);
    }
    const target = mine[1]!;
    target.age = age;
    const pay = Math.round(salary(s, target));
    contractOf(s, target.id)!.salaries = [pay, pay, pay];
    // Sopra la tassa per il migliore, che il bot si tiene
    contractOf(s, mine[0]!.id)!.salaries = [s.config.luxuryTax, s.config.luxuryTax];
    expect(payroll(s, seller.id)).toBeGreaterThan(s.config.luxuryTax);
    // Compratori con saldo positivo e un posto libero in rosa (lo spazio sotto il cap ce l'hanno le squadre generate)
    for (const t of s.teams.filter((x) => x.id !== seller.id)) {
      t.balance = 50e6;
      const worst = [...standardRoster(s, t.id)].sort((a, b) => overall(a) - overall(b))[0]!;
      s.contracts = s.contracts.filter((c) => c.playerId !== worst.id);
      worst.teamId = null;
    }
    return { s, target };
  }
  /** In quante di 12 estrazioni il bot cede il giocatore. */
  const dumped = (s: LeagueState, target: PlayerState) =>
    Array.from({ length: 12 }, (_, i) => {
      const copy = JSON.parse(JSON.stringify(s)) as LeagueState;
      return botSalaryDump(copy, new Rng(`cessione-${i}`), 3)?.playersA.includes(target.id) ?? false;
    }).filter(Boolean).length;

  it('chi cede un contratto pesante deve guadagnarci: un giovane che vale più di quanto costa non si regala', () => {
    const young = squeezed(21, () => 6e6);
    expect(marketValue(young.s.config, young.target)).toBeGreaterThan(9e6);
    expect(dumped(young.s, young.target)).toBe(0);
    // Lo stesso posto con un buon veterano di 35 anni pagato quanto vale: per chi ricostruisce vale poco, a un
    // compratore serve, e il risparmio sulla tassa è grande. Lo cede
    const old = squeezed(35, (s, p) => marketValue(s.config, p), 8);
    expect(dumped(old.s, old.target)).toBeGreaterThan(0);
  });

  it('al massimo uno per turno', () => {
    const s = league('uno-per-turno');
    for (let t = 0; t < 56; t++) playRegularTurn(s, quickGame);
    const perTurn = new Map<number, number>();
    for (const x of s.transactions)
      if (x.type === 'trade' && x.turn !== null) perTurn.set(x.turn, (perTurn.get(x.turn) ?? 0) + 1);
    expect(perTurn.size).toBeGreaterThan(0);
    expect(Math.max(...perTurn.values())).toBe(1);
    // Rose sempre valide
    for (const team of s.teams) expect(roster(s, team.id).length).toBeGreaterThanOrEqual(13);
    for (const p of s.players.filter((x) => x.teamId !== null)) expect(contractOf(s, p.id)).toBeDefined();
  });
});
