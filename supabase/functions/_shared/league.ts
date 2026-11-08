// Passaggi tra il database e il motore, comuni alla Edge Function create-league (Deno) e agli script (Node):
// dati di partenza (tabelle base_*) <-> LeagueData del motore, e LeagueState -> righe per insert_league.
// Nessuna dipendenza oltre al pacchetto engine; gli import usano l'estensione .ts come vuole Deno.
import {
  autoSetup,
  coachOf,
  coachSetup,
  INITIAL_DRAFT_ROUNDS,
  minimumSalaryFor,
  overall,
  roster,
  snakeOrder,
  TEAMS,
} from '../../../packages/engine/src/index.ts';
import type {
  Contract,
  DeadMoney,
  DraftInfo,
  DraftMode,
  Hidden,
  LeagueData,
  LeagueState,
  Player,
  Ratings,
  Role,
  Tendencies,
} from '../../../packages/engine/src/index.ts';

/** Dataset dei dati di partenza usato per le leghe nuove. */
export const BASE_DATASET = '2026-27';

/** Leghe che un utente può avere create (come private.max_leagues_per_user nel database). */
export const MAX_LEAGUES_PER_USER = 5;

export const LEAGUE_LIMIT_MESSAGE = `Hai già creato ${MAX_LEAGUES_PER_USER} leghe: eliminane una per crearne un'altra`;

export interface BaseTeamRow {
  code: string;
  city: string;
  name: string;
  full_name: string;
  conference: string;
  division: string;
}

export interface BasePlayerRow {
  dataset: string;
  slug: string;
  team_code: string | null;
  first_name: string;
  last_name: string;
  nationality: string;
  role: string;
  secondary_role: string | null;
  hand: string;
  archetype: string;
  age: number;
  height_cm: number | string;
  wingspan_cm: number | string;
  weight_kg: number | string;
  years_in_league: number | null;
  /** Draft NBA (null: non noto); manca nelle righe scritte prima della colonna. */
  draft?: DraftInfo | null;
  ratings: Record<string, number>;
  tendencies: Record<string, number>;
  hidden: Record<string, number>;
}

export interface BaseContractRow {
  dataset: string;
  player_slug: string;
  team_code: string;
  type: string;
  salaries: (number | string)[];
  options: (string | null)[];
  guaranteed: number | string | null;
}

export interface BaseDeadMoneyRow {
  dataset: string;
  team_code: string;
  player_name: string;
  salaries: (number | string)[];
}

export interface BaseRows {
  players: BasePlayerRow[];
  contracts: BaseContractRow[];
  deadMoney: BaseDeadMoneyRow[];
}

export function baseTeamRows(): BaseTeamRow[] {
  return TEAMS.map((t) => ({
    code: t.id,
    city: t.city,
    name: t.name,
    full_name: t.fullName,
    conference: t.conference,
    division: t.division,
  }));
}

/** Lega importata (o generata) -> righe delle tabelle base_*. */
export function baseRowsFromLeague(league: LeagueData, dataset = league.season): BaseRows {
  return {
    players: league.players.map((p) => ({
      dataset,
      slug: p.id,
      team_code: p.teamId,
      first_name: p.firstName,
      last_name: p.lastName,
      nationality: p.nationality,
      role: p.role,
      secondary_role: p.secondaryRole,
      hand: p.hand,
      archetype: p.archetype,
      age: p.age,
      height_cm: p.heightCm,
      wingspan_cm: p.wingspanCm,
      weight_kg: p.weightKg,
      years_in_league: p.yearsInLeague,
      draft: p.draft ?? null,
      ratings: p.ratings,
      tendencies: p.tendencies,
      hidden: p.hidden,
    })),
    contracts: league.contracts.map((c) => ({
      dataset,
      player_slug: c.playerId,
      team_code: c.teamId,
      type: c.type,
      salaries: c.salaries,
      options: c.options,
      guaranteed: c.guaranteed,
    })),
    deadMoney: league.deadMoney.map((d) => ({
      dataset,
      team_code: d.teamId,
      player_name: d.playerName,
      salaries: d.salaries,
    })),
  };
}

// Postgres restituisce numeric e bigint come stringhe: qui tornano numeri
const num = (x: number | string) => Number(x);

/** Righe delle tabelle base_* -> lega per il motore (le squadre sono le 30 della tabella fissa). */
export function leagueFromBaseRows(rows: BaseRows, dataset = BASE_DATASET): LeagueData {
  const players = [...rows.players]
    .sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0))
    .map((p): Player & { teamId: string | null } => ({
      id: p.slug,
      firstName: p.first_name,
      lastName: p.last_name,
      nationality: p.nationality,
      role: p.role as Role,
      secondaryRole: p.secondary_role as Role | null,
      hand: p.hand as 'R' | 'L',
      archetype: p.archetype,
      age: p.age,
      heightCm: num(p.height_cm),
      wingspanCm: num(p.wingspan_cm),
      weightKg: num(p.weight_kg),
      yearsInLeague: p.years_in_league,
      draft: p.draft ?? null,
      ratings: p.ratings as Ratings,
      tendencies: p.tendencies as Tendencies,
      hidden: p.hidden as Hidden,
      energy: 100,
      morale: 60,
      injury: null,
      teamId: p.team_code,
    }));
  const contracts = [...rows.contracts]
    .sort((a, b) => (a.player_slug < b.player_slug ? -1 : a.player_slug > b.player_slug ? 1 : 0))
    .map((c): Contract => ({
      playerId: c.player_slug,
      teamId: c.team_code,
      type: c.type as Contract['type'],
      salaries: c.salaries.map(num),
      options: c.options.map((o) => (o === 'player' || o === 'team' ? o : null)),
      guaranteed: c.guaranteed === null ? null : num(c.guaranteed),
    }));
  const deadMoney = rows.deadMoney.map((d): DeadMoney => ({
    teamId: d.team_code,
    playerName: d.player_name,
    salaries: d.salaries.map(num),
  }));
  return { season: dataset, teams: [...TEAMS], players, contracts, deadMoney };
}

/** Id stabili per chiave: la stessa chiave dà sempre lo stesso uuid (squadre citate da giocatori e partite). */
export function keyedIds(newId: (key: string) => string): (key: string) => string {
  const ids = new Map<string, string>();
  return (key) => {
    let id = ids.get(key);
    if (id === undefined) {
      id = newId(key);
      ids.set(key, id);
    }
    return id;
  };
}

export interface LeagueSettings {
  deadline_minutes: number | null;
  max_pace_seconds: number;
  roster_mode: 'real' | 'draft';
  draft_mode: 'list' | 'live';
  rookie_source: 'generated' | 'real';
}

export const DEFAULT_SETTINGS: LeagueSettings = {
  deadline_minutes: null,
  max_pace_seconds: 60,
  roster_mode: 'real',
  draft_mode: 'list',
  rookie_source: 'generated',
};

/**
 * Scadenza dei turni e ritmo massimo più brevi ammessi (le scelte più brevi dell'app). Li controllano anche i
 * vincoli di leagues (terza analisi): con una scadenza di un minuto, o il ritmo a 0, una lega giocava 1.440 turni al
 * giorno, con circa 145 MB di database e 1.440 chiamate ad advance-turn.
 */
export const MIN_DEADLINE_MINUTES = 15;
export const MIN_PACE_SECONDS = 60;

export class SettingsError extends Error {}

/** Impostazioni della lega dalla richiesta di create-league, con i controlli dei valori ammessi. */
export function readSettings(raw: unknown): LeagueSettings & { pick_seconds: number } {
  const s = {
    ...DEFAULT_SETTINGS,
    pick_seconds: 60,
    ...(typeof raw === 'object' && raw !== null ? raw : {}),
  } as LeagueSettings & { pick_seconds: number };
  if (
    s.deadline_minutes !== null &&
    !(Number.isInteger(s.deadline_minutes) && s.deadline_minutes >= MIN_DEADLINE_MINUTES)
  )
    throw new SettingsError(`La scadenza dei turni è di almeno ${MIN_DEADLINE_MINUTES} minuti`);
  if (!(Number.isInteger(s.max_pace_seconds) && s.max_pace_seconds >= MIN_PACE_SECONDS))
    throw new SettingsError('Il ritmo massimo è di al più un turno al minuto');
  if (!['real', 'draft'].includes(s.roster_mode)) throw new SettingsError('Rose iniziali non valide');
  if (!(Number.isInteger(s.pick_seconds) && s.pick_seconds >= 10 && s.pick_seconds <= 600))
    throw new SettingsError('Tempo per scelta non valido');
  if (!['list', 'live'].includes(s.draft_mode)) throw new SettingsError('Modalità del draft non valida');
  if (!['generated', 'real'].includes(s.rookie_source))
    throw new SettingsError('Origine dei rookie non valida');
  return {
    deadline_minutes: s.deadline_minutes,
    max_pace_seconds: s.max_pace_seconds,
    roster_mode: s.roster_mode,
    draft_mode: s.draft_mode,
    rookie_source: s.rookie_source,
    pick_seconds: s.pick_seconds,
  };
}

export interface LeaguePayloadOptions {
  /** Id per chiave (league, season:2026, team:BOS, player:<slug>...): usa keyedIds. */
  id: (key: string) => string;
  name: string;
  commissionerId: string;
  /** Sigla della squadra -> utente che la guida. Le altre restano ai bot. */
  owners: Record<string, string>;
  settings?: Partial<LeagueSettings>;
  /** Facoltativo: se manca lo genera il database. */
  inviteCode?: string;
  /** Salva per le squadre umane le impostazioni del pulsante Auto. */
  withTeamSettings?: boolean;
  /**
   * Draft iniziale (rose vuote, createLeagueState con emptyRosters): i contratti del file diventano quelli che i
   * giocatori firmano con chi li sceglie.
   */
  initialDraft?: { mode: DraftMode; pickSeconds: number; contracts: readonly Contract[] };
}

/** Ordine delle chiamate e giocatori in palio: tutti tranne i two-way, con il contratto del file o il minimo. */
export function initialDraftSection(
  state: LeagueState,
  d: NonNullable<LeaguePayloadOptions['initialDraft']>,
  team: (code: string) => string,
  player: (slug: string) => string,
): Record<string, unknown> {
  const contracts = new Map(d.contracts.map((c) => [c.playerId, c]));
  const pool = state.players
    .filter((p) => contracts.get(p.id)?.type !== 'two-way')
    .map((p) => {
      const c = contracts.get(p.id);
      const signed = c && c.salaries.length > 0;
      return {
        player_id: player(p.id),
        overall: Math.round(overall(p) * 10) / 10,
        contract_type: signed ? c.type : 'minimum',
        salaries: signed ? c.salaries : [minimumSalaryFor(state.config, p.yearsInLeague)],
        options: signed ? c.options : [null],
        guaranteed: signed ? c.guaranteed : null,
      };
    });
  const order = snakeOrder(
    state.teams.map((t) => t.id),
    INITIAL_DRAFT_ROUNDS,
    state.seed,
  );
  if (pool.length < order.length) throw new Error(`Giocatori insufficienti per il draft: ${pool.length}`);
  return { mode: d.mode, pick_seconds: d.pickSeconds, team_order: order.map(team), pool };
}

/** Stato del motore appena creato -> argomento di insert_league. */
export function leaguePayload(state: LeagueState, o: LeaguePayloadOptions): Record<string, unknown> {
  const year = state.config.year;
  const team = (code: string) => o.id(`team:${code}`);
  const player = (slug: string) => o.id(`player:${slug}`);
  const c = state.config;
  const settings = { ...DEFAULT_SETTINGS, ...o.settings };
  const members = Object.values(o.owners)
    .filter((u) => u !== o.commissionerId)
    .map((user_id) => ({ user_id, role: 'manager' }));

  return {
    league: {
      id: o.id('league'),
      name: o.name,
      invite_code: o.inviteCode ?? null,
      commissioner_id: o.commissionerId,
      ...settings,
      seed: state.seed,
      talent_reference: state.talentReference,
    },
    members,
    season: {
      id: o.id(`season:${year}`),
      year,
      phase: 'regular',
      salary_cap: c.salaryCap,
      luxury_tax: c.luxuryTax,
      first_apron: c.firstApron,
      second_apron: c.secondApron,
      minimum_team_salary: c.minimumTeamSalary,
      minimum_salary: c.minimumSalary,
      rookie_scale: c.rookieScale,
      revenue: c.revenue,
      growth: c.growth,
    },
    round: { id: o.id(`round:${year}:${state.turn}`), number: state.turn, kind: 'regular', day: state.day },
    teams: state.teams.map((t) => ({
      id: team(t.id),
      code: t.id,
      city: t.city,
      name: t.name,
      full_name: t.fullName,
      conference: t.conference,
      division: t.division,
      owner_id: o.owners[t.id] ?? null,
      balance: Math.round(t.balance),
      strategy: t.strategy,
      tax_history: t.taxHistory,
      owner_profile: t.owner ?? null,
      expected_wins: t.expectedWins ?? null,
    })),
    // Allenatori, in panchina e liberi, e gli esonerati da pagare (alla creazione nessuno)
    coaches: (state.coaches ?? []).map((k) => ({
      id: o.id(`coach:${k.id}`),
      team_id: k.teamId === null ? null : team(k.teamId),
      first_name: k.firstName,
      last_name: k.lastName,
      nationality: k.nationality,
      age: k.age,
      philosophy: k.philosophy,
      traits: k.traits,
      ratings: k.ratings,
      salaries: k.salaries,
      since: k.since,
      pressure: k.pressure,
      idle_seasons: k.idleSeasons,
    })),
    coach_buyouts: (state.coachBuyouts ?? []).map((b) => ({
      team_id: team(b.teamId),
      coach_id: o.id(`coach:${b.coachId}`),
      coach_name: b.coachName,
      salaries: b.salaries,
    })),
    players: state.players.map((p) => ({
      id: player(p.id),
      slug: p.id,
      team_id: p.teamId === null ? null : team(p.teamId),
      first_name: p.firstName,
      last_name: p.lastName,
      nationality: p.nationality,
      role: p.role,
      secondary_role: p.secondaryRole,
      hand: p.hand,
      archetype: p.archetype,
      age: p.age,
      height_cm: p.heightCm,
      wingspan_cm: p.wingspanCm,
      weight_kg: p.weightKg,
      years_in_league: p.yearsInLeague,
      draft: p.draft ?? null,
      ratings: p.ratings,
      tendencies: p.tendencies,
      energy: p.energy,
      morale: p.morale,
      scouted_potential: p.scoutedPotential,
      two_way_games: p.twoWayGames,
      season_stats: p.stats,
    })),
    player_hidden: state.players.map((p) => ({ player_id: player(p.id), hidden: p.hidden })),
    injuries: state.players.flatMap((p) =>
      p.injury === null
        ? []
        : [
            {
              player_id: player(p.id),
              body_part: p.injury.bodyPart,
              severity: p.injury.severity,
              games_remaining: p.injury.gamesRemaining,
            },
          ],
    ),
    contracts: state.contracts.map((k) => ({
      player_id: player(k.playerId),
      team_id: team(k.teamId),
      type: k.type,
      salaries: k.salaries,
      options: k.options,
      guaranteed: k.guaranteed,
    })),
    dead_money: state.deadMoney.map((d, i) => ({
      id: o.id(`dead:${i}`),
      team_id: team(d.teamId),
      player_name: d.playerName,
      salaries: d.salaries,
    })),
    draft_picks: state.picks.map((p) => ({
      id: o.id(`pick:${p.id}`),
      draft_year: p.draftYear,
      round: p.round,
      original_team_id: team(p.originalTeamId),
      owner_team_id: team(p.ownerId),
      protection: p.protection,
      deferrals: p.deferrals,
    })),
    games: state.schedule.map((g) => ({
      id: o.id(`game:${year}:${g.turn}:${g.homeId}`),
      round_number: g.turn,
      day: g.day,
      kind: 'regular',
      home_team_id: team(g.homeId),
      away_team_id: team(g.awayId),
    })),
    team_settings: o.withTeamSettings
      ? Object.keys(o.owners).map((code) => {
          // Le scelte del pulsante Auto: quelle dell'allenatore della squadra, se la lega li ha
          const t = state.teams.find((x) => x.id === code);
          const coach = coachOf(state, code);
          const setup = coach
            ? coachSetup(code, roster(state, code), coach)
            : autoSetup(code, roster(state, code), t?.tactics);
          return {
            team_id: team(code),
            starters: setup.starters.map(player),
            minutes: Object.fromEntries(Object.entries(setup.minutes).map(([id, m]) => [player(id), m])),
            tactics: setup.tactics,
          };
        })
      : [],
    initial_draft: o.initialDraft ? initialDraftSection(state, o.initialDraft, team, player) : undefined,
  };
}
