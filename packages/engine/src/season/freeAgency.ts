import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import { maxSalaryFor, minimumSalaryFor, type SeasonConfig } from './config.ts';
import { botWantsRenewal, teamStrength, playerTalent } from './bots.ts';
import { autoDraftPick, INITIAL_DRAFT_ROLE_TARGET } from './initialDraft.ts';
import {
  MIN_STANDARD,
  canSign,
  marketValue,
  payroll,
  releasedBy,
  rightsOf,
  roster,
  salaryRun,
  signContract,
  standardRoster,
  typicalYears,
} from './finance.ts';
import { ownerStyle } from './owners.ts';
import type { LeagueState, PlayerState, Strategy } from './state.ts';

export interface Offer {
  teamId: string;
  playerId: string;
  salaries: number[];
}

/** Turni di free agency nell'offseason. */
export const FREE_AGENCY_ROUNDS = 15;
/** Turni di sole offerte all'inizio della free agency: nessuno firma fino al 6° turno (indice 5). */
export const FA_MORATORIUM_ROUNDS = 5;
/** Richiesta all'ultimo turno di free agency, in quota del valore: la stessa che resta poi in stagione. */
export const FA_FINAL_ASK = 0.64;

/** Il turno di free agency (0-14) è uno di quelli in cui si firma? */
export function faSigningRound(round: number): boolean {
  return round >= FA_MORATORIUM_ROUNDS;
}

/**
 * Quota del valore che uno svincolato chiede in un turno di free agency (0-14): tutto il valore nei turni di sole
 * offerte e al primo in cui si firma, poi giù in linea retta fino al 64% all'ultimo turno.
 */
export function askFactor(round: number): number {
  if (round <= FA_MORATORIUM_ROUNDS) return 1;
  const t = Math.min(1, (round - FA_MORATORIUM_ROUNDS) / (FREE_AGENCY_ROUNDS - 1 - FA_MORATORIUM_ROUNDS));
  return 1 - (1 - FA_FINAL_ASK) * t;
}

/**
 * Richiesta minima di uno svincolato: il suo valore di mercato, un po' più alta con il morale basso, che scende di
 * turno in turno dal primo in cui si firma (askFactor) senza andare sotto il minimo né sopra il massimo per la sua
 * anzianità.
 */
export function askingSalary(state: LeagueState, p: PlayerState, round: number): number {
  return askingSalaryFor(state.config, p, round);
}

/** Come askingSalary, con la sola configurazione della stagione: la usa anche l'app per mostrare le richieste. */
export function askingSalaryFor(
  c: SeasonConfig,
  p: Pick<PlayerState, 'ratings' | 'role' | 'age' | 'yearsInLeague' | 'scoutedPotential' | 'morale'>,
  round: number,
): number {
  const minimum = minimumSalaryFor(c, p.yearsInLeague);
  const ask = marketValue(c, p) * (1 + (50 - p.morale) / 400) * askFactor(round);
  return Math.min(maxSalaryFor(c, p.yearsInLeague), Math.max(minimum, Math.round(ask / 10_000) * 10_000));
}

/** Scarto massimo tra un'offerta e la richiesta perché valga come la richiesta esatta. */
export const ASK_ROUNDING = 5_000;

/**
 * Le richieste si mostrano in milioni con due decimali, cioè arrotondate ai 10.000 $, ma i minimi non sono cifre
 * tonde (1.452.806 $ si legge "1,45"). Un'offerta che dista dalla richiesta non più di 5.000 $ è la cifra mostrata
 * e vale come la richiesta esatta: chi offre quello che vede firma alla richiesta, e un minimo resta un minimo
 * (sopra la soglia della tassa è l'unica firma possibile).
 */
export function snapToAsk(salary: number, ask: number): number {
  return Math.abs(salary - ask) <= ASK_ROUNDING ? ask : salary;
}

/** Posto che il giocatore avrebbe nella rotazione di una squadra: 1 da titolare, 0,6 da sesto-ottavo, 0,3 oltre. */
function expectedRole(state: LeagueState, teamId: string, p: PlayerState): number {
  const mine = overall(p);
  const better = roster(state, teamId).filter((x) => overall(x) > mine).length;
  const sameRoleBetter = roster(state, teamId).filter((x) => x.role === p.role && overall(x) > mine).length;
  if (better < 5 || sameRoleBetter === 0) return 1;
  return better < 8 ? 0.6 : 0.3;
}

/** Partite di regular season da cui la classifica entra nella forza della squadra per gli svincolati. */
export const APPEAL_MIN_GAMES = 10;

/**
 * Forza della squadra per uno svincolato, da 0 a 1: l'overall della rotazione (da 60 a 75) e, con almeno 10 partite
 * di regular season giocate, la percentuale di vittorie, metà e metà. In offseason la classifica è quella della
 * stagione appena finita.
 */
export function teamAppeal(state: LeagueState): Map<string, number> {
  const games = new Map(state.teams.map((t) => [t.id, { w: 0, g: 0 }]));
  for (const g of state.games) {
    if (g.phase !== 'regular') continue;
    const home = games.get(g.homeId);
    const away = games.get(g.awayId);
    if (home) home.g++;
    if (away) away.g++;
    const winner = g.homeScore > g.awayScore ? home : away;
    if (winner) winner.w++;
  }
  return new Map(
    state.teams.map((t) => {
      const s = Math.max(0, Math.min(1, (teamStrength(state, t.id) - 60) / 15));
      const r = games.get(t.id) as { w: number; g: number };
      return [t.id, r.g >= APPEAL_MIN_GAMES ? 0.5 * s + (0.5 * r.w) / r.g : s];
    }),
  );
}

/**
 * Punteggio di un'offerta per il giocatore: 0,55 soldi + 0,25 minuti attesi + 0,20 forza della squadra (rotazione
 * e classifica: teamAppeal). Dopo i 30 anni conta di più la durata.
 */
export function offerScore(
  state: LeagueState,
  p: PlayerState,
  offer: Offer,
  ask: number,
  appeal: Map<string, number>,
): number {
  const years = offer.salaries.length;
  const money = Math.min(1.5, (offer.salaries[0] ?? 0) / ask) * (p.age >= 30 ? 1 + 0.06 * (years - 1) : 1);
  const minutes = expectedRole(state, offer.teamId, p);
  return 0.55 * money + 0.25 * minutes + 0.2 * (appeal.get(offer.teamId) ?? 0);
}

/** Come sta un'offerta per lo svincolato: la migliore valida, un'altra è meglio, sotto la richiesta, non valida. */
export type OfferStanding = 'best' | 'behind' | 'below' | 'invalid';

/** Le offerte valide per un giocatore: sopra la richiesta e firmabili adesso. */
function validOffers(state: LeagueState, p: PlayerState, offers: readonly Offer[], ask: number): Offer[] {
  return offers.filter(
    (o) => (o.salaries[0] ?? 0) >= ask && canSign(state, o.teamId, p, o.salaries[0] ?? 0).ok,
  );
}

/** L'offerta che il giocatore sceglie tra quelle valide: punteggio più alto, a parità la squadra peggiore. */
function bestOffer(
  state: LeagueState,
  p: PlayerState,
  valid: readonly Offer[],
  ask: number,
  appeal: Map<string, number>,
  worstFirst: readonly string[],
): Offer {
  return valid.reduce((a, b) => {
    const sa = offerScore(state, p, a, ask, appeal);
    const sb = offerScore(state, p, b, ask, appeal);
    if (sb > sa + 1e-9) return b;
    if (Math.abs(sb - sa) <= 1e-9 && worstFirst.indexOf(b.teamId) < worstFirst.indexOf(a.teamId)) return b;
    return a;
  });
}

/**
 * Come sta ogni offerta, giocatore per giocatore, senza firmare nessuno: è quello che lo svincolato fa sapere a chi
 * gli ha fatto un'offerta (senza cifre). Un elemento per ogni offerta, nello stesso ordine.
 */
export function offerStandings(
  state: LeagueState,
  offers: readonly Offer[],
  round: number,
  worstFirst: readonly string[],
): OfferStanding[] {
  const appeal = teamAppeal(state);
  const best = new Map<string, Offer | null>();
  return offers.map((o) => {
    const p = state.players.find((x) => x.id === o.playerId);
    if (!p || p.teamId !== null) return 'invalid';
    if (!canSign(state, o.teamId, p, o.salaries[0] ?? 0).ok) return 'invalid';
    const ask = askingSalary(state, p, round);
    if ((o.salaries[0] ?? 0) < ask) return 'below';
    if (!best.has(p.id)) {
      const mine = offers.filter((x) => x.playerId === p.id);
      const valid = validOffers(state, p, mine, ask);
      best.set(p.id, valid.length ? bestOffer(state, p, valid, ask, appeal, worstFirst) : null);
    }
    return best.get(p.id) === o ? 'best' : 'behind';
  });
}

/**
 * Risolve un turno di offerte: ogni svincolato sceglie, tra quelle sopra la richiesta, l'offerta con il punteggio
 * più alto (a parità, la squadra peggio classificata). Nei turni di sole offerte (i primi 5 della free agency) non
 * firma nessuno. Un RFA che sceglie la squadra con i suoi diritti firma subito; se sceglie un'altra squadra, quella
 * con i diritti pareggia: un bot decide adesso, un manager nel turno dopo (state.offerSheets). Chi ha già un'offerta
 * in attesa di pareggio aspetta. Restituisce gli id firmati.
 */
export function resolveOffers(
  state: LeagueState,
  offers: readonly Offer[],
  round: number,
  worstFirst: readonly string[],
  turn: number | null,
): string[] {
  if (!faSigningRound(round)) return [];
  const appeal = teamAppeal(state);
  const byPlayer = new Map<string, Offer[]>();
  for (const o of offers) byPlayer.set(o.playerId, [...(byPlayer.get(o.playerId) ?? []), o]);
  const signed: string[] = [];
  const pending = new Set((state.offerSheets ?? []).map((x) => x.playerId));
  // I migliori scelgono per primi: le firme consumano spazio salariale e posti in rosa
  const order = [...byPlayer.keys()]
    .map((id) => state.players.find((p) => p.id === id) as PlayerState)
    .sort((a, b) => overall(b) - overall(a));
  for (const p of order) {
    if (p.teamId !== null || pending.has(p.id)) continue;
    const ask = askingSalary(state, p, round);
    const valid = validOffers(state, p, byPlayer.get(p.id) ?? [], ask);
    if (!valid.length) continue;
    const best = bestOffer(state, p, valid, ask, appeal, worstFirst);
    const rights = rightsOf(state, p.id);
    if (rights && rights.teamId !== best.teamId) {
      const rightsTeam = state.teams.find((t) => t.id === rights.teamId);
      if (rightsTeam?.human) {
        (state.offerSheets ??= []).push({
          playerId: p.id,
          teamId: best.teamId,
          rightsTeamId: rights.teamId,
          salaries: best.salaries,
        });
        continue;
      }
      // Un bot decide subito se pareggiare: come per un rinnovo, se il prezzo è giusto per lui
      if (botWantsRenewal(state, rights.teamId, p, best.salaries[0] ?? 0)) {
        matchOfferSheet(state, p, rights.teamId, best.teamId, best.salaries, turn);
        signed.push(p.id);
        continue;
      }
    }
    dropRights(state, p.id);
    signStandard(state, p, best.teamId, best.salaries, turn);
    signed.push(p.id);
  }
  return signed;
}

function signStandard(
  state: LeagueState,
  p: PlayerState,
  teamId: string,
  salaries: number[],
  turn: number | null,
): void {
  signContract(
    state,
    p,
    {
      playerId: p.id,
      teamId,
      type: 'standard',
      salaries,
      options: salaries.map(() => null),
      guaranteed: null,
    },
    turn,
  );
}

function dropRights(state: LeagueState, playerId: string): void {
  if (state.restricted) state.restricted = state.restricted.filter((r) => r.playerId !== playerId);
}

/** La squadra con i diritti pareggia l'offerta: il giocatore resta con lei, alle stesse cifre. */
function matchOfferSheet(
  state: LeagueState,
  p: PlayerState,
  rightsTeamId: string,
  sheetTeamId: string,
  salaries: number[],
  turn: number | null,
): void {
  dropRights(state, p.id);
  signStandard(state, p, rightsTeamId, salaries, turn);
  const last = state.transactions[state.transactions.length - 1];
  if (last)
    last.text = `${rightsTeamId} pareggia l'offerta di ${sheetTeamId} e tiene ${p.firstName} ${p.lastName} (${last.text.slice(last.text.lastIndexOf('(') + 1)}`;
}

export interface OfferSheetOutcome {
  playerId: string;
  teamId: string;
  rightsTeamId: string;
  /** matched: pareggiata; left: il giocatore va dall'altra squadra; void: l'offerta non vale più, resta RFA. */
  outcome: 'matched' | 'left' | 'void';
}

/**
 * Offerte in attesa di pareggio (state.offerSheets), decise nel turno dopo: la squadra con i diritti pareggia
 * (matches: true) o no. Senza risposta non pareggia. Se non pareggia e l'altra squadra non può più firmarlo (rosa,
 * tassa, bilancio), il giocatore resta RFA.
 */
export function resolveOfferSheets(
  state: LeagueState,
  matches: ReadonlyMap<string, boolean>,
  turn: number | null,
): OfferSheetOutcome[] {
  const out: OfferSheetOutcome[] = [];
  for (const sheet of state.offerSheets ?? []) {
    const p = state.players.find((x) => x.id === sheet.playerId);
    const base = { playerId: sheet.playerId, teamId: sheet.teamId, rightsTeamId: sheet.rightsTeamId };
    const rights = rightsOf(state, sheet.playerId);
    if (!p || p.teamId !== null || rights?.teamId !== sheet.rightsTeamId) {
      out.push({ ...base, outcome: 'void' });
      continue;
    }
    const rightsTeam = state.teams.find((t) => t.id === sheet.rightsTeamId);
    const match = rightsTeam?.human
      ? matches.get(p.id) === true
      : botWantsRenewal(state, sheet.rightsTeamId, p, sheet.salaries[0] ?? 0);
    if (match) {
      matchOfferSheet(state, p, sheet.rightsTeamId, sheet.teamId, sheet.salaries, turn);
      out.push({ ...base, outcome: 'matched' });
      continue;
    }
    dropRights(state, p.id);
    if (canSign(state, sheet.teamId, p, sheet.salaries[0] ?? 0).ok) {
      signStandard(state, p, sheet.teamId, sheet.salaries, turn);
      out.push({ ...base, outcome: 'left' });
    } else {
      (state.restricted ??= []).push(rights);
      out.push({ ...base, outcome: 'void' });
    }
  }
  state.offerSheets = [];
  return out;
}

/**
 * Fine della free agency: gli RFA che non hanno firmato (e non hanno un'offerta in attesa di pareggio) firmano la
 * qualifica, un anno con la squadra che ha i diritti.
 */
export function signQualifyingOffers(state: LeagueState, turn: number | null): PlayerState[] {
  const waiting = new Set((state.offerSheets ?? []).map((x) => x.playerId));
  const signed: PlayerState[] = [];
  for (const r of [...(state.restricted ?? [])]) {
    if (waiting.has(r.playerId)) continue;
    const p = state.players.find((x) => x.id === r.playerId);
    dropRights(state, r.playerId);
    if (!p || p.teamId !== null) continue;
    signStandard(state, p, r.teamId, [r.qualifyingOffer], turn);
    signed.push(p);
  }
  return signed;
}

/**
 * Quanto conta il ruolo per una squadra: 1,15 se il ruolo principale del giocatore è scoperto (meno di 3 PG, 3 SG,
 * 3 SF, 2 PF o 2 C con contratto standard, come nel draft iniziale), 0,8 se in quel ruolo ne ha già di più, 1 se è
 * coperto giusto.
 */
export function roleNeed(state: LeagueState, teamId: string, p: Pick<PlayerState, 'role'>): number {
  return roleNeedOf(roleCounts(state, teamId), p.role);
}

/** Contratti standard per ruolo principale di una squadra. */
function roleCounts(state: LeagueState, teamId: string): Map<PlayerState['role'], number> {
  const counts = new Map<PlayerState['role'], number>();
  for (const x of standardRoster(state, teamId)) counts.set(x.role, (counts.get(x.role) ?? 0) + 1);
  return counts;
}

function roleNeedOf(counts: Map<PlayerState['role'], number>, role: PlayerState['role']): number {
  const n = INITIAL_DRAFT_ROLE_TARGET[role] - (counts.get(role) ?? 0);
  return n > 0 ? 1.15 : n < 0 ? 0.8 : 1;
}

/** Offerte che un bot fa al massimo in un turno di free agency. */
export const BOT_OFFERS_PER_ROUND = 3;

/**
 * Offerte dei bot in un turno di free agency. Ogni bot guarda quanto un giocatore vale per la sua strategia (il
 * talento, corretto per il ruolo scoperto: roleNeed) sopra il sostituto, cioè il migliore che firmerebbe comunque al
 * minimo, e spende lo spazio fin dove vuole il proprietario (dal cap alla soglia della tassa: spendAboveCap) sui
 * migliori che può pagare, uno dopo l'altro (con il saldo negativo solo fino al monte stipendi minimo, come vuole
 * canSign). Chi chiede il minimo si firma sempre, per riempire la rosa.
 * Sotto il monte stipendi minimo la differenza si paga comunque a fine regular season: in offseason, dove la rosa
 * arriva a 21, il bot prende un giocatore anche con 15 contratti standard (alla preparazione si taglia il peggiore,
 * e il residuo resta nel monte) e alza l'offerta fino a raggiungere il minimo. Il proprietario cambia quanto spazio
 * spende (chi risparmia tre quarti dello spazio fino al cap, chi vuole vincere subito fino alla tassa), quanto rilancia sopra la richiesta (chi
 * vuole fare colpo fino al 15%) e se preferisce i giovani o i veterani (OWNER_STYLE).
 */
export function botOffers(state: LeagueState, round: number, rng: Rng, opts: { fillTo: number }): Offer[] {
  const c = state.config;
  // Chi ha già scelto un'offerta e aspetta il pareggio della sua squadra non ne riceve altre
  const waiting = new Set((state.offerSheets ?? []).map((x) => x.playerId));
  const free = state.players
    .filter((p) => p.teamId === null && p.age < 39 && !waiting.has(p.id))
    .map((p) => ({ p, ask: askingSalary(state, p, round), minimum: minimumSalaryFor(c, p.yearsInLeague) }));
  const offers: Offer[] = [];
  // Il talento di ogni svincolato si calcola una volta per strategia, i ruoli una volta per squadra
  const talents = new Map<Strategy, number[]>();
  const talentFor = (strategy: Strategy) => {
    let t = talents.get(strategy);
    if (!t) talents.set(strategy, (t = free.map((x) => playerTalent(x.p, strategy, state))));
    return t;
  };
  for (const team of state.teams) {
    if (team.human) continue;
    const pay = payroll(state, team.id);
    let shortfall = state.phase === 'offseason' ? c.minimumTeamSalary - pay : 0;
    const counts = roleCounts(state, team.id);
    const standard = [...counts.values()].reduce((a, b) => a + b, 0);
    const open = Math.min(Math.max(opts.fillTo - standard, shortfall > 0 ? 1 : 0), BOT_OFFERS_PER_ROUND);
    if (open <= 0) continue;
    const style = ownerStyle(team, c.revenue);
    // Le regole permettono di firmare fino alla soglia della tassa: il proprietario decide fin dove spendere
    const limit = c.salaryCap + style.spendAboveCap * (c.luxuryTax - c.salaryCap);
    let space = (team.balance >= 0 ? limit : c.minimumTeamSalary) - pay;
    // Chi spende meno si ferma prima, ma il monte stipendi minimo lo raggiunge comunque
    if (style.spendShare < 1 && space > 0) space = Math.max(shortfall, space * style.spendShare);
    const talent = talentFor(team.strategy);
    const ageF = (age: number) => (age <= 25 ? style.youngFA : age >= 29 ? style.veteranFA : 1);
    const scored = free.map((x, i) => ({
      ...x,
      value: (talent[i] as number) * roleNeedOf(counts, x.p.role) * ageF(x.p.age),
    }));
    const replacement = Math.max(0, ...scored.filter((x) => x.ask <= x.minimum).map((x) => x.value));
    scored.sort((a, b) => b.value - a.value || (a.p.id < b.p.id ? -1 : 1));
    let made = 0;
    for (const { p, ask, minimum, value } of scored) {
      if (made >= open) break;
      if (releasedBy(state, team.id, p.id)) continue;
      let first = ask;
      if (ask > minimum) {
        if (value <= replacement || ask > space) continue;
        first = Math.min(space, Math.round((ask * (1 + rng.next() * style.overAsk)) / 10_000) * 10_000);
      }
      if (shortfall > 0)
        first = Math.max(first, Math.min(shortfall, space, maxSalaryFor(c, p.yearsInLeague)));
      if (first > minimum) space -= first;
      shortfall -= first;
      offers.push({ teamId: team.id, playerId: p.id, salaries: salaryRun(first, typicalYears(p.age)) });
      made++;
    }
  }
  return offers;
}

/** Quanto sopra il minimo può chiedere uno svincolato perché il server lo firmi al minimo (firme automatiche). */
export const MINIMUM_SIGNING_SLACK = 1.2;

/**
 * Svincolati che il server può firmare al minimo per riportare una rosa a 13: sani, sotto i 39 anni, e che
 * chiedono il minimo o poco più (la richiesta dell'ultimo turno di free agency, la più bassa, come in stagione).
 * Chi chiede di più va preso sul mercato. Solo se non resta nessuno così (caso limite) si passa a chi chiede
 * meno, prima i sani: la rosa deve comunque arrivare a 13. Con teamId, senza chi quella squadra ha tagliato in
 * questa stagione. Mai gli RFA: hanno ancora i diritti di una squadra.
 */
export function minimumSigningPool(state: LeagueState, teamId?: string): PlayerState[] {
  const free = state.players.filter(
    (p) =>
      p.teamId === null &&
      p.age < 39 &&
      p.prospect == null &&
      !rightsOf(state, p.id) &&
      (teamId === undefined || !releasedBy(state, teamId, p.id)),
  );
  const ask = (p: PlayerState) => askingSalaryFor(state.config, p, FREE_AGENCY_ROUNDS - 1);
  const minimum = (p: PlayerState) => minimumSalaryFor(state.config, p.yearsInLeague);
  const pool = free.filter((p) => p.injury === null && ask(p) <= minimum(p) * MINIMUM_SIGNING_SLACK);
  if (pool.length) return pool;
  const cheapest = [...free].sort(
    (a, b) =>
      Number(a.injury !== null) - Number(b.injury !== null) || ask(a) / minimum(a) - ask(b) / minimum(b),
  )[0];
  return cheapest ? [cheapest] : [];
}

/** In stagione: chi ha meno di 13 contratti standard firma al minimo i migliori svincolati che lo accettano. */
export function fillMinimumRosters(state: LeagueState, turn: number | null): void {
  for (const team of state.teams) {
    if (team.human) continue;
    while (standardRoster(state, team.id).length < MIN_STANDARD) {
      const free = minimumSigningPool(state, team.id).sort((a, b) => overall(b) - overall(a));
      const p = free[0];
      if (!p) break;
      const salary = minimumSalaryFor(state.config, p.yearsInLeague);
      signContract(
        state,
        p,
        {
          playerId: p.id,
          teamId: team.id,
          type: 'standard',
          salaries: [salary],
          options: [null],
          guaranteed: null,
        },
        turn,
      );
    }
  }
}

/**
 * Squadra umana sotto i 13 contratti standard (il manager non ha risposto all'avviso): il server firma al
 * minimo, per un anno, i migliori svincolati dei ruoli più scoperti tra quelli che accettano il minimo
 * (minimumSigningPool), come la scelta automatica del draft iniziale. Restituisce i giocatori firmati.
 */
export function fillRosterAtMinimum(state: LeagueState, teamId: string, turn: number | null): PlayerState[] {
  const signed: PlayerState[] = [];
  const prospect = (p: PlayerState) => ({
    id: p.id,
    role: p.role,
    secondaryRole: p.secondaryRole,
    overall: overall(p),
  });
  while (standardRoster(state, teamId).length < MIN_STANDARD) {
    const free = minimumSigningPool(state, teamId);
    if (!free.length) break;
    const choice = autoDraftPick(free.map(prospect), standardRoster(state, teamId).map(prospect));
    const p = free.find((x) => x.id === choice.id) as PlayerState;
    signContract(
      state,
      p,
      {
        playerId: p.id,
        teamId,
        type: 'standard',
        salaries: [minimumSalaryFor(state.config, p.yearsInLeague)],
        options: [null],
        guaranteed: null,
      },
      turn,
    );
    signed.push(p);
  }
  return signed;
}
