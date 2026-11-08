// Scala delle abilità all'import. Il motore (probabilità di canestro, energia, rimbalzi, stoppate) e l'economia
// (overall per ruolo con `OVERALL_SCALE`, valore di mercato dall'overall) sono calibrati sul file v2 del 4 novembre
// 2026. Dalla revisione NBA 2K27 (file v4) le abilità arrivano sulla scala di 2K: più alta, con dispersioni diverse
// campo per campo e campi meno legati tra loro (in 2K un giocatore forte non è forte in tutto). Importarle così
// com'erano avrebbe spostato partite e overall anche nelle leghe già in corso, che hanno i giocatori copiati con la
// scala del v2 e leggono le stesse costanti del motore. Due passi:
// 1. ruolo per ruolo (il ruolo principale del file), ogni campo si riporta con una retta alla media e alla
//    dispersione dei giocatori dello stesso ruolo nel v2: 2K decide l'ordine e le distanze nel ruolo;
// 2. l'overall prende la distribuzione del v2: ogni giocatore tiene il suo posto nella classifica dell'overall
//    (distanza dalla media del ruolo, tutti i ruoli insieme) e prende la distanza che aveva quel posto nel v2. La
//    differenza si aggiunge, uguale, a tutte le abilità del passo 1: è il talento generale che nel v2 legava tra
//    loro i campi. Senza questo passo l'overall si stringeva (9 giocatori sopra 80 invece di 28). Con solo media e
//    dispersione del v2 restavano più giocatori tra 63 e 75 e meno riserve basse: le rose valevano il 6% in più e
//    nelle simulazioni di 10 stagioni c'erano più squadre in rosso. Con la differenza solo sulle abilità che pesano
//    nell'overall, l'overall cresceva più della forza in campo: con +5 di overall si vinceva il 63% delle partite
//    invece del 65-70%.
// Le misure del file si fanno sui giocatori nelle rose; svincolati e giocatori fuori dalla NBA seguono le stesse
// trasformazioni. Sul file v2 i due passi non cambiano quasi nulla.
import {
  OVERALL_SCALE,
  overallRaw,
  ROLES,
  type HiddenKey,
  type Player,
  type RatingKey,
  type Role,
} from '@nbbgm/engine';

interface Scale {
  mean: number;
  sd: number;
}

/**
 * Media e dispersione per ruolo principale dei 525 giocatori nelle rose del file v2. Sono i campi che la revisione
 * 2K27 prende da 2K (o ricava da 2K): restano fuori Freddezza, Leadership, tendenze e gli altri valori nascosti,
 * scelte editoriali che la revisione non tocca.
 */
export const REFERENCE_SCALE = {
  PG: {
    ratings: {
      closeShot: { mean: 60.44, sd: 5.99 },
      layup: { mean: 75.55, sd: 6.95 },
      drivingDunk: { mean: 46.97, sd: 7.36 },
      standingDunk: { mean: 23.12, sd: 6.04 },
      postControl: { mean: 26.16, sd: 6.62 },
      hook: { mean: 23.6, sd: 5.91 },
      postFade: { mean: 25.74, sd: 6.77 },
      drawFoul: { mean: 62.92, sd: 8 },
      midRange: { mean: 69.49, sd: 6.97 },
      threePoint: { mean: 73.48, sd: 7.84 },
      pullUp: { mean: 73.57, sd: 7.39 },
      freeThrow: { mean: 78.66, sd: 7.73 },
      ballHandle: { mean: 78.12, sd: 7.51 },
      speedWithBall: { mean: 77.92, sd: 7 },
      passAccuracy: { mean: 79.21, sd: 7.92 },
      passVision: { mean: 76.93, sd: 8.03 },
      hands: { mean: 74.91, sd: 5.84 },
      perimeterDefense: { mean: 64.1, sd: 6.59 },
      interiorDefense: { mean: 35.62, sd: 5.32 },
      steal: { mean: 67.46, sd: 4.8 },
      block: { mean: 25.57, sd: 4.44 },
      helpDefense: { mean: 57.62, sd: 5.02 },
      passLaneReading: { mean: 65.3, sd: 5.48 },
      offensiveRebound: { mean: 25.6, sd: 4.99 },
      defensiveRebound: { mean: 45.35, sd: 6.43 },
      speed: { mean: 80.07, sd: 7.13 },
      agility: { mean: 81.75, sd: 6.21 },
      strength: { mean: 47.34, sd: 7.44 },
      vertical: { mean: 72.57, sd: 6.03 },
      stamina: { mean: 76.6, sd: 6.64 },
      hustle: { mean: 72.8, sd: 7.53 },
      offensiveIQ: { mean: 75.4, sd: 8.09 },
      defensiveIQ: { mean: 62.21, sd: 6.41 },
    },
    hidden: {
      offensiveConsistency: { mean: 67.56, sd: 8.74 },
      defensiveConsistency: { mean: 63.76, sd: 4.08 },
    },
  },
  SG: {
    ratings: {
      closeShot: { mean: 63.64, sd: 4.87 },
      layup: { mean: 71.86, sd: 7.97 },
      drivingDunk: { mean: 60.05, sd: 7.26 },
      standingDunk: { mean: 24.24, sd: 4.37 },
      postControl: { mean: 29.42, sd: 5.27 },
      hook: { mean: 23.09, sd: 3.95 },
      postFade: { mean: 28.2, sd: 5.38 },
      drawFoul: { mean: 62.22, sd: 6.62 },
      midRange: { mean: 69.99, sd: 4.24 },
      threePoint: { mean: 73.74, sd: 6.77 },
      pullUp: { mean: 74.09, sd: 7.71 },
      freeThrow: { mean: 76.28, sd: 7.57 },
      ballHandle: { mean: 69.5, sd: 6.21 },
      speedWithBall: { mean: 73.26, sd: 5.43 },
      passAccuracy: { mean: 67.45, sd: 6.03 },
      passVision: { mean: 65.18, sd: 7.81 },
      hands: { mean: 73, sd: 4.26 },
      perimeterDefense: { mean: 66.63, sd: 6.25 },
      interiorDefense: { mean: 41.93, sd: 4.35 },
      steal: { mean: 64.93, sd: 3.5 },
      block: { mean: 33.45, sd: 3.82 },
      helpDefense: { mean: 55.74, sd: 5.02 },
      passLaneReading: { mean: 64.5, sd: 5.37 },
      offensiveRebound: { mean: 29.93, sd: 4.02 },
      defensiveRebound: { mean: 46.58, sd: 4.33 },
      speed: { mean: 78.73, sd: 5.17 },
      agility: { mean: 76.51, sd: 5.48 },
      strength: { mean: 54.27, sd: 5.57 },
      vertical: { mean: 75.43, sd: 5.28 },
      stamina: { mean: 74.24, sd: 4.71 },
      hustle: { mean: 72.32, sd: 5.05 },
      offensiveIQ: { mean: 68.92, sd: 7.7 },
      defensiveIQ: { mean: 65.55, sd: 6.79 },
    },
    hidden: {
      offensiveConsistency: { mean: 62.57, sd: 4.92 },
      defensiveConsistency: { mean: 65.12, sd: 4.99 },
    },
  },
  SF: {
    ratings: {
      closeShot: { mean: 68.87, sd: 5.87 },
      layup: { mean: 69.09, sd: 7.77 },
      drivingDunk: { mean: 68.98, sd: 7.6 },
      standingDunk: { mean: 38.47, sd: 5.89 },
      postControl: { mean: 44.25, sd: 8.06 },
      hook: { mean: 33.95, sd: 7.96 },
      postFade: { mean: 37.32, sd: 6.89 },
      drawFoul: { mean: 63.16, sd: 7 },
      midRange: { mean: 66.94, sd: 5.92 },
      threePoint: { mean: 69.48, sd: 6.93 },
      pullUp: { mean: 63.52, sd: 6.91 },
      freeThrow: { mean: 71.15, sd: 6.7 },
      ballHandle: { mean: 66.92, sd: 5.92 },
      speedWithBall: { mean: 67.98, sd: 5.34 },
      passAccuracy: { mean: 67.26, sd: 6.78 },
      passVision: { mean: 63.12, sd: 7.43 },
      hands: { mean: 73.56, sd: 4.94 },
      perimeterDefense: { mean: 69.21, sd: 4.78 },
      interiorDefense: { mean: 61.35, sd: 4.27 },
      steal: { mean: 67.24, sd: 3.53 },
      block: { mean: 51.23, sd: 3.98 },
      helpDefense: { mean: 63.94, sd: 5.77 },
      passLaneReading: { mean: 65.82, sd: 5.15 },
      offensiveRebound: { mean: 45.42, sd: 4.33 },
      defensiveRebound: { mean: 63.37, sd: 4.67 },
      speed: { mean: 72.85, sd: 5.55 },
      agility: { mean: 74, sd: 5.86 },
      strength: { mean: 68.39, sd: 5.68 },
      vertical: { mean: 76.06, sd: 5.17 },
      stamina: { mean: 75.76, sd: 5.2 },
      hustle: { mean: 74.89, sd: 5.81 },
      offensiveIQ: { mean: 69.49, sd: 6.82 },
      defensiveIQ: { mean: 68.82, sd: 6.32 },
    },
    hidden: {
      offensiveConsistency: { mean: 63.31, sd: 5.76 },
      defensiveConsistency: { mean: 68.84, sd: 4.03 },
    },
  },
  PF: {
    ratings: {
      closeShot: { mean: 74.35, sd: 6.71 },
      layup: { mean: 66.87, sd: 7.2 },
      drivingDunk: { mean: 76.94, sd: 6.51 },
      standingDunk: { mean: 62.41, sd: 6.73 },
      postControl: { mean: 63.91, sd: 7.18 },
      hook: { mean: 52.64, sd: 6.84 },
      postFade: { mean: 52.71, sd: 7.96 },
      drawFoul: { mean: 64.99, sd: 7.15 },
      midRange: { mean: 61.54, sd: 5.67 },
      threePoint: { mean: 55.56, sd: 6.68 },
      pullUp: { mean: 53.67, sd: 6.65 },
      freeThrow: { mean: 65.38, sd: 5.77 },
      ballHandle: { mean: 53.45, sd: 8.01 },
      speedWithBall: { mean: 60.64, sd: 6.64 },
      passAccuracy: { mean: 62.87, sd: 6.29 },
      passVision: { mean: 58.97, sd: 7.56 },
      hands: { mean: 70.44, sd: 5.16 },
      perimeterDefense: { mean: 59.28, sd: 5.47 },
      interiorDefense: { mean: 74.79, sd: 6.17 },
      steal: { mean: 55.41, sd: 4.68 },
      block: { mean: 71.08, sd: 5.22 },
      helpDefense: { mean: 67.26, sd: 5.58 },
      passLaneReading: { mean: 59.69, sd: 5.85 },
      offensiveRebound: { mean: 63.69, sd: 4.26 },
      defensiveRebound: { mean: 71.54, sd: 5.68 },
      speed: { mean: 66.26, sd: 6.71 },
      agility: { mean: 67.67, sd: 7.29 },
      strength: { mean: 77.4, sd: 6.27 },
      vertical: { mean: 76.73, sd: 5.83 },
      stamina: { mean: 73.08, sd: 5.96 },
      hustle: { mean: 76.26, sd: 6.5 },
      offensiveIQ: { mean: 72.04, sd: 7.32 },
      defensiveIQ: { mean: 67.32, sd: 7.43 },
    },
    hidden: {
      offensiveConsistency: { mean: 65.83, sd: 6.36 },
      defensiveConsistency: { mean: 70.42, sd: 4.25 },
    },
  },
  C: {
    ratings: {
      closeShot: { mean: 79.48, sd: 7.81 },
      layup: { mean: 61.53, sd: 7.61 },
      drivingDunk: { mean: 68.5, sd: 7.95 },
      standingDunk: { mean: 81.77, sd: 6.85 },
      postControl: { mean: 72.77, sd: 7.99 },
      hook: { mean: 65.09, sd: 7.79 },
      postFade: { mean: 55.28, sd: 7.93 },
      drawFoul: { mean: 64.79, sd: 7.25 },
      midRange: { mean: 52.76, sd: 7.41 },
      threePoint: { mean: 43.48, sd: 8.04 },
      pullUp: { mean: 43.23, sd: 7.94 },
      freeThrow: { mean: 59.56, sd: 5.88 },
      ballHandle: { mean: 40.64, sd: 8.07 },
      speedWithBall: { mean: 46, sd: 7.51 },
      passAccuracy: { mean: 66.21, sd: 7.47 },
      passVision: { mean: 54.42, sd: 7.96 },
      hands: { mean: 75, sd: 5.56 },
      perimeterDefense: { mean: 45.02, sd: 6.03 },
      interiorDefense: { mean: 81.23, sd: 7.44 },
      steal: { mean: 44.35, sd: 5.38 },
      block: { mean: 81.56, sd: 7.85 },
      helpDefense: { mean: 75.05, sd: 6.92 },
      passLaneReading: { mean: 55.23, sd: 7.34 },
      offensiveRebound: { mean: 42.53, sd: 5.21 },
      defensiveRebound: { mean: 79.35, sd: 7.42 },
      speed: { mean: 50.51, sd: 7.09 },
      agility: { mean: 51.72, sd: 8 },
      strength: { mean: 86.6, sd: 6.01 },
      vertical: { mean: 67.53, sd: 6.59 },
      stamina: { mean: 71.56, sd: 7.14 },
      hustle: { mean: 77.93, sd: 6.67 },
      offensiveIQ: { mean: 72.51, sd: 7.52 },
      defensiveIQ: { mean: 69.86, sd: 7.92 },
    },
    hidden: {
      offensiveConsistency: { mean: 67.4, sd: 7.51 },
      defensiveConsistency: { mean: 74.72, sd: 5.33 },
    },
  },
} satisfies Record<
  Role,
  { ratings: Partial<Record<RatingKey, Scale>>; hidden: Partial<Record<HiddenKey, Scale>> }
>;

/**
 * Distribuzione dell'overall nel v2, tutti i ruoli insieme: per i 525 giocatori nelle rose la distanza dalla media
 * del ruolo in dispersioni, `(overall grezzo − media) / dispersione` di `OVERALL_SCALE` (l'overall mostrato è
 * 62 + 9 × distanza). Coppie [quota dei giocatori, distanza], più fitte in cima dove stanno le stelle: il v2 ha
 * molte riserve vicine tra loro (nessuna sotto −1,39) e poche stelle molto staccate (fino a +4,59).
 */
export const V2_OVERALL_QUANTILES: readonly (readonly [number, number])[] = [
  [0, -1.388],
  [0.025, -1.112],
  [0.05, -1.059],
  [0.075, -1.017],
  [0.1, -0.973],
  [0.125, -0.934],
  [0.15, -0.888],
  [0.175, -0.857],
  [0.2, -0.82],
  [0.225, -0.796],
  [0.25, -0.75],
  [0.275, -0.715],
  [0.3, -0.686],
  [0.325, -0.63],
  [0.35, -0.57],
  [0.375, -0.538],
  [0.4, -0.486],
  [0.425, -0.432],
  [0.45, -0.374],
  [0.475, -0.315],
  [0.5, -0.262],
  [0.525, -0.21],
  [0.55, -0.148],
  [0.575, -0.108],
  [0.6, -0.052],
  [0.625, -0.009],
  [0.65, 0.056],
  [0.675, 0.159],
  [0.7, 0.272],
  [0.725, 0.366],
  [0.75, 0.469],
  [0.775, 0.554],
  [0.8, 0.653],
  [0.825, 0.758],
  [0.85, 1.049],
  [0.875, 1.279],
  [0.9, 1.516],
  [0.925, 1.701],
  [0.95, 2.031],
  [0.975, 2.642],
  [0.98, 2.782],
  [0.985, 2.885],
  [0.99, 3.175],
  [0.995, 3.508],
  [1, 4.592],
];

/** Distanza dalla media al quantile u (0-1) del v2, per interpolazione. */
function v2Quantile(u: number): number {
  const q = V2_OVERALL_QUANTILES;
  if (u <= q[0]![0]) return q[0]![1];
  for (let i = 1; i < q.length; i++) {
    const [u1, z1] = q[i]!;
    if (u <= u1) {
      const [u0, z0] = q[i - 1]!;
      return z0 + ((z1 - z0) * (u - u0)) / (u1 - u0);
    }
  }
  return q[q.length - 1]![1];
}

type ScaledRating = keyof (typeof REFERENCE_SCALE)['PG']['ratings'];
type ScaledHidden = keyof (typeof REFERENCE_SCALE)['PG']['hidden'];
const SCALED_RATINGS = Object.keys(REFERENCE_SCALE.PG.ratings) as ScaledRating[];
const SCALED_HIDDEN = Object.keys(REFERENCE_SCALE.PG.hidden) as ScaledHidden[];

function scaleOf(values: readonly number[]): Scale {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
  return { mean, sd };
}

const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
/** Retta che porta la scala `from` sulla scala `to`. */
const line = (from: Scale, to: Scale) => (x: number) => to.mean + (to.sd * (x - from.mean)) / (from.sd || 1);

export interface ScaleChange {
  role: Role;
  /** Overall grezzo dei giocatori nelle rose del ruolo: nel file, dopo il primo passo, alla fine. */
  overall: { file: Scale; fields: Scale; final: Scale };
  /** Quanto si è aggiunto alle abilità nel passo 2, dal giocatore più basso al più alto. */
  shift: { min: number; max: number };
}

type Scalable = Pick<Player, 'ratings' | 'hidden' | 'role'> & { teamId: string | null };

/**
 * Funzione crescente che porta le distanze dalla media del file su quelle del v2: i giocatori nelle rose in ordine,
 * ognuno al quantile del suo posto; fuori dai loro estremi si continua con pendenza 1.
 */
function rankMap(rosteredZ: readonly number[]): (z: number) => number {
  const sorted = [...rosteredZ].sort((a, b) => a - b);
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < sorted.length;) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[i]) j++;
    // pari merito: la media dei quantili dei loro posti
    let sum = 0;
    for (let k = i; k <= j; k++) sum += v2Quantile((k + 0.5) / sorted.length);
    xs.push(sorted[i]!);
    ys.push(sum / (j - i + 1));
    i = j + 1;
  }
  const last = xs.length - 1;
  return (z) => {
    if (z <= xs[0]!) return ys[0]! + (z - xs[0]!);
    if (z >= xs[last]!) return ys[last]! + (z - xs[last]!);
    let lo = 0;
    let hi = last;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid]! <= z) lo = mid;
      else hi = mid;
    }
    return ys[lo]! + ((ys[hi]! - ys[lo]!) * (z - xs[lo]!)) / (xs[hi]! - xs[lo]!);
  };
}

/**
 * Riporta i campi di REFERENCE_SCALE e l'overall alla scala del v2, valori interi da 0 a 100 (vedi in cima al file).
 * Un ruolo con meno di 2 giocatori nelle rose resta com'è.
 */
export function toReferenceScale<P extends Scalable>(
  players: readonly P[],
): { players: P[]; changes: ScaleChange[] } {
  const out = players.map((p) => ({ ...p, ratings: { ...p.ratings }, hidden: { ...p.hidden } }));
  const inRole = (role: Role, rosteredOnly: boolean) =>
    out.filter((p) => p.role === role && (!rosteredOnly || p.teamId !== null));
  const roles = ROLES.filter((r) => inRole(r, true).length >= 2);
  const rawScale = (role: Role) => scaleOf(inRole(role, true).map((p) => overallRaw(p.ratings, role)));
  const before = new Map(roles.map((r) => [r, rawScale(r)]));

  // 1. campo per campo, ruolo per ruolo
  for (const role of roles) {
    const all = inRole(role, false);
    const rostered = inRole(role, true);
    const ref = REFERENCE_SCALE[role];
    for (const k of SCALED_RATINGS) {
      const f = line(scaleOf(rostered.map((p) => p.ratings[k])), ref.ratings[k]);
      for (const p of all) p.ratings[k] = f(p.ratings[k]);
    }
    for (const k of SCALED_HIDDEN) {
      const f = line(scaleOf(rostered.map((p) => p.hidden[k])), ref.hidden[k]);
      for (const p of all) p.hidden[k] = clamp(f(p.hidden[k]));
    }
  }

  // 2. distribuzione dell'overall del v2
  const fields = new Map(roles.map((r) => [r, rawScale(r)]));
  const z = new Map<(typeof out)[number], number>();
  for (const p of out) {
    const scale = fields.get(p.role);
    if (scale) z.set(p, (overallRaw(p.ratings, p.role) - scale.mean) / (scale.sd || 1));
  }
  const toV2 = rankMap(out.filter((p) => p.teamId !== null && z.has(p)).map((p) => z.get(p)!));
  const shifts = new Map<Role, number[]>(roles.map((r) => [r, []]));
  for (const [p, zp] of z) {
    const { mean, sd } = OVERALL_SCALE[p.role];
    const shift = mean + sd * toV2(zp) - overallRaw(p.ratings, p.role);
    shifts.get(p.role)!.push(shift);
    // I pesi dell'overall stanno tutti tra queste abilità: l'overall grezzo sale della stessa quantità
    for (const k of SCALED_RATINGS) p.ratings[k] += shift;
  }
  for (const p of out) for (const k of SCALED_RATINGS) p.ratings[k] = clamp(p.ratings[k]);

  const changes = roles.map((role) => {
    const list = shifts.get(role)!;
    return {
      role,
      overall: { file: before.get(role)!, fields: fields.get(role)!, final: rawScale(role) },
      shift: { min: Math.min(...list), max: Math.max(...list) },
    };
  });
  return { players: out as P[], changes };
}
