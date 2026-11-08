// Terza analisi, correzioni urgenti: scambi con elementi ripetuti, swap venduti su scelte che non si hanno (o a più
// squadre), anno e giro degli swap non interi, liste del draft annuale lunghissime.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { botAccepts, draftRanking, swapValue, tradeBalance, tradeGainOk } from '../src/season/bots.ts';
import {
  MAX_STANDARD,
  MAX_TWO_WAY,
  MIN_STANDARD,
  standardRoster,
  twoWayRoster,
} from '../src/season/finance.ts';
import { generatedDraftClass, runAnnualDraft, startOffseason } from '../src/season/offseason.ts';
import { deferralYears, initialPicks, resolveDraft, swapLive, swapTouches } from '../src/season/picks.ts';
import { createLeagueState, playPostseasonTurn, playRegularTurn } from '../src/season/season.ts';
import type { DraftSwap, LeagueState } from '../src/season/state.ts';
import { executeTrade, validateTrade, type Trade } from '../src/season/trades.ts';
import { TEAMS } from '../src/teams.ts';
import { quickGame } from './helpers.ts';

function league(seed = 'regole-scambi'): LeagueState {
  const data = generateLeague(new Rng(seed), ARCHETYPE_PROFILES);
  return createLeagueState(data, seed, { humanTeams: ['BOS', 'BKN'], potentialOnOverallScale: true });
}

const bots = (s: LeagueState) => s.teams.filter((t) => !t.human).map((t) => t.id);
const byOverall = (s: LeagueState, team: string) =>
  [...standardRoster(s, team)].sort((a, b) => overall(b) - overall(a));
const firstOf = (s: LeagueState, team: string, year: number) =>
  s.picks.find((k) => k.originalTeamId === team && k.round === 1 && k.draftYear === year)!;
const trade = (teamA: string, teamB: string, rest: Partial<Trade> = {}): Trade => ({
  teamA,
  teamB,
  playersA: [],
  playersB: [],
  picksA: [],
  picksB: [],
  ...rest,
});

describe('scambi con elementi ripetuti', () => {
  it('un giocatore ripetuto non conta due volte: rifiutato prima della valutazione del bot', () => {
    const s = league();
    const ranking = draftRanking(s);
    let flipped = 0;
    for (const bot of bots(s)) {
      for (const theirs of byOverall(s, bot).slice(0, 6)) {
        for (const mine of byOverall(s, 'BOS').slice(0, 8)) {
          const once = trade('BOS', bot, { playersA: [mine.id], playersB: [theirs.id] });
          const twice = { ...once, playersA: [mine.id, mine.id] };
          // Il bot che rifiuta una copia ne valutava due come due giocatori
          const one = tradeBalance(s, once, bot, ranking);
          const two = tradeBalance(s, twice, bot, ranking);
          if (tradeGainOk(one.get, one.give) || !tradeGainOk(two.get, two.give)) continue;
          flipped++;
          expect(validateTrade(s, twice)).toContain('Un giocatore compare più di una volta nello scambio');
          expect(botAccepts(s, twice, bot)).toBe(false);
        }
      }
    }
    // Il caso c'è davvero: senza il controllo questi scambi sarebbero passati
    expect(flipped).toBeGreaterThan(0);
  });

  it('con l’id ripetuto la rosa non può più finire oltre i limiti', () => {
    const s = league();
    // BOS a 14 contratti standard: cede x (scritto due volte) e riceve tre giocatori
    const [cut, x] = byOverall(s, 'BOS').slice(-2);
    if (!cut || !x) throw new Error('rosa corta');
    s.contracts = s.contracts.filter((c) => c.playerId !== cut.id);
    s.players.find((p) => p.id === cut.id)!.teamId = null;
    expect(standardRoster(s, 'BOS')).toHaveLength(14);
    const three = byOverall(s, 'LAL')
      .slice(-3)
      .map((p) => p.id);
    const t = trade('BOS', 'LAL', { playersA: [x.id, x.id], playersB: three });
    expect(validateTrade(s, t)).toContain('Un giocatore compare più di una volta nello scambio');
    // Senza la copia lo scambio porterebbe BOS a 16: rifiutato per la rosa
    expect(validateTrade(s, { ...t, playersA: [x.id] }).join(' ')).toMatch(/oltre 15 contratti standard/);
  });

  it('scelte ripetute, anche tra le due parti, e lo stesso giocatore da tutte e due le parti', () => {
    const s = league();
    const second = s.picks.find((k) => k.originalTeamId === 'BOS' && k.round === 2)!;
    const forty = trade('BOS', 'LAL', { picksA: Array.from({ length: 40 }, () => second.id) });
    expect(validateTrade(s, forty)).toEqual(['Una scelta compare più di una volta nello scambio']);
    const p = byOverall(s, 'BOS')[5]!;
    const both = trade('BOS', 'LAL', { playersA: [p.id], playersB: [p.id] });
    expect(validateTrade(s, both)).toContain('Un giocatore compare più di una volta nello scambio');
  });

  it('invarianti dopo scambi a caso: rose nei limiti, contratti unici, swap risolvibili', () => {
    const s = league('invarianti');
    const rng = new Rng('scambi a caso');
    const ids = s.teams.map((t) => t.id);
    const year = s.config.year;
    let executed = 0;
    for (let i = 0; i < 600; i++) {
      const a = rng.pick(ids);
      const b = rng.pick(ids.filter((x) => x !== a));
      const some = <T>(items: readonly T[], max: number): T[] => {
        const out = rng.shuffle(items).slice(0, rng.int(0, max));
        // A volte un elemento ripetuto
        if (out.length && rng.chance(0.25)) out.push(rng.pick(out));
        return out;
      };
      const playersOf = (team: string) => s.players.filter((p) => p.teamId === team).map((p) => p.id);
      const picksOf = (team: string) => s.picks.filter((k) => k.ownerId === team).map((k) => k.id);
      const t = trade(a, b, {
        playersA: some(playersOf(a), 2),
        playersB: some(playersOf(b), 2),
        picksA: some(picksOf(a), 2),
        picksB: some(picksOf(b), 2),
        swaps: Array.from({ length: rng.int(0, 2) }, () => {
          const holder = rng.chance(0.5) ? a : b;
          return {
            draftYear: year + rng.int(1, 4),
            round: rng.int(1, 2) as 1 | 2,
            holderId: holder,
            otherId: holder === a ? b : a,
          };
        }),
      });
      const own = t.picksA.find((id) => s.picks.find((k) => k.id === id)?.originalTeamId === a);
      if (own && rng.chance(0.5)) t.protections = { [own]: rng.int(1, 20) };
      if (validateTrade(s, t).length) continue;
      executeTrade(s, t, 1);
      executed++;

      for (const team of ids) {
        const standard = standardRoster(s, team).length;
        expect(standard).toBeGreaterThanOrEqual(MIN_STANDARD);
        expect(standard).toBeLessThanOrEqual(MAX_STANDARD);
        expect(twoWayRoster(s, team).length).toBeLessThanOrEqual(MAX_TWO_WAY);
      }
      const contracts = s.contracts.map((c) => c.playerId);
      expect(new Set(contracts).size).toBe(contracts.length);
      for (const c of s.contracts) expect(s.players.find((p) => p.id === c.playerId)?.teamId).toBe(c.teamId);
      expect(new Set(s.picks.map((k) => k.id)).size).toBe(s.picks.length);
      for (const [n, w] of s.swaps.entries()) {
        expect(swapLive(s.picks, w)).toBe(true);
        for (const team of [w.holderId, w.otherId]) {
          const others = s.swaps.filter((x, m) => m !== n && swapTouches(x, w.draftYear, w.round, team));
          expect(others).toEqual([]);
          if (w.round === 1) expect(deferralYears(s.picks, team).has(w.draftYear)).toBe(false);
        }
      }
    }
    expect(executed).toBeGreaterThan(20);
    expect(s.swaps.length).toBeGreaterThan(0);
  });
});

describe('swap e proprietà delle scelte', () => {
  it('uno swap su una scelta già ceduta non si vende, e per i bot non vale niente', () => {
    const s = league();
    const year = s.config.year + 1;
    executeTrade(s, trade('BKN', 'CHI', { picksA: [firstOf(s, 'BKN', year).id] }), 1);
    const offer = (bot: string): Trade =>
      trade('BKN', bot, {
        picksB: [firstOf(s, bot, year + 2).id],
        swaps: [{ draftYear: year, round: 1, holderId: bot, otherId: 'BKN' }],
      });
    for (const bot of bots(s).filter((b) => b !== 'CHI')) {
      expect(validateTrade(s, offer(bot))).toContain(
        `Lo swap riguarda la prima scelta ${year} di BKN, che non è più sua`,
      );
      expect(botAccepts(s, offer(bot), bot)).toBe(false);
      expect(
        swapValue(
          s,
          offer(bot).swaps![0]!,
          'rebuild',
          s.teams.map((t) => t.id),
        ),
      ).toBe(0);
    }
  });

  it('lo stesso swap non si vende a più squadre, e la scelta nello swap non si cede', () => {
    const s = league();
    const year = s.config.year + 1;
    const sell = (to: string): Trade =>
      trade('BKN', to, { swaps: [{ draftYear: year, round: 1, holderId: to, otherId: 'BKN' }] });
    expect(validateTrade(s, sell('CHI'))).toEqual([]);
    executeTrade(s, sell('CHI'), 1);
    for (const to of ['IND', 'MIL'])
      expect(validateTrade(s, sell(to))).toContain(`La prima scelta ${year} di BKN è già legata a uno swap`);
    // Due swap sulla stessa scelta nello stesso scambio, o lo stesso swap ripetuto
    const twice = trade('BOS', 'LAL', {
      swaps: [
        { draftYear: year + 1, round: 2, holderId: 'BOS', otherId: 'LAL' },
        { draftYear: year + 1, round: 2, holderId: 'LAL', otherId: 'BOS' },
      ],
    });
    expect(validateTrade(s, twice).join(' ')).toMatch(/già legata a uno swap/);
    // Finché lo swap è aperto, né BKN né CHI cedono la scelta dello swap
    expect(validateTrade(s, trade('BKN', 'IND', { picksA: [firstOf(s, 'BKN', year).id] }))).toContain(
      `La prima scelta ${year} di BKN è legata a uno swap: non si cede finché lo swap è aperto`,
    );
    expect(validateTrade(s, trade('CHI', 'IND', { picksA: [firstOf(s, 'CHI', year).id] })).join(' ')).toMatch(
      /legata a uno swap/,
    );
    // La scelta ceduta nello stesso scambio non può essere anche nello swap
    const same = trade('BOS', 'LAL', {
      picksA: [firstOf(s, 'BOS', year + 2).id],
      swaps: [{ draftYear: year + 2, round: 1, holderId: 'LAL', otherId: 'BOS' }],
    });
    expect(validateTrade(s, same)).toContain(
      `La prima scelta ${year + 2} di BOS è nello scambio: non può essere anche in uno swap`,
    );
  });

  it('niente swap su una prima scelta che il rinvio di una protetta potrebbe portare via', () => {
    const s = league();
    const year = s.config.year + 1;
    // BOS cede la prima dell'anno prossimo protetta top 10: se cade nella fascia, l'obbligo passa a quella dopo
    executeTrade(
      s,
      trade('BOS', 'LAL', {
        picksA: [firstOf(s, 'BOS', year).id],
        protections: { [firstOf(s, 'BOS', year).id]: 10 },
      }),
      1,
    );
    expect([...deferralYears(s.picks, 'BOS')]).toEqual([year + 1, year + 2, year + 3]);
    const swap = (y: number): Trade =>
      trade('BOS', 'MIA', { swaps: [{ draftYear: y, round: 1, holderId: 'MIA', otherId: 'BOS' }] });
    expect(validateTrade(s, swap(year + 1)).join(' ')).toMatch(/rinvio di una scelta protetta/);
    expect(validateTrade(s, swap(year + 4))).toEqual([]);
    // E al contrario: con uno swap aperto non si mette una protezione che potrebbe spostarne la scelta
    executeTrade(
      s,
      trade('MIA', 'ATL', { swaps: [{ draftYear: year + 1, round: 1, holderId: 'ATL', otherId: 'MIA' }] }),
      1,
    );
    const protect = trade('MIA', 'LAL', {
      picksA: [firstOf(s, 'MIA', year).id],
      protections: { [firstOf(s, 'MIA', year).id]: 5 },
    });
    expect(validateTrade(s, protect).join(' ')).toMatch(/la protezione potrebbe spostarla/);
    expect(validateTrade(s, { ...protect, protections: {} })).toEqual([]);
  });

  it('anno e giro dello swap devono essere interi', () => {
    const s = league();
    const year = s.config.year + 2;
    const swap = (w: Partial<Omit<DraftSwap, 'id'>>): Trade =>
      trade('BOS', 'LAL', { swaps: [{ draftYear: year, round: 1, holderId: 'BOS', otherId: 'LAL', ...w }] });
    expect(validateTrade(s, swap({}))).toEqual([]);
    expect(validateTrade(s, swap({ draftYear: year + 0.5 }))).toEqual([
      'Lo swap riguarda uno dei prossimi 7 draft',
    ]);
    expect(validateTrade(s, swap({ draftYear: Number.NaN }))).toEqual([
      'Lo swap riguarda uno dei prossimi 7 draft',
    ]);
    expect(validateTrade(s, swap({ round: 1.5 as 1 }))).toEqual([
      'Lo swap riguarda il primo o il secondo giro',
    ]);
  });

  it('al draft uno swap salvato prima della regola che non si può fare decade con una nota', () => {
    const ids = TEAMS.map((t) => t.id);
    const picks = initialPicks(ids, 2027);
    // ATL ha venduto lo stesso swap a BOS e a CHI, e uno su una scelta già ceduta a DAL
    picks.find((x) => x.id === '2027-1-DEN')!.ownerId = 'DAL';
    const swaps: DraftSwap[] = [
      { id: 'a', draftYear: 2027, round: 1, holderId: 'BOS', otherId: 'ATL' },
      { id: 'b', draftYear: 2027, round: 1, holderId: 'CHI', otherId: 'ATL' },
      { id: 'c', draftYear: 2027, round: 1, holderId: 'MIA', otherId: 'DEN' },
    ];
    const order = ['ATL', 'DEN', ...ids.filter((x) => x !== 'ATL' && x !== 'DEN')];
    const { slots, notes } = resolveDraft(picks, swaps, 2027, order, order);
    expect(slots[0]!.ownerId).toBe('BOS');
    expect(slots.find((x) => x.round === 1 && x.originalTeamId === 'BOS')!.ownerId).toBe('ATL');
    expect(slots.find((x) => x.round === 1 && x.originalTeamId === 'CHI')!.ownerId).toBe('CHI');
    expect(slots[1]!.ownerId).toBe('DAL');
    expect(notes).toContain('Swap 2027 tra CHI e ATL decaduto: ATL non ha più la sua prima scelta');
    expect(notes).toContain('Swap 2027 tra MIA e DEN decaduto: DEN non ha più la sua prima scelta');
    expect(swaps).toEqual([]);
  });
});

describe('draft annuale con liste lunghe', () => {
  it('una lista lunghissima dà le stesse scelte di quella ridotta ai prospetti, senza scorrerla a ogni chiamata', () => {
    const base = league('liste-lunghe');
    while (base.phase === 'regular') playRegularTurn(base, quickGame);
    while (base.phase === 'postseason') playPostseasonTurn(base, quickGame);
    startOffseason(base, generatedDraftClass(new Rng('classe'), base.config.year + 1));
    const prospects = base.players.filter((p) => p.prospect === base.offseason!.draftYear).map((p) => p.id);
    const wanted = new Rng('ordine').shuffle(prospects).slice(0, 40);
    const noise = Array.from(
      { length: 100_000 },
      (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    );
    const long = [...noise.slice(0, 50_000), ...wanted, ...wanted, ...noise.slice(50_000)];
    const run = (list: string[]) => {
      const s = JSON.parse(JSON.stringify(base)) as LeagueState;
      runAnnualDraft(
        s,
        new Map([
          ['BOS', list],
          ['BKN', [...list].reverse()],
        ]),
      );
      return s.offseason!.slots.map((x) => x.playerId);
    };
    const start = Date.now();
    const fromLong = run(long);
    expect(Date.now() - start).toBeLessThan(3000);
    const fromShort = run(wanted);
    expect(fromLong).toEqual(fromShort);
    const bosPicks = base.offseason!.slots.filter((x) => x.ownerId === 'BOS').length;
    expect(bosPicks).toBeGreaterThan(0);
  });
});

describe('draft dei giocatori', () => {
  it('il draft annuale scrive anno, giro e scelta di chi è scelto, e "non scelto" con l’anno degli altri', () => {
    const s = league('draft-giocatori');
    while (s.phase === 'regular') playRegularTurn(s, quickGame);
    while (s.phase === 'postseason') playPostseasonTurn(s, quickGame);
    startOffseason(s, generatedDraftClass(new Rng('classe'), s.config.year + 1));
    const year = s.offseason!.draftYear;
    const prospects = new Set(s.players.filter((p) => p.prospect === year).map((p) => p.id));
    const before = new Map(s.players.filter((p) => !prospects.has(p.id)).map((p) => [p.id, p.draft]));
    expect(prospects.size).toBeGreaterThan(60);
    runAnnualDraft(s, new Map());
    const byId = new Map(s.players.map((p) => [p.id, p]));
    for (const slot of s.offseason!.slots) {
      expect(byId.get(slot.playerId!)!.draft).toEqual({ year, round: slot.round, pick: slot.pick });
    }
    const chosen = new Set(s.offseason!.slots.map((x) => x.playerId));
    const left = [...prospects].filter((id) => !chosen.has(id));
    expect(left.length).toBe(prospects.size - 60);
    for (const id of left) expect(byId.get(id)!.draft).toEqual({ year, round: null, pick: null });
    // Gli altri restano come erano
    for (const [id, draft] of before) expect(byId.get(id)!.draft).toEqual(draft);
  });
});
