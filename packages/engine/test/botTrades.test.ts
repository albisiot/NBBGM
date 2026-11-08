// Dopo la Fase 13: i bot non accettano più gli scambi "furbi" (contratti pesanti regalati, swap regalati,
// scelte protette valutate come libere, infortunati valutati come sani). Seconda analisi: un infortunio toglie solo
// la stagione che il giocatore salta, il valore delle scelte non cambia con un infortunio breve, la tassa conta
// per la stagione giusta e chi è in corsa non smonta la squadra per risparmiarla.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import {
  botAccepts,
  CONTEND_TAX_SAVING_SHARE,
  draftRanking,
  injurySeasons,
  pickValue,
  playerTalent,
  playerValue,
  strengthRanking,
  taxSeason,
  tradeBalance,
  tradeGainOk,
} from '../src/season/bots.ts';
import { contractOf, payroll, standardRoster } from '../src/season/finance.ts';
import { createLeagueState, playRegularTurn } from '../src/season/season.ts';
import type { LeagueState } from '../src/season/state.ts';
import { validateTrade, type Trade } from '../src/season/trades.ts';
import { gamesAfterOffseason } from '../src/season/turn.ts';
import { quickGame } from './helpers.ts';

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

  it('una prima scelta con la protezione quasi certa vale come la seconda scelta che diventa', () => {
    const s = league();
    const ranking = draftRanking(s);
    const pick = (team: string, round: 1 | 2, year: number) =>
      s.picks.find((k) => k.originalTeamId === team && k.round === round && k.draftYear === year)!;
    const next = s.config.year + 1;
    for (const strategy of ['rebuild', 'middle', 'contend'] as const) {
      // La più debole al prossimo draft, protetta top 20: ci cade di sicuro, e dopo tre rinvii è una seconda scelta
      // di tre anni dopo, che vale un po' meno della seconda scelta di quest'anno
      const worst = ranking[29]!;
      const secondNow = pickValue(s, pick(worst, 2, next), strategy, ranking);
      const sure = pickValue(s, pick(worst, 1, next), strategy, ranking, 20);
      expect(sure).toBeLessThan(secondNow);
      expect(sure).toBeGreaterThan(secondNow * 0.9 ** 3 * 0.95);
      // La diciannovesima (scelta attesa intorno alla 12) nel draft dopo, protetta top 20: ci cade circa 4 volte
      // su 5, quindi vale vicino alla seconda scelta, non a un terzo della prima (prima era 6,5 contro 1,9 per chi
      // ricostruisce)
      const team = ranking[18]!;
      const second = pickValue(s, pick(team, 2, next + 1), strategy, ranking);
      const free = pickValue(s, pick(team, 1, next + 1), strategy, ranking);
      const protected20 = pickValue(s, pick(team, 1, next + 1), strategy, ranking, 20);
      expect(protected20).toBeLessThan(free * 0.3);
      expect(protected20).toBeLessThan(second * 2.2);
      expect(protected20).toBeGreaterThan(second);
    }
    // Chi è già stata rinviata ha meno rinvii davanti: diventa prima una seconda scelta, che vale di più
    const first = pick(ranking[29]!, 1, next + 1);
    expect(pickValue(s, { ...first, deferrals: 2 }, 'middle', ranking, 20)).toBeGreaterThan(
      pickValue(s, { ...first, deferrals: 0 }, 'middle', ranking, 20),
    );
  });

  it('un infortunato da 60 partite vale meno: chi lo accettava sano ora lo rifiuta', () => {
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
    // A inizio stagione salta 60 partite su 82: perde quella parte di una stagione, un terzo del talento al più
    const injuredValue = playerValue(star, contractOf(s, star.id), 'middle', s.config, s);
    expect(injuredValue).toBeLessThan(healthyValue * 0.85);
    expect(injuredValue).toBeGreaterThan(healthyValue * 0.6);
    const injured = bots(s).filter((b) => botAccepts(s, swapStars(b), b));
    expect(injured.length).toBeLessThan(healthy.length);
    for (const b of injured) expect(healthy).toContain(b);
  });
});

describe('infortunati: si toglie solo la stagione che saltano (seconda analisi)', () => {
  it('stagioni saltate: le partite che restano, poi la guarigione in offseason', () => {
    expect(gamesAfterOffseason(30)).toBe(0);
    expect(gamesAfterOffseason(31)).toBe(11);
    // Calendario di prova: 164 giorni con 7 o 8 partite (1.230 in tutto)
    const schedule = Array.from({ length: 1230 }, (_, i) => ({
      turn: Math.floor(i / 7.5),
      day: Math.floor(i / 7.5),
      homeId: 'A',
      awayId: 'B',
    }));
    const at = (turn: number) => ({ phase: 'regular' as const, turn, schedule });
    // A inizio stagione: 60 partite su 82 (anche senza calendario)
    expect(injurySeasons(60, { phase: 'regular', turn: 0, schedule: [] })).toBeCloseTo(60 / 82);
    expect(injurySeasons(60, at(0))).toBeCloseTo(60 / 82);
    // Al turno 100 su 164 ne restano 32: le salta tutte, le altre 28 le recupera in offseason
    expect(injurySeasons(60, at(100))).toBeCloseTo(1);
    // Con 70 ne restano 38 dopo la regular season: in offseason ne recupera 20, ne salta 18 della prossima
    expect(injurySeasons(70, at(100))).toBeCloseTo(1 + 18 / 82);
    expect(injurySeasons(3, at(100))).toBeCloseTo(3 / 32);
    // Dopo la regular season conta solo la prossima, dopo la guarigione; in offseason la guarigione c'è già stata
    expect(injurySeasons(25, { phase: 'postseason', turn: 164, schedule })).toBe(0);
    expect(injurySeasons(40, { phase: 'postseason', turn: 164, schedule })).toBeCloseTo(20 / 82);
    expect(injurySeasons(10, { phase: 'offseason', turn: 164, schedule })).toBeCloseTo(10 / 82);
    expect(injurySeasons(0, at(0))).toBe(0);
  });

  it('una stella ferma fino a fine stagione non si cede per un giocatore qualsiasi', () => {
    const s = league();
    s.turn = 50;
    const modest = [...standardRoster(s, 'BOS')]
      .filter((p) => overall(p) >= 50 && overall(p) <= 67)
      .sort((a, b) => overall(a) - overall(b))[0]!;
    const yes: string[] = [];
    let valid = 0;
    for (const bot of bots(s)) {
      const star = best(s, bot)[0]!;
      const talent = playerTalent(star, 'middle', s);
      star.injury = { bodyPart: 'knees', severity: 'severe', gamesRemaining: 60 };
      // Salta le partite che restano, il resto lo recupera in offseason: perde un anno di valore su tre
      expect(playerTalent(star, 'middle', s)).toBeCloseTo((talent * 2) / 3);
      const t: Trade = {
        teamA: 'BOS',
        teamB: bot,
        playersA: [modest.id],
        playersB: [star.id],
        picksA: [],
        picksB: [],
      };
      if (validateTrade(s, t).length === 0) {
        valid++;
        if (botAccepts(s, t, bot)) yes.push(bot);
      }
      star.injury = null;
    }
    expect(valid).toBeGreaterThan(20);
    expect(yes).toEqual([]);
  });
});

describe('valore delle scelte: classifica attesa (seconda analisi)', () => {
  function played(turns: number): LeagueState {
    const s = league();
    for (let i = 0; i < turns; i++) playRegularTurn(s, quickGame);
    for (const p of s.players) p.injury = null;
    return s;
  }
  const firstPick = (s: LeagueState, team: string) =>
    s.picks.find((k) => k.originalTeamId === team && k.round === 1 && k.draftYear === s.config.year + 1)!;

  it('un infortunio breve dei migliori non sposta il valore delle scelte', () => {
    const s = played(10);
    for (const team of s.teams) {
      const pick = firstPick(s, team.id);
      const before = pickValue(s, pick, 'middle', draftRanking(s));
      for (const p of best(s, team.id).slice(0, 2))
        p.injury = { bodyPart: 'ankles', severity: 'light', gamesRemaining: 2 };
      const after = pickValue(s, pick, 'middle', draftRanking(s));
      for (const p of best(s, team.id).slice(0, 2)) p.injury = null;
      expect(Math.abs(after - before)).toBeLessThan(0.5);
    }
  });

  it('un infortunio lungo del migliore peggiora la classifica attesa', () => {
    const s = played(10);
    const team = draftRanking(s)[5]!;
    best(s, team)[0]!.injury = { bodyPart: 'knees', severity: 'severe', gamesRemaining: 60 };
    expect(draftRanking(s).indexOf(team)).toBeGreaterThan(5);
  });

  it('a fine regular season conta il record', () => {
    const s = league();
    while (s.phase === 'regular') playRegularTurn(s, quickGame);
    const wins = new Map(s.teams.map((t) => [t.id, 0]));
    for (const g of s.games.filter((x) => x.phase === 'regular')) {
      const w = g.homeScore > g.awayScore ? g.homeId : g.awayId;
      wins.set(w, wins.get(w)! + 1);
    }
    const order = draftRanking(s).map((id) => wins.get(id)!);
    for (let i = 1; i < order.length; i++) expect(order[i]!).toBeLessThanOrEqual(order[i - 1]!);
  });
});

describe('luxury tax negli scambi dei bot (seconda analisi)', () => {
  /** Il bot passa la tassa di 25 milioni in questa stagione con un contratto pesante in scadenza. */
  function overTax(s: LeagueState, team: string): void {
    const filler = [...standardRoster(s, team)].sort((a, b) => overall(a) - overall(b))[0]!;
    const c = contractOf(s, filler.id)!;
    c.salaries = [c.salaries[0]! + s.config.luxuryTax + 25_000_000 - payroll(s, team)];
    c.options = [null];
  }

  it('nel turno del draft conta la tassa della stagione che arriva, non quella già pagata', () => {
    const s = league();
    const bot = bots(s)[0]!;
    overTax(s, bot);
    // Un buon giocatore con un contratto di più anni, regalato a BOS
    const good = best(s, bot).find((p) => (contractOf(s, p.id)?.salaries.length ?? 0) >= 2)!;
    const gift: Trade = {
      teamA: bot,
      teamB: 'BOS',
      playersA: [good.id],
      playersB: [],
      picksA: [],
      picksB: [],
    };
    // In stagione il risparmio sulla tassa c'è davvero
    expect(taxSeason(s).season).toBe(0);
    expect(tradeBalance(s, gift, bot).get).toBeGreaterThan(5);
    // Turno del draft: contratti non ancora scalati, la tassa di questa stagione è già pagata
    s.phase = 'offseason';
    s.offseason = { draftYear: s.config.year + 1, lottery: [], slots: [] };
    expect(taxSeason(s).season).toBe(1);
    expect(taxSeason(s).config.year).toBe(s.config.year + 1);
    expect(payroll(s, bot, 1)).toBeLessThan(taxSeason(s).config.luxuryTax);
    expect(tradeBalance(s, gift, bot).get).toBe(0);
    // Dopo che i contratti sono scalati si torna alla stagione corrente
    s.config = { ...s.config, year: s.config.year + 1 };
    expect(taxSeason(s).season).toBe(0);
  });

  it('chi è in corsa non cede un titolare per due ragazzi solo per la tassa', () => {
    const s = league();
    const bot = 'PHI';
    const team = s.teams.find((t) => t.id === bot)!;
    expect(team.human).toBe(false);
    team.strategy = 'contend';
    // Ben oltre la tassa con lo stipendio residuo di un tagliato
    s.deadMoney.push({
      teamId: bot,
      playerName: 'Tagliato',
      salaries: [s.config.luxuryTax + 30_000_000 - payroll(s, bot)],
    });
    // Il titolare con lo stipendio più alto, per due giocatori da 52-62 che costano poco
    const salary = (id: string) => contractOf(s, id)?.salaries[0] ?? 0;
    const starter = best(s, bot)
      .slice(0, 5)
      .sort((a, b) => salary(b.id) - salary(a.id))[0]!;
    const kids = [...standardRoster(s, 'BOS')]
      .filter((p) => overall(p) >= 52 && overall(p) <= 62)
      .sort((a, b) => salary(a.id) - salary(b.id))
      .slice(0, 2);
    expect(kids).toHaveLength(2);
    const t: Trade = {
      teamA: bot,
      teamB: 'BOS',
      playersA: [starter.id],
      playersB: kids.map((k) => k.id),
      picksA: [],
      picksB: [],
    };
    const kidsValue = (strategy: 'contend' | 'middle') =>
      kids.reduce((a, k) => a + playerValue(k, contractOf(s, k.id), strategy, s.config, s), 0);
    const talent = playerTalent(starter, 'contend', s);
    // Il risparmio conta al massimo per un quarto del talento ceduto
    expect(tradeBalance(s, t, bot).get - kidsValue('contend')).toBeCloseTo(CONTEND_TAX_SAVING_SHARE * talent);
    expect(botAccepts(s, t, bot)).toBe(false);
    // A metà strada lo stesso risparmio conta intero
    team.strategy = 'middle';
    expect(tradeBalance(s, t, bot).get - kidsValue('middle')).toBeGreaterThan(
      CONTEND_TAX_SAVING_SHARE * talent,
    );
  });
});
