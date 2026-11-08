import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { botDraftChoice, botWantsRenewal, draftRanking, updateStrategies } from '../src/season/bots.ts';
import { coachOf, freeCoaches } from '../src/season/coaches.ts';
import { marketValue, payroll } from '../src/season/finance.ts';
import { botOffers } from '../src/season/freeAgency.ts';
import { botProposals } from '../src/season/market.ts';
import {
  coachAppeal,
  DEFAULT_OWNER,
  generateOwners,
  hireBestCoach,
  midseasonCoachMoves,
  OWNER_STYLE,
  ownerStyle,
  renewalRatio,
  tradeMargin,
  type OwnerGoal,
  type OwnerProfile,
} from '../src/season/owners.ts';
import { createLeagueState } from '../src/season/season.ts';
import type { LeagueState, PlayerState } from '../src/season/state.ts';

const data = generateLeague(new Rng('proprietari'), ARCHETYPE_PROFILES);

function league(humans: string[] = []): LeagueState {
  return createLeagueState(data, 'proprietari', { humanTeams: humans, potentialOnOverallScale: true });
}

const owner = (goal: OwnerGoal, more: Partial<OwnerProfile> = {}): OwnerProfile => ({
  ...DEFAULT_OWNER,
  goal,
  ...more,
});

describe('proprietari', () => {
  it('ogni lega ha lo stesso miscuglio di obiettivi', () => {
    const owners = generateOwners(
      data.teams.map((t) => t.id),
      new Rng('mazzo'),
    );
    const count = (g: OwnerGoal) => [...owners.values()].filter((o) => o.goal === g).length;
    expect([
      count('balanced'),
      count('win-now'),
      count('patient'),
      count('thrifty'),
      count('splash'),
    ]).toEqual([8, 6, 6, 6, 4]);
    const s = league();
    expect(s.teams.every((t) => t.owner !== undefined)).toBe(true);
    expect(s.teams.every((t) => typeof t.expectedWins === 'number')).toBe(true);
  });

  it("l'obiettivo sposta la strategia: chi vuole vincere subito è in corsa più spesso, chi ha pazienza meno", () => {
    const s = league();
    for (const t of s.teams) t.owner = owner('balanced');
    updateStrategies(s);
    const ranking = draftRanking(s);
    const twelfth = s.teams.find((t) => t.id === ranking[11])!;
    const eighth = s.teams.find((t) => t.id === ranking[7])!;
    expect(twelfth.strategy).toBe('middle');
    expect(eighth.strategy).toBe('contend');
    twelfth.owner = owner('win-now');
    eighth.owner = owner('patient');
    updateStrategies(s);
    expect(twelfth.strategy).toBe('contend');
    expect(eighth.strategy).toBe('middle');
  });

  it('chi risparmia si sente stretto appena supera la tassa, anche con il saldo positivo', () => {
    const s = league();
    for (const t of s.teams) t.owner = owner('balanced');
    updateStrategies(s);
    const ranking = draftRanking(s);
    const rich = s.teams
      .filter((t) => payroll(s, t.id) > s.config.luxuryTax)
      .find((t) => {
        const r = ranking.indexOf(t.id);
        return r >= OWNER_STYLE.thrifty.squeezedRebuildRank && r < OWNER_STYLE.balanced.rebuildRank;
      });
    if (!rich) return;
    rich.balance = 50_000_000;
    updateStrategies(s);
    expect(rich.strategy).toBe('middle');
    rich.owner = owner('thrifty');
    updateStrategies(s);
    expect(rich.strategy).toBe('rebuild');
  });

  it('molto in rosso anche chi vuole vincere subito deve risparmiare', () => {
    const team = { owner: owner('win-now'), balance: -1 };
    expect(ownerStyle(team, 200e6)).toBe(OWNER_STYLE['win-now']);
    expect(ownerStyle({ ...team, balance: -70e6 }, 200e6).hatesTax).toBe(true);
    // Equilibrio non cambia: ha già le sue regole per il rosso
    expect(ownerStyle({ owner: owner('balanced'), balance: -500e6 }, 200e6)).toBe(OWNER_STYLE.balanced);
  });

  it('i GM: margine negli scambi e fedeltà nei rinnovi', () => {
    expect(tradeMargin({ owner: owner('balanced', { trades: 'high' }) })).toBeLessThan(
      tradeMargin({ owner: owner('balanced') }),
    );
    expect(tradeMargin({ owner: owner('balanced', { trades: 'low' }) })).toBeGreaterThan(1.1);
    expect(tradeMargin(undefined)).toBe(1.1);
    expect(renewalRatio({ owner: owner('win-now', { loyalty: 'high' }) })).toBeGreaterThan(
      renewalRatio({ owner: owner('thrifty', { loyalty: 'low' }) }),
    );
  });

  it('i rinnovi: chi è fedele paga di più, chi risparmia non va sopra la tassa', () => {
    const s = league();
    const team = s.teams.find((t) => t.id === 'NYK')!;
    team.balance = 10_000_000;
    const best = [...s.players.filter((p) => p.teamId === 'NYK')].sort((a, b) => overall(b) - overall(a));
    const p = best[3] as PlayerState;
    const ask = marketValue(s.config, p) * 1.25;
    team.owner = owner('balanced');
    team.strategy = 'middle';
    expect(botWantsRenewal(s, 'NYK', p, ask)).toBe(false);
    team.owner = owner('win-now', { loyalty: 'high' });
    expect(botWantsRenewal(s, 'NYK', p, ask)).toBe(true);
    // Chi risparmia: anche al prezzo giusto, non se lo porta sopra la tassa (salvo i due migliori)
    team.owner = owner('thrifty');
    const fair = marketValue(s.config, p);
    const over = payroll(s, 'NYK') + fair > s.config.luxuryTax;
    expect(botWantsRenewal(s, 'NYK', p, fair)).toBe(!over);
  });

  it('al draft il GM sceglie tra potenziale e giocatori pronti', () => {
    const s = league();
    const base = s.players.find((p) => p.teamId === null) as PlayerState;
    const raw = { ...base, id: 'grezzo', scoutedPotential: 90, ratings: { ...base.ratings } };
    const ready = {
      ...base,
      id: 'pronto',
      scoutedPotential: overall(base) + 4,
      ratings: { ...base.ratings },
    };
    for (const k of Object.keys(ready.ratings) as (keyof typeof ready.ratings)[]) ready.ratings[k] += 8;
    ready.scoutedPotential = Math.max(ready.scoutedPotential, overall(ready) + 1);
    const team = s.teams.find((t) => t.id === 'NYK')!;
    const pickWith = (draft: OwnerProfile['draft']) => {
      team.owner = owner('balanced', { draft });
      let raws = 0;
      for (let i = 0; i < 40; i++)
        if (botDraftChoice(s, 'NYK', [raw, ready], new Rng(`draft-${i}`)).id === 'grezzo') raws++;
      return raws;
    };
    expect(pickWith('potential')).toBeGreaterThan(pickWith('ready'));
  });

  it('in free agency chi risparmia spende meno spazio di chi vuole fare colpo', () => {
    const s = league();
    s.phase = 'offseason';
    const spend = (goal: OwnerGoal) => {
      for (const t of s.teams) {
        t.owner = owner(goal);
        t.balance = 50_000_000;
      }
      return botOffers(s, 0, new Rng('fa'), { fillTo: 15 }).reduce((a, o) => a + (o.salaries[0] ?? 0), 0);
    };
    expect(spend('thrifty')).toBeLessThan(spend('splash'));
  });

  it('con i proprietari i bot propongono ancora scambi agli umani', () => {
    let got = 0;
    for (const seed of ['p1', 'p2', 'p3']) {
      const s = createLeagueState(generateLeague(new Rng(seed), ARCHETYPE_PROFILES), seed, {
        humanTeams: ['BOS', 'LAL', 'NYK', 'MIA'],
        potentialOnOverallScale: true,
      });
      const rng = new Rng('proposte');
      const last = new Map<string, number>();
      for (let turn = 0; turn < 160; turn++) {
        s.turn = turn;
        for (const p of botProposals(s, rng, last, turn)) {
          last.set(p.toId, turn);
          got++;
        }
      }
    }
    expect(got).toBeGreaterThan(5);
  });
});

describe('proprietari e allenatori', () => {
  it('ognuno sceglie l’allenatore secondo il suo obiettivo e il suo budget', () => {
    const s = league();
    const team = s.teams.find((t) => t.id === 'NYK')!;
    const free = freeCoaches(s);
    const best = (goal: OwnerGoal) => {
      team.owner = owner(goal);
      return [...free].sort(
        (a, b) => (coachAppeal(s, team, b) ?? -1e9) - (coachAppeal(s, team, a) ?? -1e9),
      )[0]!;
    };
    expect(best('win-now').ratings.tactics).toBeGreaterThanOrEqual(best('patient').ratings.tactics);
    expect(best('patient').ratings.development).toBeGreaterThanOrEqual(best('win-now').ratings.development);
    team.owner = owner('thrifty');
    const dear = free.find((c) => coachAppeal(s, { ...team, owner: owner('splash') }, c) !== null);
    expect(dear).toBeDefined();
    const old = coachOf(s, 'NYK')!;
    old.teamId = null;
    const hired = hireBestCoach(s, team, null)!;
    expect(coachOf(s, 'NYK')).toBe(hired);
  });

  it('a metà stagione esonera solo chi ha poca pazienza o vuole vincere subito, se si è molto sotto le attese', () => {
    const s = league();
    for (const t of s.teams) t.owner = owner('balanced');
    const team = s.teams.find((t) => t.id === 'NYK')!;
    team.expectedWins = 60;
    // 40 partite, 8 vinte: molto sotto le attese
    for (let i = 0; i < 40; i++)
      s.games.push({
        turn: i,
        phase: 'regular',
        homeId: 'NYK',
        awayId: 'BOS',
        homeScore: i < 8 ? 110 : 90,
        awayScore: 100,
        overtimes: 0,
      });
    const coach = coachOf(s, 'NYK')!;
    coach.since = s.config.year - 1;
    expect(midseasonCoachMoves(s, new Rng('m'), 40)).toBeNull();
    team.owner = owner('win-now');
    const hired = midseasonCoachMoves(s, new Rng('m'), 40);
    expect(hired).not.toBeNull();
    expect(coachOf(s, 'NYK')).toBe(hired);
    expect(coach.teamId).toBeNull();
    // Il nuovo è appena arrivato: per questa stagione resta
    expect(midseasonCoachMoves(s, new Rng('m2'), 41)).toBeNull();
  });
});
