// Proprietari e GM delle squadre dei bot. Ogni franchigia ha un proprietario con un obiettivo (vincere subito,
// costruire con pazienza, risparmiare, equilibrio, fare colpo) e un GM con un carattere (quanto cerca scambi, quanto
// è fedele ai suoi giocatori, se al draft punta sul potenziale o su chi è pronto, quanta pazienza ha con
// l'allenatore). Contano solo finché la squadra è dei bot: con un manager umano decide lui. Senza profilo (leghe
// create prima) il bot si comporta come "Equilibrio" con un GM nella media, cioè come prima, numero per numero.
import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import { autoSetup } from '../game/setup.ts';
import {
  ageCoaches,
  coachAsk,
  coachMarketValue,
  coachName,
  coachOf,
  coachRating,
  coachSalaryMax,
  fireCoach,
  freeCoaches,
  philosophyFit,
  refillCoachPool,
  signCoach,
  type CoachState,
} from './coaches.ts';
import { nextConfig } from './config.ts';
import { roster } from './finance.ts';
import { REGULAR_SEASON_GAMES } from './schedule.ts';
import type { LeagueState, TeamState } from './state.ts';

export const OWNER_GOALS = ['win-now', 'patient', 'thrifty', 'balanced', 'splash'] as const;
export type OwnerGoal = (typeof OWNER_GOALS)[number];
export type Level = 'low' | 'normal' | 'high';

export interface OwnerProfile {
  /** Cosa vuole il proprietario dalla squadra. */
  goal: OwnerGoal;
  /** GM: quanto cerca scambi (chi ne cerca di più si accontenta di un margine più piccolo). */
  trades: Level;
  /** GM: fedeltà ai suoi giocatori nei rinnovi. */
  loyalty: Level;
  /** GM: al draft il potenziale o chi è già pronto. */
  draft: 'potential' | 'balanced' | 'ready';
  /** Proprietario: pazienza con l'allenatore quando i risultati sono sotto le attese. */
  patience: Level;
}

export const OWNER_GOAL_LABEL: Record<OwnerGoal, string> = {
  'win-now': 'Vincere subito',
  patient: 'Costruire con pazienza',
  thrifty: 'Risparmiare',
  balanced: 'Equilibrio',
  splash: 'Fare colpo',
};

export const OWNER_GOAL_TEXT: Record<OwnerGoal, string> = {
  'win-now': 'Vuole il titolo adesso: spende, accetta la luxury tax e compra veterani.',
  patient: 'Costruisce con giovani e scelte al draft e va in corsa solo quando la squadra è pronta.',
  thrifty: 'Tiene i conti in ordine: resta sotto la luxury tax, spende poco e cede i contratti pesanti.',
  balanced: 'Nessun estremo: va in corsa o ricostruisce secondo la classifica.',
  splash: 'Vuole i nomi grossi: punta sui migliori svincolati e rilancia per averli.',
};

export const OWNER_TRAIT_LABEL = {
  trades: { low: 'Pochi scambi', normal: 'Scambi nella media', high: 'Sempre sul mercato' },
  loyalty: {
    low: 'Poco legato ai suoi giocatori',
    normal: 'Rinnovi nella media',
    high: 'Fedele ai suoi giocatori',
  },
  draft: {
    potential: 'Al draft punta sul potenziale',
    balanced: 'Al draft cerca equilibrio',
    ready: 'Al draft vuole chi è pronto',
  },
  patience: {
    low: 'Poca pazienza con l’allenatore',
    normal: 'Pazienza nella media',
    high: 'Molta pazienza con l’allenatore',
  },
} as const;

/** Profilo dei bot senza proprietario (leghe create prima): il comportamento di sempre. */
export const DEFAULT_OWNER: OwnerProfile = {
  goal: 'balanced',
  trades: 'normal',
  loyalty: 'normal',
  draft: 'balanced',
  patience: 'normal',
};

/** Numeri con cui l'obiettivo del proprietario cambia le scelte del bot. "Equilibrio" ha quelli di sempre. */
export interface OwnerStyle {
  /** In corsa se nella classifica attesa è tra le prime contendRank. */
  contendRank: number;
  /** In ricostruzione da questo posto, o da oldRebuildRank con una rotazione vecchia (età media da 30). */
  rebuildRank: number;
  oldRebuildRank: number;
  /** Con i conti stretti (sopra la tassa e in rosso): in corsa solo tra le prime, in ricostruzione da questo posto. */
  squeezedContendRank: number;
  squeezedRebuildRank: number;
  /** Conti stretti appena sopra la tassa, anche con il saldo positivo. */
  hatesTax: boolean;
  /**
   * Sopra la tassa cede contratti pesanti quando il saldo scende sotto questa quota dei ricavi (0: appena va in
   * rosso; chi vuole vincere subito aspetta di essere molto in rosso).
   */
  dumpBelow: number;
  /** Peso della luxury tax negli scambi (1: mezzo punto per milione). */
  taxWeight: number;
  /** Peso delle scelte al draft negli scambi. */
  pickWeight: number;
  /** Quota dello spazio sotto il cap che spende in free agency (il monte stipendi minimo lo raggiunge comunque). */
  spendShare: number;
  /** Rilancio massimo sopra la richiesta di uno svincolato (a caso tra 0 e questo). */
  overAsk: number;
  /** Rinnova se la richiesta non supera il valore di mercato per tanto (1,15: il 15% in più). */
  renewalRatio: number;
  /** Valore di uno svincolato per età: giovani fino a 25 anni, veterani da 29. */
  youngFA: number;
  veteranFA: number;
  /** Budget per l'allenatore, in quota dello stipendio massimo di un allenatore. */
  coachBudget: number;
  /** Quante vittorie sotto le attese in più (o in meno) tollera prima di esonerare l'allenatore. */
  coachTolerance: number;
  /**
   * Sotto questo saldo, in quota dei ricavi di una stagione, la banca impone di risparmiare: il bot decide come chi
   * risparmia (Infinity: mai, come "Equilibrio", che ha già le sue regole per il rosso).
   */
  redLimit: number;
}

export const OWNER_STYLE: Record<OwnerGoal, OwnerStyle> = {
  balanced: {
    contendRank: 10,
    rebuildRank: 20,
    oldRebuildRank: 15,
    squeezedContendRank: 6,
    squeezedRebuildRank: 12,
    hatesTax: false,
    dumpBelow: 0,
    taxWeight: 1,
    pickWeight: 1,
    spendShare: 1,
    overAsk: 0.08,
    renewalRatio: 1.15,
    youngFA: 1,
    veteranFA: 1,
    coachBudget: 0.75,
    coachTolerance: 0,
    redLimit: Infinity,
  },
  'win-now': {
    contendRank: 14,
    rebuildRank: 25,
    oldRebuildRank: 22,
    squeezedContendRank: 10,
    squeezedRebuildRank: 16,
    hatesTax: false,
    dumpBelow: -0.15,
    taxWeight: 0.5,
    pickWeight: 0.8,
    spendShare: 1,
    overAsk: 0.12,
    renewalRatio: 1.3,
    youngFA: 0.9,
    veteranFA: 1.1,
    coachBudget: 1,
    coachTolerance: -2,
    redLimit: 0.3,
  },
  patient: {
    contendRank: 6,
    rebuildRank: 15,
    oldRebuildRank: 10,
    squeezedContendRank: 4,
    squeezedRebuildRank: 10,
    hatesTax: false,
    dumpBelow: 0,
    taxWeight: 1.3,
    pickWeight: 1.25,
    spendShare: 0.9,
    overAsk: 0.05,
    renewalRatio: 1.1,
    youngFA: 1.15,
    veteranFA: 0.8,
    coachBudget: 0.75,
    coachTolerance: 3,
    redLimit: 0.2,
  },
  thrifty: {
    contendRank: 8,
    rebuildRank: 18,
    oldRebuildRank: 14,
    squeezedContendRank: 5,
    squeezedRebuildRank: 10,
    hatesTax: true,
    dumpBelow: 0,
    taxWeight: 2,
    pickWeight: 1.1,
    spendShare: 0.75,
    overAsk: 0.03,
    renewalRatio: 1.05,
    youngFA: 1,
    veteranFA: 0.9,
    coachBudget: 0.5,
    coachTolerance: 2,
    redLimit: Infinity,
  },
  splash: {
    contendRank: 12,
    rebuildRank: 22,
    oldRebuildRank: 17,
    squeezedContendRank: 8,
    squeezedRebuildRank: 14,
    hatesTax: false,
    dumpBelow: -0.05,
    taxWeight: 0.75,
    pickWeight: 0.9,
    spendShare: 1,
    overAsk: 0.15,
    renewalRatio: 1.2,
    youngFA: 1,
    veteranFA: 1,
    coachBudget: 1,
    coachTolerance: -1,
    redLimit: 0.2,
  },
};

export function ownerOf(team: Pick<TeamState, 'owner'> | undefined): OwnerProfile {
  return team?.owner ?? DEFAULT_OWNER;
}

/**
 * Regole del proprietario di una squadra. Con revenue (i ricavi della stagione), un saldo sotto redLimit stagioni di
 * ricavi fa decidere il bot come chi risparmia: anche chi vuole vincere subito, molto in rosso, deve tagliare.
 */
export function ownerStyle(
  team: (Pick<TeamState, 'owner'> & Partial<Pick<TeamState, 'balance'>>) | undefined,
  revenue?: number,
): OwnerStyle {
  const style = OWNER_STYLE[ownerOf(team).goal];
  if (revenue !== undefined && team?.balance !== undefined && team.balance < -style.redLimit * revenue)
    return { ...OWNER_STYLE.thrifty, coachTolerance: style.coachTolerance };
  return style;
}

/** Margine che il bot chiede negli scambi: chi cerca scambi si accontenta di meno. */
export function tradeMargin(team: Pick<TeamState, 'owner'> | undefined): number {
  const t = ownerOf(team).trades;
  return t === 'high' ? 1.06 : t === 'low' ? 1.15 : 1.1;
}

/** Peso del bot nella scelta di chi prova uno scambio tra bot. */
export function tradeActivity(team: Pick<TeamState, 'owner'> | undefined): number {
  const t = ownerOf(team).trades;
  return t === 'high' ? 2 : t === 'low' ? 0.5 : 1;
}

/** Rinnova se la richiesta è entro questa quota del valore di mercato (revenue: vedi ownerStyle). */
export function renewalRatio(
  team: (Pick<TeamState, 'owner'> & Partial<Pick<TeamState, 'balance'>>) | undefined,
  revenue?: number,
): number {
  const o = ownerOf(team);
  return (
    ownerStyle(team, revenue).renewalRatio + (o.loyalty === 'high' ? 0.12 : o.loyalty === 'low' ? -0.08 : 0)
  );
}

/** Peso del potenziale stimato nella scelta al draft (il resto è l'overall di adesso). */
export function draftPotentialWeight(team: Pick<TeamState, 'owner'> | undefined): number {
  const d = ownerOf(team).draft;
  return d === 'potential' ? 0.72 : d === 'ready' ? 0.48 : 0.6;
}

/**
 * Proprietari di una lega nuova: gli obiettivi da un mazzo fisso (8 Equilibrio, 6 Vincere subito, 6 Costruire con
 * pazienza, 6 Risparmiare, 4 Fare colpo) mescolato, così ogni lega ha lo stesso miscuglio e l'economia regge; i
 * caratteri dei GM a caso (metà nella media). Chi costruisce con pazienza ha più spesso pazienza con l'allenatore,
 * chi vuole vincere subito meno.
 */
export function generateOwners(teamIds: readonly string[], rng: Rng): Map<string, OwnerProfile> {
  const deck: OwnerGoal[] = [];
  const counts: [OwnerGoal, number][] = [
    ['balanced', 8],
    ['win-now', 6],
    ['patient', 6],
    ['thrifty', 6],
    ['splash', 4],
  ];
  for (const [goal, n] of counts) for (let i = 0; i < n; i++) deck.push(goal);
  const goals = rng.shuffle(deck);
  const level = (low = 0.25, high = 0.25): Level => {
    const r = rng.next();
    return r < low ? 'low' : r < low + high ? 'high' : 'normal';
  };
  const out = new Map<string, OwnerProfile>();
  teamIds.forEach((id, i) => {
    const goal = goals[i % goals.length] as OwnerGoal;
    const draftR = rng.next();
    out.set(id, {
      goal,
      trades: level(),
      loyalty: level(),
      draft: draftR < 0.3 ? 'potential' : draftR < 0.55 ? 'ready' : 'balanced',
      patience: goal === 'patient' ? level(0.1, 0.5) : goal === 'win-now' ? level(0.5, 0.1) : level(),
    });
  });
  return out;
}

// ------------------------------------------------------------------ attese e allenatore

/** Scarto di forza (overall della rotazione) che vale circa due vittorie su tre (come in bots.ts). */
const WIN_SCALE = 6.8;

/**
 * Vittorie attese da ogni squadra nella stagione che comincia, dalla forza della rotazione automatica rispetto
 * alla media: il proprietario giudica l'allenatore su queste.
 */
export function setExpectations(state: LeagueState): void {
  const strength = new Map(
    state.teams.map((t) => {
      const players = roster(state, t.id).filter((p) => p.injury === null);
      if (players.length < 5) return [t.id, 40];
      const setup = autoSetup(t.id, players);
      let sum = 0;
      for (const p of setup.players) sum += overall(p) * (setup.minutes[p.id] ?? 0);
      return [t.id, sum / 240];
    }),
  );
  const average = [...strength.values()].reduce((a, b) => a + b, 0) / Math.max(1, strength.size);
  for (const team of state.teams) {
    const s = strength.get(team.id) as number;
    team.expectedWins = Math.round(REGULAR_SEASON_GAMES / (1 + Math.exp(-(s - average) / WIN_SCALE)));
  }
}

/** Vittorie in regular season della stagione in corso, e partite giocate. */
function seasonRecord(state: LeagueState, teamId: string): { w: number; g: number } {
  let w = 0;
  let g = 0;
  for (const x of state.games) {
    if (x.phase !== 'regular' || (x.homeId !== teamId && x.awayId !== teamId)) continue;
    g++;
    if ((x.homeScore > x.awayScore ? x.homeId : x.awayId) === teamId) w++;
  }
  return { w, g };
}

/** Vittorie sotto le attese per esonerare a fine stagione, con la pazienza nella media; poca -3, molta +4. */
export const COACH_FIRE_WINS = 8;
/** A metà stagione si esonera solo molto sotto le attese (in proporzione alle partite giocate). */
export const COACH_FIRE_MIDSEASON = 8;

function tolerance(team: TeamState): number {
  const o = ownerOf(team);
  return (
    COACH_FIRE_WINS +
    OWNER_STYLE[o.goal].coachTolerance +
    (o.patience === 'low' ? -3 : o.patience === 'high' ? 4 : 0)
  );
}

/** Allenatore nella media: in rosso un bot non spende di più. */
const AVERAGE_COACH = { ratings: { tactics: 55, development: 55, motivation: 55 } };

/**
 * Quanto un bot vuole un allenatore libero: per chi vuole vincere subito conta la Tattica, per chi costruisce lo
 * Sviluppo, per chi risparmia la valutazione per milione, per chi vuole fare colpo il nome (la valutazione); in più
 * quanto la sua idea di gioco va d'accordo con la rosa. null se costa più del budget del proprietario.
 */
export function coachAppeal(state: LeagueState, team: TeamState, coach: CoachState): number | null {
  const style = ownerStyle(team);
  const ask = coachAsk(state.config, coach)[0] ?? 0;
  let budget = style.coachBudget * coachSalaryMax(state.config);
  // In rosso non spende più di quanto costa un allenatore nella media
  if (team.balance < 0) budget = Math.min(budget, coachMarketValue(state.config, AVERAGE_COACH));
  if (ask > budget) return null;
  const r = coach.ratings;
  const goal = ownerOf(team).goal;
  const base =
    goal === 'win-now'
      ? 0.7 * r.tactics + 0.15 * r.development + 0.15 * r.motivation
      : goal === 'patient'
        ? 0.3 * r.tactics + 0.55 * r.development + 0.15 * r.motivation
        : goal === 'thrifty'
          ? coachRating(coach) - (2.5 * ask) / 1e6
          : goal === 'splash'
            ? coachRating(coach) + (coachRating(coach) >= 70 ? 5 : 0)
            : coachRating(coach);
  return base + 3 * philosophyFit(coach.philosophy, roster(state, team.id));
}

/**
 * Il bot assume l'allenatore libero che preferisce e può pagare (il più economico se nessuno sta nel budget). Le
 * squadre umane senza allenatore (per esempio dopo un ritiro) ne ricevono uno con le scelte di "Equilibrio".
 */
export function hireBestCoach(state: LeagueState, team: TeamState, turn: number | null): CoachState | null {
  const free = freeCoaches(state);
  if (!free.length) return null;
  const judge = team.human ? { ...team, owner: undefined } : team;
  let best: CoachState | null = null;
  let bestScore = -Infinity;
  for (const c of free) {
    const s = coachAppeal(state, judge, c);
    if (s !== null && (s > bestScore || (s === bestScore && best !== null && c.id < best.id))) {
      best = c;
      bestScore = s;
    }
  }
  best ??= [...free].sort(
    (a, b) => coachMarketValue(state.config, a) - coachMarketValue(state.config, b) || (a.id < b.id ? -1 : 1),
  )[0] as CoachState;
  signCoach(state, team.id, best, coachAsk(state.config, best), turn);
  return best;
}

/**
 * A metà stagione (dal giorno della revisione delle strategie): un proprietario con poca pazienza, o che vuole
 * vincere subito, esonera l'allenatore se la squadra è molto sotto le attese per le partite giocate, salvo che lo
 * abbia assunto in questa stagione. Al massimo un esonero per turno nella lega.
 */
export function midseasonCoachMoves(state: LeagueState, rng: Rng, turn: number | null): CoachState | null {
  if (!state.coaches) return null;
  const candidates = rng.shuffle(
    state.teams.filter((t) => {
      const o = ownerOf(t);
      return !t.human && t.owner !== undefined && (o.patience === 'low' || o.goal === 'win-now');
    }),
  );
  for (const team of candidates) {
    const coach = coachOf(state, team.id);
    if (!coach || coach.since === state.config.year || team.expectedWins === undefined) continue;
    const { w, g } = seasonRecord(state, team.id);
    if (g < 20) continue;
    const expected = (team.expectedWins * g) / REGULAR_SEASON_GAMES;
    if (w - expected > -COACH_FIRE_MIDSEASON * (g / REGULAR_SEASON_GAMES) - 4) continue;
    fireCoach(state, team.id, turn);
    return hireBestCoach(state, team, turn);
  }
  return null;
}

/**
 * A fine stagione (alla chiusura della finale). Per ogni bot, dalla squadra peggiore: il proprietario somma le
 * vittorie sopra o sotto le attese (più 2,5 per ogni serie di playoff vinta) a metà del giudizio di prima, ed
 * esonera l'allenatore se va oltre la sua tolleranza. Un contratto all'ultimo anno si rinnova se le cose vanno almeno
 * quasi come previsto e l'allenatore ha meno di 70 anni; altrimenti finisce. Le squadre umane rinnovano da sole
 * l'allenatore in scadenza per 2 anni alla sua richiesta (il manager può cambiarlo quando vuole). Poi gli
 * allenatori invecchiano, chi resta senza panchina ne trova una (i bot scelgono, dal peggiore) e i liberi tornano a
 * FREE_COACH_POOL.
 */
export function offseasonCoachMoves(
  state: LeagueState,
  rng: Rng,
  worstFirst: readonly string[],
  seriesWon: ReadonlyMap<string, number>,
): void {
  if (!state.coaches) return;
  const year = state.config.year;
  for (const id of worstFirst) {
    const team = state.teams.find((t) => t.id === id);
    const coach = coachOf(state, id);
    if (!team || !coach) continue;
    const expiring = coach.salaries.length <= 1;
    if (team.human) {
      // L'allenatore in scadenza resta per altri 2 anni: parte dalla stagione che arriva (il primo stipendio si
      // toglie quando i contratti scalano)
      if (expiring) renewCoach(state, coach, 2);
      continue;
    }
    if (team.owner === undefined) {
      if (expiring) renewCoach(state, coach);
      continue;
    }
    const { w } = seasonRecord(state, id);
    const perf = w - (team.expectedWins ?? w) + 2.5 * (seriesWon.get(id) ?? 0);
    coach.pressure = 0.5 * coach.pressure + perf;
    const fresh = coach.since === year;
    if (!fresh && coach.pressure < -tolerance(team)) {
      fireCoach(state, id, null);
      continue;
    }
    if (expiring) {
      if (perf >= -2 && coach.age < 70) renewCoach(state, coach);
      else {
        coach.teamId = null;
        coach.salaries = [];
        coach.since = null;
        coach.pressure = 0;
        state.transactions.push({
          year,
          turn: null,
          type: 'coach',
          text: `${id} non rinnova il contratto dell'allenatore ${coachName(coach)}`,
        });
      }
    }
  }
  ageCoaches(state, rng);
  for (const id of worstFirst) {
    const team = state.teams.find((t) => t.id === id);
    if (team && !coachOf(state, id)) hireBestCoach(state, team, null);
  }
  refillCoachPool(state, rng, year + 1);
}

/**
 * Rinnovo di un allenatore all'ultimo anno: il contratto si allunga, dalla stagione che arriva, alla sua richiesta
 * (anni dati o quelli che chiede).
 */
export function renewCoach(state: LeagueState, coach: CoachState, years?: number): void {
  const ask = coachAsk(nextConfig(state.config), { ...coach, age: coach.age + 1 });
  const salaries = ask.slice(0, years ?? ask.length);
  while (salaries.length < (years ?? 0)) salaries.push(Math.round((salaries.at(-1) ?? 0) * 1.03));
  coach.salaries = [coach.salaries[0] ?? 0, ...salaries];
  state.transactions.push({
    year: state.config.year,
    turn: null,
    type: 'coach',
    text: `${coach.teamId} rinnova l'allenatore ${coachName(coach)} (${salaries.length} anni)`,
  });
}
