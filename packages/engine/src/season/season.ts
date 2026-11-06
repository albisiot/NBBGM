import { autoSetup, setupFromSettings } from '../game/setup.ts';
import { simulateGame } from '../game/simulate.ts';
import { DEFAULT_TACTICS, type GameResult, type TeamSetup } from '../game/types.ts';
import { overall } from '../overall.ts';
import { Rng } from '../rng.ts';
import type { Conference, LeagueData, Player } from '../types.ts';
import { botBotTrade, botSalaryDump, updateStrategies } from './bots.ts';
import { CONFIG_2026_27, type SeasonConfig } from './config.ts';
import { calibratePotential, talentLevel } from './development.ts';
import {
  MAX_STANDARD,
  MAX_TWO_WAY,
  TWO_WAY_GAME_LIMIT,
  chargeTurn,
  contractOf,
  releasePlayer,
  roster,
  settleSeason,
  standardRoster,
  twoWayRoster,
} from './finance.ts';
import { fillMinimumRosters } from './freeAgency.ts';
import { initialPicks } from './picks.ts';
import {
  applyPostseasonResult,
  postseasonGames,
  startPostseason,
  type PostseasonState,
} from './postseason.ts';
import { REGULAR_SEASON_TURNS, generateSchedule } from './schedule.ts';
import { conferenceStandings, leagueStandings } from './standings.ts';
import { emptyStats, type GameRecord, type LeagueState, type PlayerState } from './state.ts';
import { applyGameToPlayers, endTurn } from './turn.ts';

export type PlayGame = (home: TeamSetup, away: TeamSetup, seed: string) => GameResult;

/** Probabilità che i bot tentino uno scambio tra loro in un turno prima della deadline (al massimo uno). */
export const BOT_TRADE_CHANCE = 0.3;
/** Probabilità per turno che un bot in rosso provi a cedere un contratto pesante. */
export const SALARY_DUMP_CHANCE = 0.25;

function scout(seed: string, p: Player): number {
  const noise = new Rng(`${seed}:scouting:${p.id}`).normal(0, 2.5);
  return Math.round(Math.max(overall(p), Math.min(99, p.hidden.potential + noise)));
}

export function toPlayerState(seed: string, p: Player & { teamId: string | null }): PlayerState {
  return {
    ...structuredCopy(p),
    teamId: p.teamId,
    stats: emptyStats(),
    scoutedPotential: scout(seed, p),
    twoWayGames: 0,
  };
}

function structuredCopy<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

/**
 * Crea una lega pronta per la prima giornata dai dati importati (o generati). Il potenziale del file viene
 * riportato sulla scala dell'overall, a meno che i dati non siano già su quella scala (leghe generate).
 */
export function createLeagueState(
  data: LeagueData,
  seed: string,
  opts: {
    config?: SeasonConfig;
    humanTeams?: readonly string[];
    potentialOnOverallScale?: boolean;
    potentialShrink?: number;
    /** Rose vuote per il draft iniziale: tutti svincolati, nessun contratto né stipendio residuo. */
    emptyRosters?: boolean;
  } = {},
): LeagueState {
  const config = structuredCopy(opts.config ?? CONFIG_2026_27);
  const players = structuredCopy(data.players).map((p) => (opts.emptyRosters ? { ...p, teamId: null } : p));
  if (!opts.potentialOnOverallScale) calibratePotential(players, opts.potentialShrink ?? POTENTIAL_SHRINK);
  const state: LeagueState = {
    seed,
    config,
    phase: 'regular',
    turn: 0,
    teams: data.teams.map((t) => ({
      ...t,
      human: opts.humanTeams?.includes(t.id) ?? false,
      strategy: 'middle',
      tactics: { ...DEFAULT_TACTICS },
      balance: 0,
      taxHistory: [],
    })),
    players: players.map((p) => toPlayerState(seed, p)),
    contracts: opts.emptyRosters ? [] : structuredCopy(data.contracts),
    deadMoney: opts.emptyRosters ? [] : structuredCopy(data.deadMoney),
    picks: initialPicks(
      data.teams.map((t) => t.id),
      config.year + 1,
    ),
    swaps: [],
    schedule: generateSchedule(data.teams, config.year, seed),
    games: [],
    postseason: null,
    transactions: [],
    history: [],
    talentReference: 0,
  };
  // Prima della prima giornata le rose fuori misura si tagliano come in offseason; con il draft iniziale le
  // rose le fanno le scelte
  if (!opts.emptyRosters) {
    enforceRosterLimits(state);
    fillMinimumRosters(state, null);
  }
  state.talentReference = talentLevel(state.players);
  updateStrategies(state);
  return state;
}

/** Quota del margine tra overall e potenziale del file che resta come tetto di crescita (calibrata con pnpm sim:seasons). */
export const POTENTIAL_SHRINK = 1;

/**
 * Rose a 15 contratti standard e 3 two-way al massimo: si tagliano i giocatori con l'overall più basso. Alla
 * creazione della lega solo i bot; a inizio stagione tutte le squadre.
 */
export function enforceRosterLimits(state: LeagueState, opts: { includeHumans?: boolean } = {}): void {
  for (const team of state.teams.filter((t) => opts.includeHumans || !t.human)) {
    const standard = [...standardRoster(state, team.id)].sort((a, b) => overall(a) - overall(b));
    while (standard.length > MAX_STANDARD) releasePlayer(state, (standard.shift() as PlayerState).id, null);
    const twoWay = [...twoWayRoster(state, team.id)].sort((a, b) => overall(a) - overall(b));
    while (twoWay.length > MAX_TWO_WAY) releasePlayer(state, (twoWay.shift() as PlayerState).id, null);
  }
}

/** Giocatori che possono andare a referto: sani, e i two-way solo in regular season fino a 50 partite. */
function eligible(state: LeagueState, teamId: string, regular: boolean): PlayerState[] {
  return roster(state, teamId).filter((p) => {
    if (p.injury) return false;
    if (contractOf(state, p.id)?.type !== 'two-way') return true;
    return regular && p.twoWayGames < TWO_WAY_GAME_LIMIT;
  });
}

/** Giocatori minimi per giocare una partita. */
export const MIN_PLAYERS = 5;

/**
 * Chi va a referto: chi può giocare (sani, i two-way solo in regular season fino a 50 partite). Se sono meno di 5,
 * si arriva a 5 con chi è fuori solo per le regole dei two-way, poi con gli infortunati che rientrano prima
 * (giocano da sani): una partita non si gioca in meno di 5, ma con 5, 6 o 7 sani sì, anche se si stancano.
 */
export function gamePlayers(state: LeagueState, teamId: string, regular: boolean): Player[] {
  const players: Player[] = eligible(state, teamId, regular);
  if (players.length >= MIN_PLAYERS) return players;
  const extra = roster(state, teamId)
    .filter((p) => !players.includes(p))
    .sort((a, b) => (a.injury?.gamesRemaining ?? 0) - (b.injury?.gamesRemaining ?? 0));
  return [...players, ...extra.slice(0, MIN_PLAYERS - players.length).map((p) => ({ ...p, injury: null }))];
}

function setupFor(state: LeagueState, teamId: string, regular: boolean): TeamSetup {
  const team = state.teams.find((t) => t.id === teamId);
  const players = gamePlayers(state, teamId, regular);
  // L'allenatore delegato fa quintetto e minuti come il pulsante Auto, con le tattiche scelte dal manager
  if (team?.human && team.coach) return autoSetup(teamId, players, team.tactics);
  // Le squadre umane giocano con le impostazioni salvate; il bot corregge solo gli slot che non valgono più
  if (team?.human && team.settings) return setupFromSettings(teamId, players, team.settings);
  return autoSetup(teamId, players, team?.tactics);
}

function record(
  state: LeagueState,
  turn: number,
  phase: GameRecord['phase'],
  result: GameResult,
): GameRecord {
  const g: GameRecord = {
    turn,
    phase,
    homeId: result.home.teamId,
    awayId: result.away.teamId,
    homeScore: result.home.score,
    awayScore: result.away.score,
    overtimes: result.overtimes,
  };
  state.games.push(g);
  return g;
}

function countTwoWayGames(state: LeagueState, result: GameResult): void {
  for (const side of [result.home, result.away]) {
    for (const l of side.box) {
      if (l.seconds === 0) continue;
      const p = state.players.find((x) => x.id === l.playerId);
      if (p && contractOf(state, p.id)?.type === 'two-way') p.twoWayGames++;
    }
  }
}

/** Gioca un turno di regular season: 15 partite, fine turno, bilancio, mercato dei bot. */
export function playRegularTurn(state: LeagueState, playGame: PlayGame = simulateGame): void {
  if (state.phase !== 'regular') throw new Error('Non siamo in regular season');
  const turn = state.turn;
  const played = new Map<string, { won: boolean; result: GameResult }>();
  for (const g of state.schedule.filter((x) => x.turn === turn)) {
    const result = playGame(
      setupFor(state, g.homeId, true),
      setupFor(state, g.awayId, true),
      `${state.seed}:${state.config.year}:${turn}:${g.homeId}`,
    );
    record(state, turn, 'regular', result);
    applyGameToPlayers(state, result, true);
    countTwoWayGames(state, result);
    const homeWon = result.home.score > result.away.score;
    played.set(g.homeId, { won: homeWon, result });
    played.set(g.awayId, { won: !homeWon, result });
  }
  endTurn(state, played);
  chargeTurn(state);
  const rng = new Rng(`${state.seed}:${state.config.year}:mercato:${turn}`);
  if (rng.chance(BOT_TRADE_CHANCE)) botBotTrade(state, rng, turn);
  if (rng.chance(SALARY_DUMP_CHANCE)) botSalaryDump(state, rng, turn);
  if (turn === 30) updateStrategies(state);
  fillMinimumRosters(state, turn);
  state.turn++;
  if (state.turn >= REGULAR_SEASON_TURNS) endRegularSeason(state);
}

export function regularGames(state: LeagueState): GameRecord[] {
  return state.games.filter((g) => g.phase === 'regular');
}

/** Seed degli spareggi in classifica di una stagione: pubblico, così l'app rifà la stessa classifica del server. */
export function standingsSeed(publicSeed: string, year: number): string {
  return `${publicSeed}:${year}`;
}

export function seasonStandingsSeed(state: LeagueState): string {
  return standingsSeed(state.publicSeed ?? state.seed, state.config.year);
}

/** Prime 10 di ogni conference a fine regular season: 1-6 ai playoff, 7-10 al play-in. */
export function postseasonSeeds(state: LeagueState): Record<Conference, string[]> {
  const games = regularGames(state);
  const seed = seasonStandingsSeed(state);
  return {
    East: conferenceStandings(state.teams, games, 'East', seed).slice(0, 10),
    West: conferenceStandings(state.teams, games, 'West', seed).slice(0, 10),
  };
}

function betterRecord(state: LeagueState): (a: string, b: string) => string {
  const order = leagueStandings(state.teams, regularGames(state), seasonStandingsSeed(state));
  return (a, b) => (order.indexOf(a) <= order.indexOf(b) ? a : b);
}

function endRegularSeason(state: LeagueState): void {
  state.lastSettlement = settleSeason(state);
  state.postseason = startPostseason(postseasonSeeds(state));
  state.phase = 'postseason';
}

/**
 * Ricostruisce play-in e playoff dalle partite giocate (sul server non si salva lo stato del tabellone):
 * dalle prime 10 di ogni conference, ogni turno di post-season in ordine, partita per partita.
 */
export function replayPostseason(state: LeagueState): PostseasonState {
  const ps = startPostseason(postseasonSeeds(state));
  const better = betterRecord(state);
  const played = state.games.filter((g) => g.phase !== 'regular');
  for (const turn of [...new Set(played.map((g) => g.turn))].sort((a, b) => a - b)) {
    const expected = postseasonGames(ps);
    const games = played.filter((g) => g.turn === turn);
    for (const g of games) {
      const match = expected.find((x) => x.homeId === g.homeId && x.awayId === g.awayId);
      if (!match)
        throw new Error(`Partita di post-season fuori tabellone: ${g.homeId}-${g.awayId} (turno ${turn})`);
      applyPostseasonResult(ps, match.ref, g.homeScore > g.awayScore ? g.homeId : g.awayId, better);
    }
    if (games.length !== expected.length)
      throw new Error(
        `Turno ${turn} di post-season incompleto: ${games.length} partite su ${expected.length}`,
      );
  }
  return ps;
}

/** Gioca un turno di post-season (play-in o una partita per ogni serie aperta). */
export function playPostseasonTurn(state: LeagueState, playGame: PlayGame = simulateGame): void {
  const ps = state.postseason;
  if (state.phase !== 'postseason' || !ps) throw new Error('Non siamo in post-season');
  const better = betterRecord(state);
  const played = new Map<string, { won: boolean; result: GameResult }>();
  // Numero del turno: 82 + turni di post-season già giocati
  const turn =
    REGULAR_SEASON_TURNS + new Set(state.games.filter((g) => g.phase !== 'regular').map((g) => g.turn)).size;
  for (const g of postseasonGames(ps)) {
    const result = playGame(
      setupFor(state, g.homeId, false),
      setupFor(state, g.awayId, false),
      `${state.seed}:${state.config.year}:${g.ref}:${turn}`,
    );
    record(state, turn, g.phase, result);
    applyGameToPlayers(state, result, false);
    const homeWon = result.home.score > result.away.score;
    played.set(g.homeId, { won: homeWon, result });
    played.set(g.awayId, { won: !homeWon, result });
    applyPostseasonResult(ps, g.ref, homeWon ? g.homeId : g.awayId, better);
  }
  endTurn(state, played);
  if (ps.stage === 'done') state.phase = 'offseason';
}
