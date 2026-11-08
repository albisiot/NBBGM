// Offseason nuova: draft dal vivo a tappe, opzioni della squadra e del giocatore, rinnovi con trattativa, RFA con
// offerta di qualifica e pareggio, free agency in 15 turni (5 di sole offerte), preparazione senza correzioni.
import { beforeAll, describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { overall } from '../src/overall.ts';
import { Rng } from '../src/rng.ts';
import { maxSalaryFor, minimumSalaryFor } from '../src/season/config.ts';
import {
  canSign,
  contractOf,
  marketValue,
  MAX_STANDARD,
  payroll,
  roster,
  standardRoster,
} from '../src/season/finance.ts';
import {
  askFactor,
  askingSalary,
  FA_MORATORIUM_ROUNDS,
  FREE_AGENCY_ROUNDS,
  offerStandings,
  resolveOffers,
  resolveOfferSheets,
  signQualifyingOffers,
} from '../src/season/freeAgency.ts';
import { runMarket, type MarketRequests } from '../src/season/market.ts';
import {
  advanceDraft,
  closeOptions,
  closeRenewals,
  draftOnClock,
  expiringPlayers,
  freeAgencyRoundOf,
  generatedDraftClass,
  isExpiring,
  nextStage,
  OFFSEASON_STAGES,
  pendingTeamOptions,
  playerOptsOut,
  qualifyingOfferFor,
  rosterIssues,
  runAnnualDraft,
  scaleContracts,
  startNewSeason,
  startOffseason,
  unhappyPlayer,
  worstFirstOf,
} from '../src/season/offseason.ts';
import {
  askTerms,
  LOWBALL_SHARE,
  offerWorth,
  RENEWAL_ATTEMPTS,
  renewalFloorShare,
  renewalReply,
  termsContract,
  type RenewalTalk,
} from '../src/season/renewals.ts';
import { createLeagueState, playPostseasonTurn, playRegularTurn } from '../src/season/season.ts';
import type { LeagueState, PlayerState } from '../src/season/state.ts';
import { quickGame } from './helpers.ts';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Lega con BOS e LAL umane, giocata fino alla fine della finale, con la classe del draft. */
let afterFinals: LeagueState;
beforeAll(() => {
  const data = generateLeague(new Rng('offseason-nuova'), ARCHETYPE_PROFILES);
  const s = createLeagueState(data, 'offseason-nuova', {
    humanTeams: ['BOS', 'LAL'],
    potentialOnOverallScale: true,
    staff: false,
  });
  while (s.phase === 'regular') playRegularTurn(s, quickGame);
  while (s.phase === 'postseason') playPostseasonTurn(s, quickGame);
  startOffseason(s, generatedDraftClass(new Rng('classe'), s.config.year + 1));
  afterFinals = s;
});

/** Stato dopo il draft e i contratti scalati, pronto per opzioni e rinnovi. */
function afterDraft(): LeagueState {
  const s = clone(afterFinals);
  runAnnualDraft(s, new Map());
  scaleContracts(s);
  return s;
}

const empty = (): MarketRequests => ({ trades: [], releases: [], renewals: [], bids: [] });

/** Spazio sotto il cap e saldo positivo per le squadre date. */
function room(s: LeagueState, teams: string[]): void {
  for (const t of teams) {
    for (const c of s.contracts.filter((x) => x.teamId === t))
      if (c.salaries.length) c.salaries[0] = 5_000_000;
    s.teams.find((x) => x.id === t)!.balance = 50_000_000;
  }
}

/** Uno svincolato di livello medio: la sua richiesta più il 40% resta sotto il massimo. */
function midFreeAgent(s: LeagueState): PlayerState {
  return s.players
    .filter(
      (p) =>
        p.teamId === null &&
        p.injury === null &&
        p.age < 33 &&
        marketValue(s.config, p) > 8_000_000 &&
        askingSalary(s, p, 0) * 1.4 < maxSalaryFor(s.config, p.yearsInLeague),
    )
    .sort((a, b) => overall(b) - overall(a))[0] as PlayerState;
}

describe('turni dell’offseason', () => {
  it('draft, opzioni, rinnovi, 15 turni di free agency e preparazione', () => {
    expect(OFFSEASON_STAGES.length).toBe(19);
    expect(nextStage('draft')).toBe('options');
    expect(nextStage('options')).toBe('renewals');
    expect(nextStage('renewals')).toBe('fa1');
    expect(nextStage('fa9')).toBe('fa10');
    expect(nextStage('fa15')).toBe('preparation');
    expect(nextStage('preparation')).toBeNull();
    expect(freeAgencyRoundOf('fa1')).toBe(0);
    expect(freeAgencyRoundOf('fa15')).toBe(14);
    expect(freeAgencyRoundOf('fa16')).toBeNull();
    expect(freeAgencyRoundOf('renewals')).toBeNull();
  });
});

describe('draft dal vivo', () => {
  it('i bot scelgono fino alla prima chiamata di un manager, che resta da fare', () => {
    const s = clone(afterFinals);
    const slot = advanceDraft(s);
    expect(slot).not.toBeNull();
    expect(['BOS', 'LAL']).toContain(slot!.ownerId);
    const before = s.offseason!.slots.filter((x) => x.pick < slot!.pick);
    expect(before.every((x) => x.playerId !== null)).toBe(true);
    expect(s.offseason!.slots.filter((x) => x.pick >= slot!.pick).every((x) => x.playerId === null)).toBe(
      true,
    );
    // Chiamarla di nuovo senza la chiamata del manager non sceglie nulla
    expect(advanceDraft(s)?.pick).toBe(slot!.pick);
  });

  it('la scelta del manager va alla sua squadra, poi si va alla prossima chiamata di un manager', () => {
    const s = clone(afterFinals);
    const slot = advanceDraft(s)!;
    const year = s.offseason!.draftYear;
    const worst = s.players
      .filter((p) => p.prospect === year)
      .sort((a, b) => overall(a) - overall(b))[0] as PlayerState;
    const next = advanceDraft(s, { onClock: { choice: worst.id } });
    expect(s.offseason!.slots.find((x) => x.pick === slot.pick)!.playerId).toBe(worst.id);
    expect(worst.teamId).toBe(slot.ownerId);
    expect(contractOf(s, worst.id)!.type).toBe('rookie');
    if (next) {
      expect(['BOS', 'LAL']).toContain(next.ownerId);
      expect(next.pick).toBeGreaterThan(slot.pick);
    }
  });

  it('una scelta non valida passa alla lista o alla logica del bot', () => {
    const s = clone(afterFinals);
    const slot = advanceDraft(s)!;
    advanceDraft(s, { onClock: { choice: 'non-esiste' } });
    expect(s.offseason!.slots.find((x) => x.pick === slot.pick)!.playerId).not.toBeNull();
  });

  it('a tappe senza scelte dei manager è lo stesso draft fatto tutto di fila', () => {
    const steps = clone(afterFinals);
    let slot = advanceDraft(steps);
    let guard = 0;
    while (slot && guard++ < 70) slot = advanceDraft(steps, { onClock: { choice: null } });
    expect(slot).toBeNull();
    const all = clone(afterFinals);
    runAnnualDraft(all, new Map());
    expect(steps.offseason!.slots.map((x) => x.playerId)).toEqual(
      all.offseason!.slots.map((x) => x.playerId),
    );
    // A draft finito i non scelti sono svincolati
    expect(steps.players.some((p) => p.prospect === steps.offseason!.draftYear)).toBe(false);
    expect(draftOnClock(steps)).toBeNull();
  });

  it('una squadra affidata all’allenatore non ferma il draft', () => {
    const s = clone(afterFinals);
    for (const t of s.teams) if (t.human) t.coach = true;
    expect(advanceDraft(s)).toBeNull();
    expect(s.offseason!.slots.every((x) => x.playerId !== null)).toBe(true);
  });
});

describe('opzioni', () => {
  it('le opzioni della squadra dei manager restano da decidere; senza risposta decadono', () => {
    const s = clone(afterFinals);
    // Un'opzione della squadra sulla prossima stagione per un giocatore di BOS e uno di un bot
    const bos = standardRoster(s, 'BOS').find((p) => (contractOf(s, p.id)?.salaries.length ?? 0) >= 3)!;
    const bot = standardRoster(s, 'NYK').find((p) => (contractOf(s, p.id)?.salaries.length ?? 0) >= 3)!;
    for (const p of [bos, bot]) contractOf(s, p.id)!.options = [null, 'team', null];
    runAnnualDraft(s, new Map());
    scaleContracts(s);
    const pending = pendingTeamOptions(s);
    expect(pending.map((c) => c.playerId)).toContain(bos.id);
    expect(pending.map((c) => c.playerId)).not.toContain(bot.id);
    expect(pendingTeamOptions(s, 'BOS')[0]!.lastSalary).toBeGreaterThan(0);
    const out = closeOptions(s, new Map());
    expect(out.declined).toContain(bos.id);
    expect(isExpiring(s, bos.id)).toBe(true);
    expect(pendingTeamOptions(s)).toEqual([]);
  });

  it('il manager esercita l’opzione: il contratto resta', () => {
    const s = clone(afterFinals);
    const bos = standardRoster(s, 'BOS').find((p) => (contractOf(s, p.id)?.salaries.length ?? 0) >= 3)!;
    contractOf(s, bos.id)!.options = [null, 'team', null];
    runAnnualDraft(s, new Map());
    scaleContracts(s);
    const salary = contractOf(s, bos.id)!.salaries[0];
    closeOptions(s, new Map([[bos.id, 'exercise']]));
    const c = contractOf(s, bos.id)!;
    expect(c.salaries[0]).toBe(salary);
    expect(c.options[0]).toBeNull();
    expect(c.lastSalary).toBeUndefined();
  });

  it('opzione del giocatore: esce se vale più del 120% e non si trova bene, o se vale più del 150%', () => {
    const s = afterDraft();
    const p = clone(standardRoster(s, 'NYK').sort((a, b) => overall(b) - overall(a))[0]!);
    const value = marketValue(s.config, p);
    p.morale = 70;
    p.stats = { ...p.stats, g: 70, av: 70, seconds: 70 * 30 * 60 };
    expect(unhappyPlayer(p)).toBe(false);
    expect(playerOptsOut(s.config, p, value / 1.3)).toBe(false);
    expect(playerOptsOut(s.config, p, value / 1.6)).toBe(true);
    expect(playerOptsOut(s.config, p, value / 1.1)).toBe(false);
    // Morale basso
    p.morale = 45;
    expect(playerOptsOut(s.config, p, value / 1.3)).toBe(true);
    expect(playerOptsOut(s.config, p, value / 1.1)).toBe(false);
    // Contento ma gioca poco quando potrebbe
    p.morale = 70;
    p.stats = { ...p.stats, g: 40, av: 70, seconds: 40 * 20 * 60 };
    expect(unhappyPlayer(p)).toBe(true);
    expect(playerOptsOut(s.config, p, value / 1.3)).toBe(true);
    // Infortunato quasi tutta la stagione: contano solo le partite a disposizione
    p.stats = { ...p.stats, g: 8, av: 8, seconds: 8 * 30 * 60 };
    expect(unhappyPlayer(p)).toBe(false);
  });
});

describe('trattativa dei rinnovi', () => {
  const ask = askTerms([20_000_000, 21_000_000, 22_050_000]);
  const limits = { min: 1_500_000, max: 50_000_000, minMorale: 30 };
  const player = (morale: number, character: number) =>
    ({ morale, hidden: { character } }) as unknown as PlayerState;
  const start: RenewalTalk = { refusals: 0, counter: null };

  it('la soglia nascosta sta tra l’85 e il 100% della richiesta', () => {
    expect(renewalFloorShare(player(50, 0))).toBe(1);
    expect(renewalFloorShare(player(100, 100))).toBeCloseTo(0.85);
    expect(renewalFloorShare(player(30, 50))).toBeCloseTo(0.975);
  });

  it('la richiesta si accetta sempre; sotto la soglia arriva una controproposta che poi si accetta', () => {
    const p = player(80, 60);
    expect(renewalReply(ask, p, ask, start, limits)).toEqual({ kind: 'accept' });
    const reply = renewalReply(ask, p, { ...ask, salary: 15_000_000 }, start, limits);
    expect(reply.kind).toBe('counter');
    if (reply.kind !== 'counter') return;
    expect(reply.attemptsLeft).toBe(RENEWAL_ATTEMPTS - 1);
    expect(reply.lowball).toBe(true);
    expect(reply.counter.salary % 500_000).toBe(0);
    expect(reply.counter.salary).toBeLessThanOrEqual(ask.salary);
    expect(renewalReply(ask, p, reply.counter, { refusals: 1, counter: reply.counter }, limits).kind).toBe(
      'accept',
    );
  });

  it('dopo 3 rifiuti resta solo l’ultima controproposta', () => {
    const p = player(60, 20);
    let talk: RenewalTalk = start;
    let last = null;
    for (let i = 0; i < RENEWAL_ATTEMPTS; i++) {
      last = renewalReply(ask, p, { ...ask, salary: 17_000_000 + i * 100_000 }, talk, limits);
      if (last.kind !== 'counter' && last.kind !== 'final') throw new Error(last.kind);
      talk = { refusals: talk.refusals + 1, counter: last.counter };
    }
    expect(last!.kind).toBe('final');
    // Anche un'offerta che prima avrebbe accettato ora non basta, se vale meno della controproposta
    const below = renewalReply(
      ask,
      p,
      { ...talk.counter!, salary: talk.counter!.salary - 1_000_000 },
      talk,
      limits,
    );
    expect(below.kind).toBe('final');
    expect(renewalReply(ask, p, talk.counter!, talk, limits).kind).toBe('accept');
  });

  it('anni diversi valgono meno, l’opzione del giocatore di più, quella della squadra di meno', () => {
    const base = offerWorth(ask, 3);
    expect(offerWorth({ ...ask, years: 5 }, 3)).toBeLessThan(base);
    expect(offerWorth({ ...ask, option: 'player' }, 3)).toBeGreaterThan(base);
    expect(offerWorth({ ...ask, option: 'team' }, 3)).toBeLessThan(base);
    expect(renewalReply(ask, player(20, 50), ask, start, limits).kind).toBe('refuse');
    expect(LOWBALL_SHARE).toBe(0.8);
    expect(termsContract({ salary: 10_000_000, years: 3, option: 'player' }).options).toEqual([
      null,
      null,
      'player',
    ]);
  });
});

describe('RFA e offerta di qualifica', () => {
  /** Un RFA di BOS (contratto da rookie o al più 3 anni nella lega) appena scaduto. */
  function withRfa(): { s: LeagueState; p: PlayerState } {
    const s = afterDraft();
    closeOptions(s, new Map());
    const p = standardRoster(s, 'BOS').sort((a, b) => overall(b) - overall(a))[3]!;
    const c = contractOf(s, p.id)!;
    c.type = 'rookie';
    c.salaries = [];
    c.options = [];
    c.lastSalary = 4_000_000;
    p.morale = 70;
    return { s, p };
  }

  it('la qualifica tiene l’RFA legato alla squadra e pesa sul suo monte stipendi', () => {
    const { s, p } = withRfa();
    const before = payroll(s, 'BOS');
    const out = closeRenewals(s, new Map(), new Set([p.id]));
    expect(out.restricted).toContain(p.id);
    expect(p.teamId).toBeNull();
    const qo = qualifyingOfferFor(s.config, p, 4_000_000);
    expect(qo).toBe(Math.max(5_000_000, minimumSalaryFor(s.config, p.yearsInLeague)));
    expect(s.restricted).toEqual([{ playerId: p.id, teamId: 'BOS', qualifyingOffer: qo }]);
    expect(payroll(s, 'BOS')).toBe(before + qo);
    // Senza qualifica è un UFA come gli altri
    const other = withRfa();
    closeRenewals(other.s, new Map());
    expect(other.s.restricted ?? []).toEqual([]);
  });

  it('se sceglie un’altra squadra, il manager con i diritti pareggia nel turno dopo', () => {
    for (const match of [true, false]) {
      const { s, p } = withRfa();
      closeRenewals(s, new Map(), new Set([p.id]));
      const salary = Math.min(maxSalaryFor(s.config, p.yearsInLeague), marketValue(s.config, p) * 1.4);
      const offer = {
        teamId: 'NYK',
        playerId: p.id,
        salaries: [Math.round(salary), Math.round(salary * 1.05)],
      };
      room(s, ['NYK']);
      resolveOffers(s, [offer], FA_MORATORIUM_ROUNDS, worstFirstOf(s), null);
      expect(p.teamId).toBeNull();
      expect(s.offerSheets).toEqual([
        { playerId: p.id, teamId: 'NYK', rightsTeamId: 'BOS', salaries: offer.salaries },
      ]);
      const out = resolveOfferSheets(s, new Map([[p.id, match]]), null);
      expect(out[0]!.outcome).toBe(match ? 'matched' : 'left');
      expect(p.teamId).toBe(match ? 'BOS' : 'NYK');
      expect(contractOf(s, p.id)!.salaries).toEqual(offer.salaries);
      expect(s.restricted ?? []).toEqual([]);
    }
  });

  it('a fine free agency chi non ha firmato firma la qualifica; la sua squadra lo rifirma anche oltre la tassa', () => {
    const { s, p } = withRfa();
    closeRenewals(s, new Map(), new Set([p.id]));
    const qo = s.restricted![0]!.qualifyingOffer;
    for (const c of s.contracts.filter((x) => x.teamId === 'BOS')) c.salaries[0] = 20_000_000;
    expect(payroll(s, 'BOS')).toBeGreaterThan(s.config.luxuryTax);
    expect(canSign(s, 'BOS', p, 15_000_000).ok).toBe(true);
    expect(canSign(s, 'NYK', p, minimumSalaryFor(s.config, p.yearsInLeague)).ok).toBe(true);
    signQualifyingOffers(s, null);
    expect(p.teamId).toBe('BOS');
    expect(contractOf(s, p.id)!.salaries).toEqual([qo]);
  });
});

describe('free agency in 15 turni', () => {
  it('richieste piene fino al 6° turno, poi giù fino al 64% al 15°', () => {
    expect(FREE_AGENCY_ROUNDS).toBe(15);
    for (let r = 0; r <= FA_MORATORIUM_ROUNDS; r++) expect(askFactor(r)).toBe(1);
    expect(askFactor(14)).toBeCloseTo(0.64);
    for (let r = 1; r < 15; r++) expect(askFactor(r)).toBeLessThanOrEqual(askFactor(r - 1));
  });

  /** Stato all'inizio della free agency: draft, opzioni e rinnovi fatti. */
  function freeAgency(): LeagueState {
    const s = afterDraft();
    closeOptions(s, new Map());
    closeRenewals(s, new Map());
    return s;
  }

  it('nei primi 5 turni nessuno firma; le offerte restano e il giocatore dice come stanno', () => {
    const s = freeAgency();
    const free = midFreeAgent(s);
    room(s, ['BOS', 'LAL']);
    const ask = askingSalary(s, free, 0);
    const req = empty();
    req.bids = [
      { id: 'b1', teamId: 'BOS', playerId: free.id, salaries: [ask, ask] },
      {
        id: 'b2',
        teamId: 'LAL',
        playerId: free.id,
        salaries: [Math.round(ask * 1.3), Math.round(ask * 1.3)],
      },
    ];
    const out = runMarket(s, req, null, { askRound: 0, keepBids: true });
    expect(free.teamId).toBeNull();
    expect(out.bids.map((b) => b.status)).toEqual(['pending', 'pending']);
    const notes = out.notes.map((n) => `${n.teamId}: ${n.text}`);
    expect(notes.find((n) => n.startsWith('BOS'))).toMatch(/ha ricevuto offerte migliori/);
    expect(notes.find((n) => n.startsWith('LAL'))).toMatch(/la migliore/);
    // Al 6° turno firma con l'offerta migliore
    const sixth = runMarket(s, req, null, { askRound: FA_MORATORIUM_ROUNDS, keepBids: true });
    expect(free.teamId).toBe('LAL');
    expect(sixth.bids.map((b) => b.status)).toEqual(['lost', 'won']);
  });

  it('un’offerta sotto la richiesta resta sul tavolo e firma quando la richiesta scende', () => {
    const s = freeAgency();
    const free = midFreeAgent(s);
    room(s, ['BOS']);
    const low = Math.round(askingSalary(s, free, 14) * 1.01);
    const req = empty();
    req.bids = [{ id: 'b1', teamId: 'BOS', playerId: free.id, salaries: [low] }];
    let round = FA_MORATORIUM_ROUNDS;
    for (; round < FREE_AGENCY_ROUNDS && free.teamId === null; round++) {
      const out = runMarket(s, req, null, { askRound: round, keepBids: round < FREE_AGENCY_ROUNDS - 1 });
      if (free.teamId === null) {
        expect(out.bids[0]!.status).toBe('pending');
        expect(out.notes[0]!.text).toMatch(/sotto la sua richiesta/);
      }
    }
    expect(free.teamId).toBe('BOS');
    expect(askingSalary(s, free, round - 1)).toBeLessThanOrEqual(low);
  });

  it('come stanno le offerte: la migliore, dietro, sotto la richiesta', () => {
    const s = freeAgency();
    const free = midFreeAgent(s);
    room(s, ['BOS', 'LAL', 'NYK']);
    const ask = askingSalary(s, free, 0);
    const standings = offerStandings(
      s,
      [
        { teamId: 'BOS', playerId: free.id, salaries: [ask] },
        { teamId: 'LAL', playerId: free.id, salaries: [ask * 1.4] },
        { teamId: 'NYK', playerId: free.id, salaries: [Math.round(ask * 0.5)] },
      ],
      0,
      worstFirstOf(s),
    );
    expect(standings[0]).toBe('behind');
    expect(standings[1]).toBe('best');
    expect(standings[2]).toBe('below');
  });
});

describe('preparazione', () => {
  it('dice quanti giocatori tagliare o firmare; a inizio stagione il server corregge quello che resta', () => {
    const s = afterDraft();
    closeOptions(s, new Map());
    closeRenewals(s, new Map());
    // BOS a 17 contratti standard, LAL a 11
    const free = s.players.filter((p) => p.teamId === null && p.injury === null).slice(0, 10);
    let i = 0;
    while (standardRoster(s, 'BOS').length < MAX_STANDARD + 2) {
      const p = free[i++]!;
      p.teamId = 'BOS';
      s.contracts.push({
        playerId: p.id,
        teamId: 'BOS',
        type: 'standard',
        salaries: [1_500_000],
        options: [null],
        guaranteed: null,
      });
    }
    while (standardRoster(s, 'LAL').length > 11) {
      const p = standardRoster(s, 'LAL')[0]!;
      s.contracts = s.contracts.filter((c) => c.playerId !== p.id);
      p.teamId = null;
    }
    expect(rosterIssues(s, 'BOS')).toMatchObject({ cut: 2, sign: 0 });
    expect(rosterIssues(s, 'LAL')).toMatchObject({ cut: 0, sign: 2 });
    for (const p of expiringPlayers(s)) expect(p.teamId).not.toBeNull();
    const fixes = startNewSeason(s);
    expect(fixes.find((f) => f.teamId === 'BOS')!.released.length).toBe(2);
    expect(fixes.find((f) => f.teamId === 'LAL')!.signed.length).toBe(2);
    expect(standardRoster(s, 'BOS').length).toBe(MAX_STANDARD);
    expect(standardRoster(s, 'LAL').length).toBe(13);
    expect(roster(s, 'BOS').length).toBeGreaterThan(0);
  });
});
