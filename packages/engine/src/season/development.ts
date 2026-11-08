import { RATING_KEYS, type RatingKey } from '../fields.ts';
import { overall } from '../overall.ts';
import type { Rng } from '../rng.ts';
import type { Player, Ratings } from '../types.ts';

const PHYSICAL = new Set<RatingKey>([
  'speed',
  'agility',
  'vertical',
  'stamina',
  'speedWithBall',
  'drivingDunk',
]);
const MENTAL = new Set<RatingKey>(['offensiveIQ', 'defensiveIQ', 'clutch', 'leadership', 'passVision']);

/** Variazione media dell'overall in un anno, per età. */
export function ageCurve(age: number): number {
  if (age <= 20) return 4;
  // Calibrata con pnpm sim:seasons: l'overall medio dei migliori resta stabile negli anni
  const table: Record<number, number> = {
    21: 3.4,
    22: 2.8,
    23: 2.2,
    24: 1.6,
    25: 1,
    26: 0.5,
    27: 0,
    28: -0.4,
    29: -0.8,
    30: -1.3,
    31: -1.9,
    32: -2.6,
    33: -3.3,
    34: -4,
  };
  return table[age] ?? -5;
}

/**
 * Riporta il potenziale del file dati sulla scala dell'overall. Tra i 28 e i 33 anni un giocatore è al suo
 * massimo, quindi potenziale e overall coincidono: da quei giocatori si ricava la retta che converte il
 * potenziale del file; per tutti il potenziale non può essere sotto l'overall attuale.
 */
export function calibratePotential(players: Player[], shrink = 1): { a: number; b: number } {
  const peak = players.filter((p) => p.age >= 28 && p.age <= 33);
  const xs = peak.map((p) => p.hidden.potential);
  const ys = peak.map((p) => overall(p));
  const mx = xs.reduce((s, x) => s + x, 0) / xs.length;
  const my = ys.reduce((s, y) => s + y, 0) / ys.length;
  const sxx = xs.reduce((s, x) => s + (x - mx) ** 2, 0);
  const b = sxx ? xs.reduce((s, x, i) => s + (x - mx) * ((ys[i] as number) - my), 0) / sxx : 1;
  const a = my - b * mx;
  // shrink < 1 riduce il margine di crescita: il potenziale è un tetto che pochi raggiungono davvero
  for (const p of players) {
    const ovr = overall(p);
    p.hidden.potential = Math.round(
      Math.min(99, ovr + Math.max(0, a + b * p.hidden.potential - ovr) * shrink),
    );
  }
  return { a, b };
}

/** Punti di overall in più in un anno di crescita con il miglior Sviluppo dell'allenatore (fino a 25 anni). */
export const COACH_GROWTH = 0.6;
/** Quota del calo risparmiata con il miglior Sviluppo dell'allenatore. */
export const COACH_DECLINE_SHARE = 0.12;

/**
 * Un anno di crescita o di calo. Fino a 27 anni si cresce (più in fretta da giovani e con Etica del lavoro
 * alta, senza superare il potenziale), dopo i 30 si cala, di più negli attributi fisici. coach è lo Sviluppo
 * dell'allenatore della squadra, da -1 a +1 (developmentFactor): fa crescere più in fretta, a metà dopo i 25 anni, e
 * rallenta il calo. Restituisce l'overall prima e dopo.
 */
export function developPlayer(p: Player, rng: Rng, coach = 0): { before: number; after: number } {
  const before = overall(p);
  const ethic = (p.hidden.workEthic - 75) / 25;
  let target = ageCurve(p.age) + rng.normal(0, 1.8);
  if (target > 0) {
    target += ethic * 1.2;
    if (coach) target += coach * COACH_GROWTH * (p.age <= 25 ? 1 : 0.5);
    target = Math.min(target, Math.max(0, p.hidden.potential - before + rng.normal(0, 1)));
  } else {
    target *= 1 - 0.3 * ethic;
    if (coach) target *= 1 - COACH_DECLINE_SHARE * coach;
  }
  if (Math.abs(target) < 0.05) return { before, after: before };
  const growing = target > 0;
  const direction = {} as Ratings;
  for (const k of RATING_KEYS) {
    const w = growing
      ? PHYSICAL.has(k)
        ? 0.6
        : MENTAL.has(k)
          ? 1.2
          : 1
      : PHYSICAL.has(k)
        ? 1.6
        : MENTAL.has(k)
          ? -0.4
          : 0.9;
    direction[k] = Math.sign(target) * w + rng.normal(0, 0.6);
  }
  const apply = (scale: number) => {
    const r = {} as Ratings;
    for (const k of RATING_KEYS) r[k] = Math.max(15, Math.min(99, p.ratings[k] + direction[k] * scale));
    return r;
  };
  const unit = overall({ role: p.role, ratings: apply(1) }) - before;
  const scale = unit !== 0 ? target / unit : 0;
  const next = apply(Math.max(0, scale));
  for (const k of RATING_KEYS) p.ratings[k] = Math.round(next[k]);
  return { before, after: overall(p) };
}

/**
 * Campi che non entrano nell'overall e regolano altro (energia, finali, morale): la normalizzazione non li
 * tocca, altrimenti col passare delle stagioni cambierebbero energia e carattere della lega.
 */
const UNNORMALIZED = new Set<RatingKey>(['stamina', 'hustle', 'clutch', 'leadership']);

/** Media dell'overall dei migliori 150: il livello della lega che resta costante negli anni. */
export function talentLevel(players: readonly Player[]): number {
  const top = players
    .map((p) => overall(p))
    .sort((a, b) => b - a)
    .slice(0, 150);
  return top.reduce((a, b) => a + b, 0) / Math.max(1, top.length);
}

/**
 * Riporta il livello della lega a quello di riferimento spostando di poco tutte le abilità allo stesso modo
 * (e potenziali e stime con loro): l'ordine tra i giocatori non cambia, ma gli overall non si gonfiano né si
 * sgonfiano con il passare delle stagioni. Restituisce lo spostamento applicato all'overall.
 */
export function normalizeTalent(
  players: Array<Player & { scoutedPotential?: number }>,
  reference: number,
): number {
  const delta = talentLevel(players) - reference;
  if (Math.abs(delta) < 0.05) return 0;
  for (const p of players) {
    // Un punto di overall vale circa sd/9 punti di abilità (vedi OVERALL_SCALE)
    const step = (delta * 5.2) / 9;
    for (const k of RATING_KEYS) {
      if (UNNORMALIZED.has(k)) continue;
      p.ratings[k] = Math.max(15, Math.min(99, Math.round(p.ratings[k] - step)));
    }
    p.hidden.potential = Math.max(overall(p), Math.min(99, Math.round(p.hidden.potential - delta)));
    if (p.scoutedPotential !== undefined)
      p.scoutedPotential = Math.max(overall(p), Math.min(99, Math.round(p.scoutedPotential - delta)));
  }
  return delta;
}

/** Probabilità di ritiro a fine stagione. */
export function retirementChance(p: Pick<Player, 'age' | 'ratings' | 'role'>, hasContract: boolean): number {
  if (p.age >= 40) return 1;
  const ovr = overall(p);
  let chance = p.age >= 35 ? 0.25 + 0.15 * (p.age - 35) : p.age >= 33 ? 0.08 : 0;
  if (!hasContract && ovr < 52 && p.age >= 29) chance += 0.35;
  if (!hasContract && p.age >= 33) chance += 0.15;
  return Math.min(1, hasContract ? chance * 0.4 : chance);
}
