import { INDICATIVE_MIN_SALARY, SEASON_2026_27, maxSalary } from './economy.ts';
import { HIDDEN_KEYS, RATING_KEYS, TENDENCY_KEYS } from './fields.ts';
import { NAME_POOLS } from './names.ts';
import { overall } from './overall.ts';
import type { ArchetypeProfile } from './profiles.ts';
import type { Rng } from './rng.ts';
import { TEAMS } from './teams.ts';
import {
  ROLES,
  type Contract,
  type Hidden,
  type LeagueData,
  type Player,
  type Ratings,
  type Role,
  type Tendencies,
} from './types.ts';

export interface GeneratePlayerOptions {
  id: string;
  archetype?: string;
  role?: Role;
  age?: number;
  /** Livello in deviazioni standard rispetto al giocatore medio del suo archetipo (0 = medio). */
  level?: number;
}

const ADJACENT: Record<Role, Role> = { PG: 'SG', SG: 'PG', SF: 'PF', PF: 'SF', C: 'PF' };
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function chooseProfile(
  rng: Rng,
  profiles: readonly ArchetypeProfile[],
  opts: GeneratePlayerOptions,
): ArchetypeProfile {
  if (profiles.length === 0) throw new Error('Nessun profilo di archetipo disponibile');
  if (opts.archetype) {
    const found = profiles.find((p) => p.archetype === opts.archetype);
    if (!found) throw new Error(`Archetipo "${opts.archetype}" sconosciuto`);
    return found;
  }
  const role = opts.role;
  const weights = profiles.map((p) => (role ? (p.roles[role] ?? 0) : p.count));
  return profiles[rng.weightedIndex(weights)] as ArchetypeProfile;
}

function weightedRole(rng: Rng, counts: Partial<Record<Role, number>>, exclude?: Role): Role | null {
  const roles = ROLES.filter((r) => r !== exclude && (counts[r] ?? 0) > 0);
  if (roles.length === 0) return null;
  return roles[rng.weightedIndex(roles.map((r) => counts[r] ?? 0))] as Role;
}

/** Genera un giocatore inventato con campi coerenti con l'archetipo scelto. */
export function generatePlayer(
  rng: Rng,
  profiles: readonly ArchetypeProfile[],
  opts: GeneratePlayerOptions,
): Player {
  const profile = chooseProfile(rng, profiles, opts);
  const role = opts.role ?? (weightedRole(rng, profile.roles) as Role);
  const secondaryRole = weightedRole(rng, profile.secondaryRoles, role) ?? ADJACENT[role];
  const level = opts.level ?? rng.normal(0, 1);

  const field = (key: string, lo: number, hi: number) => {
    const f = profile.fields[key];
    if (!f) throw new Error(`Profilo ${profile.archetype}: campo ${key} mancante`);
    const noise = Math.sqrt(1 - f.loading ** 2) * rng.normal(0, 1);
    return Math.round(clamp(f.mean + f.sd * (f.loading * level + noise), lo, hi));
  };
  const ratings = Object.fromEntries(RATING_KEYS.map((k) => [k, field(`ratings.${k}`, 15, 99)])) as Ratings;
  const tendencies = Object.fromEntries(
    TENDENCY_KEYS.map((k) => [k, field(`tendencies.${k}`, 3, 99)]),
  ) as Tendencies;
  const hidden = Object.fromEntries(HIDDEN_KEYS.map((k) => [k, field(`hidden.${k}`, 30, 99)])) as Hidden;

  const age = opts.age ?? Math.round(clamp(rng.normal(26.5, 4), 19, 37));
  // Il potenziale sta sulla scala dell'overall: i giovani hanno più margine, dopo i 27 anni quasi nessuno.
  const current = overall({ ratings, role });
  const growth = Math.max(0, 27 - age) * clamp(rng.normal(1.8, 0.7), 0.3, 3.5);
  hidden.potential = Math.round(clamp(current + growth + rng.normal(0, 2), current, 99));

  const heightCm =
    Math.round(clamp(rng.normal(profile.heightCm.mean, profile.heightCm.sd), 175, 228) * 10) / 10;
  const pool = NAME_POOLS[rng.weightedIndex(NAME_POOLS.map((p) => p.weight))] as (typeof NAME_POOLS)[number];

  return {
    id: opts.id,
    firstName: rng.pick(pool.first),
    lastName: rng.pick(pool.last),
    nationality: pool.nationality,
    role,
    secondaryRole,
    hand: rng.chance(0.1) ? 'L' : 'R',
    archetype: profile.archetype,
    age,
    heightCm,
    wingspanCm: Math.round((heightCm * profile.wingspanRatio + rng.normal(0, 2.5)) * 10) / 10,
    weightKg: Math.round(clamp(rng.normal(profile.weightKg.mean, profile.weightKg.sd), 70, 140) * 10) / 10,
    yearsInLeague: Math.max(0, age - 20),
    ratings,
    tendencies,
    hidden,
    energy: 100,
    morale: 60,
    injury: null,
  };
}

/** Classe di draft inventata: giovani, più bassi oggi ma con potenziale alto e incerto. */
export function generateDraftClass(
  rng: Rng,
  profiles: readonly ArchetypeProfile[],
  opts: { size?: number; idPrefix: string },
): Player[] {
  const size = opts.size ?? 60;
  return Array.from({ length: size }, (_, i) => {
    const player = generatePlayer(rng, profiles, {
      id: `${opts.idPrefix}-${i + 1}`,
      age: rng.int(19, 22),
      level: rng.normal(-1.3, 0.9),
    });
    player.yearsInLeague = 0;
    return player;
  });
}

/** Stipendio indicativo in base all'overall, tra il minimo e il massimo per anzianità. */
export function estimateSalary(ovr: number, yearsInLeague: number): number {
  const max = maxSalary(SEASON_2026_27.salaryCap, yearsInLeague);
  const t = clamp((ovr - 58) / 30, 0, 1) ** 2;
  return Math.round((INDICATIVE_MIN_SALARY + (max - INDICATIVE_MIN_SALARY) * t) / 1000) * 1000;
}

const ROSTER_PLAN: readonly Role[] = [
  'PG',
  'PG',
  'PG',
  'SG',
  'SG',
  'SG',
  'SF',
  'SF',
  'SF',
  'PF',
  'PF',
  'PF',
  'C',
  'C',
  'C',
];

/** Lega inventata: le 30 squadre NBA con 15 giocatori ciascuna e un gruppo di svincolati. */
export function generateLeague(
  rng: Rng,
  profiles: readonly ArchetypeProfile[],
  opts: { season?: string; freeAgents?: number } = {},
): LeagueData {
  const players: LeagueData['players'] = [];
  const contracts: Contract[] = [];
  let n = 0;
  for (const team of TEAMS) {
    const strength = rng.normal(0, 0.35);
    for (const role of ROSTER_PLAN) {
      const p = generatePlayer(rng, profiles, { id: `gen-${++n}`, role, level: rng.normal(strength, 1) });
      players.push({ ...p, teamId: team.id });
      const years = rng.int(1, 4);
      const salary = estimateSalary(overall(p), p.yearsInLeague ?? 0);
      contracts.push({
        playerId: p.id,
        teamId: team.id,
        type: 'standard',
        salaries: Array.from({ length: years }, (_, y) => Math.round(salary * 1.05 ** y)),
        options: Array.from({ length: years }, () => null),
        guaranteed: null,
      });
    }
  }
  for (let i = 0; i < (opts.freeAgents ?? 30); i++) {
    const p = generatePlayer(rng, profiles, { id: `gen-${++n}`, level: rng.normal(-1, 0.7) });
    players.push({ ...p, teamId: null });
  }
  return { season: opts.season ?? '2026-27', teams: [...TEAMS], players, contracts, deadMoney: [] };
}
