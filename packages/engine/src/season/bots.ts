import { autoSetup } from '../game/setup.ts';
import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import type { Contract, Role } from '../types.ts';
import { luxuryTax, minimumSalaryFor, type SeasonConfig } from './config.ts';
import { contractOf, isRepeater, marketValue, payroll, roster, standardRoster } from './finance.ts';
import type { DraftPick, DraftSwap, LeagueState, PlayerState, Strategy } from './state.ts';
import { executeTrade, payrollChange, tradeWindowOpen, validateTrade, type Trade } from './trades.ts';

/** Forza di una squadra: overall medio della rotazione automatica, pesato sui minuti. */
export function teamStrength(state: LeagueState, teamId: string): number {
  const players = roster(state, teamId).filter((p) => p.injury === null);
  if (players.length < 5) return 40;
  const setup = autoSetup(teamId, players);
  let sum = 0;
  for (const p of setup.players) sum += overall(p) * (setup.minutes[p.id] ?? 0);
  return sum / 240;
}

/** Classifica per forza, dalla più forte. */
export function strengthRanking(state: LeagueState): string[] {
  const s = new Map(state.teams.map((t) => [t.id, teamStrength(state, t.id)]));
  return [...state.teams].map((t) => t.id).sort((a, b) => (s.get(b) as number) - (s.get(a) as number));
}

/**
 * Strategia dei bot: in corsa le prime 10 per forza, in ricostruzione le ultime 10 o chi ha una rotazione
 * vecchia e debole, le altre a metà strada.
 */
export function updateStrategies(state: LeagueState): void {
  const ranking = strengthRanking(state);
  for (const team of state.teams) {
    const rank = ranking.indexOf(team.id);
    const top8 = [...roster(state, team.id)].sort((a, b) => overall(b) - overall(a)).slice(0, 8);
    const age = top8.reduce((a, p) => a + p.age, 0) / Math.max(1, top8.length);
    team.strategy = rank < 10 ? 'contend' : rank >= 20 || (age >= 30 && rank >= 15) ? 'rebuild' : 'middle';
  }
}

/** Valore di un giocatore per una squadra con una certa strategia (con il potenziale stimato, non quello vero). */
export function playerValue(
  p: PlayerState,
  contract: Contract | undefined,
  strategy: Strategy,
  c: SeasonConfig,
): number {
  const ovr = overall(p);
  const room = Math.max(0, p.scoutedPotential - ovr);
  const young = p.age <= 25;
  let level: number;
  // Anche chi è in corsa sconta un po' i veterani oltre i 32 anni: il calo arriva
  if (strategy === 'contend') level = ovr + (young ? room * 0.15 : 0) - Math.max(0, p.age - 32) * 1.5;
  else if (strategy === 'rebuild') level = ovr + (young ? room * 0.7 : 0) - Math.max(0, p.age - 27) * 1.5;
  else level = ovr + (young ? room * 0.4 : 0) - Math.max(0, p.age - 30);
  // Un infortunato salta una parte della stagione: con 60 partite da saltare vale circa un terzo
  const injured = p.injury ? Math.min(0.7, p.injury.gamesRemaining / 82) : 0;
  const talent = (Math.max(0, level - 50) ** 2 / 10) * (1 - injured);
  const salary = contract?.salaries[0] ?? 0;
  const years = contract?.salaries.length ?? 0;
  // Un contratto sopra il valore del giocatore pesa: il valore può scendere sotto zero
  const surplus =
    years && contract?.type !== 'two-way'
      ? ((marketValue(c, p) - salary) / 1e6) * Math.min(years, 3) * 0.5
      : 0;
  return talent + surplus;
}

/** Posizione attesa della scelta di una squadra, dalla sua forza attuale (la più debole sceglie per prima). */
export function expectedPickPosition(ranking: readonly string[], teamId: string): number {
  const i = ranking.indexOf(teamId);
  return i < 0 ? 15 : ranking.length - i;
}

/**
 * Quota del valore che resta a una prima scelta protetta "top N": se cade nella fascia protetta resta a chi la
 * cede e l'obbligo passa al draft dopo (alla fine, dopo tre rinvii, diventa una seconda scelta), quindi in quel
 * caso vale circa il 30%. La probabilità di cadere nella fascia dipende da N e dalla posizione attesa, più
 * incerta per i draft lontani.
 */
export function protectedShare(expected: number, protection: number, yearsAway: number): number {
  const inRange = 1 / (1 + Math.exp(-(protection + 0.5 - expected) / (3 + 2 * yearsAway)));
  return 1 - 0.7 * inRange;
}

/** Valore di una scelta; protection è la protezione da considerare (di default quella della scelta). */
export function pickValue(
  state: LeagueState,
  pick: Pick<DraftPick, 'draftYear' | 'round' | 'originalTeamId' | 'protection'>,
  strategy: Strategy,
  ranking: readonly string[],
  protection: number | null = pick.protection,
): number {
  const yearsAway = Math.max(0, pick.draftYear - (state.config.year + 1));
  // Più lontana la scelta, più la posizione attesa tende alla media
  const expected = 15 + (expectedPickPosition(ranking, pick.originalTeamId) - 15) * 0.6 ** yearsAway;
  const base = pick.round === 1 ? 45 * Math.exp(-(expected - 1) / 7) + 4 : 1.5;
  const share = protection && pick.round === 1 ? protectedShare(expected, protection, yearsAway) : 1;
  const strategyF = strategy === 'rebuild' ? 1.4 : strategy === 'contend' ? 0.6 : 1;
  return base * 0.9 ** yearsAway * share * strategyF;
}

/**
 * Valore di uno swap per chi ha il diritto: la differenza attesa tra la scelta dell'altra squadra e la propria,
 * se è migliore, più un valore d'opzione (le classifiche cambiano). Chi lo concede perde lo stesso valore.
 */
export function swapValue(
  state: LeagueState,
  swap: Pick<DraftSwap, 'draftYear' | 'round' | 'holderId' | 'otherId'>,
  strategy: Strategy,
  ranking: readonly string[],
): number {
  const value = (team: string) =>
    pickValue(
      state,
      { draftYear: swap.draftYear, round: swap.round, originalTeamId: team, protection: null },
      strategy,
      ranking,
    );
  const own = value(swap.holderId);
  const other = value(swap.otherId);
  return Math.max(0, other - own) + 0.15 * Math.min(own, other);
}

/**
 * Costo della luxury tax in più (o risparmio, se negativo) per la squadra se lo scambio si fa, nella stessa
 * scala dei valori: come per i contratti, mezzo punto per milione.
 */
function taxCost(state: LeagueState, t: Trade, teamId: string): number {
  const team = state.teams.find((x) => x.id === teamId);
  if (!team) return 0;
  const before = payroll(state, teamId);
  const repeater = isRepeater(team.taxHistory);
  const extra =
    luxuryTax(state.config, before + payrollChange(state, t, teamId), repeater) -
    luxuryTax(state.config, before, repeater);
  return (extra / 1e6) * 0.5;
}

/**
 * Valore di uno scambio per una squadra: ciò che riceve (giocatori, scelte con le protezioni messe nello scambio,
 * diritti di swap) e ciò che cede, con la tassa in più tra i costi (o il risparmio tra i guadagni).
 */
export function tradeBalance(
  state: LeagueState,
  t: Trade,
  teamId: string,
  ranking: readonly string[] = strengthRanking(state),
): { get: number; give: number } {
  const team = state.teams.find((x) => x.id === teamId);
  const strategy = team?.strategy ?? 'middle';
  const val = (players: string[], picks: string[]) =>
    players.reduce((a, id) => {
      const p = state.players.find((x) => x.id === id) as PlayerState;
      return a + playerValue(p, contractOf(state, id), strategy, state.config);
    }, 0) +
    picks.reduce((a, id) => {
      const pick = state.picks.find((x) => x.id === id) as DraftPick;
      return a + pickValue(state, pick, strategy, ranking, t.protections?.[id] ?? pick.protection);
    }, 0);
  const swaps = (holder: boolean) =>
    (t.swaps ?? [])
      .filter((s) => (holder ? s.holderId : s.otherId) === teamId)
      .reduce((a, s) => a + swapValue(state, s, strategy, ranking), 0);
  const mine = teamId === t.teamA;
  const tax = taxCost(state, t, teamId);
  return {
    get: (mine ? val(t.playersB, t.picksB) : val(t.playersA, t.picksA)) + swaps(true) + Math.max(0, -tax),
    give: (mine ? val(t.playersA, t.picksA) : val(t.playersB, t.picksB)) + swaps(false) + Math.max(0, tax),
  };
}

/** Un bot accetta solo se riceve almeno il 10% in più di quanto cede. */
export const BOT_TRADE_MARGIN = 1.1;
/** Guadagno netto minimo di un bot in uno scambio: niente scambi alla pari o in perdita, nemmeno a costo zero. */
export const MIN_TRADE_GAIN = 1;

/**
 * Il guadagno netto basta? Almeno MIN_TRADE_GAIN e almeno il margine (10%) su quanto cede, contato in valore
 * assoluto: cedere un contratto in perdita (valore negativo) non rende buono un altro contratto in perdita.
 */
export function tradeGainOk(get: number, give: number, margin = BOT_TRADE_MARGIN): boolean {
  // Il millesimo evita che l'arrotondamento dei decimali rifiuti uno scambio proprio al margine
  return get - give >= Math.max(MIN_TRADE_GAIN, (margin - 1) * Math.abs(give)) - 1e-9;
}

export function botAccepts(state: LeagueState, t: Trade, teamId: string): boolean {
  const { get, give } = tradeBalance(state, t, teamId);
  return tradeGainOk(get, give) && validateTrade(state, t).length === 0;
}

/**
 * Scambio tra bot: una squadra in corsa cede giovani e scelte a una in ricostruzione per un veterano.
 * Si fa solo se conviene a entrambe secondo la propria strategia. Restituisce lo scambio fatto, o null.
 */
/**
 * Costruisce uno scambio "veterano per giovani e scelte": seller cede uno dei suoi migliori veterani,
 * buyer paga con giocatori fuori dai suoi primi 4 e scelte. sellerGain e buyerGain dicono quale delle due
 * parti deve guadagnare almeno il 10% (per un umano decide il manager: basta che l'offerta sia credibile).
 */
function buildVeteranTrade(
  state: LeagueState,
  rng: Rng,
  ranking: readonly string[],
  sellerId: string,
  buyerId: string,
  check: { seller: number; buyer: number },
): Trade | null {
  const strategyOf = (id: string): Strategy => {
    const t = state.teams.find((x) => x.id === id);
    return !t || t.human ? 'middle' : t.strategy;
  };
  const sS = strategyOf(sellerId);
  const sB = strategyOf(buyerId);
  const vets = roster(state, sellerId)
    .filter(
      (p) =>
        p.age >= 26 && overall(p) >= 66 && contractOf(state, p.id)?.type !== 'two-way' && p.injury === null,
    )
    .sort((a, b) => overall(b) - overall(a));
  if (!vets.length) return null;
  const target = rng.pick(vets.slice(0, 3));
  const targetC = contractOf(state, target.id);
  const vSeller = playerValue(target, targetC, sS, state.config);
  const vBuyer = playerValue(target, targetC, sB, state.config);
  const keep = new Set(
    [...roster(state, buyerId)]
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, 4)
      .map((p) => p.id),
  );
  type Asset = { kind: 'player' | 'pick'; id: string; forSeller: number; forBuyer: number };
  const assets: Asset[] = [
    ...standardRoster(state, buyerId)
      .filter((p) => !keep.has(p.id) && p.injury === null)
      .map((p) => ({
        kind: 'player' as const,
        id: p.id,
        forSeller: playerValue(p, contractOf(state, p.id), sS, state.config),
        forBuyer: playerValue(p, contractOf(state, p.id), sB, state.config),
      })),
    ...state.picks
      .filter((p) => p.ownerId === buyerId)
      .map((p) => ({
        kind: 'pick' as const,
        id: p.id,
        forSeller: pickValue(state, p, sS, ranking),
        forBuyer: pickValue(state, p, sB, ranking),
      })),
  ]
    // Nel pacchetto solo quello che il venditore vuole: prima ciò che vale di più per lui che per il compratore
    .filter((a) => a.forSeller > 0)
    .sort((a, b) => b.forSeller / Math.max(0.5, b.forBuyer) - a.forSeller / Math.max(0.5, a.forBuyer));
  const pkg: Asset[] = [];
  let forSeller = 0;
  let forBuyer = 0;
  for (const a of assets) {
    if (forSeller >= vSeller * check.seller) break;
    if (a.kind === 'player' && pkg.filter((x) => x.kind === 'player').length >= 3) continue;
    if (a.kind === 'pick' && pkg.filter((x) => x.kind === 'pick').length >= 2) continue;
    pkg.push(a);
    forSeller += a.forSeller;
    forBuyer += a.forBuyer;
  }
  if (forSeller < vSeller * check.seller || vBuyer < forBuyer * check.buyer) return null;
  const trade: Trade = {
    teamA: sellerId,
    teamB: buyerId,
    playersA: [target.id],
    playersB: pkg.filter((a) => a.kind === 'player').map((a) => a.id),
    picksA: [],
    picksB: pkg.filter((a) => a.kind === 'pick').map((a) => a.id),
  };
  // Il bot deve volere lo scambio come se gli arrivasse da fuori (tassa compresa)
  for (const [team, margin] of [
    [sellerId, check.seller],
    [buyerId, check.buyer],
  ] as const) {
    if (margin < BOT_TRADE_MARGIN) continue;
    const { get, give } = tradeBalance(state, trade, team, ranking);
    if (!tradeGainOk(get, give, margin)) return null;
  }
  return validateTrade(state, trade).length ? null : trade;
}

export function botBotTrade(state: LeagueState, rng: Rng, turn: number | null): Trade | null {
  if (!tradeWindowOpen(state)) return null;
  const bots = state.teams.filter((t) => !t.human);
  const ranking = strengthRanking(state);
  // Le due squadre più forti non comprano: così i bot non costruiscono dinastie a forza di scambi
  const top = new Set(ranking.slice(0, 2));
  const sellers = bots.filter((t) => t.strategy === 'rebuild');
  const buyers = bots.filter((t) => t.strategy === 'contend' && !top.has(t.id));
  if (!sellers.length || !buyers.length) return null;
  for (let attempt = 0; attempt < 4; attempt++) {
    const trade = buildVeteranTrade(state, rng, ranking, rng.pick(sellers).id, rng.pick(buyers).id, {
      seller: BOT_TRADE_MARGIN,
      buyer: BOT_TRADE_MARGIN,
    });
    if (!trade) continue;
    executeTrade(state, trade, turn);
    return trade;
  }
  return null;
}

/**
 * Proposta di un bot a una squadra umana (non eseguita: decide il manager). Un bot in corsa chiede un
 * veterano dell'umano, uno in ricostruzione glielo offre; il bot deve guadagnarci almeno il 10%, e per
 * l'umano lo scambio deve essere almeno vicino alla parità, altrimenti la proposta non parte.
 */
export function botProposeTrade(state: LeagueState, botId: string, humanId: string, rng: Rng): Trade | null {
  if (!tradeWindowOpen(state)) return null;
  const bot = state.teams.find((t) => t.id === botId);
  if (!bot || bot.human || bot.strategy === 'middle') return null;
  const ranking = strengthRanking(state);
  if (bot.strategy === 'contend')
    return buildVeteranTrade(state, rng, ranking, humanId, botId, { seller: 0.95, buyer: BOT_TRADE_MARGIN });
  return buildVeteranTrade(state, rng, ranking, botId, humanId, { seller: BOT_TRADE_MARGIN, buyer: 0.9 });
}

/**
 * Cessione di un contratto pesante: un bot in rosso e sopra la tassa cede un giocatore a una squadra con
 * spazio sotto il cap e saldo positivo, aggiungendo se serve una scelta perché il valore torni.
 */
export function botSalaryDump(state: LeagueState, rng: Rng, turn: number | null): Trade | null {
  if (!tradeWindowOpen(state)) return null;
  const c = state.config;
  const pay = (id: string) =>
    state.contracts
      .filter((x) => x.teamId === id && x.type !== 'two-way')
      .reduce((a, x) => a + (x.salaries[0] ?? 0), 0);
  const sellers = state.teams.filter((t) => !t.human && t.balance < 0 && pay(t.id) > c.luxuryTax);
  if (!sellers.length) return null;
  const seller = rng.pick(sellers);
  const ranking = strengthRanking(state);
  const keep = new Set(
    [...roster(state, seller.id)]
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, seller.strategy === 'contend' ? 3 : 1)
      .map((p) => p.id),
  );
  const heavy = standardRoster(state, seller.id)
    .filter((p) => !keep.has(p.id) && (contractOf(state, p.id)?.salaries[0] ?? 0) >= 6_000_000)
    .sort((a, b) => (contractOf(state, b.id)?.salaries[0] ?? 0) - (contractOf(state, a.id)?.salaries[0] ?? 0))
    .slice(0, 3);
  for (const target of heavy) {
    const contract = contractOf(state, target.id) as Contract;
    const salary = contract.salaries[0] ?? 0;
    const buyers = state.teams.filter(
      (t) => !t.human && t.id !== seller.id && t.balance >= 0 && pay(t.id) + salary <= c.salaryCap,
    );
    for (const buyer of rng.shuffle(buyers).slice(0, 4)) {
      const value = playerValue(target, contract, buyer.strategy, c);
      // Incentivo: le seconde scelte, poi le prime più lontane del venditore
      const sweeteners = state.picks
        .filter((p) => p.ownerId === seller.id)
        .sort((a, b) => b.round - a.round || b.draftYear - a.draftYear);
      const trade: Trade = {
        teamA: seller.id,
        teamB: buyer.id,
        playersA: [target.id],
        playersB: [],
        picksA: [],
        picksB: [],
      };
      let got = value;
      for (const pick of sweeteners) {
        if (got >= 6) break;
        trade.picksA.push(pick.id);
        got += pickValue(state, pick, buyer.strategy, ranking);
        if (trade.picksA.length >= 2) break;
      }
      if (got < 6) continue;
      // Se il venditore scenderebbe sotto 13, riceve indietro il contratto più leggero del compratore
      if (standardRoster(state, seller.id).length <= 13) {
        const cheap = [...standardRoster(state, buyer.id)].sort(
          (a, b) => (contractOf(state, a.id)?.salaries[0] ?? 0) - (contractOf(state, b.id)?.salaries[0] ?? 0),
        )[0];
        if (!cheap) continue;
        trade.playersB.push(cheap.id);
      }
      if (validateTrade(state, trade).length) continue;
      executeTrade(state, trade, turn);
      return trade;
    }
  }
  return null;
}

/** Scelta al draft: il migliore disponibile tra potenziale stimato e livello attuale, con un occhio ai ruoli scoperti. */
export function botDraftChoice(
  state: LeagueState,
  teamId: string,
  prospects: readonly PlayerState[],
  rng: Rng,
): PlayerState {
  const roles = new Map<Role, number>();
  for (const p of roster(state, teamId)) roles.set(p.role, (roles.get(p.role) ?? 0) + 1);
  // Un punteggio per prospetto, con la sua parte casuale estratta una volta sola
  const scored = prospects.map((p) => ({
    p,
    score:
      0.6 * p.scoutedPotential +
      0.4 * overall(p) +
      ((roles.get(p.role) ?? 0) < 2 ? 2 : 0) +
      rng.normal(0, 1.5),
  }));
  return scored.reduce((best, x) => (x.score > best.score ? x : best)).p;
}

/** Il bot rinnova un suo giocatore in scadenza se gli serve e il prezzo è giusto. */
export function botWantsRenewal(state: LeagueState, teamId: string, p: PlayerState, ask: number): boolean {
  const team = state.teams.find((t) => t.id === teamId);
  if (!team) return false;
  const ranked = [...roster(state, teamId), p]
    .filter((x, i, a) => a.indexOf(x) === i)
    .sort((a, b) => overall(b) - overall(a));
  const rank = ranked.indexOf(p);
  const fair = marketValue(state.config, p);
  if (ask > fair * 1.15) return false;
  if (team.balance < 0 && ask > minimumSalaryFor(state.config, p.yearsInLeague) * 1.5 && rank > 3)
    return false;
  if (team.strategy === 'rebuild' && p.age >= 30 && rank > 2) return false;
  return rank < 10 && p.age <= 34;
}
