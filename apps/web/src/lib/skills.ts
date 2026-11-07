// Gruppi di abilità per i bisogni della squadra e per ordinare gli svincolati: ognuno è la media di alcune abilità
// visibili. La rotazione di una squadra, per il confronto con la media della lega, sono gli 8 giocatori con contratto
// standard con la media dei gruppi più alta (a parità l'id più piccolo): la stessa regola della funzione
// public.league_skill_profile nel database (migrazione 20261107100200_skill_profile.sql), che dà la media della lega
// senza scaricare le rose delle 30 squadre. Modulo puro: lo usa anche il test sul database.
import type { RatingKey, Ratings } from '@nbbgm/engine';

export const SKILL_GROUPS = [
  { key: 'tiro3', label: 'Tiro da 3', fields: ['threePoint'] },
  { key: 'media', label: 'Tiro dalla media', fields: ['midRange', 'pullUp'] },
  { key: 'ferro', label: 'Conclusioni al ferro', fields: ['closeShot', 'layup', 'drivingDunk'] },
  { key: 'post', label: 'Gioco in post', fields: ['postControl', 'hook', 'postFade'] },
  { key: 'regia', label: 'Regia', fields: ['ballHandle', 'passAccuracy', 'passVision'] },
  {
    key: 'perimetro',
    label: 'Difesa sul perimetro',
    fields: ['perimeterDefense', 'steal', 'passLaneReading'],
  },
  { key: 'protezione', label: 'Protezione del ferro', fields: ['interiorDefense', 'block', 'helpDefense'] },
  { key: 'rimbalzi', label: 'Rimbalzi', fields: ['offensiveRebound', 'defensiveRebound'] },
  { key: 'atletismo', label: 'Atletismo', fields: ['speed', 'agility', 'vertical', 'strength'] },
] as const satisfies readonly { key: string; label: string; fields: readonly RatingKey[] }[];

export type SkillKey = (typeof SKILL_GROUPS)[number]['key'];
export type SkillProfile = Record<SkillKey, number>;

export const SKILL_LABEL = Object.fromEntries(SKILL_GROUPS.map((g) => [g.key, g.label])) as Record<
  SkillKey,
  string
>;

/** Valore di un gruppo: la media delle sue abilità. */
export function skillOf(ratings: Partial<Ratings> | undefined, key: SkillKey): number {
  const g = SKILL_GROUPS.find((x) => x.key === key);
  if (!g || !ratings) return 0;
  return g.fields.reduce((a, f) => a + Number(ratings[f] ?? 0), 0) / g.fields.length;
}

/** Media dei gruppi: decide chi sta negli 8 della rotazione per il confronto. */
export function skillAverage(ratings: Partial<Ratings>): number {
  return SKILL_GROUPS.reduce((a, g) => a + skillOf(ratings, g.key), 0) / SKILL_GROUPS.length;
}

/** Giocatori della rotazione per il confronto. */
export const ROTATION_SIZE = 8;

/** Profilo della rotazione: per ogni gruppo la media degli 8 con la media dei gruppi più alta. */
export function rotationProfile(
  players: readonly { id: string; ratings: Partial<Ratings>; contractType?: string | null }[],
): SkillProfile {
  const rotation = players
    .filter((p) => p.contractType !== 'two-way')
    .map((p) => ({ p, avg: skillAverage(p.ratings) }))
    .sort((a, b) => b.avg - a.avg || (a.p.id < b.p.id ? -1 : a.p.id > b.p.id ? 1 : 0))
    .slice(0, ROTATION_SIZE);
  const out = {} as SkillProfile;
  for (const g of SKILL_GROUPS)
    out[g.key] = rotation.length
      ? rotation.reduce((a, x) => a + skillOf(x.p.ratings, g.key), 0) / rotation.length
      : 0;
  return out;
}
