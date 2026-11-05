// Stato della lega dal database al motore: il risultato di public.league_state(lega) diventa un LeagueState,
// con le impostazioni salvate dai manager al posto di quelle del bot. Nel motore le squadre hanno per id la
// sigla (BOS), i giocatori e le scelte il loro uuid; ids riporta le sigle agli uuid del database.
import { emptyStats, nextConfig, validTactics } from '../../../packages/engine/src/index.ts';
import type {
  BodyPart,
  Conference,
  ContractOption,
  ContractType,
  Division,
  GameRecord,
  Hidden,
  LeagueState,
  PlayerState,
  Ratings,
  Role,
  SeasonConfig,
  SeasonStats,
  Strategy,
  Tendencies,
} from '../../../packages/engine/src/index.ts';

type Num = number | string;
const num = (x: Num) => Number(x);

export interface LeagueStateRows {
  league: { id: string; seed: string; talent_reference: Num };
  season: {
    id: string;
    year: number;
    phase: 'regular' | 'play-in' | 'playoffs' | 'offseason';
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
  round: {
    id: string;
    number: number;
    kind: string;
    state: string;
    seed?: string | null;
    close_reason?: string | null;
    /** Turno di offseason: draft, renewals, fa1-fa4, preparation. */
    stage?: string | null;
  } | null;
  teams: {
    id: string;
    code: string;
    city: string;
    name: string;
    full_name: string;
    conference: string;
    division: string;
    owner_id: string | null;
    balance: Num;
    strategy: string;
    tax_history: boolean[];
  }[];
  players: {
    id: string;
    slug?: string;
    draft_prospect?: number | null;
    team_id: string | null;
    first_name: string;
    last_name: string;
    nationality: string;
    role: string;
    secondary_role: string | null;
    hand: string;
    archetype: string;
    age: number;
    height_cm: Num;
    wingspan_cm: Num;
    weight_kg: Num;
    years_in_league: number | null;
    ratings: Record<string, number>;
    tendencies: Record<string, number>;
    hidden: Record<string, number>;
    energy: Num;
    morale: Num;
    scouted_potential: number;
    two_way_games: number;
    season_stats: Partial<SeasonStats>;
  }[];
  contracts: {
    player_id: string;
    team_id: string;
    type: string;
    salaries: Num[];
    options: (string | null)[];
    guaranteed: Num | null;
  }[];
  dead_money: { team_id: string; player_name: string; salaries: Num[] }[];
  injuries: { player_id: string; body_part: string; severity: string; games_remaining: number }[];
  draft_picks: {
    id: string;
    draft_year: number;
    round: number;
    original_team_id: string;
    owner_team_id: string;
    protection: number | null;
    deferrals: number;
  }[];
  draft_swaps: {
    id: string;
    draft_year: number;
    round: number;
    holder_team_id: string;
    other_team_id: string;
  }[];
  team_settings: { team_id: string; starters: string[]; minutes: Record<string, number>; tactics: object }[];
  games: {
    id: string;
    round_number: number;
    kind: 'regular' | 'play-in' | 'playoffs';
    home_team_id: string;
    away_team_id: string;
    home_score: number | null;
    away_score: number | null;
    overtimes: number | null;
    series_id?: string | null;
  }[];
  /** Serie di playoff della stagione corrente. */
  playoff_series?: {
    id: string;
    round: number;
    conference: string | null;
    high_team_id: string;
    low_team_id: string;
    high_seed: number;
    low_seed: number;
    wins_high: number;
    wins_low: number;
    winner_team_id: string | null;
  }[];
  /** Squadre umane con l'allenatore attivo nel turno corrente. */
  coach?: string[];
  coach_delegations?: {
    team_id: string;
    active: boolean;
    until_round: number | null;
    until_at: string | null;
    until_phase_end: boolean;
  }[];
  /** Avvisi aperti e avvisi nati nel turno corrente. */
  alerts?: {
    id: string;
    team_id: string;
    kind: string;
    blocking: boolean;
    status: 'open' | 'resolved' | 'expired';
    round_id: string | null;
    payload: Record<string, unknown>;
  }[];
  /** Proposte di scambio ancora da decidere (in attesa o accettate), nell'ordine della risposta. */
  trade_offers?: TradeOfferRow[];
  /** Offerte agli svincolati del turno. */
  bids?: { id: string; team_id: string; player_id: string; salaries: Num[] }[];
  /** Tagli e rinnovi chiesti nel turno. */
  requests?: {
    id: string;
    team_id: string;
    player_id: string;
    kind: 'release' | 'renew';
    payload: { salaries?: Num[] };
  }[];
  /** Squadra umana -> numero dell'ultimo turno in cui un bot le ha proposto uno scambio. */
  bot_proposals?: Record<string, number>;
  /** Ordine del draft annuale della stagione (dopo lottery, protezioni e swap). */
  draft_order?: {
    draft_year: number;
    pick_no: number;
    round: number;
    number: number;
    team_id: string;
    original_team_id: string;
    player_id: string | null;
  }[];
  /** Preferiti dei manager per il draft annuale. */
  draft_lists?: { team_id: string; player_ids: string[] }[];
}

export interface TradeOfferRow {
  id: string;
  from_team_id: string;
  to_team_id: string;
  players_from: string[];
  players_to: string[];
  picks_from: string[];
  picks_to: string[];
  /** [{ draft_year, round, holder_team_id, other_team_id }] */
  swaps: { draft_year: number; round: number; holder_team_id: string; other_team_id: string }[];
  /** { id della scelta: N } */
  protections: Record<string, number>;
  status: 'pending' | 'accepted';
}

export interface StateIds {
  /** Sigla -> uuid della squadra. */
  team: Map<string, string>;
  /** uuid -> sigla. */
  code: Map<string, string>;
}

export function leagueStateFromRows(r: LeagueStateRows): { state: LeagueState; ids: StateIds } {
  const code = new Map(r.teams.map((t) => [t.id, t.code]));
  const team = new Map(r.teams.map((t) => [t.code, t.id]));
  const codeOf = (id: string) => {
    const c = code.get(id);
    if (c === undefined) throw new Error(`Squadra sconosciuta: ${id}`);
    return c;
  };
  const settings = new Map(r.team_settings.map((s) => [s.team_id, s]));
  const coach = new Set(r.coach ?? []);
  const injuries = new Map(r.injuries.map((i) => [i.player_id, i]));
  const s = r.season;
  const seasonConfig: SeasonConfig = {
    year: s.year,
    salaryCap: num(s.salary_cap),
    luxuryTax: num(s.luxury_tax),
    firstApron: num(s.first_apron),
    secondApron: num(s.second_apron),
    minimumTeamSalary: num(s.minimum_team_salary),
    minimumSalary: s.minimum_salary.map(num),
    rookieScale: s.rookie_scale,
    revenue: num(s.revenue),
    growth: num(s.growth),
  };
  // Dopo il draft dell'offseason i contratti sono già scalati: si lavora con la configurazione della stagione
  // che arriva (la sua riga di seasons nasce alla fine della preparazione)
  const config =
    r.round?.kind === 'offseason' && r.round.stage && r.round.stage !== 'draft'
      ? nextConfig(seasonConfig)
      : seasonConfig;

  const players: PlayerState[] = r.players.map((p) => {
    const injury = injuries.get(p.id);
    return {
      id: p.id,
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
      ratings: p.ratings as Ratings,
      tendencies: p.tendencies as Tendencies,
      hidden: p.hidden as Hidden,
      energy: num(p.energy),
      morale: num(p.morale),
      injury: injury
        ? {
            bodyPart: injury.body_part as BodyPart,
            severity: injury.severity as 'light' | 'medium' | 'severe',
            gamesRemaining: injury.games_remaining,
          }
        : null,
      teamId: p.team_id === null ? null : codeOf(p.team_id),
      stats: { ...emptyStats(), ...p.season_stats },
      scoutedPotential: p.scouted_potential,
      twoWayGames: p.two_way_games,
      prospect: p.draft_prospect ?? null,
    };
  });

  const games: GameRecord[] = r.games
    .filter((g) => g.home_score !== null && g.away_score !== null)
    .map((g) => ({
      turn: g.round_number,
      phase: g.kind,
      homeId: codeOf(g.home_team_id),
      awayId: codeOf(g.away_team_id),
      homeScore: g.home_score as number,
      awayScore: g.away_score as number,
      overtimes: g.overtimes ?? 0,
    }));

  const state: LeagueState = {
    seed: r.league.seed,
    config,
    phase: s.phase === 'regular' ? 'regular' : s.phase === 'offseason' ? 'offseason' : 'postseason',
    turn:
      r.round?.kind === 'regular' ? r.round.number : games.filter((g) => g.phase === 'regular').length / 15,
    teams: r.teams.map((t) => {
      const saved = settings.get(t.id);
      const tactics = validTactics(
        saved?.tactics as Partial<LeagueState['teams'][number]['tactics']> | undefined,
      );
      return {
        id: t.code,
        city: t.city,
        name: t.name,
        fullName: t.full_name,
        conference: t.conference as Conference,
        division: t.division as Division,
        human: t.owner_id !== null,
        strategy: t.strategy as Strategy,
        tactics,
        balance: num(t.balance),
        taxHistory: t.tax_history,
        settings:
          t.owner_id !== null && saved ? { starters: saved.starters, minutes: saved.minutes, tactics } : null,
        coach: t.owner_id !== null && coach.has(t.id),
      };
    }),
    players,
    contracts: r.contracts.map((c) => ({
      playerId: c.player_id,
      teamId: codeOf(c.team_id),
      type: c.type as ContractType,
      salaries: c.salaries.map(num),
      options: c.options.map((o) => (o === 'player' || o === 'team' ? o : null) as ContractOption),
      guaranteed: c.guaranteed === null ? null : num(c.guaranteed),
    })),
    deadMoney: r.dead_money.map((d) => ({
      teamId: codeOf(d.team_id),
      playerName: d.player_name,
      salaries: d.salaries.map(num),
    })),
    picks: r.draft_picks.map((k) => ({
      id: k.id,
      draftYear: k.draft_year,
      round: k.round as 1 | 2,
      originalTeamId: codeOf(k.original_team_id),
      ownerId: codeOf(k.owner_team_id),
      protection: k.protection,
      deferrals: k.deferrals,
    })),
    swaps: r.draft_swaps.map((w) => ({
      id: w.id,
      draftYear: w.draft_year,
      round: w.round as 1 | 2,
      holderId: codeOf(w.holder_team_id),
      otherId: codeOf(w.other_team_id),
    })),
    schedule: r.games
      .filter((g) => g.kind === 'regular')
      .map((g) => ({ turn: g.round_number, homeId: codeOf(g.home_team_id), awayId: codeOf(g.away_team_id) })),
    games,
    // Play-in e playoff si ricostruiscono dalle partite giocate (replayPostseason in serverTurn)
    postseason: null,
    transactions: [],
    history: [],
    talentReference: num(r.league.talent_reference),
    // Gli spareggi in classifica usano l'id della lega, che l'app conosce: il seed della lega resta segreto
    publicSeed: r.league.id,
    offseason: r.draft_order?.length
      ? {
          draftYear: (r.draft_order[0] as { draft_year: number }).draft_year,
          lottery: [],
          slots: r.draft_order.map((d) => ({
            pick: d.pick_no,
            round: d.round as 1 | 2,
            number: d.number,
            ownerId: codeOf(d.team_id),
            originalTeamId: codeOf(d.original_team_id),
            playerId: d.player_id,
          })),
        }
      : null,
  };
  return { state, ids: { team, code } };
}
