import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { autoSetup } from '../src/game/setup.ts';
import { simulateGame } from '../src/game/simulate.ts';
import { generateLeague } from '../src/generator.ts';
import { Rng } from '../src/rng.ts';
import {
  checkCoachHire,
  COACH_SALARY_MAX,
  COACH_SALARY_MIN,
  coachAsk,
  coachCost,
  coachGameEffect,
  coachMarketValue,
  coachOf,
  coachSetup,
  coachTactics,
  fireCoach,
  FREE_COACH_POOL,
  freeCoaches,
  generateCoach,
  lineupStyle,
  philosophyBonus,
  PHILOSOPHY_TACTICS,
  replaceCoach,
  scaleCoachContracts,
  signCoach,
  type Coach,
} from '../src/season/coaches.ts';
import { developPlayer } from '../src/season/development.ts';
import { twoWaySalary } from '../src/season/config.ts';
import { chargeGames, payroll, roster, twoWayRoster } from '../src/season/finance.ts';
import { runMarket } from '../src/season/market.ts';
import { simulateSeason } from '../src/season/offseason.ts';
import { createLeagueState, STAFF_REVENUE } from '../src/season/season.ts';
import type { LeagueState } from '../src/season/state.ts';
import type { Player } from '../src/types.ts';
import { quickGame } from './helpers.ts';

const data = generateLeague(new Rng('allenatori'), ARCHETYPE_PROFILES);

function league(humans: string[] = ['BOS']): LeagueState {
  return createLeagueState(data, 'allenatori', { humanTeams: humans, potentialOnOverallScale: true });
}

function coach(over: Partial<Coach> = {}, traits: Partial<Coach['traits']> = {}): Coach {
  const base = generateCoach(new Rng('un-allenatore'), 'prova');
  return {
    ...base,
    philosophy: 'balanced',
    ...over,
    traits: { rotation: 'normal', trust: 'neutral', rest: 'normal', flexible: false, ...traits },
    ratings: { tactics: 50, development: 50, motivation: 50, ...over.ratings },
  };
}

const rosterOf = (id: string) => data.players.filter((p) => p.teamId === id);

describe('allenatori della lega', () => {
  it('uno per squadra, più i liberi, con contratti da 1 a 5 anni', () => {
    const s = league();
    const coaches = s.coaches!;
    expect(coaches).toHaveLength(30 + FREE_COACH_POOL);
    expect(new Set(coaches.map((c) => c.id)).size).toBe(coaches.length);
    for (const t of s.teams) expect(coaches.filter((c) => c.teamId === t.id)).toHaveLength(1);
    for (const c of coaches) {
      for (const k of ['tactics', 'development', 'motivation'] as const) {
        expect(c.ratings[k]).toBeGreaterThanOrEqual(20);
        expect(c.ratings[k]).toBeLessThanOrEqual(95);
      }
      if (c.teamId === null) expect(c.salaries).toEqual([]);
      else {
        expect(c.salaries.length).toBeGreaterThanOrEqual(1);
        expect(c.salaries.length).toBeLessThanOrEqual(5);
        expect(c.salaries[0]).toBeGreaterThanOrEqual(COACH_SALARY_MIN * 0.9 - 1);
        expect(c.salaries[0]).toBeLessThanOrEqual(COACH_SALARY_MAX * 1.1 + 1);
      }
    }
  });

  it('i proprietari e gli allenatori non cambiano il resto della lega', () => {
    const a = league();
    const b = createLeagueState(data, 'allenatori', {
      humanTeams: ['BOS'],
      potentialOnOverallScale: true,
      staff: false,
    });
    expect(b.coaches).toBeUndefined();
    expect(a.players).toEqual(b.players);
    expect(a.schedule).toEqual(b.schedule);
    expect(a.contracts).toEqual(b.contracts);
  });

  it('i ricavi coprono anche lo staff', () => {
    const plain = createLeagueState(data, 'allenatori', { potentialOnOverallScale: true, staff: false });
    expect(league().config.revenue - plain.config.revenue).toBe(STAFF_REVENUE);
  });

  it('il valore di mercato cresce con la valutazione e con il cap', () => {
    const s = league();
    const weak = coach({ ratings: { tactics: 30, development: 30, motivation: 30 } });
    const strong = coach({ ratings: { tactics: 90, development: 90, motivation: 90 } });
    expect(coachMarketValue(s.config, weak)).toBe(COACH_SALARY_MIN);
    expect(coachMarketValue(s.config, strong)).toBe(COACH_SALARY_MAX);
    const later = { ...s.config, salaryCap: s.config.salaryCap * 1.07 };
    expect(coachMarketValue(later, strong)).toBeGreaterThan(COACH_SALARY_MAX);
    expect(coachAsk(s.config, strong)).toHaveLength(5);
    expect(coachAsk(s.config, { ...weak, age: 67 })).toHaveLength(2);
  });
});

describe('in campo', () => {
  const team = rosterOf('BOS');

  it("quintetto, minuti a 240 e le tattiche della sua idea di gioco, con l'effetto della Tattica", () => {
    for (const philosophy of ['run', 'space', 'grit', 'inside', 'motion', 'balanced'] as const) {
      const c = coach({ philosophy, ratings: { tactics: 80, development: 50, motivation: 50 } });
      const setup = coachSetup('BOS', team, c);
      expect(Object.values(setup.minutes).reduce((a, b) => a + b, 0)).toBe(240);
      expect(new Set(setup.starters).size).toBe(5);
      expect(setup.tactics).toEqual(PHILOSOPHY_TACTICS[philosophy]);
      expect(setup.coaching).toBeCloseTo(coachGameEffect(c));
      expect(setup.coaching).toBeGreaterThan(0);
    }
  });

  it('la rotazione corta usa 9 giocatori, quella lunga 10 con i minuti più divisi', () => {
    const short = coachSetup('BOS', team, coach({}, { rotation: 'short' }));
    const deep = coachSetup('BOS', team, coach({}, { rotation: 'deep' }));
    const used = (m: Record<string, number>) => Object.values(m).filter((x) => x > 0).length;
    expect(used(short.minutes)).toBe(9);
    expect(used(deep.minutes)).toBe(10);
    expect(Math.max(...Object.values(short.minutes))).toBe(36);
    expect(Math.max(...Object.values(deep.minutes))).toBeLessThanOrEqual(33);
  });

  it('chi fa riposare gli stanchi toglie minuti ai titolari stanchi, con la somma sempre a 240', () => {
    const tired = team.map((p) => ({ ...p, energy: 68 }));
    const rest = coachSetup('BOS', tired, coach({}, { rest: 'high' }));
    const squeeze = coachSetup('BOS', tired, coach({}, { rest: 'low' }));
    const top = (m: Record<string, number>) => Math.max(...Object.values(m));
    expect(top(rest.minutes)).toBeLessThan(top(squeeze.minutes));
    expect(Object.values(rest.minutes).reduce((a, b) => a + b, 0)).toBe(240);
    expect(Math.max(...Object.values(rest.minutes))).toBeLessThanOrEqual(48);
  });

  it("l'idea di gioco preferisce chi ha le abilità che cerca, a parità di overall", () => {
    const p = rosterOf('BOS')[0] as Player;
    const shooter = { ...p, ratings: { ...p.ratings, threePoint: 85, midRange: 75, pullUp: 75 } };
    const brick = { ...p, ratings: { ...p.ratings, threePoint: 30, midRange: 40, pullUp: 35 } };
    expect(philosophyBonus('space', shooter)).toBeGreaterThan(philosophyBonus('space', brick));
    expect(philosophyBonus('balanced', shooter)).toBe(0);
    const youth = lineupStyle(coach({}, { trust: 'youth' }));
    const vets = lineupStyle(coach({}, { trust: 'veterans' }));
    const kid = { ...p, age: 20 };
    const old = { ...p, age: 33 };
    expect(youth.bonus(kid)).toBeGreaterThan(youth.bonus(old));
    expect(vets.bonus(old)).toBeGreaterThan(vets.bonus(kid));
  });

  it('un allenatore flessibile adatta il focus alla rosa e rallenta con la squadra stanca', () => {
    const p = rosterOf('BOS')[0] as Player;
    const shooters = Array.from({ length: 8 }, (_, i) => ({
      ...p,
      id: `t${i}`,
      ratings: {
        ...p.ratings,
        threePoint: 85,
        midRange: 80,
        pullUp: 80,
        postControl: 30,
        closeShot: 40,
        standingDunk: 30,
        hook: 25,
      },
    }));
    const grit = coach({ philosophy: 'grit' }, { flexible: true });
    expect(coachTactics(grit, shooters).focus).toBe('perimeter');
    expect(coachTactics({ ...grit, traits: { ...grit.traits, flexible: false } }, shooters).focus).toBe(
      'balanced',
    );
    const tired = shooters.map((x) => ({ ...x, energy: 70 }));
    expect(coachTactics(grit, tired).intensity).toBe('medium');
  });

  it('una Tattica migliore fa vincere di più a parità di giocatori', () => {
    const a = rosterOf('BOS');
    const b = rosterOf('NYK');
    let margin = 0;
    for (let i = 0; i < 300; i++) {
      const good = autoSetup('BOS', a);
      good.coaching = 0.02;
      const plain = autoSetup('NYK', b);
      const base = simulateGame(autoSetup('BOS', a), autoSetup('NYK', b), `tattica:${i}`);
      const r = simulateGame(good, plain, `tattica:${i}`);
      margin += r.home.score - r.away.score - (base.home.score - base.away.score);
    }
    expect(margin / 300).toBeGreaterThan(1);
  });

  it("senza effetto dell'allenatore la partita è identica a quella di prima", () => {
    const home = autoSetup('BOS', rosterOf('BOS'));
    const away = autoSetup('NYK', rosterOf('NYK'));
    const zero = { ...home, coaching: 0 };
    expect(simulateGame(zero, away, 'uguale')).toEqual(simulateGame(home, away, 'uguale'));
  });
});

describe('crescita e morale', () => {
  it('lo Sviluppo fa crescere di più i giovani e calare di meno i veterani', () => {
    const young = { ...structuredClone(rosterOf('BOS')[0] as Player), age: 20 };
    young.hidden.potential = 95;
    const good = structuredClone(young);
    const bad = structuredClone(young);
    const g = developPlayer(good, new Rng('crescita'), 1);
    const b = developPlayer(bad, new Rng('crescita'), -1);
    expect(g.after - g.before).toBeGreaterThan(b.after - b.before);
    const old = { ...structuredClone(rosterOf('BOS')[0] as Player), age: 34 };
    const og = developPlayer(structuredClone(old), new Rng('calo'), 1);
    const ob = developPlayer(structuredClone(old), new Rng('calo'), -1);
    expect(og.after - og.before).toBeGreaterThan(ob.after - ob.before);
  });
});

describe('contratti, esoneri e assunzioni', () => {
  it("l'esonerato si paga fino alla scadenza, partita per partita, e il nuovo arriva alla sua richiesta", () => {
    const s = league();
    const old = coachOf(s, 'NYK')!;
    const owed = [...old.salaries];
    const pick = freeCoaches(s)[0]!;
    expect(replaceCoach(s, 'NYK', pick.id, 3)).toBe(true);
    expect(coachOf(s, 'NYK')?.id).toBe(pick.id);
    expect(pick.salaries).toEqual(coachAsk(s.config, pick));
    expect(old.teamId).toBeNull();
    expect(s.coachBuyouts).toEqual([
      { teamId: 'NYK', coachId: old.id, coachName: `${old.firstName} ${old.lastName}`, salaries: owed },
    ]);
    expect(coachCost(s, 'NYK')).toBe((pick.salaries[0] ?? 0) + (owed[0] ?? 0));
    const before = s.teams.find((t) => t.id === 'NYK')!.balance;
    chargeGames(s, ['NYK']);
    const after = s.teams.find((t) => t.id === 'NYK')!.balance;
    const twoWays = twoWayRoster(s, 'NYK').length * twoWaySalary(s.config);
    const games = (s.config.revenue - payroll(s, 'NYK') - twoWays) / 82;
    expect(after - before).toBeCloseTo(games - coachCost(s, 'NYK') / 82, 3);
  });

  it('chi assume un esonerato abbassa quello che gli deve ancora la squadra di prima', () => {
    const s = league();
    const old = coachOf(s, 'NYK')!;
    old.salaries = [8_000_000, 8_000_000, 8_000_000];
    fireCoach(s, 'NYK', 1);
    signCoach(
      s,
      'NYK',
      freeCoaches(s).find((c) => c.id !== old.id)!,
      [5_000_000, 5_000_000],
      1,
    );
    fireCoach(s, 'MIA', 1);
    signCoach(s, 'MIA', old, [6_000_000, 6_000_000], 1);
    expect(s.coachBuyouts?.find((b) => b.coachId === old.id)?.salaries).toEqual([
      2_000_000, 2_000_000, 8_000_000,
    ]);
  });

  it('con il saldo in rosso si prende solo un allenatore che costa al massimo come quello di adesso', () => {
    const s = league();
    const team = s.teams.find((t) => t.id === 'NYK')!;
    team.balance = -1;
    const current = coachOf(s, 'NYK')!.salaries[0]!;
    const free = freeCoaches(s);
    const dear = free.find((c) => (coachAsk(s.config, c)[0] ?? 0) > current);
    const cheap = free.find((c) => (coachAsk(s.config, c)[0] ?? 0) <= current);
    if (dear) expect(checkCoachHire(s, 'NYK', dear.id).ok).toBe(false);
    if (cheap) expect(checkCoachHire(s, 'NYK', cheap.id).ok).toBe(true);
    expect(checkCoachHire(s, 'NYK', coachOf(s, 'MIA')!.id).ok).toBe(false);
  });

  it('nel mercato del turno: un cambio per squadra, e se due vogliono lo stesso allenatore ne arriva uno solo', () => {
    const s = league(['BOS', 'LAL']);
    const [a, b] = freeCoaches(s);
    const out = runMarket(
      s,
      {
        trades: [],
        releases: [],
        renewals: [],
        bids: [],
        coaches: [
          { id: 'r1', teamId: 'BOS', coachId: a!.id },
          { id: 'r2', teamId: 'LAL', coachId: a!.id },
          { id: 'r3', teamId: 'BOS', coachId: b!.id },
        ],
      },
      2,
    );
    // a va a una sola squadra; BOS, se non lo prende, ripiega su b (una sola assunzione a testa)
    expect(out.requests).toHaveLength(3);
    expect([coachOf(s, 'BOS')?.id, coachOf(s, 'LAL')?.id].filter((id) => id === a!.id)).toHaveLength(1);
    const status = new Map(out.requests.map((r) => [r.id, r.status]));
    expect(Number(status.get('r1') === 'done') + Number(status.get('r3') === 'done')).toBe(1);
  });

  it('i contratti scalano con quelli dei giocatori', () => {
    const s = league();
    const c = coachOf(s, 'NYK')!;
    c.salaries = [5_000_000, 6_000_000];
    fireCoach(s, 'MIA', null);
    signCoach(s, 'MIA', freeCoaches(s)[0]!, [4_000_000], null);
    scaleCoachContracts(s);
    expect(c.salaries).toEqual([6_000_000]);
    expect(s.coachBuyouts?.every((x) => x.salaries.length > 0)).toBe(true);
  });

  it('dopo una stagione intera ogni squadra ha il suo allenatore e i liberi bastano', () => {
    const s = league(['BOS']);
    const bos = coachOf(s, 'BOS')!;
    bos.salaries = [bos.salaries[0]!];
    simulateSeason(s, quickGame);
    for (const t of s.teams) expect(s.coaches!.filter((c) => c.teamId === t.id)).toHaveLength(1);
    expect(freeCoaches(s).length).toBeGreaterThanOrEqual(FREE_COACH_POOL);
    // L'allenatore di una squadra umana in scadenza resta, per 2 anni
    expect(coachOf(s, 'BOS')?.id).toBe(bos.id);
    expect(bos.salaries).toHaveLength(2);
    for (const c of s.coaches!) if (c.teamId) expect(c.salaries.length).toBeGreaterThan(0);
    expect(roster(s, 'BOS').length).toBeGreaterThanOrEqual(13);
  });
});
