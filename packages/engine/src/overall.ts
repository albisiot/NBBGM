import type { RatingKey } from './fields.ts';
import type { Player, Ratings, Role } from './types.ts';

// Pesi dell'overall per ruolo: contano le abilità che servono davvero in quel ruolo.
const WEIGHTS: Record<Role, Partial<Record<RatingKey, number>>> = {
  PG: {
    ballHandle: 3,
    passAccuracy: 3,
    passVision: 3,
    pullUp: 2,
    threePoint: 2,
    speedWithBall: 2,
    offensiveIQ: 2,
    layup: 1.5,
    perimeterDefense: 1.5,
    midRange: 1,
    freeThrow: 1,
    steal: 1,
    speed: 1,
    agility: 1,
    hands: 1,
    drawFoul: 1,
    defensiveIQ: 1,
    closeShot: 0.5,
  },
  SG: {
    threePoint: 3,
    pullUp: 2.5,
    midRange: 2,
    ballHandle: 2,
    perimeterDefense: 2,
    offensiveIQ: 2,
    layup: 1.5,
    drawFoul: 1,
    freeThrow: 1,
    passAccuracy: 1,
    passVision: 1,
    steal: 1,
    speed: 1,
    agility: 1,
    defensiveIQ: 1,
    speedWithBall: 1,
    hands: 0.5,
  },
  SF: {
    threePoint: 2,
    perimeterDefense: 2,
    offensiveIQ: 2,
    midRange: 1.5,
    layup: 1.5,
    defensiveIQ: 1.5,
    drivingDunk: 1,
    pullUp: 1,
    interiorDefense: 1,
    helpDefense: 1,
    defensiveRebound: 1,
    ballHandle: 1,
    passAccuracy: 1,
    vertical: 1,
    strength: 1,
    steal: 1,
    closeShot: 1,
    drawFoul: 1,
  },
  PF: {
    closeShot: 2,
    interiorDefense: 2,
    defensiveRebound: 2,
    block: 1.5,
    helpDefense: 1.5,
    strength: 1.5,
    offensiveIQ: 1.5,
    defensiveIQ: 1.5,
    layup: 1,
    standingDunk: 1,
    postControl: 1,
    hook: 1,
    midRange: 1,
    threePoint: 1,
    offensiveRebound: 1,
    vertical: 1,
    perimeterDefense: 1,
    drawFoul: 1,
  },
  C: {
    interiorDefense: 3,
    closeShot: 2.5,
    block: 2.5,
    defensiveRebound: 2.5,
    strength: 2,
    standingDunk: 1.5,
    postControl: 1.5,
    helpDefense: 1.5,
    offensiveRebound: 1.5,
    defensiveIQ: 1.5,
    hook: 1,
    vertical: 1,
    offensiveIQ: 1,
    hands: 1,
    drawFoul: 1,
    layup: 0.5,
    passVision: 0.5,
  },
};

/** Media pesata delle abilità per il ruolo, sulla scala grezza 0-100. */
export function overallRaw(ratings: Ratings, role: Role): number {
  let sum = 0;
  let weight = 0;
  for (const [key, w] of Object.entries(WEIGHTS[role]) as [RatingKey, number][]) {
    sum += ratings[key] * w;
    weight += w;
  }
  return sum / weight;
}

/**
 * Riporta la media grezza su una scala con poche stelle (80+), un nucleo di titolari (65-79) e molte
 * riserve. Media e dispersione di ogni ruolo vengono dal file dei giocatori reali (pnpm data:import le
 * ricalcola e le stampa nel report): così un centro e un playmaker dello stesso livello hanno lo stesso overall.
 */
export const OVERALL_SCALE: Record<Role, { mean: number; sd: number }> = {
  PG: { mean: 74.4, sd: 5.9 },
  SG: { mean: 70.7, sd: 4.4 },
  SF: { mean: 67.6, sd: 4.5 },
  PF: { mean: 68.2, sd: 4.9 },
  C: { mean: 74.4, sd: 5.4 },
};

/** Overall mostrato: 62 è il giocatore medio, ogni deviazione standard vale 9 punti. */
export function overall(player: Pick<Player, 'ratings' | 'role'>): number {
  const { mean, sd } = OVERALL_SCALE[player.role];
  const z = (overallRaw(player.ratings, player.role) - mean) / sd;
  return Math.max(25, Math.min(99, Math.round(62 + 9 * z)));
}
