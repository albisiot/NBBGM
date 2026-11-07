import { autoSetup } from '../game/setup.ts';
import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import type { Contract, Role } from '../types.ts';
import { luxuryTax, minimumSalaryFor, nextConfig, type SeasonConfig } from './config.ts';
import { contractOf, isRepeater, marketValue, payroll, roster, standardRoster } from './finance.ts';
import { lotteryPositionOdds, MAX_DEFERRALS, pickInSwap, swapLive } from './picks.ts';
import { REGULAR_SEASON_TURNS } from './schedule.ts';
import type { DraftPick, DraftSwap, LeagueState, PlayerState, Strategy } from './state.ts';
import { executeTrade, payrollChange, tradeWindowOpen, validateTrade, type Trade } from './trades.ts';
import { gamesAfterOffseason } from './turn.ts';

/** Forza di una rosa: overall medio della rotazione automatica dei sani, pesato sui minuti. */
function rotationStrength(teamId: string, players: readonly PlayerState[]): number {
  const healthy = players.filter((p) => p.injury === null);
  if (healthy.length < 5) return 40;
  const setup = autoSetup(teamId, healthy);
  let sum = 0;
  for (const p of setup.players) sum += overall(p) * (setup.minutes[p.id] ?? 0);
  return sum / 240;
}

/** Forza di una squadra: overall medio della rotazione automatica, pesato sui minuti. */
export function teamStrength(state: LeagueState, teamId: string): number {
  return rotationStrength(teamId, roster(state, teamId));
}

/** Classifica per forza, dalla più forte. */
export function strengthRanking(state: LeagueState): string[] {
  const s = new Map(state.teams.map((t) => [t.id, teamStrength(state, t.id)]));
  return [...state.teams].map((t) => t.id).sort((a, b) => (s.get(b) as number) - (s.get(a) as number));
}

/**
 * Strategia dei bot, dalla classifica attesa (vittorie fatte più quelle attese dalla forza nelle partite che
 * restano: draftRanking; in offseason la forza per la stagione che arriva), dall'età della rotazione e dal monte
 * stipendi. In corsa le prime 10, in ricostruzione le ultime 10 o chi ha una rotazione vecchia fuori dalle prime 15,
 * le altre a metà strada. Chi è sopra la tassa con il saldo in rosso deve liberarsi di stipendi: è in corsa solo tra
 * le prime 6, e fuori dalle prime 12 è in ricostruzione.
 */
export function updateStrategies(state: LeagueState): void {
  const ranking = draftRanking(state);
  for (const team of state.teams) {
    const rank = ranking.indexOf(team.id);
    const top8 = [...roster(state, team.id)].sort((a, b) => overall(b) - overall(a)).slice(0, 8);
    const age = top8.reduce((a, p) => a + p.age, 0) / Math.max(1, top8.length);
    const squeezed = team.balance < 0 && payroll(state, team.id) > state.config.luxuryTax;
    team.strategy =
      rank < (squeezed ? 6 : 10)
        ? 'contend'
        : rank >= 20 || (age >= 30 && rank >= 15) || (squeezed && rank >= 12)
          ? 'rebuild'
          : 'middle';
  }
}

/** Momento della stagione (fase e turno della lega): serve a contare le partite che salta un infortunato. */
export type SeasonMoment = Pick<LeagueState, 'phase' | 'turn'>;
const SEASON_START: SeasonMoment = { phase: 'regular', turn: 0 };

/** Stagioni che il talento di un giocatore riassume, come il contratto nel valore (al massimo 3 anni). */
export const VALUE_YEARS = 3;

/**
 * Stagioni saltate da un infortunato, in frazione: le partite che salta tra quelle che restano di questa regular
 * season (diviso quelle che restano), più la parte della prossima se lo stop va oltre l'offseason, dove si
 * guarisce (gamesAfterOffseason). In offseason la guarigione c'è già stata e conta la stagione che arriva. Dopo
 * la regular season (play-in e playoff) di questa stagione non resta nulla. Va da 0 a 2.
 */
export function injurySeasons(gamesRemaining: number, when: SeasonMoment): number {
  if (gamesRemaining <= 0) return 0;
  if (when.phase === 'offseason') return Math.min(1, gamesRemaining / REGULAR_SEASON_TURNS);
  const left = when.phase === 'regular' ? Math.max(0, REGULAR_SEASON_TURNS - when.turn) : 0;
  const now = Math.min(gamesRemaining, left);
  const next = Math.min(REGULAR_SEASON_TURNS, gamesAfterOffseason(gamesRemaining - now));
  return (left > 0 ? now / left : 0) + next / REGULAR_SEASON_TURNS;
}

/**
 * Parte del valore di un giocatore che viene dal suo livello, senza il contratto (con il potenziale stimato, non
 * quello vero). Un infortunio toglie solo le stagioni che salta, ognuna per un anno di valore (1/VALUE_YEARS):
 * una stella ferma per il resto della stagione perde un terzo del suo valore, non quasi tutto.
 */
export function playerTalent(p: PlayerState, strategy: Strategy, when: SeasonMoment = SEASON_START): number {
  const ovr = overall(p);
  const room = Math.max(0, p.scoutedPotential - ovr);
  const young = p.age <= 25;
  let level: number;
  // Anche chi è in corsa sconta un po' i veterani oltre i 32 anni: il calo arriva
  if (strategy === 'contend') level = ovr + (young ? room * 0.15 : 0) - Math.max(0, p.age - 32) * 1.5;
  else if (strategy === 'rebuild') level = ovr + (young ? room * 0.7 : 0) - Math.max(0, p.age - 27) * 1.5;
  else level = ovr + (young ? room * 0.4 : 0) - Math.max(0, p.age - 30);
  const missed = p.injury ? injurySeasons(p.injury.gamesRemaining, when) : 0;
  return (Math.max(0, level - 50) ** 2 / 10) * (1 - missed / VALUE_YEARS);
}

/**
 * Valore di un giocatore per una squadra con una certa strategia: talento (playerTalent) più quanto il contratto
 * costa meno (o più) del suo valore di mercato. when è il momento della stagione, per gli infortunati.
 */
export function playerValue(
  p: PlayerState,
  contract: Contract | undefined,
  strategy: Strategy,
  c: SeasonConfig,
  when: SeasonMoment = SEASON_START,
): number {
  const talent = playerTalent(p, strategy, when);
  const salary = contract?.salaries[0] ?? 0;
  const years = contract?.salaries.length ?? 0;
  // Un contratto sopra il valore del giocatore pesa: il valore può scendere sotto zero
  const surplus =
    years && contract?.type !== 'two-way'
      ? ((marketValue(c, p) - salary) / 1e6) * Math.min(years, 3) * 0.5
      : 0;
  return talent + surplus;
}

/** Scarto di forza (overall di squadra) che vale circa due vittorie su tre: +5 vince il 67% (calibrazione). */
const WIN_SCALE = 6.8;

/**
 * Classifica attesa a fine regular season, dalla migliore: serve al valore delle scelte al draft. Vittorie già
 * fatte più quelle attese nelle partite che restano, dalla forza della squadra rispetto alla media. Nella forza
 * contano anche gli infortunati che saltano meno di metà delle partite che restano: un infortunio breve dei
 * migliori non sposta il valore delle scelte, uno lungo sì. In offseason conta solo la forza (la stagione che
 * arriva); dopo la regular season solo le vittorie (a parità, la forza).
 */
export function draftRanking(state: LeagueState): string[] {
  const offseason = state.phase === 'offseason';
  const left =
    state.phase === 'regular'
      ? Math.max(0, REGULAR_SEASON_TURNS - state.turn)
      : offseason
        ? REGULAR_SEASON_TURNS
        : 0;
  const strength = new Map(
    state.teams.map((t) => [
      t.id,
      rotationStrength(
        t.id,
        roster(state, t.id).map((p) =>
          p.injury && p.injury.gamesRemaining * 2 < Math.max(1, left) ? { ...p, injury: null } : p,
        ),
      ),
    ]),
  );
  const average = [...strength.values()].reduce((a, b) => a + b, 0) / Math.max(1, strength.size);
  const wins = new Map(state.teams.map((t) => [t.id, 0]));
  if (!offseason)
    for (const g of state.games) {
      if (g.phase !== 'regular') continue;
      const winner = g.homeScore > g.awayScore ? g.homeId : g.awayId;
      wins.set(winner, (wins.get(winner) ?? 0) + 1);
    }
  const projected = new Map(
    state.teams.map((t) => {
      const s = strength.get(t.id) as number;
      const p = 1 / (1 + Math.exp(-(s - average) / WIN_SCALE));
      return [t.id, (wins.get(t.id) as number) + left * p];
    }),
  );
  return state.teams
    .map((t) => t.id)
    .sort(
      (a, b) =>
        (projected.get(b) as number) - (projected.get(a) as number) ||
        (strength.get(b) as number) - (strength.get(a) as number) ||
        (a < b ? -1 : a > b ? 1 : 0),
    );
}

/** Posizione attesa della scelta di una squadra, dalla classifica attesa (la più debole sceglie per prima). */
export function expectedPickPosition(ranking: readonly string[], teamId: string): number {
  const i = ranking.indexOf(teamId);
  return i < 0 ? 15 : ranking.length - i;
}

/**
 * Probabilità che una prima scelta protetta "top N" cada nella fascia protetta. Il posto in classifica (dalla
 * peggiore) si sparge intorno a quello atteso, di più per i draft lontani; per le 14 fuori dai playoff conta poi la
 * lottery: la peggiore ha la prima scelta solo nel 14% dei casi, e una protezione top 1 su di lei vale poco.
 */
export function protectionChance(expected: number, protection: number, yearsAway: number): number {
  const scale = 3 + 2 * yearsAway;
  const below = (x: number) => 1 / (1 + Math.exp(-(x - expected) / scale));
  const lottery = lotteryPositionOdds();
  let inRange = 0;
  let total = 0;
  for (let s = 1; s <= 30; s++) {
    const pS = below(s + 0.5) - below(s - 0.5);
    total += pS;
    const row = lottery[s - 1];
    if (!row) inRange += s <= protection ? pS : 0;
    else for (let x = 0; x < Math.min(protection, row.length); x++) inRange += pS * (row[x] as number);
  }
  return inRange / total;
}

/** Valore di una seconda scelta (prima dello sconto per gli anni e della strategia). */
export const SECOND_ROUND_VALUE = 1.5;

/**
 * Valore di una scelta; protection è la protezione da considerare (di default quella della scelta). Una prima
 * scelta protetta vale quella libera se esce dalla fascia, e se ci cade quello che diventa alla fine: l'obbligo
 * passa ai draft dopo e, finiti i rinvii che restano (tre in tutto), diventa una seconda scelta. Con la protezione
 * quasi certa vale quindi come quella seconda scelta, più lontana nel tempo.
 */
export function pickValue(
  state: LeagueState,
  pick: Pick<DraftPick, 'draftYear' | 'round' | 'originalTeamId' | 'protection'> &
    Partial<Pick<DraftPick, 'deferrals'>>,
  strategy: Strategy,
  ranking: readonly string[],
  protection: number | null = pick.protection,
): number {
  const yearsAway = Math.max(0, pick.draftYear - (state.config.year + 1));
  // Più lontana la scelta, più la posizione attesa tende alla media
  const expected = 15 + (expectedPickPosition(ranking, pick.originalTeamId) - 15) * 0.6 ** yearsAway;
  const strategyF = strategy === 'rebuild' ? 1.4 : strategy === 'contend' ? 0.6 : 1;
  if (pick.round === 2) return SECOND_ROUND_VALUE * 0.9 ** yearsAway * strategyF;
  const free = (45 * Math.exp(-(expected - 1) / 7) + 4) * 0.9 ** yearsAway;
  if (!protection) return free * strategyF;
  const p = protectionChance(expected, protection, yearsAway);
  const deferrals = Math.max(0, MAX_DEFERRALS - (pick.deferrals ?? 0));
  const becomesSecond = SECOND_ROUND_VALUE * 0.9 ** (yearsAway + deferrals);
  return ((1 - p) * free + p * becomesSecond) * strategyF;
}

/**
 * Valore di uno swap per chi ha il diritto: la differenza attesa tra la scelta dell'altra squadra e la propria,
 * se è migliore, più un valore d'opzione (le classifiche cambiano). Chi lo concede perde lo stesso valore. Vale 0 se
 * una delle due squadre non ha più la propria scelta (al draft lo swap decadrebbe).
 */
export function swapValue(
  state: LeagueState,
  swap: Pick<DraftSwap, 'draftYear' | 'round' | 'holderId' | 'otherId'>,
  strategy: Strategy,
  ranking: readonly string[],
): number {
  // Uno swap su una scelta che una delle due squadre non ha più decade al draft: non vale niente
  if (!swapLive(state.picks, swap)) return 0;
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
 * Stagione su cui conta la tassa di uno scambio. Nel turno del draft dell'offseason i contratti non sono ancora
 * scalati: la tassa della stagione finita è già pagata e conta quella che arriva, con i suoi stipendi (il secondo
 * anno dei contratti) e le sue soglie. Altrimenti la stagione corrente.
 */
export function taxSeason(state: LeagueState): { config: SeasonConfig; season: 0 | 1 } {
  const o = state.offseason;
  if (state.phase === 'offseason' && o && state.config.year < o.draftYear)
    return { config: nextConfig(state.config), season: 1 };
  return { config: state.config, season: 0 };
}

/**
 * Costo della luxury tax in più (o risparmio, se negativo) per la squadra se lo scambio si fa, nella stessa
 * scala dei valori: come per i contratti, mezzo punto per milione.
 */
function taxCost(state: LeagueState, t: Trade, teamId: string): number {
  const team = state.teams.find((x) => x.id === teamId);
  if (!team) return 0;
  const { config, season } = taxSeason(state);
  const before = payroll(state, teamId, season);
  const repeater = isRepeater(team.taxHistory);
  const extra =
    luxuryTax(config, before + payrollChange(state, t, teamId, season), repeater) -
    luxuryTax(config, before, repeater);
  return (extra / 1e6) * 0.5;
}

/**
 * Per chi è in corsa il risparmio sulla tassa conta al massimo per questa quota del talento che cede: una squadra
 * che punta al titolo non regala un titolare per risparmiare (il costo della tassa in più, invece, conta intero).
 */
export const CONTEND_TAX_SAVING_SHARE = 0.25;

/**
 * Valore di uno scambio per una squadra: ciò che riceve (giocatori, scelte con le protezioni messe nello scambio,
 * diritti di swap) e ciò che cede, con la tassa in più tra i costi (o il risparmio tra i guadagni).
 */
export function tradeBalance(
  state: LeagueState,
  t: Trade,
  teamId: string,
  ranking: readonly string[] = draftRanking(state),
): { get: number; give: number } {
  const team = state.teams.find((x) => x.id === teamId);
  const strategy = team?.strategy ?? 'middle';
  const val = (players: string[], picks: string[]) =>
    players.reduce((a, id) => {
      const p = state.players.find((x) => x.id === id) as PlayerState;
      return a + playerValue(p, contractOf(state, id), strategy, state.config, state);
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
  let saving = Math.max(0, -tax);
  if (strategy === 'contend') {
    const talentOut = (mine ? t.playersA : t.playersB).reduce((a, id) => {
      const p = state.players.find((x) => x.id === id) as PlayerState;
      return a + playerTalent(p, strategy, state);
    }, 0);
    saving = Math.min(saving, CONTEND_TAX_SAVING_SHARE * talentOut);
  }
  return {
    get: (mine ? val(t.playersB, t.picksB) : val(t.playersA, t.picksA)) + swaps(true) + saving,
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
  const vSeller = playerValue(target, targetC, sS, state.config, state);
  const vBuyer = playerValue(target, targetC, sB, state.config, state);
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
        forSeller: playerValue(p, contractOf(state, p.id), sS, state.config, state),
        forBuyer: playerValue(p, contractOf(state, p.id), sB, state.config, state),
      })),
    ...state.picks
      .filter((p) => p.ownerId === buyerId && !pickInSwap(state.swaps, p))
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
  // Classifica attesa per il valore delle scelte; per le due squadre più forti conta la forza di adesso
  const ranking = draftRanking(state);
  // Le due squadre più forti non comprano: così i bot non costruiscono dinastie a forza di scambi
  const top = new Set(strengthRanking(state).slice(0, 2));
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
  const ranking = draftRanking(state);
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
  const ranking = draftRanking(state);
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
      const value = playerValue(target, contract, buyer.strategy, c, state);
      // Incentivo: le seconde scelte, poi le prime più lontane del venditore
      const sweeteners = state.picks
        .filter((p) => p.ownerId === seller.id && !pickInSwap(state.swaps, p))
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
      // Anche chi cede deve guadagnarci, risparmio sulla tassa compreso: un contratto in perdita sì, un giovane che
      // vale più di quanto costa no (Philadelphia regalava Malik Ashford, 21 anni e 78 di overall, per una seconda
      // scelta, e Dallas ci costruiva una dinastia)
      const { get, give } = tradeBalance(state, trade, seller.id, ranking);
      if (!tradeGainOk(get, give)) continue;
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
  // In rosso rinnova caro solo i migliori 4, o se resta comunque sotto il monte stipendi minimo
  if (
    team.balance < 0 &&
    ask > minimumSalaryFor(state.config, p.yearsInLeague) * 1.5 &&
    rank > 3 &&
    payroll(state, teamId) + ask > state.config.minimumTeamSalary
  )
    return false;
  if (team.strategy === 'rebuild' && p.age >= 30 && rank > 2) return false;
  return rank < 10 && p.age <= 34;
}
