// Azioni di mercato di un manager: controllo con il motore sullo stato della lega e preparazione della
// scrittura per public.market_write. Comune alla Edge Function market (Deno) e ai test (Node). Il turno le
// esegue tutte alla chiusura, ricontrollandole: qui si rifiuta subito quello che già adesso non va.
import {
  askingSalary,
  askTerms,
  canSign,
  checkCoachHire,
  expiringAsk,
  freeAgencyRoundOf,
  isExpiring,
  contractOf,
  inSeasonAsk,
  LOWBALL_MORALE,
  maxSalaryFor,
  minimumSalaryFor,
  MIN_RENEWAL_MORALE,
  nextConfig,
  pendingTeamOptions,
  releasedBy,
  renewalMax,
  renewalOffer,
  renewalReply,
  RENEWAL_ATTEMPTS,
  restrictedEligible,
  salaryRun,
  snapToAsk,
  termsContract,
  validateTrade,
} from '../../../packages/engine/src/index.ts';
import type {
  LeagueState,
  OffseasonStage,
  PlayerState,
  RenewalTalk,
  RenewalTerms,
  Trade,
} from '../../../packages/engine/src/index.ts';
import { leagueStateFromRows, type LeagueStateRows, type StateIds } from './state.ts';
import { tradeFromRow } from './turn.ts';

export class MarketError extends Error {}

/** Risposta del giocatore a un'offerta di rinnovo, per l'app: mai la soglia nascosta. */
export type RenewalAnswer =
  | { kind: 'accept'; salaries: number[]; options: (string | null)[] }
  | { kind: 'counter'; counter: RenewalTerms; attemptsLeft: number; lowball: boolean }
  | { kind: 'final'; counter: RenewalTerms; lowball: boolean };

/** Proposte in attesa che una squadra può avere aperte insieme. */
export const MAX_OPEN_OFFERS = 10;

export type MarketAction =
  | { kind: 'bid'; player_id: string; salary: number; years: number }
  | { kind: 'withdraw_bid'; bid_id: string }
  | {
      kind: 'propose_trade';
      to_team_id: string;
      players_from?: string[];
      players_to?: string[];
      picks_from?: string[];
      picks_to?: string[];
      /** { id della propria prima scelta ceduta: N } */
      protections?: Record<string, number>;
      /** holder: chi riceve il diritto di scambiare la propria scelta con quella dell'altra squadra */
      swaps?: { draft_year: number; round: number; holder: 'from' | 'to' }[];
    }
  | { kind: 'respond_trade'; offer_id: string; accept: boolean }
  | { kind: 'withdraw_trade'; offer_id: string }
  | { kind: 'release'; player_id: string }
  /** Rinnovo alla richiesta del giocatore (la si accetta così com'è). */
  | { kind: 'renew'; player_id: string }
  /** Trattativa del rinnovo: stipendio del primo anno, anni (1-5) e opzione sull'ultimo anno; risposta subito. */
  | {
      kind: 'renew_offer';
      player_id: string;
      salary: number;
      years: number;
      option?: 'player' | 'team' | null;
    }
  /** Draft dal vivo: il giocatore scelto per la chiamata del turno. */
  | { kind: 'draft_pick'; player_id: string }
  /** Turno delle opzioni: esercitare (true) o declinare l'opzione della squadra. */
  | { kind: 'option'; player_id: string; exercise: boolean }
  /** Turno dei rinnovi: offerta di qualifica a un RFA in scadenza (o ritirarla). */
  | { kind: 'qualify'; player_id: string; qualify: boolean }
  /** Free agency: pareggiare (true) o no l'offerta che un proprio RFA ha scelto da un'altra squadra. */
  | { kind: 'match'; player_id: string; match: boolean }
  | { kind: 'withdraw_request'; request_id: string }
  /** Cambio di allenatore: esonera quello di adesso e prende uno libero alla sua richiesta, alla chiusura del turno. */
  | { kind: 'hire_coach'; coach_id: string }
  | { kind: 'withdraw_coach'; request_id: string };

const millions = (x: number) => `${(x / 1e6).toFixed(2).replace('.', ',')} mln`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (x: unknown): x is string => typeof x === 'string' && UUID.test(x);

/** Elementi al massimo in ogni lista di una proposta (giocatori, scelte, swap): bastano per qualunque scambio vero. */
export const MAX_TRADE_ITEMS = 30;

/**
 * Forma della proposta come arriva dall'app (o dall'API chiamata a mano): liste di uuid, protezioni { uuid: intero },
 * swap con anno e giro interi e holder 'from' o 'to'. Quello che non torna è un MarketError, non un errore del
 * database alla scrittura (uuid[] e integer) o alla chiusura del turno (terza analisi: uno swap con anno 2028.5 era
 * salvato e fermava il turno).
 */
function tradeShape(action: Extract<MarketAction, { kind: 'propose_trade' }>) {
  const bad = (what: string) => new MarketError(`Proposta non valida: ${what}`);
  const list = (x: unknown, what: string): string[] => {
    if (x === undefined || x === null) return [];
    if (!Array.isArray(x) || !x.every(isUuid)) throw bad(what);
    if (x.length > MAX_TRADE_ITEMS) throw new MarketError('Troppi elementi nello scambio');
    return x;
  };
  const protections: Record<string, number> = {};
  if (action.protections !== undefined && action.protections !== null) {
    const p: unknown = action.protections;
    if (typeof p !== 'object' || Array.isArray(p)) throw bad('protezioni');
    for (const [id, n] of Object.entries(p as Record<string, unknown>)) {
      if (!isUuid(id) || typeof n !== 'number' || !Number.isInteger(n)) throw bad('protezioni');
      protections[id] = n;
    }
  }
  const swaps: unknown = action.swaps ?? [];
  if (!Array.isArray(swaps)) throw bad('swap');
  if (swaps.length > MAX_TRADE_ITEMS) throw new MarketError('Troppi elementi nello scambio');
  const integer = (x: unknown): x is number => typeof x === 'number' && Number.isInteger(x);
  for (const w of swaps as unknown[]) {
    const s = w as { draft_year?: unknown; round?: unknown; holder?: unknown } | null;
    if (!s || typeof s !== 'object' || !integer(s.draft_year) || !integer(s.round)) throw bad('swap');
    if (s.holder !== 'from' && s.holder !== 'to') throw bad('swap');
  }
  return {
    playersFrom: list(action.players_from, 'giocatori ceduti'),
    playersTo: list(action.players_to, 'giocatori richiesti'),
    picksFrom: list(action.picks_from, 'scelte cedute'),
    picksTo: list(action.picks_to, 'scelte richieste'),
    protections,
    swaps: swaps as { draft_year: number; round: number; holder: 'from' | 'to' }[],
  };
}

/** L'id di una riga a cui l'azione si riferisce (offerta, proposta, richiesta, squadra): un uuid, o MarketError. */
function rowId(x: unknown, what: string): string {
  if (!isUuid(x)) throw new MarketError(`${what} non trovata`);
  return x;
}

/**
 * Giocatore dell'azione (offerta, taglio, rinnovo), o null. La Edge Function legge lo stato con
 * public.market_state(lega, giocatore), che dà le abilità solo a lui: servono per la sua richiesta. Un id che non è
 * un uuid non arriva al database (darebbe un errore di tipo): il controllo dice poi che il giocatore non c'è.
 */
export function actionPlayer(action: MarketAction): string | null {
  const id = (action as { player_id?: unknown }).player_id;
  return typeof id === 'string' && UUID.test(id) ? id : null;
}

/**
 * Controlla l'azione del manager userId. Restituisce la squadra, il turno e l'azione da scrivere con
 * market_write; lancia MarketError con un messaggio per il manager se l'azione non è valida. rows può essere lo stato
 * completo (league_state) o quello leggero di market_state con il giocatore dell'azione (actionPlayer): il risultato
 * è lo stesso.
 */
export function checkMarketAction(
  rows: LeagueStateRows,
  userId: string,
  action: MarketAction,
): { teamId: string; roundId: string; write: Record<string, unknown>; reply?: RenewalAnswer } {
  const round = rows.round;
  if (!round || round.state !== 'open') throw new MarketError('Il turno è già in chiusura: riprova tra poco');
  const team = rows.teams.find((t) => t.owner_id === userId);
  if (!team) throw new MarketError('Non hai una squadra in questa lega');
  const { state, ids: map } = leagueStateFromRows(rows);
  const me = team.code;
  const write = (w: Record<string, unknown>) => ({ teamId: team.id, roundId: round.id, write: w });
  const marketOpen = round.kind === 'regular';
  const offseason = round.kind === 'offseason';
  const stage = offseason ? (round.stage ?? null) : null;
  const faRound = stage ? freeAgencyRoundOf(stage as OffseasonStage) : null;

  switch (action.kind) {
    case 'bid': {
      if (!marketOpen && faRound === null && stage !== 'preparation')
        throw new MarketError('Svincolati: si firma in regular season, in free agency e in preparazione');
      const p = state.players.find((x) => x.id === action.player_id);
      if (!p || p.teamId !== null || p.prospect) throw new MarketError('Il giocatore non è svincolato');
      const sheet = state.offerSheets?.find((x) => x.playerId === p.id);
      if (sheet)
        throw new MarketError(
          `Ha già scelto l'offerta di ${sheet.teamId}: aspetta che ${sheet.rightsTeamId} decida se pareggiarla`,
        );
      if (releasedBy(state, me, p.id))
        throw new MarketError('Lo hai tagliato in questa stagione: potrai rifirmarlo dalla prossima');
      const years = Number(action.years);
      const ask = faRound === null ? inSeasonAsk(state, p) : askingSalary(state, p, faRound);
      // La cifra mostrata dall'app (arrotondata ai 10.000 $) vale come la richiesta esatta
      const salary = snapToAsk(Math.round(Number(action.salary)), ask);
      if (!Number.isInteger(years) || years < 1 || years > 5)
        throw new MarketError('Il contratto va da 1 a 5 anni');
      const min = minimumSalaryFor(state.config, p.yearsInLeague);
      const max = maxSalaryFor(state.config, p.yearsInLeague);
      if (!(salary >= min)) throw new MarketError(`Lo stipendio minimo per lui è ${millions(min)}`);
      if (salary > max) throw new MarketError(`Lo stipendio massimo per lui è ${millions(max)}`);
      // In free agency un'offerta sotto la richiesta resta sul tavolo e firma quando la richiesta scende; in stagione e
      // in preparazione si firma solo alla richiesta
      if (salary < ask && faRound === null)
        throw new MarketError(`Chiede almeno ${millions(ask)} a stagione`);
      const check = canSign(state, me, p, salary);
      if (!check.ok) throw new MarketError(`Non puoi firmarlo: ${check.reason}`);
      return write({ kind: 'bid', player_id: p.id, salaries: salaryRun(salary, years) });
    }

    case 'withdraw_bid':
      return write({ kind: 'withdraw_bid', bid_id: rowId(action.bid_id, 'Offerta') });

    case 'propose_trade': {
      const to = rows.teams.find((t) => t.id === action.to_team_id);
      if (!to || to.id === team.id) throw new MarketError('Scegli la squadra con cui scambiare');
      const open = (rows.trade_offers ?? []).filter((o) => o.from_team_id === team.id).length;
      if (open >= MAX_OPEN_OFFERS) throw new MarketError(`Hai già ${MAX_OPEN_OFFERS} proposte in attesa`);
      const shape = tradeShape(action);
      const trade: Trade = {
        teamA: me,
        teamB: to.code,
        playersA: shape.playersFrom,
        playersB: shape.playersTo,
        picksA: shape.picksFrom,
        picksB: shape.picksTo,
        protections: shape.protections,
        swaps: shape.swaps.map((w) => ({
          draftYear: w.draft_year,
          round: w.round as 1 | 2,
          holderId: w.holder === 'from' ? me : to.code,
          otherId: w.holder === 'from' ? to.code : me,
        })),
      };
      const assets =
        trade.playersA.length + trade.playersB.length + trade.picksA.length + trade.picksB.length;
      if (assets === 0 && !trade.swaps?.length) throw new MarketError('Lo scambio è vuoto');
      const problems = validateTrade(state, trade);
      if (problems.length) throw new MarketError(problems.join('. '));
      return write({
        kind: 'propose_trade',
        to_team_id: to.id,
        players_from: trade.playersA,
        players_to: trade.playersB,
        picks_from: trade.picksA,
        picks_to: trade.picksB,
        protections: trade.protections,
        swaps: (trade.swaps ?? []).map((w) => ({
          draft_year: w.draftYear,
          round: w.round,
          holder_team_id: teamUuid(map, w.holderId),
          other_team_id: teamUuid(map, w.otherId),
        })),
      });
    }

    case 'respond_trade': {
      const offer = (rows.trade_offers ?? []).find((o) => o.id === action.offer_id);
      if (!offer || offer.to_team_id !== team.id || offer.status !== 'pending')
        throw new MarketError('Proposta di scambio non trovata o già decisa');
      if (action.accept) {
        const problems = validateTrade(
          state,
          tradeFromRow(offer, (id) => codeOf(map, id)),
        );
        if (problems.length) throw new MarketError(`Lo scambio non è più valido: ${problems.join('. ')}`);
      }
      return write({ kind: 'respond_trade', offer_id: offer.id, accept: action.accept === true });
    }

    case 'withdraw_trade':
      return write({ kind: 'withdraw_trade', offer_id: rowId(action.offer_id, 'Proposta di scambio') });

    case 'release': {
      if (!marketOpen && !offseason) throw new MarketError('Durante play-in e playoff non si taglia');
      const p = ownPlayer(state, me, action.player_id);
      if (!contractOf(state, p.id)) throw new MarketError('Il giocatore non ha un contratto');
      return write({ kind: 'release', player_id: p.id });
    }

    case 'renew': {
      // La richiesta così com'è: il giocatore la accetta sempre (se il morale non è troppo basso)
      const p = ownPlayer(state, me, action.player_id);
      const ctx = renewalContext(state, rows, team.id, p, stage, marketOpen);
      return write({
        kind: 'renew',
        player_id: p.id,
        salaries: ctx.ask,
        options: ctx.ask.map(() => null),
      });
    }

    case 'renew_offer': {
      const p = ownPlayer(state, me, action.player_id);
      const ctx = renewalContext(state, rows, team.id, p, stage, marketOpen);
      const years = Number(action.years);
      if (!Number.isInteger(years) || years < 1 || years > 5)
        throw new MarketError('Il contratto va da 1 a 5 anni');
      const option = action.option ?? null;
      if (option !== null && option !== 'player' && option !== 'team')
        throw new MarketError('Opzione non valida');
      if (option !== null && years < 2)
        throw new MarketError('L’opzione si mette sull’ultimo di almeno 2 anni');
      const ask = askTerms(ctx.ask);
      const salary = snapToAsk(Math.round(Number(action.salary)), ask.salary);
      if (!(salary >= ctx.min)) throw new MarketError(`Lo stipendio minimo per lui è ${millions(ctx.min)}`);
      if (salary > ctx.max) throw new MarketError(`Lo stipendio massimo per lui è ${millions(ctx.max)}`);
      const offer: RenewalTerms = { salary, years, option };
      const reply = renewalReply(ask, p, offer, ctx.talk, {
        min: ctx.min,
        max: ctx.max,
        minMorale: MIN_RENEWAL_MORALE,
      });
      if (reply.kind === 'refuse') throw new MarketError('Non vuole rinnovare: il morale è troppo basso');
      const base = { kind: 'renew_offer', player_id: p.id };
      if (reply.kind === 'accept') {
        const contract = termsContract(offer);
        return {
          ...write({
            ...base,
            accepted: true,
            ...contract,
            refusals: ctx.talk.refusals,
            counter: ctx.talk.counter,
            morale_penalty: 0,
          }),
          reply: { kind: 'accept', ...contract },
        };
      }
      const refusals = Math.min(RENEWAL_ATTEMPTS, ctx.talk.refusals + 1);
      const answer: RenewalAnswer =
        reply.kind === 'counter'
          ? {
              kind: 'counter',
              counter: reply.counter,
              attemptsLeft: reply.attemptsLeft,
              lowball: reply.lowball,
            }
          : { kind: 'final', counter: reply.counter, lowball: reply.lowball };
      return {
        ...write({
          ...base,
          accepted: false,
          refusals,
          counter: reply.counter,
          morale_penalty: reply.lowball ? LOWBALL_MORALE : 0,
        }),
        reply: answer,
      };
    }

    case 'draft_pick': {
      if (stage !== 'draft' || !round.draft_team_id)
        throw new MarketError('Si sceglie nei turni del draft, quando tocca a te');
      if (round.draft_team_id !== team.id) throw new MarketError('In questo turno non tocca a te scegliere');
      const p = state.players.find((x) => x.id === action.player_id);
      if (!p || p.prospect === null || p.prospect === undefined)
        throw new MarketError('Il giocatore non è tra i prospetti del draft');
      return write({ kind: 'draft_pick', player_id: p.id, payload: {} });
    }

    case 'option': {
      if (stage !== 'options') throw new MarketError('Le opzioni si decidono nel turno delle opzioni');
      const p = ownPlayer(state, me, action.player_id);
      if (!pendingTeamOptions(state, me).some((c) => c.playerId === p.id))
        throw new MarketError('Non c’è un’opzione della squadra da decidere su questo giocatore');
      return write({ kind: 'option', player_id: p.id, payload: { exercise: action.exercise === true } });
    }

    case 'qualify': {
      if (stage !== 'renewals') throw new MarketError('L’offerta di qualifica si fa nel turno dei rinnovi');
      const p = ownPlayer(state, me, action.player_id);
      const c = contractOf(state, p.id);
      if (!c || !isExpiring(state, p.id)) throw new MarketError('Il giocatore non è in scadenza');
      if (!restrictedEligible(p, c))
        throw new MarketError(
          'Solo chi finisce il contratto da rookie o ha al più 3 anni nella lega è un RFA',
        );
      return write({ kind: 'qualify', player_id: p.id, payload: { qualify: action.qualify !== false } });
    }

    case 'match': {
      const sheet = state.offerSheets?.find((x) => x.playerId === action.player_id);
      if (!offseason || !sheet || sheet.rightsTeamId !== me)
        throw new MarketError('Nessuna offerta da pareggiare per questo giocatore');
      return write({ kind: 'match', player_id: sheet.playerId, payload: { match: action.match === true } });
    }

    case 'withdraw_request':
      return write({ kind: 'withdraw_request', request_id: rowId(action.request_id, 'Richiesta') });

    case 'hire_coach': {
      // In ogni turno, anche in post-season e in offseason: si esegue alla chiusura
      if (!state.coaches) throw new MarketError('In questa lega non ci sono allenatori');
      if (!isUuid(action.coach_id)) throw new MarketError('Allenatore non trovato');
      const check = checkCoachHire(state, me, action.coach_id);
      if (!check.ok) throw new MarketError(`Non puoi prenderlo: ${check.reason}`);
      return write({ kind: 'hire_coach', coach_id: action.coach_id });
    }

    case 'withdraw_coach':
      return write({ kind: 'withdraw_coach', request_id: rowId(action.request_id, 'Richiesta') });

    default:
      throw new MarketError('Azione non valida');
  }
}

/**
 * Da dove parte la trattativa di un rinnovo: la richiesta del giocatore (stipendi dalla stagione che arriva), lo
 * stipendio minimo e massimo per lui e com'è andata finora con questa squadra. Nel turno dei rinnovi i giocatori in
 * scadenza (la configurazione è già quella della stagione che arriva), in regular season chi è all'ultimo anno.
 */
function renewalContext(
  state: LeagueState,
  rows: LeagueStateRows,
  teamUuid: string,
  p: PlayerState,
  stage: string | null,
  marketOpen: boolean,
): { ask: number[]; min: number; max: number; talk: RenewalTalk } {
  const c = contractOf(state, p.id);
  if (!c || c.type === 'two-way') throw new MarketError('I two-way non si rinnovano');
  const saved = rows.renewal_talks?.find((t) => t.player_id === p.id && t.team_id === teamUuid);
  const talk: RenewalTalk = { refusals: saved?.refusals ?? 0, counter: saved?.counter ?? null };
  if (stage === 'renewals') {
    if (!isExpiring(state, p.id)) throw new MarketError('Il giocatore non è in scadenza');
    const ask = expiringAsk(state, p);
    if (!ask) throw new MarketError('Non vuole rinnovare: il morale è troppo basso');
    const max = maxSalaryFor(state.config, p.yearsInLeague);
    if ((ask[0] ?? 0) > max) throw new MarketError('La richiesta supera lo stipendio massimo');
    return { ask, min: minimumSalaryFor(state.config, p.yearsInLeague), max, talk };
  }
  if (!marketOpen) throw new MarketError('Si rinnova in regular season o nel turno dei rinnovi');
  if (c.salaries.length !== 1) throw new MarketError('Si rinnova solo all’ultimo anno di contratto');
  const offer = renewalOffer(state, p);
  if (!offer) throw new MarketError('Non vuole rinnovare: il morale è troppo basso');
  const max = renewalMax(state.config, p);
  if ((offer.salaries[0] ?? 0) > max) throw new MarketError('La richiesta supera lo stipendio massimo');
  const years = p.yearsInLeague === null ? null : p.yearsInLeague + 1;
  return { ask: offer.salaries, min: minimumSalaryFor(nextConfig(state.config), years), max, talk };
}

function ownPlayer(state: LeagueState, team: string, id: string) {
  const p = state.players.find((x) => x.id === id);
  if (!p || p.teamId !== team) throw new MarketError('Il giocatore non è della tua squadra');
  return p;
}

function teamUuid(map: StateIds, code: string): string {
  const id = map.team.get(code);
  if (!id) throw new MarketError('Squadra sconosciuta');
  return id;
}

function codeOf(map: StateIds, id: string): string {
  const c = map.code.get(id);
  if (!c) throw new MarketError('Squadra sconosciuta');
  return c;
}
