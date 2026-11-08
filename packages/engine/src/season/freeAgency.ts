import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import { maxSalaryFor, minimumSalaryFor, type SeasonConfig } from './config.ts';
import { teamStrength, playerTalent } from './bots.ts';
import { autoDraftPick, INITIAL_DRAFT_ROLE_TARGET } from './initialDraft.ts';
import {
  MIN_STANDARD,
  canSign,
  marketValue,
  payroll,
  releasedBy,
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
export const FREE_AGENCY_ROUNDS = 4;

/**
 * Richiesta minima di uno svincolato: il suo valore di mercato, un po' più alta con il morale basso,
 * che scende di turno in turno senza andare sotto il minimo né sopra il massimo per la sua anzianità.
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
  const ask = marketValue(c, p) * (1 + (50 - p.morale) / 400) * (1 - 0.12 * round);
  return Math.min(maxSalaryFor(c, p.yearsInLeague), Math.max(minimum, Math.round(ask / 10_000) * 10_000));
}

/** Scarto massimo tra un'offerta e la richiesta perché valga come la richiesta esatta. */
export const ASK_ROUNDING = 5_000;

/**
 * Le richieste si mostrano in milioni con due decimali, cioè arrotondate ai 10.000 $, ma i minimi non sono cifre
 * tonde (1.452.806 $ si legge "1,45"). Un'offerta che dista dalla richiesta non più di 5.000 $ è la cifra mostrata
 * e vale come la richiesta esatta: chi offre quello che vede firma alla richiesta, e un minimo resta un minimo
 * (sopra il cap è l'unica firma possibile).
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

/**
 * Risolve un turno di offerte: ogni svincolato sceglie, tra quelle sopra la richiesta, l'offerta con il
 * punteggio più alto (a parità, la squadra peggio classificata). Restituisce gli id firmati.
 */
export function resolveOffers(
  state: LeagueState,
  offers: readonly Offer[],
  round: number,
  worstFirst: readonly string[],
  turn: number | null,
): string[] {
  const appeal = teamAppeal(state);
  const byPlayer = new Map<string, Offer[]>();
  for (const o of offers) byPlayer.set(o.playerId, [...(byPlayer.get(o.playerId) ?? []), o]);
  const signed: string[] = [];
  // I migliori scelgono per primi: le firme consumano spazio salariale e posti in rosa
  const order = [...byPlayer.keys()]
    .map((id) => state.players.find((p) => p.id === id) as PlayerState)
    .sort((a, b) => overall(b) - overall(a));
  for (const p of order) {
    if (p.teamId !== null) continue;
    const ask = askingSalary(state, p, round);
    const valid = (byPlayer.get(p.id) ?? []).filter(
      (o) => (o.salaries[0] ?? 0) >= ask && canSign(state, o.teamId, p, o.salaries[0] ?? 0).ok,
    );
    if (!valid.length) continue;
    const best = valid.reduce((a, b) => {
      const sa = offerScore(state, p, a, ask, appeal);
      const sb = offerScore(state, p, b, ask, appeal);
      if (sb > sa + 1e-9) return b;
      if (Math.abs(sb - sa) <= 1e-9 && worstFirst.indexOf(b.teamId) < worstFirst.indexOf(a.teamId)) return b;
      return a;
    });
    signContract(
      state,
      p,
      {
        playerId: p.id,
        teamId: best.teamId,
        type: 'standard',
        salaries: best.salaries,
        options: best.salaries.map(() => null),
        guaranteed: null,
      },
      turn,
    );
    signed.push(p.id);
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
 * minimo, e spende lo spazio sotto il cap sui migliori che può pagare, uno dopo l'altro (con il saldo negativo solo
 * fino al monte stipendi minimo, come vuole canSign). Chi chiede il minimo si firma sempre, per riempire la rosa.
 * Sotto il monte stipendi minimo la differenza si paga comunque a fine regular season: in offseason, dove la rosa
 * arriva a 21, il bot prende un giocatore anche con 15 contratti standard (alla preparazione si taglia il peggiore,
 * e il residuo resta nel monte) e alza l'offerta fino a raggiungere il minimo. Il proprietario cambia quanto spazio
 * spende (chi risparmia tre quarti dello spazio sotto il cap, chi costruisce con pazienza il 90%), quanto rilancia sopra la richiesta (chi
 * vuole fare colpo fino al 15%) e se preferisce i giovani o i veterani (OWNER_STYLE).
 */
export function botOffers(state: LeagueState, round: number, rng: Rng, opts: { fillTo: number }): Offer[] {
  const c = state.config;
  const free = state.players
    .filter((p) => p.teamId === null && p.age < 39)
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
    let space = (team.balance >= 0 ? c.salaryCap : c.minimumTeamSalary) - pay;
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
 * questa stagione.
 */
export function minimumSigningPool(state: LeagueState, teamId?: string): PlayerState[] {
  const free = state.players.filter(
    (p) =>
      p.teamId === null &&
      p.age < 39 &&
      p.prospect == null &&
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
