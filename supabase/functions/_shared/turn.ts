// Un turno sul server: dallo stato della lega (public.league_state) al risultato per public.apply_turn.
// Comune alla Edge Function advance-turn (Deno) e ai test (Node).
//
// Prima delle partite il server chiude gli avvisi bloccanti del turno rimasti senza risposta (decide
// l'allenatore con la logica del bot) e firma al minimo per le squadre umane rimaste sotto 13. Poi il motore
// gioca il turno; alla fine si confronta lo stato prima e dopo e si scrive solo quello che è cambiato.
// Tutto il caso viene dal seed salvato nel turno: una ripresa dà lo stesso risultato.
//
// In play-in e playoff il tabellone si ricostruisce dalle partite giocate (replayPostseason); il turno salva le
// serie aggiornate e mette in calendario le partite del turno successivo, così tutti vedono chi gioca.
import {
  BODY_PART_LABEL,
  fillRosterAtMinimum,
  shortDayLabel,
  MIN_STANDARD,
  payroll,
  playPostseasonTurn,
  playRegularTurn,
  postseasonGames,
  postseasonTurn,
  regularTurns,
  replayPostseason,
  Rng,
  botFreeAgencyOffers,
  botProposals,
  closeRenewals,
  expiringPlayers,
  freeAgencyRoundOf,
  generatedDraftClass,
  nextStage,
  runAnnualDraft,
  runMarket,
  scaleContracts,
  startNewSeason,
  startOffseason,
  simulateGame,
  standardRoster,
  twoWayRoster,
  twoWaySalary,
} from '../../../packages/engine/src/index.ts';
import type {
  GameResult,
  LeagueState,
  PlayerState,
  OffseasonStage,
  PostseasonGame,
  PostseasonState,
  TeamSetup,
  Trade,
} from '../../../packages/engine/src/index.ts';
import { leagueStateFromRows, type LeagueStateRows, type TradeOfferRow } from './state.ts';

export interface TurnOptions {
  now?: Date;
  /** uuid per le righe nuove (proposte dei bot, swap, partite di post-season). */
  newId: () => string;
  /** false: niente proposte dei bot ai manager (per i test che non riguardano il mercato). */
  botProposals?: boolean;
  /** Partita da giocare al posto del motore vero (solo per i test lunghi). */
  playGame?: (home: TeamSetup, away: TeamSetup, seed: string) => GameResult;
}

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
  kind: string;
  games: number;
  /** Campione, quando il turno chiude la finale. */
  championId: string | null;
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
  /** Bloccante: proposta di scambio ricevuta. */
  tradeOffer: 'trade_offer',
  /** Informativo: esito di scambi, tagli, rinnovi e offerte agli svincolati. */
  market: 'market',
  /** Bloccante, offseason: scelte al draft da preparare (lista dei preferiti). */
  draft: 'draft_pick',
  /** Bloccante, offseason: giocatori in scadenza da rinnovare o lasciar andare. */
  renewals: 'renewals',
  /** Bloccante, offseason: turno di free agency. */
  freeAgency: 'free_agency',
  /** Bloccante, offseason: preparazione della stagione (rosa, quintetto, tattiche). */
  preparation: 'preparation',
} as const;

/** Ricavi, stipendi e two-way di una stagione si dividono sulle partite di regular season di ogni squadra. */
const GAMES_PER_SEASON = 82;

/** Partite di stop da cui un infortunio finisce nella cronaca della lega (medi e gravi). */
export const INJURY_NEWS_GAMES = 4;

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
  opts: TurnOptions,
): { payload: Row; summary: TurnSummary } {
  const round = rows.round;
  if (!round || round.id !== claim.round_id) throw new Error('Il turno da simulare non è quello corrente');
  const regular = round.kind === 'regular';
  const offseason = round.kind === 'offseason';
  const stage = offseason ? ((round.stage ?? null) as OffseasonStage | null) : null;
  if (offseason && !stage) throw new Error('Turno di offseason senza stage');
  if (!regular && !offseason && round.kind !== 'play-in' && round.kind !== 'playoffs')
    throw new Error(`Turno sconosciuto: ${round.kind}`);
  const now = opts.now ?? new Date();
  const { state, ids } = leagueStateFromRows(rows);
  if (regular !== (state.phase === 'regular'))
    throw new Error(`Il turno (${round.kind}) non corrisponde alla fase della stagione`);
  state.seed = claim.seed;
  const uuid = (code: string): string => {
    const id = ids.team.get(code);
    if (!id) throw new Error(`Squadra sconosciuta: ${code}`);
    return id;
  };
  let scheduled: PostseasonGame[] = [];
  if (!regular && !offseason) {
    state.postseason = replayPostseason(state);
    scheduled = postseasonGames(state.postseason);
  }
  const turn = regular ? state.turn : offseason ? round.number : postseasonTurn(state);
  if (!offseason && turn !== round.number)
    throw new Error(`Turno ${round.number} fuori sequenza (atteso ${turn})`);
  const before = clone(state);
  const alerts = rows.alerts ?? [];

  // ------------------------------------------------ mercato dei manager: scambi, tagli, rinnovi, firme
  const code = (id: string): string => {
    const c = ids.code.get(id);
    if (!c) throw new Error(`Squadra sconosciuta: ${id}`);
    return c;
  };
  const humanCodes = new Set(state.teams.filter((t) => t.human).map((t) => t.id));
  const faRound = stage ? freeAgencyRoundOf(stage) : null;
  const requests = rows.requests ?? [];
  const market = runMarket(
    state,
    {
      trades: (rows.trade_offers ?? []).map((o, i) => ({
        id: o.id,
        trade: tradeFromRow(o, code),
        fromId: code(o.from_team_id),
        status: o.status,
        toBot: !humanCodes.has(code(o.to_team_id)),
        order: i,
      })),
      releases: (rows.requests ?? [])
        .filter((q) => q.kind === 'release')
        .map((q) => ({ id: q.id, teamId: code(q.team_id), playerId: q.player_id })),
      // In offseason i rinnovi riguardano i giocatori in scadenza: li decide il turno dei rinnovi
      renewals: (offseason ? [] : requests)
        .filter((q) => q.kind === 'renew')
        .map((q) => ({
          id: q.id,
          teamId: code(q.team_id),
          playerId: q.player_id,
          salaries: (q.payload.salaries ?? []).map(Number),
        })),
      bids: (offseason && faRound === null ? [] : (rows.bids ?? [])).map((b) => ({
        id: b.id,
        teamId: code(b.team_id),
        playerId: b.player_id,
        salaries: b.salaries.map(Number),
      })),
    },
    offseason ? null : turn,
    faRound === null ? {} : { askRound: faRound, extraOffers: () => botFreeAgencyOffers(state, faRound) },
  );

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
  // Ricavi e stipendi di una partita per chi gioca oggi, con le rose che vanno in campo, come li conta il motore
  // (chargeGames); chi riposa e la post-season non hanno movimenti
  const today = regular ? state.schedule.filter((g) => g.turn === turn) : [];
  const day = today[0]?.day ?? state.day;
  const opponent = new Map(
    today.flatMap((g) => [[g.homeId, `vs ${g.awayId}`] as const, [g.awayId, `@ ${g.homeId}`] as const]),
  );
  const charge = new Map(
    state.teams.map((t) => [
      t.id,
      opponent.has(t.id)
        ? {
            revenue: Math.round(state.config.revenue / GAMES_PER_SEASON),
            salary: Math.round(payroll(state, t.id) / GAMES_PER_SEASON),
            twoWay: Math.round(
              (twoWayRoster(state, t.id).length * twoWaySalary(state.config)) / GAMES_PER_SEASON,
            ),
          }
        : { revenue: 0, salary: 0, twoWay: 0 },
    ]),
  );
  const games: { result: GameResult; seed: string }[] = [];
  const play = (home: TeamSetup, away: TeamSetup, seed: string) => {
    const result = (opts.playGame ?? simulateGame)(home, away, seed);
    games.push({ result, seed });
    return result;
  };
  const renewalResults: { id: string; status: 'done' | 'invalid' }[] = [];
  let newSeason = false;
  let lottery: string[] | null = null;
  if (regular) playRegularTurn(state, play);
  else if (!offseason) {
    playPostseasonTurn(state, play);
    // Finale giocata: fine stagione, lottery, ordine del draft e classe del draft (generata)
    if (state.phase === 'offseason') {
      const draftYear = state.config.year + 1;
      const draftClass = generatedDraftClass(new Rng(`${claim.seed}:classe`), draftYear).map((p) => ({
        ...p,
        id: opts.newId(),
        slug: `${p.id}-${state.publicSeed ?? ''}`.slice(0, 60),
      }));
      startOffseason(state, draftClass);
      lottery = state.offseason?.lottery ?? null;
    }
  } else if (stage === 'draft') {
    runAnnualDraft(state, new Map((rows.draft_lists ?? []).map((l) => [code(l.team_id), l.player_ids])));
    scaleContracts(state);
  } else if (stage === 'renewals') {
    const asked = new Map(requests.filter((q) => q.kind === 'renew').map((q) => [q.player_id, q.id]));
    const decisions = new Map<string, 'renew' | 'release' | 'bot'>();
    for (const p of expiringPlayers(state)) {
      const team = state.teams.find((t) => t.id === p.teamId);
      if (!team?.human) continue;
      if (asked.has(p.id)) decisions.set(p.id, 'renew');
      else {
        // Senza risposta: con l'allenatore decide la logica del bot, altrimenti il giocatore se ne va
        const open = alerts.some(
          (a) => a.kind === ALERT_KINDS.renewals && a.team_id === uuid(team.id) && a.status === 'open',
        );
        decisions.set(p.id, team.coach && open ? 'bot' : 'release');
      }
    }
    const result = closeRenewals(state, decisions);
    for (const [playerId, id] of asked)
      renewalResults.push({ id, status: result.renewed.includes(playerId) ? 'done' : 'invalid' });
  } else if (stage === 'preparation') {
    startNewSeason(state);
    newSeason = true;
  }
  const ps = state.postseason as PostseasonState | null;
  // Fine della regular season in questo turno: tassa, monte minimo e primo turno di play-in
  const seasonOver = regular && state.phase !== 'regular';
  // Il giorno del turno che si apre: il prossimo giorno con partite (il motore lo mette in state.day); in offseason
  // non c'è
  const next: { number: number; kind: string; stage?: OffseasonStage; day?: number } = newSeason
    ? { number: 0, kind: 'regular', day: state.day }
    : offseason
      ? { number: turn + 1, kind: 'offseason', stage: nextStage(stage as OffseasonStage) as OffseasonStage }
      : state.phase === 'regular'
        ? { number: state.turn, kind: 'regular', day: state.day }
        : state.phase === 'offseason'
          ? { number: turn + 1, kind: 'offseason', stage: 'draft' }
          : {
              number: seasonOver ? regularTurns(state.schedule) : turn + 1,
              kind: ps?.stage === 'playoffs' ? 'playoffs' : 'play-in',
              day: state.day,
            };

  // ------------------------------------------------ avvisi nuovi
  const humans = new Set(state.teams.filter((t) => t.human).map((t) => t.id));
  const newAlerts: Row[] = [];
  for (const code of humans) {
    const standard = standardRoster(state, code).length;
    if (next.kind !== 'offseason' && standard < MIN_STANDARD) {
      newAlerts.push({
        team_id: uuid(code),
        kind: ALERT_KINDS.rosterMinimum,
        blocking: true,
        payload: { standard, minimum: MIN_STANDARD },
        deadline: null,
      });
    }
  }
  // Turni di offseason che chiedono decisioni: avviso bloccante per i manager interessati
  if (next.kind === 'offseason' && next.stage) {
    const fa = freeAgencyRoundOf(next.stage);
    for (const team of humans) {
      const alert = (kind: string, payload: Record<string, unknown>) =>
        newAlerts.push({ team_id: uuid(team), kind, blocking: true, payload, deadline: null });
      if (next.stage === 'draft') {
        const picks = (state.offseason?.slots ?? []).filter((s) => s.ownerId === team).map((s) => s.pick);
        if (picks.length) alert(ALERT_KINDS.draft, { picks, draft_year: state.offseason?.draftYear });
      } else if (next.stage === 'renewals') {
        const n = expiringPlayers(state, team).length;
        if (n) alert(ALERT_KINDS.renewals, { players: n });
      } else if (fa !== null) alert(ALERT_KINDS.freeAgency, { round: fa + 1 });
      else alert(ALERT_KINDS.preparation, {});
    }
  }
  for (const n of market.notes) {
    if (!humans.has(n.teamId)) continue;
    newAlerts.push({
      team_id: uuid(n.teamId),
      kind: ALERT_KINDS.market,
      blocking: false,
      payload: { text: n.text },
      deadline: null,
    });
  }
  // Proposte dei bot per il turno che si apre (solo in regular season, prima della trade deadline)
  const newTrades: Row[] = [];
  if (next.kind === 'regular' && opts.botProposals !== false) {
    const last = new Map(Object.entries(rows.bot_proposals ?? {}).map(([id, n]) => [code(id), n]));
    for (const p of botProposals(state, new Rng(`${claim.seed}:proposte`), last, next.number)) {
      const fromIsA = p.trade.teamA === p.fromId;
      const id = opts.newId();
      newTrades.push({
        id,
        from_team_id: uuid(p.fromId),
        to_team_id: uuid(p.toId),
        players_from: fromIsA ? p.trade.playersA : p.trade.playersB,
        players_to: fromIsA ? p.trade.playersB : p.trade.playersA,
        picks_from: fromIsA ? p.trade.picksA : p.trade.picksB,
        picks_to: fromIsA ? p.trade.picksB : p.trade.picksA,
        swaps: [],
        protections: {},
      });
      newAlerts.push({
        team_id: uuid(p.toId),
        kind: ALERT_KINDS.tradeOffer,
        blocking: true,
        payload: { trade_id: id, from_team_id: uuid(p.fromId) },
        deadline: null,
      });
    }
  }
  const playerOf = new Map(state.players.map((p) => [p.id, p]));
  // Gli infortuni medi e gravi (da 4 partite in su) vanno anche nella cronaca della lega, per tutte le squadre;
  // quelli leggeri no, sarebbero troppi
  const injuryNews: Row[] = [];
  for (const { result } of games) {
    for (const inj of result.injuries) {
      const code = result[inj.team].teamId;
      const p = playerOf.get(inj.playerId);
      if (p && inj.games >= INJURY_NEWS_GAMES)
        injuryNews.push({
          season_year: state.config.year,
          round_number: turn,
          day,
          type: 'injury',
          text: `${code}: ${p.firstName} ${p.lastName} si infortuna (${BODY_PART_LABEL[inj.bodyPart]}), fuori ${inj.games} partite`,
        });
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
  const date = shortDayLabel(before.config.year, day);
  const teams = state.teams.map((t) => {
    const c = charge.get(t.id) as { revenue: number; salary: number; twoWay: number };
    const s = settlement.get(t.id);
    const tax = Math.round(s?.tax ?? 0);
    const shortfall = Math.round(s?.shortfall ?? 0);
    const id = uuid(t.id);
    // "mer 21 ott, vs LAL": la partita del giorno
    const note = `${date}, ${opponent.get(t.id) ?? ''}`;
    if (opponent.has(t.id)) {
      ledger.push({ team_id: id, kind: 'revenue', amount: c.revenue, note });
      ledger.push({ team_id: id, kind: 'salary', amount: -c.salary, note });
    }
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
  const rawPlayer = new Map(rows.players.map((r) => [r.id, r]));
  const status: Row[] = [];
  const moves: Row[] = [];
  // Righe intere: prospetti nuovi, giocatori cambiati in offseason (crescita, età) e ritirati
  const fullRows: Row[] = [];
  const hiddenRows: Row[] = [];
  const prospects: Row[] = [];
  // Draft annuale: anno, giro e scelta dei prospetti (lo stato letto dal database non ha il draft dei giocatori:
  // qui arriva solo quello che il motore ha appena deciso)
  const drafts: Row[] = [];
  const card = (p: PlayerState) =>
    JSON.stringify([p.age, p.ratings, p.tendencies, p.yearsInLeague, p.scoutedPotential]);
  for (const p of state.players) {
    const b = beforePlayer.get(p.id) as PlayerState | undefined;
    if (p.draft && JSON.stringify(p.draft) !== JSON.stringify(b?.draft ?? null))
      drafts.push({ id: p.id, draft: p.draft });
    if (!b) {
      if (!offseason && !lottery) throw new Error(`Giocatore nuovo durante la stagione: ${p.id}`);
      fullRows.push(playerRow(p, rawPlayer.get(p.id)?.slug, uuid, false));
      hiddenRows.push({ player_id: p.id, hidden: p.hidden });
      if (p.prospect) prospects.push({ id: p.id, draft_prospect: p.prospect });
      continue;
    }
    if (JSON.stringify(p.hidden) !== JSON.stringify(b.hidden))
      hiddenRows.push({ player_id: p.id, hidden: p.hidden });
    if ((p.prospect ?? null) !== (b.prospect ?? null))
      prospects.push({ id: p.id, draft_prospect: p.prospect ?? null });
    if (card(p) !== card(b)) {
      fullRows.push(playerRow(p, rawPlayer.get(p.id)?.slug, uuid, false));
      continue;
    }
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

  // Ritirati: restano nel database, fuori dalle squadre, per lo storico delle statistiche
  const stillHere = new Set(state.players.map((p) => p.id));
  for (const b of before.players)
    if (!stillHere.has(b.id))
      fullRows.push(playerRow({ ...b, teamId: null }, rawPlayer.get(b.id)?.slug, uuid, true));

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
  const picks: Row[] = state.picks
    .filter((k) => beforePick.get(k.id) !== JSON.stringify(k))
    .map((k) => ({
      // Le scelte nuove (un anno in più di scelte future) non hanno ancora un uuid
      id: UUID.test(k.id) ? k.id : opts.newId(),
      draft_year: k.draftYear,
      round: k.round,
      original_team_id: uuid(k.originalTeamId),
      owner_team_id: uuid(k.ownerId),
      protection: k.protection,
      deferrals: k.deferrals,
      position: null,
      player_id: null,
    }));
  // Scelte usate nel draft dell'anno: restano nel database con la loro posizione
  const afterPick = new Set(state.picks.map((k) => k.id));
  for (const k of before.picks) {
    if (afterPick.has(k.id)) continue;
    const slot = state.offseason?.slots.find(
      (s) => s.round === k.round && s.originalTeamId === k.originalTeamId,
    );
    picks.push({
      id: k.id,
      draft_year: k.draftYear,
      round: k.round,
      original_team_id: uuid(k.originalTeamId),
      owner_team_id: uuid(k.ownerId),
      protection: k.protection,
      deferrals: k.deferrals,
      position: slot?.number ?? 0,
      player_id: null,
    });
  }
  const afterSwaps = new Set(state.swaps.map((w) => w.id));
  const swapsDone = before.swaps
    .filter((w) => !afterSwaps.has(w.id))
    .map((w) => ({
      id: w.id,
      draft_year: w.draftYear,
      round: w.round,
      holder_team_id: uuid(w.holderId),
      other_team_id: uuid(w.otherId),
      result: 'risolto',
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

  // ------------------------------------------------ serie di playoff
  // Una serie è la stessa da un turno all'altro: stesso giro, stessa conference, stesse squadre
  const seriesKey = (r: number, conference: string | null, high: string, low: string) =>
    `${r}:${conference ?? ''}:${high}:${low}`;
  const savedSeries = new Map(
    (rows.playoff_series ?? []).map((x) => [
      seriesKey(x.round, x.conference, x.high_team_id, x.low_team_id),
      x.id,
    ]),
  );
  const seriesId = new Map<string, string>(); // id del motore -> uuid
  const seriesRows: Row[] = [];
  for (const x of ps?.series ?? []) {
    const high = uuid(x.highId);
    const low = uuid(x.lowId);
    const id = savedSeries.get(seriesKey(x.round, x.conference, high, low)) ?? opts.newId();
    seriesId.set(x.id, id);
    seriesRows.push({
      id,
      season_id: null,
      round: x.round,
      conference: x.conference,
      high_team_id: high,
      low_team_id: low,
      high_seed: x.highSeed,
      low_seed: x.lowSeed,
      wins_high: x.winsHigh,
      wins_low: x.winsLow,
      winner_team_id: x.winnerId === null ? null : uuid(x.winnerId),
    });
  }

  // ------------------------------------------------ partite e box score
  const gameId = new Map(rows.games.map((g) => [`${g.round_number}:${g.home_team_id}`, g.id]));
  const gameRows: Row[] = [];
  const stats: Row[] = [];
  for (const { result, seed } of games) {
    const home = uuid(result.home.teamId);
    const away = uuid(result.away.teamId);
    let id = gameId.get(`${turn}:${home}`);
    const ref = scheduled.find((g) => g.homeId === result.home.teamId && g.awayId === result.away.teamId);
    if (!id) {
      // In post-season una partita che non era in calendario (turno aperto prima della Fase 10) si aggiunge
      if (regular) throw new Error(`Partita non in calendario: ${result.home.teamId}-${result.away.teamId}`);
      id = opts.newId();
    }
    gameRows.push({
      id,
      round_number: turn,
      day: regular ? day : (ref?.day ?? day),
      kind: regular ? 'regular' : (ref?.phase ?? 'playoffs'),
      home_team_id: home,
      away_team_id: away,
      series_id: ref && ref.phase === 'playoffs' ? (seriesId.get(ref.ref) ?? null) : null,
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

  // Le partite del prossimo turno di post-season vanno in calendario: tutti vedono chi gioca, e nei turni di
  // play-in e playoff devono essere pronte solo le squadre che giocano
  if (ps && ps.stage !== 'done') {
    for (const g of postseasonGames(ps)) {
      gameRows.push({
        id: opts.newId(),
        round_number: next.number,
        day: g.day,
        kind: g.phase,
        home_team_id: uuid(g.homeId),
        away_team_id: uuid(g.awayId),
        series_id: g.phase === 'playoffs' ? (seriesId.get(g.ref) ?? null) : null,
        home_score: null,
        away_score: null,
        overtimes: null,
        quarters: null,
        play_by_play: null,
        seed: null,
      });
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
  if (swaps.length || swapsDone.length) payload.draft_swaps = [...swaps, ...swapsDone];
  if (fullRows.length) payload.players = fullRows;
  if (hiddenRows.length) payload.player_hidden = hiddenRows;
  if (prospects.length) payload.draft_prospects = prospects;
  if (drafts.length) payload.player_drafts = drafts;
  if (
    state.offseason &&
    JSON.stringify(state.offseason.slots) !== JSON.stringify(before.offseason?.slots ?? null)
  )
    payload.draft_order = state.offseason.slots.map((s) => ({
      draft_year: state.offseason?.draftYear,
      pick_no: s.pick,
      round: s.round,
      number: s.number,
      team_id: uuid(s.ownerId),
      original_team_id: uuid(s.originalTeamId),
      player_id: s.playerId,
    }));
  if (lottery && state.offseason)
    payload.draft_lottery = [{ draft_year: state.offseason.draftYear, pick_order: lottery.map(uuid) }];
  if (newSeason) {
    const c = state.config;
    payload.new_season = {
      year: c.year,
      phase: 'regular',
      salary_cap: Math.round(c.salaryCap),
      luxury_tax: Math.round(c.luxuryTax),
      first_apron: Math.round(c.firstApron),
      second_apron: Math.round(c.secondApron),
      minimum_team_salary: Math.round(c.minimumTeamSalary),
      minimum_salary: c.minimumSalary.map(Math.round),
      rookie_scale: c.rookieScale,
      revenue: Math.round(c.revenue),
      growth: c.growth,
    };
    payload.new_games = state.schedule.map((g) => ({
      id: opts.newId(),
      round_number: g.turn,
      day: g.day,
      kind: 'regular',
      home_team_id: uuid(g.homeId),
      away_team_id: uuid(g.awayId),
    }));
  }
  if (state.transactions.length || injuryNews.length)
    payload.transactions = [
      ...state.transactions.map((t) => ({
        season_year: t.year,
        round_number: t.turn,
        // Il giorno del turno; in offseason non c'è
        day: offseason ? null : day,
        type: t.type,
        text: t.text,
      })),
      ...injuryNews,
    ];
  // Fine della regular season: fotografia delle statistiche per lo storico e i premi (player_seasons)
  if (seasonOver)
    payload.player_seasons = state.players
      .filter((p) => p.stats.g > 0)
      .map((p) => ({
        player_id: p.id,
        team_id: p.teamId === null ? null : uuid(p.teamId),
        rookie: p.yearsInLeague === null ? null : p.yearsInLeague === 0,
        stats: p.stats,
      }));
  if (newAlerts.length) payload.alerts = newAlerts;
  if (closed.size) payload.alerts_closed = [...closed].map(([id, s]) => ({ id, status: s }));
  if (coachExpired.length) payload.coach_expired = coachExpired;
  if (seriesRows.length) payload.playoff_series = seriesRows;
  if (market.trades.length) payload.trades = market.trades;
  if (market.bids.length) payload.bids = market.bids;
  if (market.requests.length || renewalResults.length)
    payload.requests = [...market.requests, ...renewalResults];
  if (newTrades.length) payload.new_trades = newTrades;
  // La stagione nuova nasce già in regular season; quella vecchia resta in offseason
  if (next.kind !== round.kind && !newSeason) payload.season_phase = next.kind;

  return {
    payload,
    summary: {
      round: turn,
      kind: round.kind,
      games: games.length,
      championId: ps?.championId ? uuid(ps.championId) : null,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Riga intera di players (prospetti nuovi, cambi dell'offseason, ritiri). */
function playerRow(
  p: PlayerState & { slug?: string },
  slug: string | undefined,
  uuid: (code: string) => string,
  retired: boolean,
): Row {
  return {
    id: p.id,
    slug: slug ?? p.slug ?? p.id,
    team_id: p.teamId === null ? null : uuid(p.teamId),
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
    ratings: p.ratings,
    tendencies: p.tendencies,
    energy: round1(p.energy),
    morale: round1(p.morale),
    scouted_potential: Math.round(p.scoutedPotential),
    two_way_games: p.twoWayGames,
    season_stats: p.stats,
    retired,
  };
}

/** Proposta di scambio salvata -> scambio del motore (A = chi propone, B = chi riceve). */
export function tradeFromRow(o: TradeOfferRow, code: (id: string) => string): Trade {
  return {
    teamA: code(o.from_team_id),
    teamB: code(o.to_team_id),
    playersA: o.players_from,
    playersB: o.players_to,
    picksA: o.picks_from,
    picksB: o.picks_to,
    swaps: (o.swaps ?? []).map((w) => ({
      draftYear: w.draft_year,
      round: w.round as 1 | 2,
      holderId: code(w.holder_team_id),
      otherId: code(w.other_team_id),
    })),
    protections: o.protections ?? {},
  };
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
 * motore, apply_turn. Se qualcosa fallisce il turno resta in chiusura senza aver scritto nulla: l'errore si
 * salva nel turno (record_round_error) e pg_cron lo riprende dopo 5 minuti, fino a 3 tentativi; poi aspetta il
 * commissario.
 */
export async function advanceLeague(
  db: ServerDb,
  leagueId: string,
  opts: TurnOptions,
): Promise<AdvanceResult> {
  const claim = await db.rpc<TurnClaim | null>('try_close_round', { p_league: leagueId });
  if (!claim) return { advanced: false };
  try {
    const rows = await db.rpc<LeagueStateRows>('league_state', { p_league: leagueId });
    const { payload, summary } = serverTurn(rows, claim, opts);
    const nextRoundId = await db.rpc<string>('apply_round', { p_round: claim.round_id, p_payload: payload });
    return { advanced: true, reason: claim.reason, reclaimed: claim.reclaimed, nextRoundId, summary };
  } catch (e) {
    // Se non si riesce nemmeno a salvare l'errore, conta comunque il tentativo: il turno si ferma lo stesso
    await db
      .rpc('record_round_error', { p_round: claim.round_id, p_error: errorText(e) })
      .catch(() => undefined);
    throw e;
  }
}

/** Testo di un errore qualsiasi, per il commissario. */
export function errorText(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === 'string') return e;
  try {
    return JSON.stringify(e) ?? String(e);
  } catch {
    return String(e);
  }
}
