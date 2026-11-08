// Mercato dei manager in un turno (Fase 11). Le richieste fatte durante il turno (scambi, tagli, rinnovi,
// offerte agli svincolati) si eseguono tutte al passaggio di turno, in quest'ordine, così nessuno è avvantaggiato
// dall'essere online prima degli altri. Ogni richiesta si ricontrolla al momento: quello che non vale più salta.
import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import { botAccepts, botProposeTrade } from './bots.ts';
import { checkCoachHire, coachName, replaceCoach } from './coaches.ts';
import { maxSalaryFor, nextConfig, type SeasonConfig } from './config.ts';
import { canSign, contractOf, releasePlayer, salaryRun, typicalYears } from './finance.ts';
import type { ContractOption } from '../types.ts';
import {
  askingSalaryFor,
  faSigningRound,
  FREE_AGENCY_ROUNDS,
  offerStandings,
  resolveOffers,
  resolveOfferSheets,
  teamAppeal,
  type Offer,
  type OfferSheetOutcome,
  type OfferStanding,
} from './freeAgency.ts';
import { ownerOf } from './owners.ts';
import { standingsSeed } from './season.ts';
import { leagueStandings } from './standings.ts';
import type { LeagueState, PlayerState } from './state.ts';
import { executeTrade, tradeWindowOpen, validateTrade, type Trade } from './trades.ts';

/** In stagione gli svincolati chiedono quanto all'ultimo turno di free agency: le richieste non scendono più. */
export const IN_SEASON_ASK_ROUND = FREE_AGENCY_ROUNDS - 1;
/** Sotto questo morale il giocatore non rinnova. */
export const MIN_RENEWAL_MORALE = 30;
/**
 * Probabilità per turno che un bot proponga uno scambio a una squadra umana. Un turno è un giorno: fino alla
 * deadline circa 105 giorni con partite contro 56 turni di prima (con 0,15), per le stesse proposte a stagione.
 */
export const BOT_PROPOSAL_CHANCE = 0.08;
/** Turni (giorni con partite) minimi tra due proposte dei bot alla stessa squadra umana: circa 5 turni di prima. */
export const BOT_PROPOSAL_COOLDOWN = 10;

const millions = (x: number) => `${(x / 1e6).toFixed(1).replace('.', ',')} mln`;
const fullName = (p: Pick<PlayerState, 'firstName' | 'lastName'>) => `${p.firstName} ${p.lastName}`;
/** "1 anno", "3 anni" */
const yearsText = (n: number) => `${n} ${n === 1 ? 'anno' : 'anni'}`;

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

/**
 * Stipendio massimo del primo anno di un rinnovo in stagione: quello della stagione successiva, con un anno di
 * anzianità in più. La richiesta (renewalSalaries) non lo supera mai; si ricontrolla alla chiusura del turno.
 */
export function renewalMax(c: SeasonConfig, p: Pick<PlayerState, 'yearsInLeague'>): number {
  return maxSalaryFor(nextConfig(c), p.yearsInLeague === null ? null : p.yearsInLeague + 1);
}

/**
 * Rinnovo: il contratto si allunga con gli stipendi concordati (e le opzioni, allineate agli stipendi), dalla stagione
 * successiva.
 */
export function applyRenewal(
  state: LeagueState,
  playerId: string,
  salaries: readonly number[],
  turn: number | null,
  options?: readonly ContractOption[],
): boolean {
  const p = state.players.find((x) => x.id === playerId);
  const c = contractOf(state, playerId);
  if (!p || !c || c.type === 'two-way' || c.salaries.length !== 1 || p.teamId !== c.teamId) return false;
  if (!salaries.length || (salaries[0] as number) > renewalMax(state.config, p)) return false;
  c.salaries = [c.salaries[0] as number, ...salaries];
  c.options = [c.options[0] ?? null, ...salaries.map((_, i) => options?.[i] ?? null)];
  if (c.type !== 'standard') c.type = 'standard';
  c.guaranteed = null;
  state.transactions.push({
    year: state.config.year,
    turn,
    type: 'renewal',
    text: `${c.teamId} rinnova ${fullName(p)} (${yearsText(salaries.length)}, ${millions(salaries[0] ?? 0)} dalla prossima stagione)`,
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
  renewals: {
    id: string;
    teamId: string;
    playerId: string;
    salaries: number[];
    /** Opzioni concordate, allineate agli stipendi (di solito solo sull'ultimo anno). */
    options?: ContractOption[];
  }[];
  bids: { id: string; teamId: string; playerId: string; salaries: number[] }[];
  /** Cambi di allenatore: la squadra esonera il suo e assume uno libero alla sua richiesta. */
  coaches?: { id: string; teamId: string; coachId: string }[];
  /** RFA: la squadra con i diritti pareggia (match) o no l'offerta che il giocatore ha scelto da un'altra squadra. */
  matches?: { id: string; teamId: string; playerId: string; match: boolean }[];
}

/** Messaggio per una squadra, da mostrare come avviso informativo. */
export interface MarketNote {
  teamId: string;
  text: string;
}

export interface MarketOutcome {
  trades: { id: string; status: 'executed' | 'void' | 'rejected' | 'expired' }[];
  requests: { id: string; status: 'done' | 'invalid' }[];
  /** pending: l'offerta resta sul tavolo per il turno dopo (free agency dell'offseason). */
  bids: { id: string; status: 'won' | 'lost' | 'invalid' | 'pending' }[];
  /** Offerte degli RFA decise in questo turno (pareggiate o no). */
  sheets: OfferSheetOutcome[];
  notes: MarketNote[];
}

/** Come sta un'offerta, per la nota al manager. */
const STANDING_TEXT: Record<OfferStanding, string> = {
  best: 'per ora è la migliore che ha ricevuto',
  behind: 'ha ricevuto offerte migliori',
  below: 'è sotto la sua richiesta',
  invalid: 'adesso non potresti firmarlo',
};

/**
 * Esegue il mercato del turno: scambi (gli accettati nell'ordine in cui sono stati accettati; quelli verso un bot
 * li decide il bot, con il suo margine del 10%; quelli senza risposta sono rifiutati), cambi di allenatore, tagli,
 * rinnovi, pareggi degli RFA e offerte agli svincolati (in stagione gli svincolati chiedono quanto a fine free
 * agency). Uno scambio che non vale più, per esempio perché un giocatore è già andato in un altro scambio, decade.
 * Nella free agency dell'offseason (keepBids) le offerte che non firmano restano sul tavolo per il turno dopo, e a
 * chi le ha fatte il giocatore dice come stanno.
 */
export function runMarket(
  state: LeagueState,
  req: MarketRequests,
  turn: number | null,
  opts: {
    /** Turno di free agency dell'offseason (0-14): le richieste scendono di turno in turno. In stagione l'ultimo. */
    askRound?: number;
    /** Offerte dei bot da mettere insieme a quelle dei manager (free agency dell'offseason). */
    extraOffers?: () => Offer[];
    /** Le offerte che non firmano restano aperte (tutti i turni di free agency tranne l'ultimo). */
    keepBids?: boolean;
  } = {},
): MarketOutcome {
  const askRound = opts.askRound ?? IN_SEASON_ASK_ROUND;
  const out: MarketOutcome = { trades: [], requests: [], bids: [], sheets: [], notes: [] };
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

  // 2. Cambi di allenatore, uno per squadra. Se più squadre vogliono lo stesso allenatore sceglie lui: la squadra
  // più forte (rotazione e classifica, come gli svincolati), a parità la peggiore in classifica
  if (req.coaches?.length) {
    const seen = new Set<string>();
    const wanted = new Map<string, number>();
    for (const r of req.coaches) wanted.set(r.coachId, (wanted.get(r.coachId) ?? 0) + 1);
    const appeal = [...wanted.values()].some((n) => n > 1) ? teamAppeal(state) : null;
    const standing = leagueStandings(
      state.teams,
      state.games.filter((g) => g.phase === 'regular'),
      standingsSeed(state.publicSeed ?? state.seed, state.config.year),
    );
    const rank = (teamId: string) => -standing.indexOf(teamId);
    const ordered = [...req.coaches].sort(
      (a, b) =>
        (appeal ? (appeal.get(b.teamId) ?? 0) - (appeal.get(a.teamId) ?? 0) : 0) ||
        rank(a.teamId) - rank(b.teamId),
    );
    for (const r of ordered) {
      const coach = state.coaches?.find((c) => c.id === r.coachId);
      const name = coach ? coachName(coach) : "l'allenatore";
      if (seen.has(r.teamId)) {
        out.requests.push({ id: r.id, status: 'invalid' });
        note(r.teamId, `Un solo cambio di allenatore per turno: ${name} non arriva.`);
        continue;
      }
      const check = checkCoachHire(state, r.teamId, r.coachId);
      if (!check.ok || !replaceCoach(state, r.teamId, r.coachId, turn)) {
        out.requests.push({ id: r.id, status: 'invalid' });
        note(r.teamId, `${name} non arriva: ${check.reason ?? 'non è più libero'}.`);
        continue;
      }
      seen.add(r.teamId);
      out.requests.push({ id: r.id, status: 'done' });
      note(r.teamId, `${name} è il tuo nuovo allenatore.`);
    }
  }

  // 3. Tagli: lo stipendio residuo resta a carico della squadra fino alla scadenza
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

  // 4. Rinnovi
  for (const r of req.renewals) {
    const p = state.players.find((x) => x.id === r.playerId);
    const ok =
      p !== undefined &&
      p.teamId === r.teamId &&
      applyRenewal(state, r.playerId, r.salaries, turn, r.options);
    out.requests.push({ id: r.id, status: ok ? 'done' : 'invalid' });
    if (p)
      note(
        r.teamId,
        ok
          ? `${fullName(p)} ha rinnovato: ${yearsText(r.salaries.length)}, ${millions(r.salaries[0] ?? 0)} il primo.`
          : `Il rinnovo di ${fullName(p)} non è più possibile.`,
      );
  }

  // 5. RFA: le offerte scelte da un'altra squadra nel turno prima, pareggiate o no da chi ha i diritti
  if (state.offerSheets?.length) {
    const asked = new Map((req.matches ?? []).map((m) => [m.playerId, m]));
    out.sheets = resolveOfferSheets(state, new Map([...asked].map(([id, m]) => [id, m.match])), turn);
    for (const sh of out.sheets) {
      const p = state.players.find((x) => x.id === sh.playerId);
      const name = p ? fullName(p) : 'Il giocatore';
      if (sh.outcome === 'matched') {
        note(sh.rightsTeamId, `Hai pareggiato l'offerta di ${sh.teamId}: ${name} resta con te.`);
        note(sh.teamId, `${sh.rightsTeamId} ha pareggiato la tua offerta: ${name} resta con loro.`);
      } else if (sh.outcome === 'left') {
        note(sh.rightsTeamId, `Non hai pareggiato: ${name} va a ${sh.teamId}.`);
        note(sh.teamId, `${sh.rightsTeamId} non ha pareggiato: ${name} firma con te.`);
      } else {
        note(sh.teamId, `L'offerta per ${name} non vale più: resta free agent con restrizioni.`);
      }
    }
  }
  for (const m of req.matches ?? [])
    out.requests.push({
      id: m.id,
      status: out.sheets.some((x) => x.playerId === m.playerId && x.rightsTeamId === m.teamId)
        ? 'done'
        : 'invalid',
    });

  // 6. Offerte agli svincolati, a busta chiusa
  const valid: typeof req.bids = [];
  for (const b of req.bids) {
    const p = state.players.find((x) => x.id === b.playerId);
    // Firmato dopo il turno di pareggio di un RFA (la sua squadra non ha pareggiato)
    if (p && p.teamId === b.teamId) {
      out.bids.push({ id: b.id, status: 'won' });
      continue;
    }
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
  // Prima di risolvere: chi non potrebbe firmare nemmeno da solo (tassa, rosa, bilancio) ha un'offerta non valida
  const reasons = new Map(
    valid.map((b) => {
      const p = state.players.find((x) => x.id === b.playerId) as PlayerState;
      const check = canSign(state, b.teamId, p, b.salaries[0] ?? 0);
      return [b.id, check.ok ? null : (check.reason ?? 'non si può firmare')];
    }),
  );
  const all = [...offers, ...(opts.extraOffers?.() ?? [])];
  // Nei turni di sole offerte il giocatore dice a chi gliel'ha fatta come sta (prima delle firme, che non ci sono)
  const standings =
    opts.keepBids && !faSigningRound(askRound) ? offerStandings(state, all, askRound, worstFirst) : null;
  resolveOffers(state, all, askRound, worstFirst, turn);
  const sheetOf = new Map((state.offerSheets ?? []).map((x) => [x.playerId, x]));
  const waiting = new Map<string, string[]>();
  valid.forEach((b, i) => {
    const p = state.players.find((x) => x.id === b.playerId) as PlayerState;
    const ask = askingSalaryFor(state.config, p, askRound);
    const sheet = sheetOf.get(p.id);
    if (p.teamId === b.teamId) {
      out.bids.push({ id: b.id, status: 'won' });
      note(
        b.teamId,
        `Hai firmato ${fullName(p)}: ${yearsText(b.salaries.length)}, ${millions(b.salaries[0] ?? 0)} il primo.`,
      );
    } else if (p.teamId !== null) {
      out.bids.push({ id: b.id, status: 'lost' });
      note(b.teamId, `${fullName(p)} ha scelto l'offerta di ${p.teamId}.`);
    } else if (sheet?.teamId === b.teamId) {
      out.bids.push({ id: b.id, status: 'pending' });
      note(
        b.teamId,
        `${fullName(p)} ha scelto la tua offerta: è un RFA e ${sheet.rightsTeamId} ha un turno per pareggiarla.`,
      );
    } else if (sheet) {
      out.bids.push({ id: b.id, status: 'lost' });
      note(b.teamId, `${fullName(p)} ha scelto l'offerta di ${sheet.teamId}.`);
    } else if (reasons.get(b.id)) {
      out.bids.push({ id: b.id, status: 'invalid' });
      note(b.teamId, `L'offerta per ${fullName(p)} non è valida: ${reasons.get(b.id)}.`);
    } else if (opts.keepBids) {
      // Resta sul tavolo: nei turni di sole offerte con com'è messa, poi solo se è sotto la richiesta
      out.bids.push({ id: b.id, status: 'pending' });
      const standing: OfferStanding =
        standings?.[i] ??
        ((b.salaries[0] ?? 0) < ask
          ? 'below'
          : canSign(state, b.teamId, p, b.salaries[0] ?? 0).ok
            ? 'behind'
            : 'invalid');
      const text =
        standing === 'below'
          ? `${fullName(p)} (${STANDING_TEXT.below}: ${millions(ask)})`
          : `${fullName(p)} (${STANDING_TEXT[standing]})`;
      waiting.set(b.teamId, [...(waiting.get(b.teamId) ?? []), text]);
    } else {
      out.bids.push({ id: b.id, status: 'lost' });
      note(
        b.teamId,
        (b.salaries[0] ?? 0) < ask
          ? `${fullName(p)} ha rifiutato: chiede almeno ${millions(ask)}.`
          : `${fullName(p)} non ha firmato: con le altre firme del turno l'offerta non stava più nella tassa o nella rosa.`,
      );
    }
  });
  for (const [teamId, list] of waiting) note(teamId, `Offerte ancora sul tavolo: ${list.join('; ')}.`);
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
    // Un GM che cerca pochi scambi propone una volta su due, uno che li cerca sempre passa davanti
    const candidates = rng
      .shuffle([...bots])
      .filter((b) => !b.owner || ownerOf(b).trades !== 'low' || rng.chance(0.5))
      .sort((a, b) => Number(ownerOf(b).trades === 'high') - Number(ownerOf(a).trades === 'high'));
    for (const bot of candidates.slice(0, 3)) {
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
