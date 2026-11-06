import { overall } from '../overall.ts';
import type { Contract, Player } from '../types.ts';
import { luxuryTax, maxSalaryFor, minimumSalaryFor, twoWaySalary, type SeasonConfig } from './config.ts';
import type { LeagueState, PlayerState } from './state.ts';

export const MAX_STANDARD = 15;
export const MIN_STANDARD = 13;
export const MAX_TWO_WAY = 3;
export const OFFSEASON_MAX_ROSTER = 21;
export const TWO_WAY_GAME_LIMIT = 50;

export function contractOf(state: LeagueState, playerId: string): Contract | undefined {
  return state.contracts.find((c) => c.playerId === playerId);
}

export function roster(state: LeagueState, teamId: string): PlayerState[] {
  return state.players.filter((p) => p.teamId === teamId);
}

export function standardRoster(state: LeagueState, teamId: string): PlayerState[] {
  return roster(state, teamId).filter((p) => contractOf(state, p.id)?.type !== 'two-way');
}

export function twoWayRoster(state: LeagueState, teamId: string): PlayerState[] {
  return roster(state, teamId).filter((p) => contractOf(state, p.id)?.type === 'two-way');
}

/** Monte stipendi della stagione corrente: contratti standard più residui dei tagliati. I two-way sono fuori. */
export function payroll(state: LeagueState, teamId: string): number {
  let total = 0;
  for (const c of state.contracts)
    if (c.teamId === teamId && c.type !== 'two-way') total += c.salaries[0] ?? 0;
  for (const d of state.deadMoney) if (d.teamId === teamId) total += d.salaries[0] ?? 0;
  return total;
}

export function isRepeater(taxHistory: readonly boolean[]): boolean {
  return taxHistory.slice(-4).filter(Boolean).length >= 3;
}

export interface SignCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Regole NBA semplificate per firmare uno svincolato: sotto il cap fino a esaurire lo spazio, sopra il cap
 * solo al minimo; con saldo negativo solo al minimo e solo per restare a 13.
 */
export function canSign(
  state: LeagueState,
  teamId: string,
  player: Pick<Player, 'yearsInLeague'>,
  salary: number,
  type: Contract['type'] = 'standard',
): SignCheck {
  const c = state.config;
  if (type === 'two-way') {
    if (twoWayRoster(state, teamId).length >= MAX_TWO_WAY) return { ok: false, reason: 'già 3 two-way' };
    // In offseason la rosa arriva a 21 giocatori in tutto, two-way compresi
    if (state.phase === 'offseason' && roster(state, teamId).length >= OFFSEASON_MAX_ROSTER)
      return { ok: false, reason: 'rosa piena' };
    return { ok: true };
  }
  const offseason = state.phase === 'offseason';
  const count = standardRoster(state, teamId).length;
  const total = roster(state, teamId).length;
  if (!offseason && count >= MAX_STANDARD) return { ok: false, reason: 'rosa piena' };
  if (offseason && total >= OFFSEASON_MAX_ROSTER) return { ok: false, reason: 'rosa piena' };
  const minimum = minimumSalaryFor(c, player.yearsInLeague);
  const isMinimum = salary <= minimum;
  if (salary > maxSalaryFor(c, player.yearsInLeague)) return { ok: false, reason: 'sopra il massimo' };
  const team = state.teams.find((t) => t.id === teamId);
  if (team && team.balance < 0 && !(isMinimum && count < MIN_STANDARD)) {
    return { ok: false, reason: 'saldo negativo: solo minimi per restare a 13' };
  }
  if (isMinimum) return { ok: true };
  if (payroll(state, teamId) + salary > c.salaryCap)
    return { ok: false, reason: 'sopra il cap: solo minimi' };
  return { ok: true };
}

/** Ricavi e stipendi di un turno di regular season (1/82 della stagione). */
export function chargeTurn(state: LeagueState): void {
  const c = state.config;
  for (const team of state.teams) {
    const twoWays = twoWayRoster(state, team.id).length * twoWaySalary(c);
    team.balance += (c.revenue - payroll(state, team.id) - twoWays) / 82;
  }
}

export interface SeasonSettlement {
  teamId: string;
  payroll: number;
  tax: number;
  shortfall: number;
}

/** A fine regular season: luxury tax a scaglioni e differenza per chi è sotto il monte stipendi minimo. */
export function settleSeason(state: LeagueState): SeasonSettlement[] {
  const c = state.config;
  return state.teams.map((team) => {
    const p = payroll(state, team.id);
    const tax = luxuryTax(c, p, isRepeater(team.taxHistory));
    const shortfall = Math.max(0, c.minimumTeamSalary - p);
    team.balance -= tax + shortfall;
    team.taxHistory.push(tax > 0);
    return { teamId: team.id, payroll: p, tax, shortfall };
  });
}

/**
 * Valore di mercato di un giocatore per una stagione: dal minimo per anzianità al massimo, in base a overall,
 * età e potenziale stimato.
 */
export function marketValue(
  c: SeasonConfig,
  p: Pick<PlayerState, 'ratings' | 'role' | 'age' | 'yearsInLeague' | 'scoutedPotential'>,
): number {
  const ovr = overall(p);
  const minimum = minimumSalaryFor(c, p.yearsInLeague);
  const max = maxSalaryFor(c, p.yearsInLeague);
  const youth = p.age <= 24 ? Math.max(0, p.scoutedPotential - ovr) * 0.35 : 0;
  const level = ovr + youth - (p.age >= 31 ? (p.age - 30) * 1.5 : 0);
  const t = Math.max(0, Math.min(1, (level - 58) / 30)) ** 2.1;
  return Math.round((minimum + (max - minimum) * t) / 10_000) * 10_000;
}

/** Anni di contratto proposti di solito in base all'età. */
export function typicalYears(age: number): number {
  return age <= 25 ? 4 : age <= 28 ? 3 : age <= 31 ? 2 : 1;
}

/** Stipendi di un contratto con aumento annuo del 5%. */
export function salaryRun(first: number, years: number): number[] {
  return Array.from({ length: years }, (_, i) => Math.round(first * 1.05 ** i));
}

/**
 * Taglio: il giocatore torna svincolato, lo stipendio residuo resta per intero a carico della squadra
 * (sul cap e sul bilancio) fino alla scadenza. I two-way non lasciano residui.
 */
export function releasePlayer(state: LeagueState, playerId: string, turn: number | null): void {
  const p = state.players.find((x) => x.id === playerId);
  const c = contractOf(state, playerId);
  if (!p || !c) return;
  if (c.type !== 'two-way' && c.salaries.length) {
    state.deadMoney.push({
      teamId: c.teamId,
      playerName: `${p.firstName} ${p.lastName}`,
      salaries: [...c.salaries],
    });
  }
  state.contracts = state.contracts.filter((x) => x !== c);
  state.transactions.push({
    year: state.config.year,
    turn,
    type: 'release',
    text: `${c.teamId} taglia ${p.firstName} ${p.lastName}`,
  });
  p.teamId = null;
}

/** Firma un contratto (sostituisce quello eventuale) e mette il giocatore in squadra. */
export function signContract(
  state: LeagueState,
  player: PlayerState,
  contract: Contract,
  turn: number | null,
  renewal = false,
): void {
  state.contracts = state.contracts.filter((c) => c.playerId !== player.id);
  state.contracts.push(contract);
  player.teamId = contract.teamId;
  const money = contract.salaries.length
    ? `${contract.salaries.length} anni, ${(contract.salaries[0]! / 1e6).toFixed(1)} mln`
    : 'two-way';
  state.transactions.push({
    year: state.config.year,
    turn,
    type: renewal ? 'renewal' : 'signing',
    text: `${contract.teamId} ${renewal ? 'rinnova' : 'firma'} ${player.firstName} ${player.lastName} (${money})`,
  });
}
