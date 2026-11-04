import { overall } from '../overall.ts';
import { ROLES, type Player, type Role } from '../types.ts';
import { DEFAULT_TACTICS, type Tactics, type TeamSetup } from './types.ts';

export const SLOT_ROLES: readonly Role[] = ROLES;

/** Distanza tra due ruoli nella fila PG, SG, SF, PF, C. */
export function roleDistance(a: Role, b: Role): number {
  return Math.abs(ROLES.indexOf(a) - ROLES.indexOf(b));
}

/** Efficacia di un giocatore in uno slot: ruolo principale e secondario pieni, poi -3%, -8%, -15%. */
export function roleFit(player: Pick<Player, 'role' | 'secondaryRole'>, slot: Role): number {
  const d = Math.min(
    roleDistance(player.role, slot),
    player.secondaryRole ? roleDistance(player.secondaryRole, slot) : 9,
  );
  return d === 0 ? 1 : d === 1 ? 0.97 : d === 2 ? 0.92 : 0.85;
}

// Minuti tipici per i primi 10 della rotazione (somma 240).
const ROTATION_MINUTES = [35, 34, 33, 32, 31, 22, 18, 15, 12, 8];

/**
 * Impostazioni automatiche (bot, pulsante Auto, allenatore): i 13 migliori sani a referto, il quintetto che
 * massimizza overall per adattamento al ruolo, minuti decrescenti con la somma a 240.
 */
export function autoSetup(
  teamId: string,
  roster: readonly Player[],
  tactics: Tactics = DEFAULT_TACTICS,
): TeamSetup {
  const healthy = roster.filter((p) => p.injury === null);
  if (healthy.length < 5) throw new Error(`${teamId}: meno di 5 giocatori disponibili`);
  const ovr = new Map(healthy.map((p) => [p, overall(p)]));
  const ranked = [...healthy]
    .map((p) => ({ p, o: (ovr.get(p) as number) * (0.8 + 0.2 * (p.energy / 100)) }))
    .sort((a, b) => b.o - a.o)
    .map((x) => x.p);
  const active = ranked.slice(0, 13);

  // Quintetto: miglior assegnazione dei 5 slot tra i primi 8 (valori per slot calcolati una volta)
  const pool = active.slice(0, 8);
  const fit = pool.map((p) => SLOT_ROLES.map((r) => (ovr.get(p) as number) * roleFit(p, r)));
  let best: number[] = [];
  let bestScore = -1;
  const chosen: number[] = [];
  const used = new Array<boolean>(pool.length).fill(false);
  const pick = (slot: number, score: number) => {
    if (slot === 5) {
      if (score > bestScore) {
        bestScore = score;
        best = [...chosen];
      }
      return;
    }
    for (let i = 0; i < pool.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      chosen.push(i);
      pick(slot + 1, score + (fit[i]![slot] as number));
      chosen.pop();
      used[i] = false;
    }
  };
  pick(0, 0);
  const starters = best.map((i) => pool[i] as Player);

  const bench = active.filter((p) => !starters.includes(p));
  const order = [...starters].sort((a, b) => (ovr.get(b) as number) - (ovr.get(a) as number)).concat(bench);
  const minutes: Record<string, number> = {};
  order.forEach((p, i) => {
    minutes[p.id] = ROTATION_MINUTES[i] ?? 0;
  });
  // Con meno di 10 giocatori i minuti mancanti vanno ai titolari
  let missing = 240 - Object.values(minutes).reduce((a, b) => a + b, 0);
  for (let i = 0; missing > 0; i = (i + 1) % starters.length, missing--) {
    const id = (order[i] as Player).id;
    minutes[id] = (minutes[id] ?? 0) + 1;
  }

  return {
    teamId,
    players: active,
    starters: starters.map((p) => p.id) as TeamSetup['starters'],
    minutes,
    tactics,
  };
}
