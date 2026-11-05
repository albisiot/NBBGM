// Mercato dei manager in un turno (Fase 11). Le richieste fatte durante il turno (scambi, tagli, rinnovi,
// offerte agli svincolati) si eseguono tutte al passaggio di turno, in quest'ordine, così nessuno è avvantaggiato
// dall'essere online prima degli altri. Ogni richiesta si ricontrolla al momento: quello che non vale più salta.
import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import { botAccepts, botProposeTrade } from './bots.ts';
import { nextConfig, type SeasonConfig } from './config.ts';
import { canSign, contractOf, releasePlayer, salaryRun, typicalYears } from './finance.ts';
import { askingSalaryFor, FREE_AGENCY_ROUNDS, resolveOffers, type Offer } from './freeAgency.ts';
import { standingsSeed } from './season.ts';
import { leagueStandings } from './standings.ts';
import type { LeagueState, PlayerState } from './state.ts';
import { executeTrade, tradeWindowOpen, validateTrade, type Trade } from './trades.ts';

/** In stagione gli svincolati chiedono quanto all'ultimo turno di free agency: le richieste non scendono più. */
export const IN_SEASON_ASK_ROUND = FREE_AGENCY_ROUNDS - 1;
/** Sotto questo morale il giocatore non rinnova. */
export const MIN_RENEWAL_MORALE = 30;
/** Probabilità per turno che un bot proponga uno scambio a una squadra umana. */
export const BOT_PROPOSAL_CHANCE = 0.15;
/** Turni minimi tra due proposte dei bot alla stessa squadra umana. */
export const BOT_PROPOSAL_COOLDOWN = 5;

const millions = (x: number) => `${(x / 1e6).toFixed(1).replace('.', ',')} mln`;
const fullName = (p: Pick<PlayerState, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;

/** Richiesta di uno svincolato in stagione. */
export function inSeasonAsk(state: LeagueState, p: PlayerState): number {
  return askingSalaryFor(state.config, p, IN_SEASON_ASK_ROUND);
}

export interface RenewalOffer {
  /** Stipendi dalla stagione successiva. */
  salaries: number[];
}

/**
 * Richiesta di rinnovo di un giocatore all'ultimo anno di contratto: parte dalla stagione successiva, ai prezzi
 * della stagione successiva, e dipende da valore, età e morale. null se non si può rinnovare (two-way, non
 * all'ultimo anno, morale sotto 30).
 */
export function renewalOffer(state: LeagueState, p: PlayerState): RenewalOffer | null {
  const c = contractOf(state, p.id);
  if (!c || c.type === 'two-way' || c.salaries.length !== 1 || p.teamId !== c.teamId) return null;
  if (p.morale < MIN_RENEWAL_MORALE) return null;
  return { salaries: renewalSalaries(state.config, p) };
}

/** Stipendi chiesti per il rinnovo, con la sola configurazione della stagione: li usa anche l'app. */
export function renewalSalaries(
  c: SeasonConfig,
  p: Pick<PlayerState, 'ratings' | 'role' | 'age' | 'yearsInLeague' | 'scoutedPotential' | 'morale'>,
): number[] {
  const older = {
    ...p,
    age: p.age + 1,
    yearsInLeague: p.yearsInLeague === null ? null : p.yearsInLeague + 1,
  };
  return salaryRun(askingSalaryFor(nextConfig(c), older, 0), typicalYears(older.age));
}

/** Rinnovo: il contratto si allunga con gli stipendi concordati, dalla stagione successiva. */
export function applyRenewal(
  state: LeagueState,
  playerId: string,
  salaries: readonly number[],
  turn: number | null,
): boolean {
  const p = state.players.find((x) => x.id === playerId);
  const c = contractOf(state, playerId);
  if (!p || !c || c.type === 'two-way' || c.salaries.length !== 1 || p.teamId !== c.teamId) return false;
  c.salaries = [c.salaries[0] as number, ...salaries];
  c.options = [c.options[0] ?? null, ...salaries.map(() => null)];
  if (c.type !== 'standard') c.type = 'standard';
  c.guaranteed = null;
  state.transactions.push({
    year: state.config.year,
    turn,
    type: 'renewal',
    text: `${c.teamId} rinnova ${fullName(p)} (${salaries.length} anni, ${millions(salaries[0] ?? 0)} dalla prossima stagione)`,
  });
  return true;
}

export interface TradeRequest {
  id: string;
  trade: Trade;
  /** Chi ha proposto (teamA o teamB dello scambio). */
  fromId: string;
  /** pending: senza risposta; accepted: accettato dal manager che lo riceve. */
  status: 'pending' | 'accepted';
  /** La squadra che riceve è un bot: decide adesso. */
  toBot: boolean;
  /** Ordine di esecuzione: prima gli scambi accettati prima. */
  order: number;
}

export interface MarketRequests {
  trades: TradeRequest[];
  releases: { id: string; teamId: string; playerId: string }[];
  renewals: { id: string; teamId: string; playerId: string; salaries: number[] }[];
  bids: { id: string; teamId: string; playerId: string; salaries: number[] }[];
}

/** Messaggio per una squadra, da mostrare come avviso informativo. */
export interface MarketNote {
  teamId: string;
  text: string;
}

export interface MarketOutcome {
  trades: { id: string; status: 'executed' | 'void' | 'rejected' | 'expired' }[];
  requests: { id: string; status: 'done' | 'invalid' }[];
  bids: { id: string; status: 'won' | 'lost' | 'invalid' }[];
  notes: MarketNote[];
}

/**
 * Esegue il mercato del turno: scambi (gli accettati nell'ordine in cui sono stati accettati; quelli verso un bot
 * li decide il bot, con il suo margine del 10%; quelli senza risposta sono rifiutati), tagli, rinnovi e offerte
 * agli svincolati (in stagione gli svincolati chiedono quanto a fine free agency). Uno scambio che non vale più,
 * per esempio perché un giocatore è già andato in un altro scambio, decade.
 */
export function runMarket(state: LeagueState, req: MarketRequests, turn: number | null): MarketOutcome {
  const out: MarketOutcome = { trades: [], requests: [], bids: [], notes: [] };
  const note = (teamId: string, text: string) => out.notes.push({ teamId, text });

  // 1. Scambi
  for (const r of [...req.trades].sort((a, b) => a.order - b.order)) {
    const t = r.trade;
    const toId = t.teamA === r.fromId ? t.teamB : t.teamA;
    if (!r.toBot && r.status === 'pending') {
      out.trades.push({ id: r.id, status: 'expired' });
      note(r.fromId, `${toId} non ha risposto alla tua proposta di scambio: rifiutata.`);
      continue;
    }
    const problems = validateTrade(state, t);
    if (problems.length) {
      out.trades.push({ id: r.id, status: 'void' });
      for (const team of [r.fromId, toId])
        note(team, `Lo scambio tra ${r.fromId} e ${toId} è saltato: ${problems[0]}.`);
      continue;
    }
    if (r.toBot && !botAccepts(state, t, toId)) {
      out.trades.push({ id: r.id, status: 'rejected' });
      note(r.fromId, `${toId} ha rifiutato la tua proposta di scambio.`);
      continue;
    }
    executeTrade(state, t, turn);
    out.trades.push({ id: r.id, status: 'executed' });
    const text = state.transactions[state.transactions.length - 1]?.text ?? 'Scambio fatto';
    for (const team of [t.teamA, t.teamB]) note(team, `${text}.`);
  }

  // 2. Tagli: lo stipendio residuo resta a carico della squadra fino alla scadenza
  for (const r of req.releases) {
    const p = state.players.find((x) => x.id === r.playerId);
    const c = contractOf(state, r.playerId);
    if (!p || p.teamId !== r.teamId || !c) {
      out.requests.push({ id: r.id, status: 'invalid' });
      continue;
    }
    const residual = c.type === 'two-way' ? 0 : c.salaries.reduce((a, b) => a + b, 0);
    releasePlayer(state, p.id, turn);
    out.requests.push({ id: r.id, status: 'done' });
    note(
      r.teamId,
      residual
        ? `Hai tagliato ${fullName(p)}: ${millions(residual)} di stipendi residui restano a tuo carico.`
        : `Hai tagliato ${fullName(p)}.`,
    );
  }

  // 3. Rinnovi
  for (const r of req.renewals) {
    const p = state.players.find((x) => x.id === r.playerId);
    const ok = p !== undefined && p.teamId === r.teamId && applyRenewal(state, r.playerId, r.salaries, turn);
    out.requests.push({ id: r.id, status: ok ? 'done' : 'invalid' });
    if (p)
      note(
        r.teamId,
        ok
          ? `${fullName(p)} ha rinnovato: ${r.salaries.length} anni, ${millions(r.salaries[0] ?? 0)} il primo.`
          : `Il rinnovo di ${fullName(p)} non è più possibile.`,
      );
  }

  // 4. Offerte agli svincolati, a busta chiusa
  const valid: typeof req.bids = [];
  for (const b of req.bids) {
    const p = state.players.find((x) => x.id === b.playerId);
    if (!p || p.teamId !== null) {
      out.bids.push({ id: b.id, status: 'lost' });
      if (p) note(b.teamId, `${fullName(p)} non è più svincolato.`);
      continue;
    }
    valid.push(b);
  }
  const worstFirst = [
    ...leagueStandings(
      state.teams,
      state.games.filter((g) => g.phase === 'regular'),
      standingsSeed(state.publicSeed ?? state.seed, state.config.year),
    ),
  ].reverse();
  const offers: Offer[] = valid.map((b) => ({
    teamId: b.teamId,
    playerId: b.playerId,
    salaries: b.salaries,
  }));
  // Prima di risolvere: chi non potrebbe firmare nemmeno da solo (cap, rosa, bilancio) ha un'offerta non valida
  const reasons = new Map(
    valid.map((b) => {
      const p = state.players.find((x) => x.id === b.playerId) as PlayerState;
      const check = canSign(state, b.teamId, p, b.salaries[0] ?? 0);
      return [b.id, check.ok ? null : (check.reason ?? 'non si può firmare')];
    }),
  );
  resolveOffers(state, offers, IN_SEASON_ASK_ROUND, worstFirst, turn);
  for (const b of valid) {
    const p = state.players.find((x) => x.id === b.playerId) as PlayerState;
    const ask = inSeasonAsk(state, p);
    if (p.teamId === b.teamId) {
      out.bids.push({ id: b.id, status: 'won' });
      note(
        b.teamId,
        `Hai firmato ${fullName(p)}: ${b.salaries.length} anni, ${millions(b.salaries[0] ?? 0)} il primo.`,
      );
    } else if (p.teamId !== null) {
      out.bids.push({ id: b.id, status: 'lost' });
      note(b.teamId, `${fullName(p)} ha scelto l'offerta di ${p.teamId}.`);
    } else if (reasons.get(b.id)) {
      out.bids.push({ id: b.id, status: 'invalid' });
      note(b.teamId, `L'offerta per ${fullName(p)} non è valida: ${reasons.get(b.id)}.`);
    } else {
      out.bids.push({ id: b.id, status: 'lost' });
      note(
        b.teamId,
        (b.salaries[0] ?? 0) < ask
          ? `${fullName(p)} ha rifiutato: chiede almeno ${millions(ask)}.`
          : `${fullName(p)} non ha firmato: con le altre firme del turno l'offerta non stava più nel cap o nella rosa.`,
      );
    }
  }
  return out;
}

/**
 * Proposte dei bot alle squadre umane: ogni tanto, al massimo una ogni BOT_PROPOSAL_COOLDOWN turni per squadra,
 * un bot in corsa chiede un veterano o uno in ricostruzione ne offre uno. lastProposal: turno dell'ultima proposta
 * ricevuta da ogni squadra umana.
 */
export function botProposals(
  state: LeagueState,
  rng: Rng,
  lastProposal: ReadonlyMap<string, number>,
  turn: number,
): { fromId: string; toId: string; trade: Trade }[] {
  if (!tradeWindowOpen(state)) return [];
  const out: { fromId: string; toId: string; trade: Trade }[] = [];
  const bots = state.teams.filter((t) => !t.human && t.strategy !== 'middle');
  for (const human of state.teams.filter((t) => t.human)) {
    const last = lastProposal.get(human.id);
    if (last !== undefined && turn - last < BOT_PROPOSAL_COOLDOWN) continue;
    if (!rng.chance(BOT_PROPOSAL_CHANCE)) continue;
    for (const bot of rng.shuffle([...bots]).slice(0, 3)) {
      const trade = botProposeTrade(state, bot.id, human.id, rng);
      if (!trade) continue;
      out.push({ fromId: bot.id, toId: human.id, trade });
      break;
    }
  }
  return out;
}

/** Riassunto di uno scambio per chi lo riceve: "MIA ti offre X per Y". */
export function describeTrade(
  state: LeagueState,
  t: Trade,
  viewerId: string,
): { get: string[]; give: string[] } {
  const player = (id: string) => {
    const p = state.players.find((x) => x.id === id);
    return p ? `${fullName(p)} (${Math.round(overall(p))})` : 'un giocatore';
  };
  const pick = (id: string) => {
    const k = state.picks.find((x) => x.id === id);
    if (!k) return 'una scelta';
    const n = t.protections?.[id] ?? k.protection;
    return `${k.round === 1 ? 'prima' : 'seconda'} scelta ${k.draftYear} di ${k.originalTeamId}${n ? ` (top ${n})` : ''}`;
  };
  const a = [...t.playersA.map(player), ...t.picksA.map(pick)];
  const b = [...t.playersB.map(player), ...t.picksB.map(pick)];
  return viewerId === t.teamA ? { give: a, get: b } : { give: b, get: a };
}
