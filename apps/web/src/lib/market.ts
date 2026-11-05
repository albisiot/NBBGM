// Mercato: letture (svincolati, proposte di scambio, offerte, richieste, bilancio) e azioni, che passano tutte
// dalla Edge Function market. Le richieste degli svincolati e dei rinnovi le calcola l'app con il motore, dalle
// stesse informazioni che vede il server: quello che conta è la decisione del server alla chiusura del turno.
import {
  askingSalaryFor,
  IN_SEASON_ASK_ROUND,
  luxuryTax,
  nextConfig,
  renewalSalaries,
  salaryRun,
  snapToAsk,
  typicalYears,
  type SeasonConfig,
} from '@nbbgm/engine';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { RosterPlayer } from './roster.ts';
import { supabase } from './supabase.ts';

export type MarketAction =
  | { kind: 'bid'; player_id: string; salary: number; years: number }
  | { kind: 'withdraw_bid'; bid_id: string }
  | {
      kind: 'propose_trade';
      to_team_id: string;
      players_from: string[];
      players_to: string[];
      picks_from: string[];
      picks_to: string[];
      protections: Record<string, number>;
      swaps: { draft_year: number; round: number; holder: 'from' | 'to' }[];
    }
  | { kind: 'respond_trade'; offer_id: string; accept: boolean }
  | { kind: 'withdraw_trade'; offer_id: string }
  | { kind: 'release'; player_id: string }
  | { kind: 'renew'; player_id: string }
  | { kind: 'withdraw_request'; request_id: string };

/** Manda un'azione di mercato al server; l'errore è già un messaggio per il manager. */
export async function marketAction(leagueId: string, action: MarketAction): Promise<string> {
  const { data, error } = await supabase.functions.invoke('market', {
    body: { league_id: leagueId, action },
  });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const body = (await error.context.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? 'Azione non riuscita');
    }
    throw error;
  }
  return (data as { id: string }).id;
}

type Num = number | string;

/** Configurazione economica della stagione (cap, soglie, minimi), dalla riga di seasons. */
export async function seasonConfig(seasonId: string): Promise<SeasonConfig> {
  const { data, error } = await supabase
    .from('seasons')
    .select(
      'year, salary_cap, luxury_tax, first_apron, second_apron, minimum_team_salary, minimum_salary, rookie_scale, revenue, growth',
    )
    .eq('id', seasonId)
    .single();
  if (error) throw error;
  const s = data as {
    year: number;
    salary_cap: Num;
    luxury_tax: Num;
    first_apron: Num;
    second_apron: Num;
    minimum_team_salary: Num;
    minimum_salary: Num[];
    rookie_scale: number[][];
    revenue: Num;
    growth: Num;
  };
  return {
    year: s.year,
    salaryCap: Number(s.salary_cap),
    luxuryTax: Number(s.luxury_tax),
    firstApron: Number(s.first_apron),
    secondApron: Number(s.second_apron),
    minimumTeamSalary: Number(s.minimum_team_salary),
    minimumSalary: s.minimum_salary.map(Number),
    rookieScale: s.rookie_scale,
    revenue: Number(s.revenue),
    growth: Number(s.growth),
  };
}

/**
 * Richiesta di uno svincolato, come la calcola il server: in stagione quella di fine free agency, nei turni di
 * free agency dell'offseason quella del turno (scende di turno in turno).
 */
export function freeAgentAsk(config: SeasonConfig, p: RosterPlayer, faRound: number | null = null): number {
  return askingSalaryFor(config, p, faRound ?? IN_SEASON_ASK_ROUND);
}

/** Turno di free agency (0-3) dello stage di offseason, o null. */
export function faRoundOf(stage: string | null): number | null {
  const m = /^fa([1-4])$/.exec(stage ?? '');
  return m ? Number(m[1]) - 1 : null;
}

/**
 * Configurazione con cui lavora il server: dopo il draft dell'offseason è già quella della stagione che arriva.
 */
export function effectiveConfig(
  config: SeasonConfig,
  kind: string | null,
  stage: string | null,
): SeasonConfig {
  return kind === 'offseason' && stage && stage !== 'draft' ? nextConfig(config) : config;
}

/** Richiesta di rinnovo di un giocatore in scadenza nel turno dei rinnovi, come la calcola il server. */
export function expiringAskOf(config: SeasonConfig, p: RosterPlayer): number[] | null {
  if (p.morale < 30) return null;
  return salaryRun(askingSalaryFor(config, p, 0), typicalYears(p.age));
}

export const STAGE_LABEL: Record<string, string> = {
  draft: 'Draft',
  renewals: 'Rinnovi',
  fa1: 'Free agency, turno 1 di 4',
  fa2: 'Free agency, turno 2 di 4',
  fa3: 'Free agency, turno 3 di 4',
  fa4: 'Free agency, turno 4 di 4',
  preparation: 'Preparazione della stagione',
};

/** Stipendi chiesti per il rinnovo (dalla stagione successiva), come li calcola il server. */
export function renewalAsk(config: SeasonConfig, p: RosterPlayer): number[] {
  return renewalSalaries(config, p);
}

/** Cifra proposta di default per un'offerta: la richiesta in milioni con due decimali ("1,45"). */
export function offerInput(ask: number): string {
  return (ask / 1e6).toFixed(2).replace('.', ',');
}

/**
 * Stipendio del primo anno da quello che scrive il manager in milioni ("1,45" o "1.45"); null se non è una cifra.
 * Come fa il server, la cifra mostrata (arrotondata ai 10.000 $) vale come la richiesta esatta.
 */
export function offerSalary(input: string, ask: number): number | null {
  const x = Math.round(Number(input.trim().replace(',', '.')) * 1e6);
  return Number.isFinite(x) && x > 0 ? snapToAsk(x, ask) : null;
}

/** Stipendi con aumento del 5% l'anno, come li firma il server. */
export function salaryRunOf(first: number, years: number): number[] {
  return Array.from({ length: years }, (_, i) => Math.round(first * 1.05 ** i));
}

export interface Bid {
  id: string;
  playerId: string;
  salaries: number[];
  status: string;
  roundId: string;
}

export async function myBids(teamId: string): Promise<Bid[]> {
  const { data, error } = await supabase
    .from('free_agent_bids')
    .select('id, player_id, salaries, status, round_id')
    .eq('team_id', teamId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (
    (data ?? []) as { id: string; player_id: string; salaries: Num[]; status: string; round_id: string }[]
  ).map((b) => ({
    id: b.id,
    playerId: b.player_id,
    salaries: b.salaries.map(Number),
    status: b.status,
    roundId: b.round_id,
  }));
}

export interface RosterRequest {
  id: string;
  playerId: string;
  kind: 'release' | 'renew';
  status: string;
  salaries: number[];
}

export async function myRequests(teamId: string): Promise<RosterRequest[]> {
  const { data, error } = await supabase
    .from('roster_requests')
    .select('id, player_id, kind, status, payload')
    .eq('team_id', teamId)
    .eq('status', 'pending');
  if (error) throw error;
  return (
    (data ?? []) as {
      id: string;
      player_id: string;
      kind: 'release' | 'renew';
      status: string;
      payload: { salaries?: Num[] };
    }[]
  ).map((r) => ({
    id: r.id,
    playerId: r.player_id,
    kind: r.kind,
    status: r.status,
    salaries: (r.payload.salaries ?? []).map(Number),
  }));
}

export interface TradeOffer {
  id: string;
  fromTeamId: string;
  toTeamId: string;
  playersFrom: string[];
  playersTo: string[];
  picksFrom: string[];
  picksTo: string[];
  protections: Record<string, number>;
  swaps: { draft_year: number; round: number; holder_team_id: string; other_team_id: string }[];
  status: string;
  createdAt: string;
}

/** Proposte di scambio della propria squadra (inviate e ricevute), le più recenti per prime. */
export async function tradeOffers(leagueId: string): Promise<TradeOffer[]> {
  const { data, error } = await supabase
    .from('trade_offers')
    .select(
      'id, from_team_id, to_team_id, players_from, players_to, picks_from, picks_to, protections, swaps, status, created_at',
    )
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false })
    .limit(60);
  if (error) throw error;
  type Row = {
    id: string;
    from_team_id: string;
    to_team_id: string;
    players_from: string[];
    players_to: string[];
    picks_from: string[];
    picks_to: string[];
    protections: Record<string, number> | null;
    swaps: TradeOffer['swaps'] | null;
    status: string;
    created_at: string;
  };
  return ((data ?? []) as Row[]).map((o) => ({
    id: o.id,
    fromTeamId: o.from_team_id,
    toTeamId: o.to_team_id,
    playersFrom: o.players_from,
    playersTo: o.players_to,
    picksFrom: o.picks_from,
    picksTo: o.picks_to,
    protections: o.protections ?? {},
    swaps: o.swaps ?? [],
    status: o.status,
    createdAt: o.created_at,
  }));
}

export interface PickInfo {
  id: string;
  draftYear: number;
  round: 1 | 2;
  originalTeamId: string;
  ownerTeamId: string;
  protection: number | null;
}

export async function leaguePicks(leagueId: string): Promise<PickInfo[]> {
  const { data, error } = await supabase
    .from('draft_picks')
    .select('id, draft_year, round, original_team_id, owner_team_id, protection, player_id')
    .eq('league_id', leagueId)
    .is('player_id', null)
    .order('draft_year')
    .order('round');
  if (error) throw error;
  return (
    (data ?? []) as {
      id: string;
      draft_year: number;
      round: 1 | 2;
      original_team_id: string;
      owner_team_id: string;
      protection: number | null;
    }[]
  ).map((k) => ({
    id: k.id,
    draftYear: k.draft_year,
    round: k.round,
    originalTeamId: k.original_team_id,
    ownerTeamId: k.owner_team_id,
    protection: k.protection,
  }));
}

export interface Finance {
  balance: number;
  repeater: boolean;
  /** Monte stipendi della stagione: contratti standard più residui dei tagliati (i two-way sono fuori). */
  payroll: number;
  deadMoney: { playerName: string; salaries: number[] }[];
  ledger: { kind: string; amount: number; note: string | null; createdAt: string }[];
}

export async function teamFinance(teamId: string): Promise<Finance> {
  const [balance, contracts, dead, ledger] = await Promise.all([
    supabase.rpc('team_balance', { p_team: teamId }),
    supabase.from('contracts').select('type, salaries').eq('team_id', teamId),
    supabase.from('dead_money').select('player_name, salaries').eq('team_id', teamId),
    supabase
      .from('ledger')
      .select('kind, amount, note, created_at')
      .eq('team_id', teamId)
      .order('id', { ascending: false })
      .limit(60),
  ]);
  for (const r of [balance, contracts, dead, ledger]) if (r.error) throw r.error;
  const b = balance.data as { balance: Num; tax_history: boolean[] } | null;
  const deadMoney = ((dead.data ?? []) as { player_name: string; salaries: Num[] }[]).map((d) => ({
    playerName: d.player_name,
    salaries: d.salaries.map(Number),
  }));
  const payroll =
    ((contracts.data ?? []) as { type: string; salaries: Num[] }[])
      .filter((c) => c.type !== 'two-way')
      .reduce((a, c) => a + Number(c.salaries[0] ?? 0), 0) +
    deadMoney.reduce((a, d) => a + (d.salaries[0] ?? 0), 0);
  return {
    balance: Number(b?.balance ?? 0),
    repeater: (b?.tax_history ?? []).slice(-4).filter(Boolean).length >= 3,
    payroll,
    deadMoney,
    ledger: (
      (ledger.data ?? []) as { kind: string; amount: Num; note: string | null; created_at: string }[]
    ).map((l) => ({ kind: l.kind, amount: Number(l.amount), note: l.note, createdAt: l.created_at })),
  };
}

/** Luxury tax che si pagherebbe con il monte stipendi di oggi (si calcola a fine regular season). */
export function projectedTax(config: SeasonConfig, f: Finance): number {
  return luxuryTax(config, f.payroll, f.repeater);
}

export const LEDGER_LABEL: Record<string, string> = {
  revenue: 'Ricavi',
  salary: 'Stipendi',
  'two-way': 'Two-way',
  tax: 'Luxury tax',
  'minimum-shortfall': 'Monte stipendi minimo',
  other: 'Altro',
};

export const TRADE_STATUS: Record<string, string> = {
  pending: 'In attesa di risposta',
  accepted: 'Accettato: si esegue alla chiusura del turno',
  rejected: 'Rifiutato',
  withdrawn: 'Ritirato',
  executed: 'Eseguito',
  void: 'Saltato: non era più valido',
  expired: 'Scaduto senza risposta',
};

export const BID_STATUS: Record<string, string> = {
  pending: 'In attesa della chiusura del turno',
  won: 'Firmato',
  lost: 'Non firmato',
  invalid: 'Non valida',
  withdrawn: 'Ritirata',
};

/** "12,35 mln" */
export function millions(x: number): string {
  return `${(x / 1e6).toFixed(2).replace('.', ',')} mln`;
}
