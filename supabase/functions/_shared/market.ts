// Azioni di mercato di un manager: controllo con il motore sullo stato della lega e preparazione della
// scrittura per public.market_write. Comune alla Edge Function market (Deno) e ai test (Node). Il turno le
// esegue tutte alla chiusura, ricontrollandole: qui si rifiuta subito quello che già adesso non va.
import {
  askingSalary,
  canSign,
  expiringAsk,
  freeAgencyRoundOf,
  isExpiring,
  contractOf,
  inSeasonAsk,
  maxSalaryFor,
  minimumSalaryFor,
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
  | { kind: 'withdraw_request'; request_id: string };

const millions = (x: number) => `${(x / 1e6).toFixed(2).replace('.', ',')} mln`;
const ids = (x: unknown): string[] => (Array.isArray(x) ? x.filter((v) => typeof v === 'string') : []);

/**
 * Controlla l'azione del manager userId. Restituisce la squadra, il turno e l'azione da scrivere con
 * market_write; lancia MarketError con un messaggio per il manager se l'azione non è valida.
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
      return write({ kind: 'withdraw_bid', bid_id: action.bid_id });

    case 'propose_trade': {
      const to = rows.teams.find((t) => t.id === action.to_team_id);
      if (!to || to.id === team.id) throw new MarketError('Scegli la squadra con cui scambiare');
      const open = (rows.trade_offers ?? []).filter((o) => o.from_team_id === team.id).length;
      if (open >= MAX_OPEN_OFFERS) throw new MarketError(`Hai già ${MAX_OPEN_OFFERS} proposte in attesa`);
      const trade: Trade = {
        teamA: me,
        teamB: to.code,
        playersA: ids(action.players_from),
        playersB: ids(action.players_to),
        picksA: ids(action.picks_from),
        picksB: ids(action.picks_to),
        protections: action.protections ?? {},
        swaps: (action.swaps ?? []).map((w) => ({
          draftYear: Number(w.draft_year),
          round: Number(w.round) as 1 | 2,
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
      return write({ kind: 'withdraw_trade', offer_id: action.offer_id });

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
      return write({ kind: 'withdraw_request', request_id: action.request_id });

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
