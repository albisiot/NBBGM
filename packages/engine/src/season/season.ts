import { ARCHETYPE_PROFILES } from '../archetype-profiles.ts';
import { autoSetup } from '../game/setup.ts';
import { simulateGame } from '../game/simulate.ts';
import { DEFAULT_TACTICS, type GameResult, type TeamSetup } from '../game/types.ts';
import { generateDraftClass } from '../generator.ts';
import { overall } from '../overall.ts';
import { Rng } from '../rng.ts';
import type { Conference, LeagueData, Player } from '../types.ts';
import { botBotTrade, botDraftChoice, botSalaryDump, botWantsRenewal, updateStrategies } from './bots.ts';
import { CONFIG_2026_27, minimumSalaryFor, nextConfig, type SeasonConfig } from './config.ts';
import {
  calibratePotential,
  developPlayer,
  normalizeTalent,
  retirementChance,
  talentLevel,
} from './development.ts';
import {
  MAX_STANDARD,
  MAX_TWO_WAY,
  TWO_WAY_GAME_LIMIT,
  chargeTurn,
  contractOf,
  marketValue,
  releasePlayer,
  roster,
  salaryRun,
  settleSeason,
  signContract,
  standardRoster,
  twoWayRoster,
  typicalYears,
} from './finance.ts';
import {
  FREE_AGENCY_ROUNDS,
  askingSalary,
  botOffers,
  fillMinimumRosters,
  resolveOffers,
} from './freeAgency.ts';
import { PICK_YEARS, drawLottery, initialPicks, newPick, resolveDraft } from './picks.ts';
import { applyPostseasonResult, postseasonGames, startPostseason } from './postseason.ts';
import { REGULAR_SEASON_TURNS, generateSchedule } from './schedule.ts';
import { conferenceStandings, leagueStandings, records } from './standings.ts';
import {
  emptyStats,
  type GameRecord,
  type LeagueState,
  type PlayerState,
  type SeasonSummary,
} from './state.ts';
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

function toPlayerState(seed: string, p: Player & { teamId: string | null }): PlayerState {
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

/** Rose dei bot a 15 contratti standard e 3 two-way al massimo: si tagliano i giocatori con l'overall più basso. */
export function enforceRosterLimits(state: LeagueState): void {
  for (const team of state.teams.filter((t) => !t.human)) {
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

function setupFor(state: LeagueState, teamId: string, regular: boolean): TeamSetup {
  const team = state.teams.find((t) => t.id === teamId);
  let players: Player[] = eligible(state, teamId, regular);
  // Con troppi infortunati gioca anche chi non è al meglio
  if (players.length < 8) players = roster(state, teamId).map((p) => ({ ...p, injury: null }));
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

function regularGames(state: LeagueState): GameRecord[] {
  return state.games.filter((g) => g.phase === 'regular');
}

function endRegularSeason(state: LeagueState): void {
  settleSeason(state);
  const games = regularGames(state);
  const seeds = {
    East: conferenceStandings(state.teams, games, 'East', `${state.seed}:${state.config.year}`).slice(0, 10),
    West: conferenceStandings(state.teams, games, 'West', `${state.seed}:${state.config.year}`).slice(0, 10),
  } as Record<Conference, string[]>;
  state.postseason = startPostseason(seeds);
  state.phase = 'postseason';
}

/** Gioca un turno di post-season (play-in o una partita per ogni serie aperta). */
export function playPostseasonTurn(state: LeagueState, playGame: PlayGame = simulateGame): void {
  const ps = state.postseason;
  if (state.phase !== 'postseason' || !ps) throw new Error('Non siamo in post-season');
  const order = leagueStandings(state.teams, regularGames(state), `${state.seed}:${state.config.year}`);
  const better = (a: string, b: string) => (order.indexOf(a) <= order.indexOf(b) ? a : b);
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

/**
 * Offseason, nell'ordine del documento: fine stagione (crescita, età, ritiri), lottery e draft, contratti che
 * scalano e opzioni, rinnovi, 4 turni di free agency, preparazione della nuova stagione.
 */
export function runOffseason(state: LeagueState, opts: { draftClass?: Player[] } = {}): SeasonSummary {
  if (state.phase !== 'offseason' || !state.postseason) throw new Error("Non siamo nell'offseason");
  const year = state.config.year;
  const rng = new Rng(`${state.seed}:offseason:${year}`);
  const games = regularGames(state);
  const standings = leagueStandings(state.teams, games, `${state.seed}:${year}`);
  const worstFirst = [...standings].reverse();
  const rows = records(state.teams, games);
  const final = state.postseason.series.find((s) => s.round === 4);
  const txStart = state.transactions.length;
  const seasonTx = state.transactions.filter((t) => t.year === year);
  const summary: SeasonSummary = {
    year,
    championId: state.postseason.championId,
    finalistId: final ? (final.winnerId === final.highId ? final.lowId : final.highId) : null,
    bestRecordId: standings[0] as string,
    records: Object.fromEntries([...rows].map(([id, r]) => [id, { w: r.w, l: r.l }])),
    lottery: [],
    trades: seasonTx.filter((t) => t.type === 'trade').length,
    botTrades: seasonTx.filter((t) => t.type === 'trade').length,
    signings: seasonTx.filter((t) => t.type === 'signing').length,
    retirements: 0,
  };

  // 1. Fine stagione: crescita e calo, un anno in più, ritiri
  for (const p of state.players) {
    developPlayer(p, rng.fork(`crescita:${p.id}`));
    p.age++;
    if (p.yearsInLeague !== null) p.yearsInLeague++;
    p.scoutedPotential = Math.max(overall(p), Math.min(99, p.scoutedPotential));
    if (p.injury)
      p.injury =
        p.injury.gamesRemaining > 30 ? { ...p.injury, gamesRemaining: p.injury.gamesRemaining - 20 } : null;
  }
  const retired = state.players.filter((p) =>
    rng.chance(retirementChance(p, contractOf(state, p.id) !== undefined)),
  );
  for (const p of retired) {
    state.transactions.push({
      year,
      turn: null,
      type: 'retirement',
      text: `${p.firstName} ${p.lastName} si ritira a ${p.age} anni`,
    });
  }
  const retiredIds = new Set(retired.map((p) => p.id));
  state.players = state.players.filter((p) => !retiredIds.has(p.id));
  state.contracts = state.contracts.filter((c) => !retiredIds.has(c.playerId));
  summary.retirements = retired.length;

  // 2. Lottery e draft (le scelte si giocano con i contratti della stagione successiva)
  const next = nextConfig(state.config);
  const playoffTeams = new Set(
    state.postseason.series.filter((s) => s.round === 1).flatMap((s) => [s.highId, s.lowId]),
  );
  const lotteryPool = worstFirst.filter((id) => !playoffTeams.has(id));
  const lottery = drawLottery(lotteryPool, `${state.seed}:${year}`);
  summary.lottery = lottery;
  const order1 = [...lottery, ...worstFirst.filter((id) => playoffTeams.has(id))];
  const draftYear = year + 1;
  const { slots, notes } = resolveDraft(state.picks, state.swaps, draftYear, order1, worstFirst);
  for (const n of notes) state.transactions.push({ year, turn: null, type: 'draft', text: n });
  const prospects: PlayerState[] = (
    opts.draftClass ??
    generateDraftClass(rng.fork('draft'), ARCHETYPE_PROFILES, { size: 70, idPrefix: `d${draftYear}` })
  ).map((p) => toPlayerState(state.seed, { ...p, teamId: null }));
  for (const slot of slots) {
    if (!prospects.length) break;
    const choice = botDraftChoice(state, slot.ownerId, prospects, rng);
    prospects.splice(prospects.indexOf(choice), 1);
    state.players.push(choice);
    const salaries =
      slot.round === 1
        ? [...(next.rookieScale[slot.number - 1] as number[])]
        : salaryRun(minimumSalaryFor(next, 0), 2);
    // Il contratto parte dalla stagione successiva: lo stipendio di quest'anno è 0 e viene tolto allo scalare
    signContract(
      state,
      choice,
      {
        playerId: choice.id,
        teamId: slot.ownerId,
        type: 'rookie',
        salaries: [0, ...salaries],
        options: slot.round === 1 ? [null, null, null, 'team', 'team'] : [null, null, null],
        guaranteed: null,
      },
      null,
    );
    state.transactions.push({
      year,
      turn: null,
      type: 'draft',
      text: `Draft ${draftYear}, ${slot.round}° giro n. ${slot.number}: ${slot.ownerId} sceglie ${choice.firstName} ${choice.lastName}`,
    });
  }
  for (const p of prospects) state.players.push(p); // non scelti: svincolati
  normalizeTalent(state.players, state.talentReference);

  // 3. Contratti che scalano di un anno, opzioni
  const rights = new Map<string, string>(); // giocatore -> squadra con diritto di rinnovo
  for (const c of [...state.contracts]) {
    c.salaries.shift();
    c.options.shift();
    const p = state.players.find((x) => x.id === c.playerId) as PlayerState;
    const expired = c.type === 'two-way' ? true : c.salaries.length === 0;
    let leave = expired;
    if (!expired && c.options[0] === 'team') {
      const keep = overall(p) >= 55 || marketValue(next, p) >= (c.salaries[0] as number) * 0.85;
      if (!keep) {
        leave = true;
        state.transactions.push({
          year,
          turn: null,
          type: 'option',
          text: `${c.teamId} non esercita l'opzione su ${p.firstName} ${p.lastName}`,
        });
      } else c.options[0] = null;
    } else if (!expired && c.options[0] === 'player') {
      if (marketValue(next, p) > (c.salaries[0] as number) * 1.15) {
        leave = true;
        state.transactions.push({
          year,
          turn: null,
          type: 'option',
          text: `${p.firstName} ${p.lastName} esce dal contratto con ${c.teamId}`,
        });
      } else c.options[0] = null;
    }
    if (leave) {
      if (c.type !== 'two-way') rights.set(p.id, c.teamId);
      state.contracts = state.contracts.filter((x) => x !== c);
      p.teamId = null;
    }
  }
  for (const d of state.deadMoney) d.salaries.shift();
  state.deadMoney = state.deadMoney.filter((d) => d.salaries.length > 0);

  // Da qui si lavora sulla stagione successiva
  state.config = next;
  state.picks.push(
    ...state.teams.flatMap((t) => [
      newPick(draftYear + PICK_YEARS, 1, t.id),
      newPick(draftYear + PICK_YEARS, 2, t.id),
    ]),
  );
  updateStrategies(state);

  // 4. Rinnovi: ultimo turno per rinnovare i propri giocatori in scadenza
  for (const [playerId, teamId] of rights) {
    const p = state.players.find((x) => x.id === playerId) as PlayerState;
    const team = state.teams.find((t) => t.id === teamId);
    if (!team || team.human || p.morale < 30) continue;
    const ask = askingSalary(state, p, 0);
    if (!botWantsRenewal(state, teamId, p, ask)) continue;
    signContract(
      state,
      p,
      {
        playerId,
        teamId,
        type: 'standard',
        salaries: salaryRun(ask, typicalYears(p.age)),
        options: Array.from({ length: typicalYears(p.age) }, () => null),
        guaranteed: null,
      },
      null,
      true,
    );
  }

  // Prima della free agency chi è in rosso prova a liberarsi di contratti pesanti
  for (let i = 0; i < 6; i++) botSalaryDump(state, rng, null);

  // 5. Free agency
  for (let round = 0; round < FREE_AGENCY_ROUNDS; round++) {
    resolveOffers(
      state,
      botOffers(state, round, rng.fork(`fa:${round}`), { fillTo: MAX_STANDARD }),
      round,
      worstFirst,
      null,
    );
  }

  // 6. Preparazione: rose a 13-15 standard e al massimo 3 two-way
  enforceRosterLimits(state);
  for (const team of state.teams.filter((t) => !t.human)) {
    const freeYoung = state.players
      .filter((p) => p.teamId === null && p.age <= 24)
      .sort((a, b) => b.scoutedPotential - a.scoutedPotential);
    while (twoWayRoster(state, team.id).length < 2 && freeYoung.length) {
      const p = freeYoung.shift() as PlayerState;
      signContract(
        state,
        p,
        { playerId: p.id, teamId: team.id, type: 'two-way', salaries: [], options: [], guaranteed: null },
        null,
      );
    }
  }
  fillMinimumRosters(state, null);

  // 7. Nuova stagione
  for (const p of state.players) {
    p.stats = emptyStats();
    p.twoWayGames = 0;
    p.energy = 100;
    p.morale = p.morale + (60 - p.morale) * 0.5;
  }
  state.schedule = generateSchedule(state.teams, state.config.year, state.seed);
  state.games = [];
  state.postseason = null;
  state.turn = 0;
  state.phase = 'regular';
  updateStrategies(state);
  summary.signings += state.transactions.slice(txStart).filter((t) => t.type === 'signing').length;
  state.history.push(summary);
  return summary;
}

/** Gioca una stagione intera, dalla prima giornata alla fine dell'offseason. */
export function simulateSeason(state: LeagueState, playGame: PlayGame = simulateGame): SeasonSummary {
  while (state.phase === 'regular') playRegularTurn(state, playGame);
  while (state.phase === 'postseason') playPostseasonTurn(state, playGame);
  return runOffseason(state);
}
