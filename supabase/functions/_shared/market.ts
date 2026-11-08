// Azioni di mercato di un manager: controllo con il motore sullo stato della lega e preparazione della
// scrittura per public.market_write. Comune alla Edge Function market (Deno) e ai test (Node). Il turno le
// esegue tutte alla chiusura, ricontrollandole: qui si rifiuta subito quello che già adesso non va.
import {
  askingSalary,
  canSign,
  checkCoachHire,
  expiringAsk,
  freeAgencyRoundOf,
  isExpiring,
  contractOf,
  inSeasonAsk,
  maxSalaryFor,
  minimumSalaryFor,
  releasedBy,
  renewalMax,
  renewalOffer,
  salaryRun,
  snapToAsk,
  validateTrade,
} from '../../../packages/engine/src/index.ts';
import type { LeagueState, OffseasonStage, Trade } from '../../../packages/engine/src/index.ts';
import { leagueStateFromRows, type LeagueStateRows, type StateIds } from './state.ts';
import { tradeFromRow } from './turn.ts';

export class MarketError extends Error {}

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
  | { kind: 'renew'; player_id: string }
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
): { teamId: string; roundId: string; write: Record<string, unknown> } {
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
      if (!marketOpen && faRound === null)
        throw new MarketError('Svincolati: si firma in regular season e nei turni di free agency');
      const p = state.players.find((x) => x.id === action.player_id);
      if (!p || p.teamId !== null || p.prospect) throw new MarketError('Il giocatore non è svincolato');
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
      if (salary < ask) throw new MarketError(`Chiede almeno ${millions(ask)} a stagione`);
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
      const p = ownPlayer(state, me, action.player_id);
      const c = contractOf(state, p.id);
      if (!c || c.type === 'two-way') throw new MarketError('I two-way non si rinnovano');
      if (stage === 'renewals') {
        // Turno dei rinnovi: i giocatori in scadenza, alla richiesta della stagione che arriva
        if (!isExpiring(state, p.id)) throw new MarketError('Il giocatore non è in scadenza');
        const ask = expiringAsk(state, p);
        if (!ask) throw new MarketError('Non vuole rinnovare: il morale è troppo basso');
        if ((ask[0] ?? 0) > maxSalaryFor(state.config, p.yearsInLeague))
          throw new MarketError('La richiesta supera lo stipendio massimo');
        return write({ kind: 'renew', player_id: p.id, salaries: ask });
      }
      if (!marketOpen) throw new MarketError('Si rinnova in regular season o nel turno dei rinnovi');
      if (c.salaries.length !== 1) throw new MarketError('Si rinnova solo all’ultimo anno di contratto');
      const offer = renewalOffer(state, p);
      if (!offer) throw new MarketError('Non vuole rinnovare: il morale è troppo basso');
      if ((offer.salaries[0] ?? 0) > renewalMax(state.config, p))
        throw new MarketError('La richiesta supera lo stipendio massimo');
      return write({ kind: 'renew', player_id: p.id, salaries: offer.salaries });
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
