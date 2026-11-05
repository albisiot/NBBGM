// Dopo la Fase 13: i bot non accettano più gli scambi "furbi" (contratti pesanti regalati, swap regalati,
// scelte protette valutate come libere, infortunati valutati come sani).
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import {
  botAccepts,
  pickValue,
  playerValue,
  strengthRanking,
  tradeBalance,
  tradeGainOk,
} from '../src/season/bots.ts';
import { contractOf, standardRoster } from '../src/season/finance.ts';
import { createLeagueState } from '../src/season/season.ts';
import type { LeagueState } from '../src/season/state.ts';
import { validateTrade, type Trade } from '../src/season/trades.ts';

function league(): LeagueState {
  const data = generateLeague(new Rng('scambi-furbi'), ARCHETYPE_PROFILES);
  const s = createLeagueState(data, 'scambi-furbi', {
    humanTeams: ['BOS'],
    potentialOnOverallScale: true,
  });
  // Un posto libero in ogni rosa (le squadre generate hanno 15 contratti standard), così si può regalare
  for (const t of s.teams) {
    const worst = [...standardRoster(s, t.id)].sort((a, b) => overall(a) - overall(b))[0]!;
    s.contracts = s.contracts.filter((c) => c.playerId !== worst.id);
    worst.teamId = null;
  }
  return s;
}

const bots = (s: LeagueState) => s.teams.filter((t) => !t.human).map((t) => t.id);
const best = (s: LeagueState, team: string) =>
  [...standardRoster(s, team)].sort((a, b) => overall(b) - overall(a));

/** Bot per cui lo scambio è valido (rosa, bilancio) e quanti di loro lo accettano. */
function accepted(s: LeagueState, make: (bot: string) => Trade): { valid: number; yes: number } {
  let valid = 0;
  let yes = 0;
  for (const bot of bots(s)) {
    const t = make(bot);
    if (validateTrade(s, t).length) continue;
    valid++;
    if (botAccepts(s, t, bot)) yes++;
  }
  return { valid, yes };
}

describe('valutazione degli scambi dei bot', () => {
  it('il guadagno netto deve essere positivo, con il 10% su quanto si cede in valore assoluto', () => {
    expect(tradeGainOk(0, 0)).toBe(false);
    expect(tradeGainOk(0.5, 0)).toBe(false);
    expect(tradeGainOk(5, 0)).toBe(true);
    expect(tradeGainOk(11, 10)).toBe(true);
    expect(tradeGainOk(10.9, 10)).toBe(false);
    expect(tradeGainOk(110, 100)).toBe(true);
    expect(tradeGainOk(109, 100)).toBe(false);
    // Un contratto in perdita in cambio di un altro un po' peggiore non è un affare
    expect(tradeGainOk(-10.5, -10)).toBe(false);
    expect(tradeGainOk(-1, -5)).toBe(true);
  });

  it('un contratto pesante regalato non lo prende nessuno; un giocatore che vale lo prende qualcuno', () => {
    const s = league();
    // Un veterano mediocre con un contratto da stella: 2 anni a 50 milioni
    const vet = best(s, 'BOS').find((p) => overall(p) < 70)!;
    vet.age = 35;
    const c = contractOf(s, vet.id)!;
    c.salaries = [50_000_000, 52_500_000];
    c.options = [null, null];
    expect(playerValue(vet, c, 'contend', s.config)).toBeLessThan(0);
    const gift = (id: string) => (bot: string) => ({
      teamA: 'BOS',
      teamB: bot,
      playersA: [id],
      playersB: [],
      picksA: [],
      picksB: [],
    });
    const dump = accepted(s, gift(vet.id));
    expect(dump.valid).toBeGreaterThan(5);
    expect(dump.yes).toBe(0);
    // Un buon giocatore con un contratto onesto, regalato: qualcuno lo prende
    const good = best(s, 'BOS').find((p) => (contractOf(s, p.id)?.salaries[0] ?? 0) < 10_000_000)!;
    expect(accepted(s, gift(good.id)).yes).toBeGreaterThan(0);
  });

  it('uno swap regalato non lo accetta nessuno; ricevere il diritto vale', () => {
    const s = league();
    const year = s.config.year + 1;
    const gift = accepted(s, (bot) => ({
      teamA: 'BOS',
      teamB: bot,
      playersA: [],
      playersB: [],
      picksA: [],
      picksB: [],
      swaps: [{ draftYear: year, round: 1, holderId: 'BOS', otherId: bot }],
    }));
    expect(gift.valid).toBe(29);
    expect(gift.yes).toBe(0);
    // Per chi riceve il diritto lo swap ha valore, più alto se l'altra squadra è più debole
    const ranking = strengthRanking(s);
    const strongest = ranking[0]!;
    const weakest = ranking[29]!;
    const holderValue = (other: string) =>
      tradeBalance(
        s,
        {
          teamA: strongest,
          teamB: other,
          playersA: [],
          playersB: [],
          picksA: [],
          picksB: [],
          swaps: [{ draftYear: year, round: 1, holderId: strongest, otherId: other }],
        },
        strongest,
        ranking,
      ).get;
    expect(holderValue(weakest)).toBeGreaterThan(holderValue(ranking[1]!));
    expect(holderValue(ranking[1]!)).toBeGreaterThan(0);
  });

  it('la protezione messa nello scambio conta, e pesa di più quanto più è larga', () => {
    const s = league();
    const ranking = strengthRanking(s);
    const weakest = ranking[29]!;
    const pick = s.picks.find(
      (k) =>
        k.originalTeamId === weakest &&
        k.ownerId === weakest &&
        k.round === 1 &&
        k.draftYear === s.config.year + 1,
    )!;
    const bot = bots(s).find((b) => b !== weakest)!;
    const valueWith = (protection?: number) =>
      tradeBalance(
        s,
        {
          teamA: weakest,
          teamB: bot,
          playersA: [],
          playersB: [],
          picksA: [pick.id],
          picksB: [],
          ...(protection ? { protections: { [pick.id]: protection } } : {}),
        },
        bot,
        ranking,
      ).get;
    const free = valueWith();
    expect(free).toBeCloseTo(pickValue(s, pick, s.teams.find((t) => t.id === bot)!.strategy, ranking));
    expect(valueWith(20)).toBeLessThan(free * 0.35);
    expect(valueWith(20)).toBeLessThan(valueWith(10));
    expect(valueWith(10)).toBeLessThan(valueWith(1));
    expect(valueWith(1)).toBeGreaterThan(free * 0.5);
  });

  it('un infortunato da 60 partite vale molto meno: chi lo accettava sano ora lo rifiuta', () => {
    const s = league();
    const star = best(s, 'BOS')[0]!;
    const swapStars = (bot: string): Trade => ({
      teamA: 'BOS',
      teamB: bot,
      playersA: [star.id],
      playersB: [best(s, bot)[0]!.id],
      picksA: [],
      picksB: [],
    });
    const healthy = bots(s).filter((b) => botAccepts(s, swapStars(b), b));
    const healthyValue = playerValue(star, contractOf(s, star.id), 'middle', s.config);
    expect(healthy.length).toBeGreaterThan(0);
    star.injury = { bodyPart: 'knees', severity: 'severe', gamesRemaining: 60 };
    expect(playerValue(star, contractOf(s, star.id), 'middle', s.config)).toBeLessThan(healthyValue * 0.5);
    const injured = bots(s).filter((b) => botAccepts(s, swapStars(b), b));
    expect(injured.length).toBeLessThan(healthy.length);
    for (const b of injured) expect(healthy).toContain(b);
  });
});
