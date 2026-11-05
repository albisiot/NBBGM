// Un turno sul server: dallo stato della lega (public.league_state) al risultato per public.apply_turn.
// Comune alla Edge Function advance-turn (Deno) e ai test (Node).
//
// Prima delle partite il server chiude gli avvisi bloccanti del turno rimasti senza risposta (decide
// l'allenatore con la logica del bot) e firma al minimo per le squadre umane rimaste sotto 13. Poi il motore
// gioca il turno; alla fine si confronta lo stato prima e dopo e si scrive solo quello che è cambiato.
// Tutto il caso viene dal seed salvato nel turno: una ripresa dà lo stesso risultato.
import {
  BODY_PART_LABEL,
  fillRosterAtMinimum,
  MIN_STANDARD,
  payroll,
  playRegularTurn,
  REGULAR_SEASON_TURNS,
  simulateGame,
  standardRoster,
  twoWayRoster,
  twoWaySalary,
} from '../../../packages/engine/src/index.ts';
import type { GameResult, LeagueState, PlayerState } from '../../../packages/engine/src/index.ts';
import { leagueStateFromRows, type LeagueStateRows } from './state.ts';

/** Risultato di public.try_close_round: il turno da simulare. */
export interface TurnClaim {
  round_id: string;
  number: number;
  kind: string;
  seed: string;
  reason: 'ready' | 'coach' | 'deadline' | 'forced' | null;
  reclaimed: boolean;
}

export interface TurnSummary {
  round: number;
  games: number;
  signings: number;
  alerts: number;
  next: { number: number; kind: string };
}

type Row = Record<string, unknown>;

/** Avvisi che il turno può creare. */
export const ALERT_KINDS = {
  /** Bloccante: rosa sotto i 13 contratti standard. */
  rosterMinimum: 'roster_minimum',
  /** Informativo: un giocatore della squadra si è infortunato. */
  injury: 'injury',
} as const;

const PERIODS = 82;

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/**
 * Calcola il turno chiuso da claim. newId dà gli uuid delle righe nuove che il motore non ha (scambi di
 * scelte, in futuro). now serve per le deleghe all'allenatore con una data di fine.
 */
export function serverTurn(
  rows: LeagueStateRows,
  claim: TurnClaim,
  opts: { now?: Date; newId: () => string },
): { payload: Row; summary: TurnSummary } {
  const round = rows.round;
  if (!round || round.id !== claim.round_id) throw new Error('Il turno da simulare non è quello corrente');
  if (round.kind !== 'regular') throw new Error('Play-in e playoff arrivano con la Fase 10');
  const now = opts.now ?? new Date();
  const { state, ids } = leagueStateFromRows(rows);
  if (state.phase !== 'regular') throw new Error('La stagione non è in regular season');
  state.seed = claim.seed;
  const uuid = (code: string): string => {
    const id = ids.team.get(code);
    if (!id) throw new Error(`Squadra sconosciuta: ${code}`);
    return id;
  };
  const turn = state.turn;
  const before = clone(state);
  const alerts = rows.alerts ?? [];

  // ------------------------------------------------ avvisi del turno che si chiude
  const closed = new Map<string, 'resolved' | 'expired'>();
  for (const team of state.teams.filter((t) => t.human)) {
    const alert = alerts.find(
      (a) => a.kind === ALERT_KINDS.rosterMinimum && a.team_id === uuid(team.id) && a.round_id === round.id,
    );
    if (!alert) continue;
    const short = standardRoster(state, team.id).length < MIN_STANDARD;
    // Il manager non ha completato la rosa: firma il server, al minimo, per i ruoli scoperti
    if (short) fillRosterAtMinimum(state, team.id, turn);
    if (alert.status === 'open') closed.set(alert.id, short ? 'expired' : 'resolved');
  }
  // Gli altri avvisi bloccanti senza risposta si chiudono: ha deciso l'allenatore
  for (const a of alerts)
    if (a.blocking && a.status === 'open' && !closed.has(a.id)) closed.set(a.id, 'expired');

  // ------------------------------------------------ partite
  // Ricavi e stipendi del turno con le rose che vanno in campo, come li conta il motore (chargeTurn)
  const charge = new Map(
    state.teams.map((t) => [
      t.id,
      {
        revenue: Math.round(state.config.revenue / PERIODS),
        salary: Math.round(payroll(state, t.id) / PERIODS),
        twoWay: Math.round((twoWayRoster(state, t.id).length * twoWaySalary(state.config)) / PERIODS),
      },
    ]),
  );
  const games: { result: GameResult; seed: string }[] = [];
  playRegularTurn(state, (home, away, seed) => {
    const result = simulateGame(home, away, seed);
    games.push({ result, seed });
    return result;
  });
  const seasonOver = state.phase !== 'regular';
  const next = seasonOver
    ? { number: REGULAR_SEASON_TURNS, kind: 'play-in' }
    : { number: state.turn, kind: 'regular' };

  // ------------------------------------------------ avvisi nuovi
  const humans = new Set(state.teams.filter((t) => t.human).map((t) => t.id));
  const newAlerts: Row[] = [];
  for (const code of humans) {
    const standard = standardRoster(state, code).length;
    if (standard < MIN_STANDARD) {
      newAlerts.push({
        team_id: uuid(code),
        kind: ALERT_KINDS.rosterMinimum,
        blocking: true,
        payload: { standard, minimum: MIN_STANDARD },
        deadline: null,
      });
    }
  }
  const playerOf = new Map(state.players.map((p) => [p.id, p]));
  for (const { result } of games) {
    for (const inj of result.injuries) {
      const code = result[inj.team].teamId;
      const p = playerOf.get(inj.playerId);
      if (!humans.has(code) || !p) continue;
      newAlerts.push({
        team_id: uuid(code),
        kind: ALERT_KINDS.injury,
        blocking: false,
        payload: {
          player_id: p.id,
          player: `${p.firstName} ${p.lastName}`,
          body_part: inj.bodyPart,
          body_part_label: BODY_PART_LABEL[inj.bodyPart],
          severity: inj.severity,
          games: inj.games,
        },
        deadline: null,
      });
    }
  }

  // ------------------------------------------------ allenatori che scadono
  const coachExpired = (rows.coach_delegations ?? [])
    .filter(
      (d) =>
        d.active &&
        ((d.until_round !== null && d.until_round < next.number) ||
          (d.until_at !== null && Date.parse(d.until_at) <= now.getTime()) ||
          (d.until_phase_end && next.kind !== round.kind)),
    )
    .map((d) => d.team_id);

  // ------------------------------------------------ bilancio: il saldo è la somma dei movimenti
  const settlement = new Map(seasonOver ? (state.lastSettlement ?? []).map((s) => [s.teamId, s]) : []);
  const ledger: Row[] = [];
  const note = `Giornata ${turn + 1}`;
  const teams = state.teams.map((t) => {
    const c = charge.get(t.id) as { revenue: number; salary: number; twoWay: number };
    const s = settlement.get(t.id);
    const tax = Math.round(s?.tax ?? 0);
    const shortfall = Math.round(s?.shortfall ?? 0);
    const id = uuid(t.id);
    ledger.push({ team_id: id, kind: 'revenue', amount: c.revenue, note });
    ledger.push({ team_id: id, kind: 'salary', amount: -c.salary, note });
    if (c.twoWay > 0) ledger.push({ team_id: id, kind: 'two-way', amount: -c.twoWay, note });
    if (tax > 0) ledger.push({ team_id: id, kind: 'tax', amount: -tax, note: 'Luxury tax' });
    if (shortfall > 0)
      ledger.push({
        team_id: id,
        kind: 'minimum-shortfall',
        amount: -shortfall,
        note: 'Monte stipendi minimo',
      });
    const old = before.teams.find((x) => x.id === t.id) as LeagueState['teams'][number];
    return {
      id,
      balance: Math.round(old.balance) + c.revenue - c.salary - c.twoWay - tax - shortfall,
      strategy: t.strategy,
      tax_history: t.taxHistory,
    };
  });

  // ------------------------------------------------ giocatori, contratti, infortuni, scelte
  const beforePlayer = new Map(before.players.map((p) => [p.id, p]));
  const status: Row[] = [];
  const moves: Row[] = [];
  for (const p of state.players) {
    const b = beforePlayer.get(p.id) as PlayerState | undefined;
    if (!b) throw new Error(`Giocatore nuovo in regular season: ${p.id}`);
    const energy = round1(p.energy);
    const morale = round1(p.morale);
    if (
      energy !== round1(b.energy) ||
      morale !== round1(b.morale) ||
      p.twoWayGames !== b.twoWayGames ||
      JSON.stringify(p.stats) !== JSON.stringify(b.stats)
    )
      status.push({ id: p.id, energy, morale, two_way_games: p.twoWayGames, season_stats: p.stats });
    if (p.teamId !== b.teamId) moves.push({ id: p.id, team_id: p.teamId === null ? null : uuid(p.teamId) });
  }

  const beforeContract = new Map(before.contracts.map((c) => [c.playerId, JSON.stringify(c)]));
  const contracts = state.contracts
    .filter((c) => beforeContract.get(c.playerId) !== JSON.stringify(c))
    .map((c) => ({
      player_id: c.playerId,
      team_id: uuid(c.teamId),
      type: c.type,
      salaries: c.salaries,
      options: c.options,
      guaranteed: c.guaranteed,
    }));
  const kept = new Set(state.contracts.map((c) => c.playerId));
  const contractsRemoved = before.contracts.map((c) => c.playerId).filter((id) => !kept.has(id));

  const beforePick = new Map(before.picks.map((k) => [k.id, JSON.stringify(k)]));
  const picks = state.picks
    .filter((k) => beforePick.get(k.id) !== JSON.stringify(k))
    .map((k) => ({
      id: k.id,
      draft_year: k.draftYear,
      round: k.round,
      original_team_id: uuid(k.originalTeamId),
      owner_team_id: uuid(k.ownerId),
      protection: k.protection,
      deferrals: k.deferrals,
      position: null,
      player_id: null,
    }));
  const beforeSwaps = new Set(before.swaps.map((w) => w.id));
  const swaps = state.swaps
    .filter((w) => !beforeSwaps.has(w.id))
    .map((w) => ({
      id: opts.newId(),
      draft_year: w.draftYear,
      round: w.round,
      holder_team_id: uuid(w.holderId),
      other_team_id: uuid(w.otherId),
      result: null,
    }));

  // ------------------------------------------------ partite e box score
  const gameId = new Map(rows.games.map((g) => [`${g.round_number}:${g.home_team_id}`, g.id]));
  const gameRows: Row[] = [];
  const stats: Row[] = [];
  for (const { result, seed } of games) {
    const home = uuid(result.home.teamId);
    const away = uuid(result.away.teamId);
    const id = gameId.get(`${turn}:${home}`);
    if (!id) throw new Error(`Partita non in calendario: ${result.home.teamId}-${result.away.teamId}`);
    gameRows.push({
      id,
      round_number: turn,
      kind: 'regular',
      home_team_id: home,
      away_team_id: away,
      series_id: null,
      home_score: result.home.score,
      away_score: result.away.score,
      overtimes: result.overtimes,
      quarters: { home: result.home.quarters, away: result.away.quarters },
      play_by_play: compactPlayByPlay(result.playByPlay),
      seed,
    });
    for (const side of [result.home, result.away]) {
      for (const l of side.box) {
        stats.push({
          game_id: id,
          player_id: l.playerId,
          team_id: uuid(side.teamId),
          starter: l.starter,
          seconds: l.seconds,
          pts: l.pts,
          fgm: l.fgm,
          fga: l.fga,
          tpm: l.tpm,
          tpa: l.tpa,
          ftm: l.ftm,
          fta: l.fta,
          orb: l.orb,
          drb: l.drb,
          ast: l.ast,
          stl: l.stl,
          blk: l.blk,
          tov: l.tov,
          pf: l.pf,
          plus_minus: l.plusMinus,
        });
      }
    }
  }

  const payload: Row = {
    teams,
    player_status: status,
    injuries: state.players
      .filter((p) => p.injury)
      .map((p) => ({
        player_id: p.id,
        body_part: p.injury?.bodyPart,
        severity: p.injury?.severity,
        games_remaining: p.injury?.gamesRemaining,
      })),
    games: gameRows,
    player_game_stats: stats,
    ledger,
    next_round: next,
  };
  if (moves.length) payload.player_moves = moves;
  if (contracts.length) payload.contracts = contracts;
  if (contractsRemoved.length) payload.contracts_removed = contractsRemoved;
  if (JSON.stringify(before.deadMoney) !== JSON.stringify(state.deadMoney))
    payload.dead_money = state.deadMoney.map((d) => ({
      team_id: uuid(d.teamId),
      player_name: d.playerName,
      salaries: d.salaries,
    }));
  if (picks.length) payload.draft_picks = picks;
  if (swaps.length) payload.draft_swaps = swaps;
  if (state.transactions.length)
    payload.transactions = state.transactions.map((t) => ({
      season_year: t.year,
      round_number: t.turn,
      type: t.type,
      text: t.text,
    }));
  if (newAlerts.length) payload.alerts = newAlerts;
  if (closed.size) payload.alerts_closed = [...closed].map(([id, s]) => ({ id, status: s }));
  if (coachExpired.length) payload.coach_expired = coachExpired;
  if (seasonOver) payload.season_phase = 'play-in';

  return {
    payload,
    summary: {
      round: turn,
      games: games.length,
      signings: state.transactions.filter((t) => t.type === 'signing').length,
      alerts: newAlerts.length,
      next,
    },
  };
}

/**
 * Cronaca da salvare, compatta perché sul piano Free lo spazio conta (circa 450 azioni a partita): ogni azione
 * è [periodo, secondi alla fine del periodo, squadra (h, a o null), testo, punti casa, punti trasferta].
 */
export type StoredPlay = [number, number, 'h' | 'a' | null, string, number, number];

export function compactPlayByPlay(events: GameResult['playByPlay']): StoredPlay[] {
  return events.map((e) => [
    e.period,
    Math.round(e.clock),
    e.team === 'home' ? 'h' : e.team === 'away' ? 'a' : null,
    e.text,
    e.home,
    e.away,
  ]);
}

/** Le chiamate al database che servono per avanzare un turno: supabase-js nella Edge Function, PGlite nei test. */
export interface ServerDb {
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

export type AdvanceResult =
  | { advanced: false }
  | {
      advanced: true;
      reason: TurnClaim['reason'];
      reclaimed: boolean;
      nextRoundId: string;
      summary: TurnSummary;
    };

/**
 * Avanza la lega di un turno se è il momento: try_close_round (vince solo la prima chiamata), league_state,
 * motore, apply_turn. Se la scrittura fallisce il turno resta in chiusura e si riprende dopo 5 minuti.
 */
export async function advanceLeague(
  db: ServerDb,
  leagueId: string,
  opts: { now?: Date; newId: () => string },
): Promise<AdvanceResult> {
  const claim = await db.rpc<TurnClaim | null>('try_close_round', { p_league: leagueId });
  if (!claim) return { advanced: false };
  const rows = await db.rpc<LeagueStateRows>('league_state', { p_league: leagueId });
  const { payload, summary } = serverTurn(rows, claim, opts);
  const nextRoundId = await db.rpc<string>('apply_turn', { p_round: claim.round_id, p_payload: payload });
  return { advanced: true, reason: claim.reason, reclaimed: claim.reclaimed, nextRoundId, summary };
}
