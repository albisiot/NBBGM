// Offseason a turni (Fase 12), nell'ordine del documento. Ogni passo è una funzione: il server ne esegue uno
// alla chiusura di ogni turno, la simulazione offline (runOffseason) li esegue tutti di fila.
//
//   alla chiusura della finale   fine stagione (crescita, età, ritiri), lottery, ordine del draft, classe del draft
//   turno "draft"                i manager ordinano i preferiti; alla chiusura 60 scelte, contratti che scalano
//   turno "renewals"             rinnovi dei giocatori in scadenza; chi non rinnova diventa svincolato
//   turni "fa1"-"fa4"            free agency a busta chiusa (le richieste scendono di turno in turno)
//   turno "preparation"          rose nei limiti, nuova stagione
import { ARCHETYPE_PROFILES } from '../archetype-profiles.ts';
import { generateDraftClass } from '../generator.ts';
import { overall } from '../overall.ts';
import { Rng } from '../rng.ts';
import type { Player } from '../types.ts';
import { botDraftChoice, botSalaryDump, botWantsRenewal, updateStrategies } from './bots.ts';
import { minimumSalaryFor, nextConfig } from './config.ts';
import { normalizeTalent, retirementChance, developPlayer } from './development.ts';
import {
  contractOf,
  marketValue,
  MAX_STANDARD,
  releasedBy,
  salaryRun,
  signContract,
  twoWayRoster,
  typicalYears,
} from './finance.ts';
import {
  askingSalary,
  botOffers,
  FREE_AGENCY_ROUNDS,
  fillMinimumRosters,
  fillRosterAtMinimum,
  resolveOffers,
  type Offer,
} from './freeAgency.ts';
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
import { emptyStats, type LeagueState, type PlayerState, type SeasonSummary } from './state.ts';

export const OFFSEASON_STAGES = ['draft', 'renewals', 'fa1', 'fa2', 'fa3', 'fa4', 'preparation'] as const;
export type OffseasonStage = (typeof OFFSEASON_STAGES)[number];

/** Turno di offseason che segue (null dopo la preparazione: riparte la regular season). */
export function nextStage(stage: OffseasonStage): OffseasonStage | null {
  const i = OFFSEASON_STAGES.indexOf(stage);
  return OFFSEASON_STAGES[i + 1] ?? null;
}

/** Indice del turno di free agency (0-3) di uno stage, o null. */
export function freeAgencyRoundOf(stage: OffseasonStage): number | null {
  const m = /^fa([1-4])$/.exec(stage);
  return m ? Number(m[1]) - 1 : null;
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
 * arriva): stipendi per gli anni tipici della sua età, oppure null se con il morale sotto 30 non rinnova.
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

  // 1. Fine stagione: crescita e calo, un anno in più, ritiri
  for (const p of state.players) {
    developPlayer(p, rng.fork(`crescita:${p.id}`));
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
  return { summary, retired };
}

/**
 * 3. Draft annuale: per ogni chiamata, chi possiede la scelta prende il primo disponibile della sua lista (le
 * squadre umane) o sceglie con la logica del bot. Primo giro: 4 anni a stipendio fisso per posizione (scala
 * rookie); secondo giro: 2 anni al minimo. I contratti partono dalla stagione successiva. I non scelti
 * diventano svincolati.
 */
export function runAnnualDraft(state: LeagueState, lists: ReadonlyMap<string, readonly string[]>): void {
  const off = state.offseason;
  if (!off) throw new Error('Il draft non è pronto');
  const year = state.config.year;
  const rng = new Rng(`${state.seed}:draft:${off.draftYear}`);
  const next = nextConfig(state.config);
  // Le liste ridotte una volta per squadra ai soli prospetti, senza doppioni e nello stesso ordine: il primo
  // disponibile resta lo stesso, ma una lista lunghissima non si scorre più a ogni chiamata (terza analisi)
  const prospectIds = new Set(state.players.filter((p) => p.prospect === off.draftYear).map((p) => p.id));
  const shortLists = new Map<string, string[]>();
  const shortList = (teamId: string): string[] => {
    let list = shortLists.get(teamId);
    if (!list) {
      list = [...new Set(lists.get(teamId) ?? [])].filter((id) => prospectIds.has(id));
      shortLists.set(teamId, list);
    }
    return list;
  };
  for (const slot of off.slots) {
    if (slot.playerId) continue;
    const available = state.players.filter((p) => p.prospect === off.draftYear);
    if (!available.length) break;
    const team = state.teams.find((t) => t.id === slot.ownerId);
    const list = team?.human ? shortList(slot.ownerId) : [];
    const byId = new Map(available.map((p) => [p.id, p]));
    const choice =
      list.map((id) => byId.get(id)).find((p) => p !== undefined) ??
      botDraftChoice(state, slot.ownerId, available, rng);
    choice.prospect = null;
    choice.draft = { year: off.draftYear, round: slot.round, pick: slot.pick };
    slot.playerId = choice.id;
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
      text: `Draft ${off.draftYear}, ${slot.round}° giro n. ${slot.number}: ${slot.ownerId} sceglie ${choice.firstName} ${choice.lastName}`,
    });
  }
  // I non scelti diventano svincolati: "non scelto" in quel draft
  for (const p of state.players) {
    if (p.prospect !== off.draftYear) continue;
    p.prospect = null;
    p.draft = { year: off.draftYear, round: null, pick: null };
  }
  normalizeTalent(state.players, state.talentReference);
}

/**
 * 4. Contratti che scalano di un anno, con le opzioni (della squadra: decide la logica del bot; del giocatore:
 * esce se vale di più). Chi scade resta in rosa "in scadenza" (contratto senza stipendi) fino al turno dei
 * rinnovi; i two-way scadono e basta. Da qui la configurazione è quella della stagione successiva.
 */
export function scaleContracts(state: LeagueState): void {
  const year = state.config.year;
  const next = nextConfig(state.config);
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
    if (!leave) continue;
    if (c.type === 'two-way') {
      state.contracts = state.contracts.filter((x) => x !== c);
      p.teamId = null;
    } else {
      // In scadenza: la squadra può rinnovarlo nel turno dei rinnovi
      c.salaries = [];
      c.options = [];
      c.guaranteed = null;
    }
  }
  for (const d of state.deadMoney) d.salaries.shift();
  state.deadMoney = state.deadMoney.filter((d) => d.salaries.length > 0);

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

/**
 * 5. Rinnovi: per ogni giocatore in scadenza decide la sua squadra. decision: 'renew' (il manager ha accettato la
 * richiesta), 'release' (lo lascia andare) o 'bot' (decide la logica del bot: squadre dei bot e allenatori
 * delegati). Chi non rinnova diventa svincolato, senza stipendi residui. Poi un bot in rosso prova a liberarsi di
 * un contratto pesante (al massimo uno scambio tra bot per turno).
 */
export function closeRenewals(
  state: LeagueState,
  decisions: ReadonlyMap<string, 'renew' | 'release' | 'bot'>,
): { renewed: string[]; released: string[] } {
  const rng = new Rng(`${state.seed}:rinnovi:${state.config.year}`);
  const out = { renewed: [] as string[], released: [] as string[] };
  for (const p of expiringPlayers(state)) {
    const teamId = p.teamId as string;
    const team = state.teams.find((t) => t.id === teamId);
    const decision = decisions.get(p.id) ?? (team?.human ? 'release' : 'bot');
    const ask = expiringAsk(state, p);
    const renew =
      ask !== null &&
      (decision === 'renew' || (decision === 'bot' && botWantsRenewal(state, teamId, p, ask[0] as number)));
    if (renew) {
      signContract(
        state,
        p,
        {
          playerId: p.id,
          teamId,
          type: 'standard',
          salaries: ask,
          options: ask.map(() => null),
          guaranteed: null,
        },
        null,
        true,
      );
      out.renewed.push(p.id);
    } else {
      state.contracts = state.contracts.filter((c) => c.playerId !== p.id);
      p.teamId = null;
      out.released.push(p.id);
    }
  }
  // Fino a 6 tentativi, ma al massimo uno scambio tra bot per turno
  for (let i = 0; i < 6; i++) if (botSalaryDump(state, rng, null)) break;
  return out;
}

/** Squadre dalla peggiore della stagione appena finita: a parità di offerta vince la peggiore. */
export function worstFirstOf(state: LeagueState): string[] {
  return [...leagueStandings(state.teams, regularGames(state), seasonStandingsSeed(state))].reverse();
}

/** Offerte dei bot in un turno di free agency (round 0-3). */
export function botFreeAgencyOffers(state: LeagueState, round: number): Offer[] {
  return botOffers(state, round, new Rng(`${state.seed}:fa:${state.config.year}:${round}`), {
    fillTo: MAX_STANDARD,
  });
}

/**
 * 7. Preparazione e nuova stagione: rose a 13-15 contratti standard e al massimo 3 two-way per tutte le squadre
 * (si tagliano gli overall più bassi; chi è sotto 13 firma al minimo), two-way dei bot tra i giovani svincolati,
 * statistiche azzerate, energia piena, calendario nuovo.
 */
export function startNewSeason(state: LeagueState): void {
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
  for (const team of state.teams.filter((t) => t.human)) fillRosterAtMinimum(state, team.id, null);
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
  state.turn = 0;
  state.day = turnDay(state.schedule, 0) ?? 0;
  state.phase = 'regular';
  // Stagione nuova: chi è stato tagliato si può rifirmare
  state.releases = [];
  updateStrategies(state);
}

/**
 * Offseason intera, di fila (simulazione offline): i manager umani non rinnovano e non fanno offerte. La classe
 * del draft è quella data o una generata.
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
  closeRenewals(state, new Map());
  const worstFirst = worstFirstOf(state);
  for (let round = 0; round < FREE_AGENCY_ROUNDS; round++)
    resolveOffers(state, botFreeAgencyOffers(state, round), round, worstFirst, null);
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
