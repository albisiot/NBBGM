// Mercato: letture (svincolati, proposte di scambio, offerte, richieste, bilancio) e azioni, che passano tutte
// dalla Edge Function market. Le richieste degli svincolati e dei rinnovi le calcola l'app con il motore, dalle
// stesse informazioni che vede il server: quello che conta è la decisione del server alla chiusura del turno.
import {
  askingSalaryFor,
  IN_SEASON_ASK_ROUND,
  luxuryTax,
  minimumSalaryFor,
  nextConfig,
  renewalSalaries,
  salaryRun,
  snapToAsk,
  typicalYears,
  type Ratings,
  type SeasonConfig,
} from '@nbbgm/engine';
import { FunctionsHttpError } from '@supabase/supabase-js';
import type { RosterPlayer } from './roster.ts';
import { SKILL_GROUPS, skillOf, type SkillKey } from './skills.ts';
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
export function freeAgentAsk(
  config: SeasonConfig,
  p: Pick<RosterPlayer, 'ratings' | 'role' | 'age' | 'yearsInLeague' | 'scoutedPotential' | 'morale'>,
  faRound: number | null = null,
): number {
  return askingSalaryFor(config, p, faRound ?? IN_SEASON_ASK_ROUND);
}

/**
 * Giocatori citati da offerte agli svincolati e proposte di scambio che la pagina non conosce ancora (non sono
 * nella propria rosa né tra gli svincolati): solo questi si scaricano, per scriverne nome, ruolo e overall.
 */
export function missingPlayerIds(
  offers: readonly Pick<TradeOffer, 'playersFrom' | 'playersTo'>[],
  bids: readonly Pick<Bid, 'playerId'>[],
  known: ReadonlyMap<string, unknown>,
): string[] {
  const ids = new Set<string>();
  for (const o of offers) for (const id of [...o.playersFrom, ...o.playersTo]) ids.add(id);
  for (const b of bids) ids.add(b.playerId);
  return [...ids].filter((id) => !known.has(id));
}

/** Turno di free agency (0-3) dello stage di offseason, o null. */
export function faRoundOf(stage: string | null): number | null {
  const m = /^fa([1-4])$/.exec(stage ?? '');
  return m ? Number(m[1]) - 1 : null;
}

/** Turno dell'offseason dopo il draft: contratti e configurazione sono già quelli della stagione che arriva. */
const afterDraft = (kind: string | null, stage: string | null) =>
  kind === 'offseason' && stage !== null && stage !== 'draft';

/**
 * Configurazione con cui lavora il server: dopo il draft dell'offseason è già quella della stagione che arriva.
 */
export function effectiveConfig(
  config: SeasonConfig,
  kind: string | null,
  stage: string | null,
): SeasonConfig {
  return afterDraft(kind, stage) ? nextConfig(config) : config;
}

/**
 * Stagione del primo stipendio di un contratto: quella in corso, oppure, dopo il draft dell'offseason (contratti
 * già scalati), quella che arriva.
 */
export function contractFirstYear(seasonYear: number, kind: string | null, stage: string | null): number {
  return afterDraft(kind, stage) ? seasonYear + 1 : seasonYear;
}

/** Richiesta di rinnovo di un giocatore in scadenza nel turno dei rinnovi, come la calcola il server. */
export function expiringAskOf(config: SeasonConfig, p: RosterPlayer): number[] | null {
  if (p.morale < 30) return null;
  return salaryRun(askingSalaryFor(config, p, 0), typicalYears(p.age));
}

// Etichette dei turni dell'offseason: stanno in turns.ts, che non carica il motore (serve anche all'intestazione)
export { STAGE_LABEL } from './turns.ts';

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

/**
 * Filtro PostgREST per le righe in cui la squadra compare in una delle colonne:
 * "owner_team_id.eq.X,original_team_id.eq.X".
 */
export function involving(teamId: string, columns: readonly string[]): string {
  return columns.map((c) => `${c}.eq.${teamId}`).join(',');
}

/**
 * Scelte al draft future della lega; con teamId solo quelle che la squadra possiede o ha ceduto (la pagina della
 * squadra non scarica le circa 400 della lega per mostrarne una trentina).
 */
export async function leaguePicks(leagueId: string, teamId?: string): Promise<PickInfo[]> {
  let query = supabase
    .from('draft_picks')
    .select('id, draft_year, round, original_team_id, owner_team_id, protection, player_id')
    .eq('league_id', leagueId)
    .is('player_id', null);
  if (teamId) query = query.or(involving(teamId, ['owner_team_id', 'original_team_id']));
  const { data, error } = await query.order('draft_year').order('round');
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

// ---------------------------------------------------------------- ricerca tra gli svincolati

/** Uno svincolato nell'elenco, con overall, richiesta e minimo per la sua anzianità. */
export interface FreeAgentRow<P> {
  p: P;
  ovr: number;
  ask: number;
  minimum: number;
}

/** Ordinamento: overall, potenziale stimato, età, richiesta o un gruppo di abilità (bisogni della squadra). */
export type FreeAgentSort = 'overall' | 'potential' | 'age' | 'ask' | `skill:${SkillKey}`;
export type AgeBand = 'all' | 'young' | 'prime' | 'veteran';
/** Richiesta: tutte, al minimo, fino al minimo + 2 o + 5 milioni, dentro lo spazio sotto il cap. */
export type AskBand = 'all' | 'min' | 'min2' | 'min5' | 'space';

export interface FreeAgentQuery {
  name: string;
  role: string;
  age: AgeBand;
  ask: AskBand;
  sort: FreeAgentSort;
}

export const DEFAULT_FA_QUERY: FreeAgentQuery = {
  name: '',
  role: 'all',
  age: 'all',
  ask: 'all',
  sort: 'overall',
};

export const AGE_BANDS: { value: AgeBand; label: string }[] = [
  { value: 'all', label: 'Tutte le età' },
  { value: 'young', label: 'Fino a 24 anni' },
  { value: 'prime', label: 'Da 25 a 30' },
  { value: 'veteran', label: 'Da 31 in su' },
];

export const ASK_BANDS: { value: AskBand; label: string }[] = [
  { value: 'all', label: 'Qualsiasi richiesta' },
  { value: 'min', label: 'Al minimo' },
  { value: 'min2', label: 'Fino al minimo + 2 mln' },
  { value: 'min5', label: 'Fino al minimo + 5 mln' },
  { value: 'space', label: 'Dentro lo spazio sotto il cap' },
];

export const FA_SORTS: { value: FreeAgentSort; label: string }[] = [
  { value: 'overall', label: 'Overall' },
  { value: 'potential', label: 'Potenziale' },
  { value: 'age', label: 'Età' },
  { value: 'ask', label: 'Richiesta' },
  ...SKILL_GROUPS.map((g) => ({ value: `skill:${g.key}` as FreeAgentSort, label: g.label })),
];

/** Svincolati per pagina; "Mostra altri" ne aggiunge altrettanti. */
export const FA_PAGE = 30;

/** Minimo di uno svincolato (per anzianità), per i filtri sulla richiesta. */
export function minimumOf(config: SeasonConfig, p: { yearsInLeague: number | null }): number {
  return minimumSalaryFor(config, p.yearsInLeague);
}

/** Minuscole e senza accenti: "Dončić" si trova scrivendo "doncic". */
export function plain(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

/** Tolleranza sulla richiesta: la cifra mostrata (arrotondata) vale come quella esatta (snapToAsk). */
const ASK_TOLERANCE = 5_000;

/**
 * Svincolati filtrati per nome, ruolo (principale o secondario), età e richiesta, e ordinati. space è lo spazio
 * sotto il cap: sopra il cap si firma solo al minimo, quindi "dentro lo spazio" comprende sempre chi chiede il
 * minimo. A parità si ordina per overall e poi per nome.
 */
export function filterFreeAgents<
  P extends {
    firstName: string;
    lastName: string;
    role: string;
    secondaryRole: string | null;
    age: number;
    scoutedPotential: number;
    ratings?: Partial<Ratings>;
  },
>(rows: readonly FreeAgentRow<P>[], q: FreeAgentQuery, space: number): FreeAgentRow<P>[] {
  const words = plain(q.name).split(/\s+/).filter(Boolean);
  const inAge = (age: number) =>
    q.age === 'all' ||
    (q.age === 'young' && age <= 24) ||
    (q.age === 'prime' && age >= 25 && age <= 30) ||
    (q.age === 'veteran' && age >= 31);
  const inAsk = (r: FreeAgentRow<P>) => {
    const over = r.ask - r.minimum;
    switch (q.ask) {
      case 'min':
        return over <= ASK_TOLERANCE;
      case 'min2':
        return over <= 2e6 + ASK_TOLERANCE;
      case 'min5':
        return over <= 5e6 + ASK_TOLERANCE;
      case 'space':
        return over <= ASK_TOLERANCE || r.ask <= space + ASK_TOLERANCE;
      default:
        return true;
    }
  };
  const fixed: Record<'overall' | 'potential' | 'age' | 'ask', (r: FreeAgentRow<P>) => number> = {
    overall: (r) => -r.ovr,
    potential: (r) => -r.p.scoutedPotential,
    age: (r) => r.p.age,
    ask: (r) => r.ask,
  };
  const skill = q.sort.startsWith('skill:') ? (q.sort.slice(6) as SkillKey) : null;
  const sortKey = skill
    ? (r: FreeAgentRow<P>) => -skillOf(r.p.ratings, skill)
    : fixed[q.sort as keyof typeof fixed];
  const name = (r: FreeAgentRow<P>) => `${r.p.lastName} ${r.p.firstName}`;
  return rows
    .filter((r) => {
      if (q.role !== 'all' && r.p.role !== q.role && r.p.secondaryRole !== q.role) return false;
      if (!inAge(r.p.age) || !inAsk(r)) return false;
      if (words.length === 0) return true;
      const full = plain(`${r.p.firstName} ${r.p.lastName}`);
      return words.every((w) => full.includes(w));
    })
    .sort((a, b) => sortKey(a) - sortKey(b) || b.ovr - a.ovr || name(a).localeCompare(name(b), 'it'));
}
