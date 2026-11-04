import { HIDDEN_KEYS, RATING_KEYS, TENDENCY_KEYS } from './fields.ts';
import { overallRaw } from './overall.ts';
import { ROLES, type Player, type Role } from './types.ts';

export interface FieldProfile {
  mean: number;
  sd: number;
  /** Correlazione del campo con il livello del giocatore dentro l'archetipo (0-0,9). */
  loading: number;
}

/** Statistiche di un archetipo ricavate dai giocatori reali: medie, dispersioni e legami con il livello. */
export interface ArchetypeProfile {
  archetype: string;
  count: number;
  roles: Partial<Record<Role, number>>;
  secondaryRoles: Partial<Record<Role, number>>;
  heightCm: { mean: number; sd: number };
  weightKg: { mean: number; sd: number };
  wingspanRatio: number;
  fields: Record<string, FieldProfile>;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs: number[]) => {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length);
};
function corr(xs: number[], ys: number[]): number {
  const mx = mean(xs);
  const my = mean(ys);
  const sx = sd(xs);
  const sy = sd(ys);
  if (sx === 0 || sy === 0) return 0;
  return xs.reduce((a, x, i) => a + (x - mx) * ((ys[i] as number) - my), 0) / xs.length / sx / sy;
}

/** Calcola i profili degli archetipi (servono almeno 5 giocatori per archetipo). */
export function computeArchetypeProfiles(players: readonly Player[]): ArchetypeProfile[] {
  // Livello del giocatore: overall grezzo standardizzato dentro il suo ruolo
  const byRole = new Map<Role, number[]>();
  for (const p of players) {
    const list = byRole.get(p.role) ?? [];
    list.push(overallRaw(p.ratings, p.role));
    byRole.set(p.role, list);
  }
  const level = new Map<Player, number>();
  for (const p of players) {
    const xs = byRole.get(p.role) as number[];
    level.set(p, (overallRaw(p.ratings, p.role) - mean(xs)) / (sd(xs) || 1));
  }

  const groups = new Map<string, Player[]>();
  for (const p of players) groups.set(p.archetype, [...(groups.get(p.archetype) ?? []), p]);

  const profiles: ArchetypeProfile[] = [];
  for (const [archetype, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
    if (group.length < 5) continue;
    const levels = group.map((p) => level.get(p) as number);
    const fields: Record<string, FieldProfile> = {};
    const add = (prefix: string, keys: readonly string[], pick: (p: Player, k: string) => number) => {
      for (const k of keys) {
        const xs = group.map((p) => pick(p, k));
        fields[`${prefix}.${k}`] = {
          mean: round(mean(xs)),
          sd: round(Math.max(2, sd(xs))),
          loading: round(Math.max(0, Math.min(0.9, corr(xs, levels)))),
        };
      }
    };
    add('ratings', RATING_KEYS, (p, k) => p.ratings[k as keyof Player['ratings']]);
    add('tendencies', TENDENCY_KEYS, (p, k) => p.tendencies[k as keyof Player['tendencies']]);
    add('hidden', HIDDEN_KEYS, (p, k) => p.hidden[k as keyof Player['hidden']]);
    const count = (roleOf: (p: Player) => Role | null) => {
      const out: Partial<Record<Role, number>> = {};
      for (const r of ROLES) {
        const n = group.filter((p) => roleOf(p) === r).length;
        if (n) out[r] = n;
      }
      return out;
    };
    profiles.push({
      archetype,
      count: group.length,
      roles: count((p) => p.role),
      secondaryRoles: count((p) => p.secondaryRole),
      heightCm: {
        mean: round(mean(group.map((p) => p.heightCm))),
        sd: round(Math.max(2, sd(group.map((p) => p.heightCm)))),
      },
      weightKg: {
        mean: round(mean(group.map((p) => p.weightKg))),
        sd: round(Math.max(2, sd(group.map((p) => p.weightKg)))),
      },
      wingspanRatio: Math.round(mean(group.map((p) => p.wingspanCm / p.heightCm)) * 1000) / 1000,
      fields,
    });
  }
  return profiles;
}

function round(x: number): number {
  return Math.round(x * 10) / 10;
}
