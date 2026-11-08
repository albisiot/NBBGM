// Allenatori. Ogni squadra ha un capo allenatore con un'idea di gioco (le tattiche e i giocatori che preferisce), un
// carattere (quanti giocatori ruota, di chi si fida, quanto fa riposare gli stanchi, se si adatta alla rosa) e tre
// qualità da 0 a 100: Tattica (un piccolo vantaggio in partita), Sviluppo (crescita dei giovani in offseason) e
// Gestione del gruppo (morale). Mette in campo i bot, il pulsante Auto e l'allenatore delegato con le sue tattiche.
// Ha un contratto con uno stipendio fuori dal cap, pagato dal bilancio partita per partita come gli stipendi dei
// giocatori; chi lo esonera lo paga fino alla scadenza.
import { autoSetup, ROTATION_MINUTES, type LineupStyle } from '../game/setup.ts';
import type { Tactics, TeamSetup } from '../game/types.ts';
import type { RatingKey } from '../fields.ts';
import { NAME_POOLS } from '../names.ts';
import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import type { Player } from '../types.ts';
import { CONFIG_2026_27, type SeasonConfig } from './config.ts';
import type { LeagueState } from './state.ts';

export const PHILOSOPHIES = ['run', 'space', 'grit', 'inside', 'motion', 'balanced'] as const;
/** Idea di gioco di un allenatore. */
export type Philosophy = (typeof PHILOSOPHIES)[number];

export const PHILOSOPHY_LABEL: Record<Philosophy, string> = {
  run: 'Corri e tira',
  space: 'Spazi e tiro da tre',
  grit: 'Difesa e fatica',
  inside: 'Gioco interno',
  motion: 'Movimento di palla',
  balanced: 'Equilibrio',
};

export const PHILOSOPHY_TEXT: Record<Philosophy, string> = {
  run: 'Ritmo alto e tiri presto: vuole giocatori veloci e tiratori.',
  space: 'Campo aperto e tanti tiri da tre: vuole tiratori anche tra i lunghi.',
  grit: 'Ritmo basso e difesa aggressiva: vuole difensori e giocatori di grinta.',
  inside: 'Palla dentro e difesa a zona che protegge l’area: vuole lunghi forti in post e a rimbalzo.',
  motion:
    'La palla gira e si sbaglia poco, con una difesa che non spreca energie: vuole passatori intelligenti.',
  balanced: 'Nessun estremo: gioca con i migliori che ha.',
};

/** Tattiche di partenza di ogni idea di gioco. */
export const PHILOSOPHY_TACTICS: Record<Philosophy, Tactics> = {
  run: { pace: 'fast', focus: 'perimeter', defense: 'man', intensity: 'medium' },
  space: { pace: 'normal', focus: 'perimeter', defense: 'man', intensity: 'medium' },
  grit: { pace: 'slow', focus: 'balanced', defense: 'man', intensity: 'high' },
  inside: { pace: 'slow', focus: 'inside', defense: 'zone', intensity: 'medium' },
  motion: { pace: 'normal', focus: 'balanced', defense: 'man', intensity: 'low' },
  balanced: { pace: 'normal', focus: 'balanced', defense: 'man', intensity: 'medium' },
};

/** Abilità che un'idea di gioco cerca nei giocatori (un'abilità ripetuta pesa di più). */
const PHILOSOPHY_SKILLS: Record<Philosophy, readonly RatingKey[]> = {
  run: ['speed', 'speedWithBall', 'agility', 'threePoint'],
  space: ['threePoint', 'threePoint', 'midRange', 'pullUp'],
  grit: ['perimeterDefense', 'interiorDefense', 'helpDefense', 'hustle', 'defensiveIQ'],
  inside: ['postControl', 'interiorDefense', 'defensiveRebound', 'offensiveRebound', 'strength'],
  motion: ['passAccuracy', 'passVision', 'offensiveIQ', 'hands'],
  balanced: [],
};

export interface CoachTraits {
  /** Rotazione: corta (9 giocatori, titolari fino a 36 minuti), normale (10) o lunga (10, minuti più divisi). */
  rotation: 'short' | 'normal' | 'deep';
  /** A parità di livello fa giocare i giovani, i veterani o chi è più forte e basta. */
  trust: 'youth' | 'neutral' | 'veterans';
  /** Riposo: quanto toglie minuti ai giocatori stanchi (le seconde sere dei back-to-back). */
  rest: 'low' | 'normal' | 'high';
  /** Cambia le tattiche per la rosa che ha (e per la stanchezza), o resta fedele alla sua idea. */
  flexible: boolean;
}

export const TRAIT_LABEL = {
  rotation: { short: 'Rotazione corta', normal: 'Rotazione normale', deep: 'Rotazione lunga' },
  trust: {
    youth: 'Fa giocare i giovani',
    neutral: 'Gioca chi è più forte',
    veterans: 'Si fida dei veterani',
  },
  rest: { low: 'Spreme i titolari', normal: 'Riposo quando serve', high: 'Fa riposare chi è stanco' },
  flexible: { true: 'Si adatta alla rosa', false: 'Fedele alla sua idea' },
} as const;

export interface CoachRatings {
  /** In partita: un piccolo vantaggio su tutte le abilità (coachGameEffect). */
  tactics: number;
  /** In offseason: crescita dei giovani più rapida, calo dei veterani più lento. */
  development: number;
  /** Morale: sale di più dopo le vittorie, scende meno dopo le sconfitte. */
  motivation: number;
}

export const COACH_RATING_LABEL: Record<keyof CoachRatings, string> = {
  tactics: 'Tattica',
  development: 'Sviluppo',
  motivation: 'Gestione del gruppo',
};

export interface Coach {
  id: string;
  firstName: string;
  lastName: string;
  nationality: string;
  age: number;
  philosophy: Philosophy;
  traits: CoachTraits;
  ratings: CoachRatings;
}

export interface CoachState extends Coach {
  /** Squadra che allena, null se libero. */
  teamId: string | null;
  /** Stipendio di ogni stagione del contratto, dalla corrente (vuoto se libero). */
  salaries: number[];
  /** Stagione in cui la squadra di adesso lo ha assunto, null se libero. */
  since: number | null;
  /**
   * Insoddisfazione del proprietario: vittorie sotto le attese delle ultime stagioni, la più recente intera e le
   * altre a metà. Negativa = sotto le attese. Riparte da 0 a ogni assunzione.
   */
  pressure: number;
  /** Stagioni di fila senza squadra: dopo COACH_MAX_IDLE smette. */
  idleSeasons: number;
}

/** Stipendi di un allenatore esonerato, ancora a carico della squadra fino alla scadenza (fuori dal cap). */
export interface CoachBuyout {
  teamId: string;
  coachId: string;
  coachName: string;
  salaries: number[];
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export const coachName = (c: Pick<Coach, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`;

// ------------------------------------------------------------------ qualità e stipendio

/** Valutazione complessiva di un allenatore (0-100): metà Tattica, un quarto ciascuna Sviluppo e Gestione del gruppo. */
export function coachRating(c: Pick<Coach, 'ratings'>): number {
  return 0.5 * c.ratings.tactics + 0.25 * c.ratings.development + 0.25 * c.ratings.motivation;
}

/** Stelle di una qualità o della valutazione (da 1 a 5): sotto 35, 35-49, 50-64, 65-79, da 80. */
export function coachStars(value: number): number {
  return value < 35 ? 1 : value < 50 ? 2 : value < 65 ? 3 : value < 80 ? 4 : 5;
}

/**
 * Effetto della Tattica in partita, in quota delle abilità di tutta la squadra: 0,012 ogni 50 punti sopra o sotto
 * 50. Con il motore vero +0,01 vale circa 1,3 punti di overall e 3 vittorie a stagione: tra il migliore (Tattica
 * intorno a 90) e il peggiore (intorno a 25) ci sono circa 5-6 vittorie, come scelto dall'utente.
 */
export const COACH_GAME_EFFECT = 0.012;

export function coachGameEffect(c: Pick<Coach, 'ratings'>): number {
  return (COACH_GAME_EFFECT * (c.ratings.tactics - 50)) / 50;
}

/** Stipendio di un allenatore nel 2026-27: da 2,5 milioni (valutazione 30 o meno) a 14 (90 o più), in linea retta. */
export const COACH_SALARY_MIN = 2_500_000;
export const COACH_SALARY_MAX = 14_000_000;

/** Quota del cap 2026-27: gli stipendi degli allenatori crescono con il cap. */
function salaryScale(c: SeasonConfig): number {
  return c.salaryCap / CONFIG_2026_27.salaryCap;
}

/** Valore di mercato di un allenatore per una stagione. */
export function coachMarketValue(c: SeasonConfig, coach: Pick<Coach, 'ratings'>): number {
  const t = clamp((coachRating(coach) - 30) / 60, 0, 1);
  const value = (COACH_SALARY_MIN + (COACH_SALARY_MAX - COACH_SALARY_MIN) * t) * salaryScale(c);
  return Math.round(value / 10_000) * 10_000;
}

/** Stipendio massimo di un allenatore nella stagione (per i budget dei proprietari). */
export function coachSalaryMax(c: SeasonConfig): number {
  return Math.round((COACH_SALARY_MAX * salaryScale(c)) / 10_000) * 10_000;
}

/** Anni di contratto che un allenatore chiede: 5 i migliori, 2 dopo i 65 anni. */
export function coachYears(coach: Pick<Coach, 'ratings' | 'age'>): number {
  if (coach.age >= 66) return 2;
  const r = coachRating(coach);
  return r >= 70 ? 5 : r >= 55 ? 4 : 3;
}

/** Richiesta di un allenatore: il suo valore di mercato, +3% l'anno, per gli anni che chiede. */
export function coachAsk(c: SeasonConfig, coach: Pick<Coach, 'ratings' | 'age'>): number[] {
  const first = coachMarketValue(c, coach);
  return Array.from({ length: coachYears(coach) }, (_, i) => Math.round(first * 1.03 ** i));
}

// ------------------------------------------------------------------ in campo

const SHORT_ROTATION: readonly number[] = [36, 36, 35, 34, 33, 24, 20, 14, 8];
const DEEP_ROTATION: readonly number[] = [33, 32, 31, 30, 29, 21, 19, 17, 15, 13];

/** Media delle abilità che l'idea di gioco cerca in un giocatore (null per "Equilibrio", che non cerca niente). */
export function philosophyScore(philosophy: Philosophy, p: Pick<Player, 'ratings'>): number | null {
  const skills = PHILOSOPHY_SKILLS[philosophy];
  if (!skills.length) return null;
  let sum = 0;
  for (const k of skills) sum += p.ratings[k];
  return sum / skills.length;
}

/** Punti di overall di bonus per punto delle abilità cercate sopra il riferimento, e i limiti. */
export const PHILOSOPHY_BONUS_PER_POINT = 0.15;
const PHILOSOPHY_BONUS_MIN = -1.5;
const PHILOSOPHY_BONUS_MAX = 2;

/**
 * Bonus di un giocatore per l'idea di gioco: 0,15 punti di overall per punto di media delle abilità che l'allenatore
 * cerca sopra il riferimento (60, o la media dei compagni dello stesso ruolo in lineupStyle), da -1,5 a +2. Uno
 * "Spazi e tiro da tre" fa giocare il centro che tira prima di quello che non tira, a parità di overall, ma non lascia
 * fuori tutti i centri: con un bonus uguale per tutti (prima prova) perdeva 2 punti a partita.
 */
export function philosophyBonus(philosophy: Philosophy, p: Pick<Player, 'ratings'>, reference = 60): number {
  const score = philosophyScore(philosophy, p);
  if (score === null) return 0;
  return clamp(PHILOSOPHY_BONUS_PER_POINT * (score - reference), PHILOSOPHY_BONUS_MIN, PHILOSOPHY_BONUS_MAX);
}

/** Bonus per la fiducia: i giovani fino a 23 anni o i veterani da 29. */
export function trustBonus(trust: CoachTraits['trust'], age: number): number {
  if (trust === 'youth') return age <= 21 ? 2 : age <= 23 ? 1.2 : age >= 31 ? -0.8 : 0;
  if (trust === 'veterans') return age >= 29 ? 1.2 : age <= 22 ? -1.2 : 0;
  return 0;
}

/**
 * Come l'allenatore mette in campo la squadra (per autoSetup). Il bonus per l'idea di gioco confronta ogni giocatore
 * con i compagni dello stesso ruolo principale della rosa data (con meno di 2 nel ruolo, con 60).
 */
export function lineupStyle(
  c: Pick<Coach, 'philosophy' | 'traits'>,
  players: readonly Player[] = [],
): LineupStyle {
  const byRole = new Map<Player['role'], { sum: number; n: number }>();
  for (const p of players) {
    const score = philosophyScore(c.philosophy, p);
    if (score === null) break;
    const x = byRole.get(p.role) ?? { sum: 0, n: 0 };
    x.sum += score;
    x.n++;
    byRole.set(p.role, x);
  }
  const reference = (role: Player['role']) => {
    const x = byRole.get(role);
    return x && x.n >= 2 ? x.sum / x.n : 60;
  };
  return {
    bonus: (p) => philosophyBonus(c.philosophy, p, reference(p.role)) + trustBonus(c.traits.trust, p.age),
    rotation:
      c.traits.rotation === 'short'
        ? SHORT_ROTATION
        : c.traits.rotation === 'deep'
          ? DEEP_ROTATION
          : ROTATION_MINUTES,
    energyWeight: c.traits.rest === 'high' ? 0.35 : c.traits.rest === 'low' ? 0.1 : 0.2,
    restBelow: c.traits.rest === 'high' ? 80 : c.traits.rest === 'normal' ? 70 : 0,
  };
}

const OUTSIDE: readonly RatingKey[] = ['threePoint', 'midRange', 'pullUp'];
const INSIDE: readonly RatingKey[] = ['postControl', 'closeShot', 'standingDunk', 'hook'];

/**
 * Scarto tipico tra tiro da fuori e gioco vicino a canestro dei migliori 8 (con i giocatori veri la mediana delle 30
 * rose è circa 12: le abilità di tiro hanno valori più alti) e quanto una rosa se ne deve allontanare perché un
 * allenatore flessibile sposti il focus: circa un quinto delle rose verso il perimetro e un quarto verso l'area.
 */
export const FLEX_FOCUS_CENTER = 12;
export const FLEX_FOCUS_GAP = 6;
/** Energia media dei migliori 8 sotto cui un allenatore flessibile abbassa ritmo e intensità. */
export const FLEX_TIRED_ENERGY = 80;

/**
 * Tattiche dell'allenatore: quelle della sua idea di gioco. Uno flessibile le adatta alla rosa: il focus verso il
 * tiro da fuori o il gioco interno se i migliori 8 sono molto più forti lì, e con la squadra stanca ritmo e
 * intensità di un gradino più bassi.
 */
export function coachTactics(c: Pick<Coach, 'philosophy' | 'traits'>, players: readonly Player[]): Tactics {
  const t = { ...PHILOSOPHY_TACTICS[c.philosophy] };
  if (!c.traits.flexible) return t;
  const top = players
    .filter((p) => p.injury === null)
    .map((p) => ({ p, o: overall(p) }))
    .sort((a, b) => b.o - a.o)
    .slice(0, 8)
    .map((x) => x.p);
  if (!top.length) return t;
  const avg = (keys: readonly RatingKey[]) =>
    top.reduce((a, p) => a + keys.reduce((s, k) => s + p.ratings[k], 0) / keys.length, 0) / top.length;
  const gap = avg(OUTSIDE) - avg(INSIDE) - FLEX_FOCUS_CENTER;
  if (gap >= FLEX_FOCUS_GAP) t.focus = 'perimeter';
  else if (gap <= -FLEX_FOCUS_GAP) t.focus = 'inside';
  else if (t.focus !== 'balanced' && Math.sign(gap) !== (t.focus === 'perimeter' ? 1 : -1))
    t.focus = 'balanced';
  const energy = top.reduce((a, p) => a + p.energy, 0) / top.length;
  if (energy < FLEX_TIRED_ENERGY) {
    t.pace = t.pace === 'fast' ? 'normal' : t.pace;
    t.intensity = t.intensity === 'high' ? 'medium' : t.intensity === 'medium' ? 'low' : t.intensity;
  }
  return t;
}

/** Impostazioni della partita decise dall'allenatore: quintetto, minuti e tattiche suoi, più l'effetto della Tattica. */
export function coachSetup(teamId: string, players: readonly Player[], coach: Coach): TeamSetup {
  const setup = autoSetup(teamId, players, coachTactics(coach, players), lineupStyle(coach, players));
  setup.coaching = coachGameEffect(coach);
  return setup;
}

/** Morale: quota in più (o in meno) delle variazioni, da -0,3 a +0,3 con la Gestione del gruppo da 0 a 100. */
export function motivationFactor(c: Pick<Coach, 'ratings'> | undefined): number {
  return c ? clamp((c.ratings.motivation - 50) / 50, -1, 1) : 0;
}

/** Sviluppo: da -1 a +1 con la qualità Sviluppo da 0 a 100 (developPlayer). */
export function developmentFactor(c: Pick<Coach, 'ratings'> | undefined): number {
  return c ? clamp((c.ratings.development - 50) / 50, -1, 1) : 0;
}

// ------------------------------------------------------------------ nella lega

export function coachOf(state: Pick<LeagueState, 'coaches'>, teamId: string): CoachState | undefined {
  return state.coaches?.find((c) => c.teamId === teamId);
}

/** Allenatori senza squadra. */
export function freeCoaches(state: Pick<LeagueState, 'coaches'>): CoachState[] {
  return (state.coaches ?? []).filter((c) => c.teamId === null);
}

/** Costo degli allenatori di una squadra in una stagione (0 la corrente): quello di adesso più gli esonerati. */
export function coachCost(
  state: Pick<LeagueState, 'coaches' | 'coachBuyouts'>,
  teamId: string,
  season = 0,
): number {
  let total = coachOf(state, teamId)?.salaries[season] ?? 0;
  for (const b of state.coachBuyouts ?? []) if (b.teamId === teamId) total += b.salaries[season] ?? 0;
  return total;
}

// ------------------------------------------------------------------ generazione

const US_FIRST = [
  'Mike',
  'Steve',
  'Tom',
  'Rick',
  'Erik',
  'Jeff',
  'Frank',
  'Dave',
  'Mark',
  'Chris',
  'Brian',
  'Kevin',
  'Scott',
  'Doug',
  'Larry',
  'Paul',
  'Gary',
  'Tony',
  'Jim',
  'Bill',
  'Dan',
  'Nate',
  'Jason',
  'Byron',
  'Terry',
  'Wes',
  'Kenny',
  'Sam',
  'Joe',
  'Ron',
  'Rob',
  'Phil',
  'Greg',
  'Darren',
  'Keith',
  'Lloyd',
];

/** Quota di allenatori americani; gli altri hanno nomi e nazionalità del generatore dei giocatori. */
const US_SHARE = 0.82;

function coachIdentity(rng: Rng): Pick<Coach, 'firstName' | 'lastName' | 'nationality'> {
  const us = NAME_POOLS[0]!;
  if (rng.chance(US_SHARE))
    return { firstName: rng.pick(US_FIRST), lastName: rng.pick(us.last), nationality: us.nationality };
  const others = NAME_POOLS.slice(1);
  const pool = others[rng.weightedIndex(others.map((p) => p.weight))]!;
  return { firstName: rng.pick(pool.first), lastName: rng.pick(pool.last), nationality: pool.nationality };
}

function pickWeighted<T extends string>(rng: Rng, items: readonly [T, number][]): T {
  return items[rng.weightedIndex(items.map((x) => x[1]))]![0];
}

const rating = (rng: Rng, mean: number, sd: number) => Math.round(clamp(rng.normal(mean, sd), 20, 95));

/**
 * Un allenatore generato. Chi è all'inizio della carriera (rookie) è più giovane e parte un po' più basso: le
 * qualità crescono con gli anni (developCoaches). L'esperienza aiuta la Tattica.
 */
export function generateCoach(rng: Rng, id: string, opts: { rookie?: boolean } = {}): Coach {
  const who = coachIdentity(rng);
  const age = opts.rookie ? rng.int(34, 48) : Math.round(clamp(rng.normal(52, 8), 36, 72));
  const shift = opts.rookie ? -6 : 0;
  return {
    id,
    ...who,
    age,
    philosophy: pickWeighted(rng, [
      ['run', 1],
      ['space', 1.4],
      ['grit', 1],
      ['inside', 0.7],
      ['motion', 1],
      ['balanced', 1.4],
    ]),
    traits: {
      rotation: pickWeighted(rng, [
        ['short', 0.3],
        ['normal', 0.45],
        ['deep', 0.25],
      ]),
      trust: pickWeighted(rng, [
        ['youth', 0.3],
        ['neutral', 0.4],
        ['veterans', 0.3],
      ]),
      rest: pickWeighted(rng, [
        ['low', 0.25],
        ['normal', 0.5],
        ['high', 0.25],
      ]),
      flexible: rng.chance(0.5),
    },
    ratings: {
      tactics: rating(rng, 56 + shift + 0.3 * (age - 50), 14),
      development: rating(rng, 55 + shift, 15),
      motivation: rating(rng, 55 + shift, 15),
    },
  };
}

/** Allenatori liberi da avere sempre a disposizione (oltre ai 30 in panchina). */
export const FREE_COACH_POOL = 12;
/** Stagioni di fila senza squadra dopo cui un allenatore smette. */
export const COACH_MAX_IDLE = 3;

/**
 * Allenatori di una lega nuova: uno per squadra (in ordine sparso) più FREE_COACH_POOL liberi. Ognuno è in
 * panchina da 0 a 3 stagioni, con un contratto da 1 a 5 anni ancora da fare al suo valore di mercato, ±10%.
 */
export function initialCoaches(state: Pick<LeagueState, 'teams' | 'config'>, rng: Rng): CoachState[] {
  const teams = rng.shuffle(state.teams.map((t) => t.id));
  const out: CoachState[] = [];
  for (let i = 0; i < teams.length + FREE_COACH_POOL; i++) {
    const coach = generateCoach(rng, `coach-${i + 1}`);
    const teamId = teams[i] ?? null;
    let salaries: number[] = [];
    if (teamId) {
      const first =
        Math.round((coachMarketValue(state.config, coach) * (0.9 + 0.2 * rng.next())) / 10_000) * 10_000;
      salaries = Array.from({ length: rng.int(1, 5) }, (_, k) => Math.round(first * 1.03 ** k));
    }
    out.push({
      ...coach,
      teamId,
      salaries,
      since: teamId ? state.config.year - rng.int(0, 3) : null,
      pressure: 0,
      idleSeasons: 0,
    });
  }
  return out;
}

// ------------------------------------------------------------------ esoneri e assunzioni

/**
 * Esonera l'allenatore di una squadra: torna libero e il resto del contratto resta a carico della squadra (in
 * stagione la parte che manca, perché si paga partita per partita). Restituisce l'esonerato.
 */
export function fireCoach(state: LeagueState, teamId: string, turn: number | null): CoachState | null {
  const coach = coachOf(state, teamId);
  if (!coach) return null;
  if (coach.salaries.length)
    (state.coachBuyouts ??= []).push({
      teamId,
      coachId: coach.id,
      coachName: coachName(coach),
      salaries: [...coach.salaries],
    });
  coach.teamId = null;
  coach.salaries = [];
  coach.since = null;
  coach.pressure = 0;
  coach.idleSeasons = 0;
  state.transactions.push({
    year: state.config.year,
    turn,
    type: 'coach',
    text: `${teamId} esonera l'allenatore ${coachName(coach)}`,
  });
  return coach;
}

/**
 * Mette un allenatore libero sulla panchina di una squadra senza allenatore, con il contratto dato. Come nella NBA, se
 * un'altra squadra lo stava ancora pagando dopo averlo esonerato, il nuovo stipendio si sconta da quello che gli deve
 * (stagione per stagione, fino a zero).
 */
export function signCoach(
  state: LeagueState,
  teamId: string,
  coach: CoachState,
  salaries: readonly number[],
  turn: number | null,
): void {
  for (const b of state.coachBuyouts ?? [])
    if (b.coachId === coach.id) b.salaries = b.salaries.map((x, i) => Math.max(0, x - (salaries[i] ?? 0)));
  if (state.coachBuyouts)
    state.coachBuyouts = state.coachBuyouts.filter((b) => b.salaries.some((x) => x > 0));
  coach.teamId = teamId;
  coach.salaries = [...salaries];
  coach.since = state.config.year;
  coach.pressure = 0;
  coach.idleSeasons = 0;
  state.transactions.push({
    year: state.config.year,
    turn,
    type: 'coach',
    text: `${teamId} affida la panchina a ${coachName(coach)} (${salaries.length} anni, ${((salaries[0] ?? 0) / 1e6).toFixed(1)} mln)`,
  });
}

export interface CoachCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Si può assumere questo allenatore? Deve essere libero. Con il saldo negativo solo uno che costa al massimo quanto
 * quello di adesso (il resto del contratto dell'esonerato si paga comunque).
 */
export function checkCoachHire(state: LeagueState, teamId: string, coachId: string): CoachCheck {
  const team = state.teams.find((t) => t.id === teamId);
  const coach = state.coaches?.find((c) => c.id === coachId);
  if (!team) return { ok: false, reason: 'squadra sconosciuta' };
  if (!coach) return { ok: false, reason: 'allenatore sconosciuto' };
  if (coach.teamId === teamId) return { ok: false, reason: 'è già il tuo allenatore' };
  if (coach.teamId !== null) return { ok: false, reason: `allena già ${coach.teamId}` };
  const ask = coachAsk(state.config, coach)[0] ?? 0;
  const current = coachOf(state, teamId)?.salaries[0] ?? 0;
  if (team.balance < 0 && ask > current)
    return {
      ok: false,
      reason: 'saldo negativo: puoi prendere solo un allenatore che costa al massimo quanto quello di adesso',
    };
  return { ok: true };
}

/** Cambio di allenatore: esonera quello di adesso (se c'è) e assume il nuovo alla sua richiesta. */
export function replaceCoach(
  state: LeagueState,
  teamId: string,
  coachId: string,
  turn: number | null,
): boolean {
  const coach = state.coaches?.find((c) => c.id === coachId);
  if (!coach || coach.teamId !== null) return false;
  fireCoach(state, teamId, turn);
  signCoach(state, teamId, coach, coachAsk(state.config, coach), turn);
  return true;
}

/** Contratti degli allenatori ed esoneri che scalano di un anno (con i contratti dei giocatori). */
export function scaleCoachContracts(state: LeagueState): void {
  for (const c of state.coaches ?? []) if (c.teamId !== null) c.salaries.shift();
  for (const b of state.coachBuyouts ?? []) b.salaries.shift();
  if (state.coachBuyouts) state.coachBuyouts = state.coachBuyouts.filter((b) => b.salaries.length > 0);
}

/**
 * Un anno in più per tutti gli allenatori: chi è giovane migliora un po', dopo i 63 anni cala; dopo i 70 si ritira
 * con probabilità crescente, chi è senza squadra da COACH_MAX_IDLE stagioni smette. Restituisce i ritirati (le
 * loro squadre restano senza allenatore: ne prendono un altro subito dopo).
 */
export function ageCoaches(state: LeagueState, rng: Rng): CoachState[] {
  const retired: CoachState[] = [];
  for (const c of state.coaches ?? []) {
    c.age++;
    const drift = c.age < 45 ? 1.5 : c.age < 63 ? 0.3 : -1.5;
    for (const k of ['tactics', 'development', 'motivation'] as const)
      c.ratings[k] = Math.round(clamp(c.ratings[k] + drift + rng.normal(0, 1.5), 20, 95));
    if (c.teamId === null) c.idleSeasons++;
    const retire =
      c.age >= 76 ||
      (c.age >= 70 && rng.chance(0.15 + 0.1 * (c.age - 70))) ||
      (c.teamId === null && c.idleSeasons >= COACH_MAX_IDLE);
    if (retire) retired.push(c);
  }
  const gone = new Set(retired);
  for (const c of retired)
    if (c.teamId !== null)
      state.transactions.push({
        year: state.config.year,
        turn: null,
        type: 'coach',
        text: `${coachName(c)} lascia la panchina di ${c.teamId} e si ritira`,
      });
  state.coaches = (state.coaches ?? []).filter((c) => !gone.has(c));
  return retired;
}

/** Nuovi allenatori (assistenti che diventano capo allenatori) finché i liberi non tornano a FREE_COACH_POOL. */
export function refillCoachPool(state: LeagueState, rng: Rng, year: number): void {
  let n = 0;
  while (freeCoaches(state).length < FREE_COACH_POOL) {
    const coach = generateCoach(rng, `coach-${year}-${++n}`, { rookie: true });
    (state.coaches ??= []).push({
      ...coach,
      teamId: null,
      salaries: [],
      since: null,
      pressure: 0,
      idleSeasons: 0,
    });
  }
}

/** Quanto un'idea di gioco va d'accordo con una rosa: il bonus medio dei migliori 8 rispetto a 60 (da -1,5 a +2). */
export function philosophyFit(philosophy: Philosophy, players: readonly Player[]): number {
  const top = players
    .map((p) => ({ p, o: overall(p) }))
    .sort((a, b) => b.o - a.o)
    .slice(0, 8);
  if (!top.length) return 0;
  return top.reduce((a, x) => a + philosophyBonus(philosophy, x.p), 0) / top.length;
}
