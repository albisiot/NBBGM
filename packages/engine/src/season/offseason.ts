// Offseason a turni, nell'ordine del documento. Ogni passo è una funzione: il server ne esegue uno alla chiusura di
// ogni turno, la simulazione offline (runOffseason) li esegue tutti di fila.
//
//   alla chiusura della finale   fine stagione (crescita, età, ritiri), lottery, ordine del draft, classe del draft;
//                                poi le scelte dei bot fino alla prima di un manager (advanceDraft)
//   turni "draft"                uno per ogni scelta di un manager: alla chiusura la sua scelta e quelle dei bot fino
//                                alla prossima; a draft finito i contratti scalano (opzioni dei giocatori e dei bot)
//   turno "options"              i manager esercitano o declinano le opzioni della squadra
//   turno "renewals"             rinnovi con trattativa e offerte di qualifica agli RFA; chi non rinnova è svincolato
//   turni "fa1"-"fa15"           free agency: nei primi 5 solo offerte, dal 6° si firma e le richieste scendono
//   turno "preparation"          rose nei limiti (i manager le sistemano, il server corregge quello che resta)
import { ARCHETYPE_PROFILES } from '../archetype-profiles.ts';
import { generateDraftClass } from '../generator.ts';
import { overall } from '../overall.ts';
import { Rng } from '../rng.ts';
import type { Contract, ContractOption, Player } from '../types.ts';
import { botDraftChoice, botSalaryDump, botWantsRenewal, updateStrategies } from './bots.ts';
import { coachOf, developmentFactor, scaleCoachContracts } from './coaches.ts';
import { maxSalaryFor, minimumSalaryFor, nextConfig, type SeasonConfig } from './config.ts';
import { normalizeTalent, retirementChance, developPlayer } from './development.ts';
import {
  contractOf,
  marketValue,
  MAX_STANDARD,
  MAX_TWO_WAY,
  MIN_STANDARD,
  releasedBy,
  roster,
  salaryRun,
  signContract,
  standardRoster,
  twoWayRoster,
  typicalYears,
} from './finance.ts';
import {
  askingSalary,
  botOffers,
  FA_MORATORIUM_ROUNDS,
  FREE_AGENCY_ROUNDS,
  fillMinimumRosters,
  fillRosterAtMinimum,
  resolveOffers,
  resolveOfferSheets,
  signQualifyingOffers,
  type Offer,
} from './freeAgency.ts';
import { offseasonCoachMoves, setExpectations } from './owners.ts';
import { drawLottery, newPick, PICK_YEARS, resolveDraft } from './picks.ts';
import { generateSchedule, turnDay } from './schedule.ts';
import {
  enforceRosterLimits,
  playPostseasonTurn,
  playRegularTurn,
  regularGames,
  seasonStandingsSeed,
  toPlayerState,
  type PlayGame,
} from './season.ts';
import { simulateGame } from '../game/simulate.ts';
import { leagueStandings, records } from './standings.ts';
import { gamesAfterOffseason } from './turn.ts';
import {
  emptyStats,
  type DraftSlotState,
  type LeagueState,
  type PlayerState,
  type SeasonSummary,
} from './state.ts';

/** Turni di free agency come stage: fa1 ... fa15. */
const FA_STAGES = Array.from({ length: FREE_AGENCY_ROUNDS }, (_, i) => `fa${i + 1}` as `fa${number}`);

export const OFFSEASON_STAGES = ['draft', 'options', 'renewals', ...FA_STAGES, 'preparation'] as const;
export type OffseasonStage = 'draft' | 'options' | 'renewals' | `fa${number}` | 'preparation';

/** È uno stage dell'offseason? */
export function isOffseasonStage(x: unknown): x is OffseasonStage {
  return typeof x === 'string' && (OFFSEASON_STAGES as readonly string[]).includes(x);
}

/**
 * Turno di offseason che segue (null dopo la preparazione: riparte la regular season). Il draft si ripete finché ci
 * sono scelte di manager: lo decide chi chiude il turno (advanceDraft), non questa funzione.
 */
export function nextStage(stage: OffseasonStage): OffseasonStage | null {
  const i = (OFFSEASON_STAGES as readonly string[]).indexOf(stage);
  return (OFFSEASON_STAGES[i + 1] as OffseasonStage | undefined) ?? null;
}

/** Indice del turno di free agency (0-14) di uno stage, o null. */
export function freeAgencyRoundOf(stage: OffseasonStage): number | null {
  const m = /^fa(\d{1,2})$/.exec(stage);
  if (!m) return null;
  const n = Number(m[1]);
  return n >= 1 && n <= FREE_AGENCY_ROUNDS ? n - 1 : null;
}

/** Giocatori della classe del draft che il motore genera quando non c'è una classe reale. */
export const DRAFT_CLASS_SIZE = 70;

/** Classe del draft generata: più giovani e più bassi, con un potenziale più alto e più incerto. */
export function generatedDraftClass(rng: Rng, draftYear: number): Player[] {
  return generateDraftClass(rng, ARCHETYPE_PROFILES, { size: DRAFT_CLASS_SIZE, idPrefix: `d${draftYear}` });
}

/** Contratto scaduto in attesa del turno dei rinnovi: la squadra ha ancora i diritti sul giocatore. */
export function isExpiring(state: LeagueState, playerId: string): boolean {
  const c = contractOf(state, playerId);
  return c !== undefined && c.type !== 'two-way' && c.salaries.length === 0;
}

export function expiringPlayers(state: LeagueState, teamId?: string): PlayerState[] {
  return state.players.filter(
    (p) => p.teamId !== null && (teamId === undefined || p.teamId === teamId) && isExpiring(state, p.id),
  );
}

/**
 * Richiesta di rinnovo di un giocatore in scadenza nel turno dei rinnovi (configurazione della stagione che
 * arriva): stipendi per gli anni tipici della sua età, oppure null se con il morale sotto 30 non rinnova. Da qui
 * parte la trattativa (renewals.ts).
 */
export function expiringAsk(state: LeagueState, p: PlayerState): number[] | null {
  if (p.morale < 30) return null;
  return salaryRun(askingSalary(state, p, 0), typicalYears(p.age));
}

/**
 * 1-2. Fine stagione e lottery: crescita e calo, un anno in più, ritiri; lottery con le probabilità NBA, ordine
 * del draft con protezioni e swap (le scelte usate escono dallo stato, le slot restano in state.offseason); la
 * classe del draft entra tra i giocatori senza squadra, segnata come prospetto. Restituisce il riassunto della
 * stagione e i ritirati.
 */
export function startOffseason(
  state: LeagueState,
  draftClass: readonly Player[],
): { summary: SeasonSummary; retired: PlayerState[] } {
  if (state.phase !== 'offseason' || !state.postseason) throw new Error("Non siamo nell'offseason");
  const year = state.config.year;
  const rng = new Rng(`${state.seed}:offseason:${year}`);
  const games = regularGames(state);
  const standings = leagueStandings(state.teams, games, seasonStandingsSeed(state));
  const worstFirst = [...standings].reverse();
  const rows = records(state.teams, games);
  const final = state.postseason.series.find((s) => s.round === 4);
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

  // 1. Fine stagione: crescita e calo (con lo Sviluppo dell'allenatore della squadra), un anno in più, ritiri
  for (const p of state.players) {
    developPlayer(
      p,
      rng.fork(`crescita:${p.id}`),
      p.teamId === null ? 0 : developmentFactor(coachOf(state, p.teamId)),
    );
    p.age++;
    if (p.yearsInLeague !== null) p.yearsInLeague++;
    p.scoutedPotential = Math.max(overall(p), Math.min(99, p.scoutedPotential));
    if (p.injury) {
      const left = gamesAfterOffseason(p.injury.gamesRemaining);
      p.injury = left > 0 ? { ...p.injury, gamesRemaining: left } : null;
    }
  }
  const retired = state.players.filter((p) =>
    rng.chance(retirementChance(p, contractOf(state, p.id) !== undefined)),
  );
  for (const p of retired)
    state.transactions.push({
      year,
      turn: null,
      type: 'retirement',
      text: `${p.firstName} ${p.lastName} si ritira a ${p.age} anni`,
    });
  const retiredIds = new Set(retired.map((p) => p.id));
  state.players = state.players.filter((p) => !retiredIds.has(p.id));
  state.contracts = state.contracts.filter((c) => !retiredIds.has(c.playerId));
  summary.retirements = retired.length;

  // 2. Lottery per le squadre fuori dai playoff (eliminate al play-in comprese), poi ordine del draft
  const playoffTeams = new Set(
    state.postseason.series.filter((s) => s.round === 1).flatMap((s) => [s.highId, s.lowId]),
  );
  const lottery = drawLottery(
    worstFirst.filter((id) => !playoffTeams.has(id)),
    `${state.seed}:${year}`,
  );
  summary.lottery = lottery;
  const order1 = [...lottery, ...worstFirst.filter((id) => playoffTeams.has(id))];
  const draftYear = year + 1;
  const { slots, notes } = resolveDraft(state.picks, state.swaps, draftYear, order1, worstFirst);
  for (const n of notes) state.transactions.push({ year, turn: null, type: 'draft', text: n });
  state.offseason = {
    draftYear,
    lottery,
    slots: slots.map((s, i) => ({ ...s, pick: i + 1, playerId: null })),
  };
  for (const p of draftClass)
    state.players.push({ ...toPlayerState(state.seed, { ...p, teamId: null }), prospect: draftYear });
  state.history.push(summary);

  // Allenatori: i proprietari giudicano la stagione, esonerano o rinnovano; poi tutti invecchiano e chi è rimasto
  // senza panchina ne trova una (con un generatore a parte: il resto dell'offseason resta quello di prima)
  if (state.coaches) {
    const seriesWon = new Map<string, number>();
    for (const s of state.postseason.series)
      if (s.winnerId) seriesWon.set(s.winnerId, (seriesWon.get(s.winnerId) ?? 0) + 1);
    offseasonCoachMoves(state, new Rng(`${state.seed}:allenatori:${year}`), worstFirst, seriesWon);
  }
  return { summary, retired };
}

// ------------------------------------------------------------------------------------------------ draft annuale

/** La squadra della chiamata aspetta il suo manager: umana e senza la squadra affidata all'allenatore. */
function waitsForManager(state: LeagueState, slot: DraftSlotState): boolean {
  const team = state.teams.find((t) => t.id === slot.ownerId);
  return team?.human === true && !team.coach;
}

/** La prossima chiamata del draft annuale ancora da fare, o null a draft finito (o senza draft). */
export function draftOnClock(state: LeagueState): DraftSlotState | null {
  const off = state.offseason;
  if (!off || !state.players.some((p) => p.prospect === off.draftYear)) return null;
  return off.slots.find((s) => s.playerId === null) ?? null;
}

/**
 * Una chiamata: chi possiede la scelta prende il giocatore scelto dal manager (se è ancora un prospetto), altrimenti
 * il primo disponibile della sua lista (le squadre umane), altrimenti sceglie con la logica del bot. Primo giro: 4
 * anni a stipendio fisso per posizione (scala rookie); secondo giro: 2 anni al minimo. I contratti partono dalla
 * stagione successiva. Il caso di ogni chiamata viene da un generatore suo, così il draft può durare più turni.
 */
function makePick(
  state: LeagueState,
  slot: DraftSlotState,
  choice: string | null,
  list: readonly string[],
): void {
  const off = state.offseason as NonNullable<LeagueState['offseason']>;
  const available = state.players.filter((p) => p.prospect === off.draftYear);
  const team = state.teams.find((t) => t.id === slot.ownerId);
  const byId = new Map(available.map((p) => [p.id, p]));
  const picked =
    (choice !== null ? byId.get(choice) : undefined) ??
    (team?.human ? list : []).map((id) => byId.get(id)).find((p) => p !== undefined) ??
    botDraftChoice(
      state,
      slot.ownerId,
      available,
      new Rng(`${state.seed}:draft:${off.draftYear}:${slot.pick}`),
    );
  const next = nextConfig(state.config);
  picked.prospect = null;
  picked.draft = { year: off.draftYear, round: slot.round, pick: slot.pick };
  slot.playerId = picked.id;
  const salaries =
    slot.round === 1
      ? [...(next.rookieScale[slot.number - 1] as number[])]
      : salaryRun(minimumSalaryFor(next, 0), 2);
  // Il contratto parte dalla stagione successiva: lo stipendio di quest'anno è 0 e viene tolto allo scalare
  signContract(
    state,
    picked,
    {
      playerId: picked.id,
      teamId: slot.ownerId,
      type: 'rookie',
      salaries: [0, ...salaries],
      options: slot.round === 1 ? [null, null, null, 'team', 'team'] : [null, null, null],
      guaranteed: null,
    },
    null,
  );
  state.transactions.push({
    year: state.config.year,
    turn: null,
    type: 'draft',
    text: `Draft ${off.draftYear}, ${slot.round}° giro n. ${slot.number}: ${slot.ownerId} sceglie ${picked.firstName} ${picked.lastName}`,
  });
}

/** Fine del draft: i non scelti diventano svincolati ("non scelto" in quel draft), il livello della lega torna lì. */
function finishDraft(state: LeagueState): void {
  const off = state.offseason as NonNullable<LeagueState['offseason']>;
  for (const p of state.players) {
    if (p.prospect !== off.draftYear) continue;
    p.prospect = null;
    p.draft = { year: off.draftYear, round: null, pick: null };
  }
  normalizeTalent(state.players, state.talentReference);
}

/**
 * Fa avanzare il draft annuale dal vivo. Con onClock (alla chiusura del turno di un manager) la chiamata che aspettava
 * lui si fa con la sua scelta (choice), o con la sua lista, o con la logica del bot; poi si fanno le chiamate dei bot e
 * delle squadre affidate all'allenatore (lista, poi logica del bot) fino alla prossima di un manager, che resta da fare.
 * Senza onClock (alla chiusura della finale) ci si ferma anche alla prima. A draft finito i non scelti diventano
 * svincolati. Restituisce la chiamata che aspetta un manager, o null se il draft è finito.
 */
export function advanceDraft(
  state: LeagueState,
  opts: {
    onClock?: { choice: string | null } | null;
    lists?: ReadonlyMap<string, readonly string[]>;
  } = {},
): DraftSlotState | null {
  const off = state.offseason;
  if (!off) throw new Error('Il draft non è pronto');
  const lists = shortLists(state, opts.lists);
  let first = true;
  for (;;) {
    const slot = draftOnClock(state);
    if (!slot) break;
    const manager = waitsForManager(state, slot);
    if (manager && !(first && opts.onClock)) return slot;
    makePick(state, slot, manager ? (opts.onClock?.choice ?? null) : null, lists(slot.ownerId));
    first = false;
  }
  finishDraft(state);
  return null;
}

/**
 * Le liste ridotte una volta per squadra ai soli prospetti, senza doppioni e nello stesso ordine: il primo
 * disponibile resta lo stesso, ma una lista lunghissima non si scorre a ogni chiamata (terza analisi).
 */
function shortLists(
  state: LeagueState,
  lists: ReadonlyMap<string, readonly string[]> | undefined,
): (teamId: string) => string[] {
  const off = state.offseason as NonNullable<LeagueState['offseason']>;
  const prospectIds = new Set(state.players.filter((p) => p.prospect === off.draftYear).map((p) => p.id));
  const cache = new Map<string, string[]>();
  return (teamId) => {
    let list = cache.get(teamId);
    if (!list) {
      list = [...new Set(lists?.get(teamId) ?? [])].filter((id) => prospectIds.has(id));
      cache.set(teamId, list);
    }
    return list;
  };
}

/**
 * 3. Draft annuale tutto di fila (simulazione offline e test): ogni chiamata con la lista delle squadre umane o la
 * logica del bot, senza fermarsi ai manager.
 */
export function runAnnualDraft(state: LeagueState, lists: ReadonlyMap<string, readonly string[]>): void {
  if (!state.offseason) throw new Error('Il draft non è pronto');
  const list = shortLists(state, lists);
  for (;;) {
    const slot = draftOnClock(state);
    if (!slot) break;
    makePick(state, slot, null, list(slot.ownerId));
  }
  finishDraft(state);
}

// ------------------------------------------------------------------------------------------------ contratti e opzioni

/** Opzione del giocatore: esce se vale più del 120% dello stipendio e non si trova bene, o se vale più del 150%. */
export const PLAYER_OPTION_UNHAPPY_SHARE = 1.2;
export const PLAYER_OPTION_ALWAYS_SHARE = 1.5;
/** Non si trova bene: morale sotto 50, o meno di 15 minuti a partita quando era a disposizione (da 10 partite). */
export const UNHAPPY_MORALE = 50;
export const UNHAPPY_MINUTES = 15;
export const UNHAPPY_MIN_GAMES = 10;

/** Il giocatore non si trova bene nella squadra: morale basso, o ha giocato poco quando poteva. */
export function unhappyPlayer(p: Pick<PlayerState, 'morale' | 'stats'>): boolean {
  if (p.morale < UNHAPPY_MORALE) return true;
  const available = p.stats.av ?? p.stats.g;
  return available >= UNHAPPY_MIN_GAMES && p.stats.seconds / 60 / available < UNHAPPY_MINUTES;
}

/** Il giocatore esce con la sua opzione dal contratto da salary (configurazione della stagione che arriva). */
export function playerOptsOut(c: SeasonConfig, p: PlayerState, salary: number): boolean {
  const value = marketValue(c, p);
  return (
    value > salary * PLAYER_OPTION_ALWAYS_SHARE ||
    (value > salary * PLAYER_OPTION_UNHAPPY_SHARE && unhappyPlayer(p))
  );
}

/** Il bot esercita l'opzione della squadra se il giocatore serve ancora o vale quasi quanto costa. */
export function botKeepsOption(c: SeasonConfig, p: PlayerState, salary: number): boolean {
  return overall(p) >= 55 || marketValue(c, p) >= salary * 0.85;
}

/** Il contratto scade: in rosa senza stipendi fino al turno dei rinnovi, con l'ultimo stipendio per la qualifica. */
function expire(c: Contract, lastSalary: number): void {
  c.salaries = [];
  c.options = [];
  c.guaranteed = null;
  c.lastSalary = lastSalary;
}

/**
 * 4. Contratti che scalano di un anno, a draft finito. Opzioni del giocatore: esce se vale più del 120% dello stipendio
 * e non si trova bene, o se vale più del 150% (playerOptsOut). Opzioni della squadra: i bot decidono adesso, i manager
 * nel turno delle opzioni (resta "team" con lastSalary: pendingTeamOptions). Chi scade resta in rosa "in scadenza"
 * (contratto senza stipendi) fino al turno dei rinnovi; i two-way scadono e basta. Da qui la configurazione è quella
 * della stagione successiva.
 */
export function scaleContracts(state: LeagueState): void {
  const year = state.config.year;
  const next = nextConfig(state.config);
  for (const c of [...state.contracts]) {
    const prev = c.salaries[0] ?? 0;
    c.salaries.shift();
    c.options.shift();
    const p = state.players.find((x) => x.id === c.playerId) as PlayerState;
    const expired = c.type === 'two-way' ? true : c.salaries.length === 0;
    let leave = expired;
    if (!expired && c.options[0] === 'team') {
      if (state.teams.find((t) => t.id === c.teamId)?.human) {
        // Decide il manager nel turno delle opzioni
        c.lastSalary = prev;
        continue;
      }
      if (!botKeepsOption(next, p, c.salaries[0] as number)) {
        leave = true;
        state.transactions.push({
          year,
          turn: null,
          type: 'option',
          text: `${c.teamId} non esercita l'opzione su ${p.firstName} ${p.lastName}`,
        });
      } else c.options[0] = null;
    } else if (!expired && c.options[0] === 'player') {
      if (playerOptsOut(next, p, c.salaries[0] as number)) {
        leave = true;
        state.transactions.push({
          year,
          turn: null,
          type: 'option',
          text: `${p.firstName} ${p.lastName} esce dal contratto con ${c.teamId}`,
        });
      } else c.options[0] = null;
    }
    if (!leave) continue;
    if (c.type === 'two-way') {
      state.contracts = state.contracts.filter((x) => x !== c);
      p.teamId = null;
    } else expire(c, prev);
  }
  for (const d of state.deadMoney) d.salaries.shift();
  state.deadMoney = state.deadMoney.filter((d) => d.salaries.length > 0);
  scaleCoachContracts(state);

  // Da qui si lavora sulla stagione successiva
  state.config = next;
  const draftYear = year + 1;
  state.picks.push(
    ...state.teams.flatMap((t) => [
      newPick(draftYear + PICK_YEARS, 1, t.id),
      newPick(draftYear + PICK_YEARS, 2, t.id),
    ]),
  );
  updateStrategies(state);
}

/** Opzioni della squadra ancora da decidere (tra il draft e la chiusura del turno delle opzioni). */
export function pendingTeamOptions(state: LeagueState, teamId?: string): Contract[] {
  return state.contracts.filter(
    (c) =>
      c.options[0] === 'team' &&
      c.salaries.length > 0 &&
      c.lastSalary !== undefined &&
      (teamId === undefined || c.teamId === teamId),
  );
}

export type OptionDecision = 'exercise' | 'decline' | 'bot';

/**
 * 5. Turno delle opzioni: per ogni opzione della squadra ancora da decidere, il manager la esercita (il contratto
 * resta) o la declina (il giocatore va in scadenza e si può rinnovare nel turno dopo). Senza risposta decade, come
 * nella NBA; 'bot' (squadra affidata all'allenatore, o tornata al bot) decide la logica del bot.
 */
export function closeOptions(
  state: LeagueState,
  decisions: ReadonlyMap<string, OptionDecision>,
): { exercised: string[]; declined: string[] } {
  const year = state.config.year - 1;
  const out = { exercised: [] as string[], declined: [] as string[] };
  for (const c of pendingTeamOptions(state)) {
    const p = state.players.find((x) => x.id === c.playerId) as PlayerState;
    const team = state.teams.find((t) => t.id === c.teamId);
    const decision = decisions.get(c.playerId) ?? (team?.human ? 'decline' : 'bot');
    const keep =
      decision === 'exercise' ||
      (decision === 'bot' && botKeepsOption(state.config, p, c.salaries[0] as number));
    const name = `${p.firstName} ${p.lastName}`;
    if (keep) {
      c.options[0] = null;
      delete c.lastSalary;
      out.exercised.push(p.id);
      state.transactions.push({
        year,
        turn: null,
        type: 'option',
        text: `${c.teamId} esercita l'opzione su ${name}`,
      });
    } else {
      expire(c, c.lastSalary as number);
      out.declined.push(p.id);
      state.transactions.push({
        year,
        turn: null,
        type: 'option',
        text: `${c.teamId} non esercita l'opzione su ${name}`,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ rinnovi e RFA

/**
 * RFA (free agent con restrizioni), come nella NBA semplificata: chi finisce il contratto da rookie o ha al più 3 anni
 * nella lega. Gli altri sono UFA.
 */
export function restrictedEligible(
  p: Pick<PlayerState, 'yearsInLeague'>,
  c: Pick<Contract, 'type'>,
): boolean {
  return c.type === 'rookie' || (p.yearsInLeague !== null && p.yearsInLeague <= 3);
}

/** Offerta di qualifica: un anno al 125% dell'ultimo stipendio, almeno il minimo per lui, non oltre il massimo. */
export function qualifyingOfferFor(
  c: SeasonConfig,
  p: Pick<PlayerState, 'yearsInLeague'>,
  lastSalary: number | undefined,
): number {
  const minimum = minimumSalaryFor(c, p.yearsInLeague);
  const qo = Math.round(((lastSalary ?? 0) * 1.25) / 10_000) * 10_000;
  return Math.min(maxSalaryFor(c, p.yearsInLeague), Math.max(minimum, qo));
}

/** Decisione su un giocatore in scadenza: rinnovo con le cifre concordate, lasciarlo andare, o logica del bot. */
export type RenewalDecision = { salaries: number[]; options?: ContractOption[] } | 'release' | 'bot';

/**
 * 6. Rinnovi: per ogni giocatore in scadenza decide la sua squadra. Un rinnovo concordato nella trattativa si firma
 * così com'è; 'release' lo lascia andare; 'bot' (squadre dei bot e allenatori delegati) decide la logica del bot alla
 * richiesta. Senza decisione un manager lo lascia andare. Chi non rinnova diventa svincolato, senza stipendi residui:
 * se è un RFA e la squadra gli fa l'offerta di qualifica (qualify per i manager, la logica del bot per 'bot'), resta
 * legato a lei in free agency (state.restricted). Poi un bot in rosso prova a liberarsi di un contratto pesante (al
 * massimo uno scambio tra bot per turno).
 */
export function closeRenewals(
  state: LeagueState,
  decisions: ReadonlyMap<string, RenewalDecision>,
  qualify: ReadonlySet<string> = new Set(),
): { renewed: string[]; released: string[]; restricted: string[] } {
  const rng = new Rng(`${state.seed}:rinnovi:${state.config.year}`);
  const out = { renewed: [] as string[], released: [] as string[], restricted: [] as string[] };
  const year = state.config.year - 1;
  for (const p of expiringPlayers(state)) {
    const teamId = p.teamId as string;
    const team = state.teams.find((t) => t.id === teamId);
    const decision = decisions.get(p.id) ?? (team?.human ? 'release' : 'bot');
    const c = contractOf(state, p.id) as Contract;
    const ask = expiringAsk(state, p);
    const agreed = typeof decision === 'object' ? decision : null;
    const renew =
      agreed !== null ||
      (decision === 'bot' && ask !== null && botWantsRenewal(state, teamId, p, ask[0] as number));
    if (renew) {
      const salaries = agreed?.salaries ?? (ask as number[]);
      signContract(
        state,
        p,
        {
          playerId: p.id,
          teamId,
          type: 'standard',
          salaries,
          options: salaries.map((_, i) => agreed?.options?.[i] ?? null),
          guaranteed: null,
        },
        null,
        true,
      );
      out.renewed.push(p.id);
      continue;
    }
    const rfa = restrictedEligible(p, c);
    const qo = qualifyingOfferFor(state.config, p, c.lastSalary);
    // L'offerta di qualifica la decide il manager (qualify) o, con 'bot', la logica del bot
    const tender = rfa && (decision === 'bot' ? botWantsRenewal(state, teamId, p, qo) : qualify.has(p.id));
    state.contracts = state.contracts.filter((x) => x.playerId !== p.id);
    p.teamId = null;
    if (tender) {
      (state.restricted ??= []).push({ playerId: p.id, teamId, qualifyingOffer: qo });
      out.restricted.push(p.id);
      state.transactions.push({
        year,
        turn: null,
        type: 'option',
        text: `${teamId} fa l'offerta di qualifica a ${p.firstName} ${p.lastName}: è free agent con restrizioni`,
      });
    } else out.released.push(p.id);
  }
  // Fino a 6 tentativi, ma al massimo uno scambio tra bot per turno
  for (let i = 0; i < 6; i++) if (botSalaryDump(state, rng, null)) break;
  return out;
}

// ------------------------------------------------------------------------------------------------ free agency

/** Squadre dalla peggiore della stagione appena finita: a parità di offerta vince la peggiore. */
export function worstFirstOf(state: LeagueState): string[] {
  return [...leagueStandings(state.teams, regularGames(state), seasonStandingsSeed(state))].reverse();
}

/** Offerte dei bot in un turno di free agency (round 0-14). */
export function botFreeAgencyOffers(state: LeagueState, round: number): Offer[] {
  return botOffers(state, round, new Rng(`${state.seed}:fa:${state.config.year}:${round}`), {
    fillTo: MAX_STANDARD,
  });
}

// ------------------------------------------------------------------------------------------------ preparazione

/** Cosa manca a una rosa per stare nei limiti della stagione: contratti standard da tagliare o da firmare, two-way. */
export interface RosterIssues {
  standard: number;
  twoWay: number;
  /** Contratti standard da tagliare per stare nei 15. */
  cut: number;
  /** Contratti standard da firmare per arrivare a 13. */
  sign: number;
  /** Two-way da tagliare per stare nei 3. */
  cutTwoWay: number;
}

export function rosterIssues(state: LeagueState, teamId: string): RosterIssues {
  const standard = standardRoster(state, teamId).length;
  const twoWay = twoWayRoster(state, teamId).length;
  return {
    standard,
    twoWay,
    cut: Math.max(0, standard - MAX_STANDARD),
    sign: Math.max(0, MIN_STANDARD - standard),
    cutTwoWay: Math.max(0, twoWay - MAX_TWO_WAY),
  };
}

/** La rosa è nei limiti della stagione? */
export function rosterReady(state: LeagueState, teamId: string): boolean {
  const i = rosterIssues(state, teamId);
  return i.cut === 0 && i.sign === 0 && i.cutTwoWay === 0;
}

/** Quello che il server ha dovuto sistemare in una rosa umana a inizio stagione. */
export interface RosterFix {
  teamId: string;
  released: string[];
  signed: string[];
}

/**
 * 7. Preparazione e nuova stagione. I manager sistemano da soli le loro rose; quello che resta fuori dai limiti
 * (13-15 contratti standard, al più 3 two-way) lo corregge il server per tutti: si tagliano gli overall più bassi e chi
 * è sotto 13 firma al minimo. Prima gli RFA ancora senza contratto firmano la qualifica. Poi two-way dei bot tra i
 * giovani svincolati, statistiche azzerate, energia piena, calendario nuovo. Restituisce le correzioni fatte alle
 * squadre umane.
 */
export function startNewSeason(state: LeagueState): RosterFix[] {
  signQualifyingOffers(state, null);
  state.offerSheets = [];
  const humans = state.teams.filter((t) => t.human);
  const before = new Map(humans.map((t) => [t.id, new Set(roster(state, t.id).map((p) => p.id))]));
  enforceRosterLimits(state, { includeHumans: true });
  for (const team of state.teams.filter((t) => !t.human)) {
    const freeYoung = state.players
      .filter((p) => p.teamId === null && p.age <= 24 && !releasedBy(state, team.id, p.id))
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
  for (const team of humans) fillRosterAtMinimum(state, team.id, null);
  const name = (id: string) => {
    const p = state.players.find((x) => x.id === id);
    return p ? `${p.firstName} ${p.lastName}` : id;
  };
  const fixes: RosterFix[] = [];
  for (const team of humans) {
    const was = before.get(team.id) as Set<string>;
    const now = new Set(roster(state, team.id).map((p) => p.id));
    const released = [...was].filter((id) => !now.has(id)).map(name);
    const signed = [...now].filter((id) => !was.has(id)).map(name);
    if (released.length || signed.length) fixes.push({ teamId: team.id, released, signed });
  }
  for (const p of state.players) {
    p.stats = emptyStats();
    p.twoWayGames = 0;
    p.energy = 100;
    p.morale = p.morale + (60 - p.morale) * 0.5;
  }
  state.schedule = generateSchedule(state.teams, state.config.year, state.seed);
  state.games = [];
  state.postseason = null;
  state.offseason = null;
  state.restricted = [];
  state.turn = 0;
  state.day = turnDay(state.schedule, 0) ?? 0;
  state.phase = 'regular';
  // Stagione nuova: chi è stato tagliato si può rifirmare
  state.releases = [];
  updateStrategies(state);
  if (state.coaches) setExpectations(state);
  return fixes;
}

/**
 * Offseason intera, di fila (simulazione offline): i manager umani non scelgono, non esercitano opzioni, non rinnovano
 * e non fanno offerte. La classe del draft è quella data o una generata. Nei turni di sole offerte della free agency non
 * firma nessuno: si parte dal primo in cui si firma.
 */
export function runOffseason(state: LeagueState, opts: { draftClass?: Player[] } = {}): SeasonSummary {
  const year = state.config.year;
  const draftClass =
    opts.draftClass ??
    generatedDraftClass(new Rng(`${state.seed}:offseason:${year}`).fork('draft'), year + 1);
  const txStart = state.transactions.length;
  const { summary } = startOffseason(state, draftClass);
  runAnnualDraft(state, new Map());
  scaleContracts(state);
  closeOptions(state, new Map());
  closeRenewals(state, new Map());
  const worstFirst = worstFirstOf(state);
  for (let round = FA_MORATORIUM_ROUNDS; round < FREE_AGENCY_ROUNDS; round++) {
    resolveOfferSheets(state, new Map(), null);
    resolveOffers(state, botFreeAgencyOffers(state, round), round, worstFirst, null);
  }
  resolveOfferSheets(state, new Map(), null);
  startNewSeason(state);
  summary.signings += state.transactions.slice(txStart).filter((t) => t.type === 'signing').length;
  return summary;
}

/** Gioca una stagione intera, dalla prima giornata alla fine dell'offseason. */
export function simulateSeason(state: LeagueState, playGame: PlayGame = simulateGame): SeasonSummary {
  while (state.phase === 'regular') playRegularTurn(state, playGame);
  while (state.phase === 'postseason') playPostseasonTurn(state, playGame);
  return runOffseason(state);
}
