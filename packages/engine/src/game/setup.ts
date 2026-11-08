import { overall } from '../overall.ts';
import { ROLES, type Player, type Role } from '../types.ts';
import { DEFAULT_TACTICS, type Tactics, type TeamSetup } from './types.ts';

export const SLOT_ROLES: readonly Role[] = ROLES;

// Posizione di ogni ruolo nella fila, senza cercarla ogni volta (roleFit si chiama a ogni lettura di un'abilità)
const ROLE_INDEX: Readonly<Record<string, number>> = Object.fromEntries(ROLES.map((r, i) => [r, i]));

/** Distanza tra due ruoli nella fila PG, SG, SF, PF, C. */
export function roleDistance(a: Role, b: Role): number {
  return Math.abs((ROLE_INDEX[a] ?? -1) - (ROLE_INDEX[b] ?? -1));
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
export const ROTATION_MINUTES: readonly number[] = [35, 34, 33, 32, 31, 22, 18, 15, 12, 8];

/**
 * Come un allenatore mette in campo la squadra (season/coaches.ts): chi preferisce, quanti giocatori ruota, quanto
 * fa riposare gli stanchi. Senza, il pulsante Auto di sempre.
 */
export interface LineupStyle {
  /** Punti di overall in più (o in meno) che l'allenatore dà a un giocatore, per la sua idea di gioco e la fiducia. */
  bonus: (p: Player) => number;
  /** Minuti dei primi della rotazione, dal migliore (somma 240). */
  rotation: readonly number[];
  /** Peso dell'energia nella scelta di chi gioca (0,2 per il pulsante Auto). */
  energyWeight: number;
  /** Sotto questa energia toglie minuti ai titolari e li dà alla panchina (0: mai). */
  restBelow: number;
}

/** Minuti che un titolare stanco perde per punto di energia sotto la soglia del riposo, e il minimo che gli restano. */
const REST_CUT_PER_POINT = 0.4;
const REST_FLOOR_MINUTES = 18;

/**
 * Impostazioni automatiche (bot, pulsante Auto, allenatore): i 13 migliori sani a referto, il quintetto che
 * massimizza overall per adattamento al ruolo, minuti decrescenti con la somma a 240. Con lo stile di un allenatore
 * il "migliore" è quello che vede lui (overall più le sue preferenze), i minuti seguono la sua rotazione e chi è
 * stanco gioca meno se l'allenatore fa riposare; senza, le scelte di sempre, numero per numero.
 */
export function autoSetup(
  teamId: string,
  roster: readonly Player[],
  tactics: Tactics = DEFAULT_TACTICS,
  style?: LineupStyle,
): TeamSetup {
  const healthy = roster.filter((p) => p.injury === null);
  if (healthy.length < 5) throw new Error(`${teamId}: meno di 5 giocatori disponibili`);
  const ovr = new Map(healthy.map((p) => [p, style ? overall(p) + style.bonus(p) : overall(p)]));
  const energyF = (p: Player) =>
    style ? 1 - style.energyWeight + style.energyWeight * (p.energy / 100) : 0.8 + 0.2 * (p.energy / 100);
  const ranked = [...healthy]
    .map((p) => ({ p, o: (ovr.get(p) as number) * energyF(p) }))
    .sort((a, b) => b.o - a.o)
    .map((x) => x.p);
  const active = ranked.slice(0, 13);

  // Quintetto: miglior assegnazione dei 5 slot tra i primi 8 (valori per slot calcolati una volta)
  const pool = active.slice(0, 8);
  const fit = pool.map((p) => SLOT_ROLES.map((r) => (ovr.get(p) as number) * roleFit(p, r)));
  // Tetto di quello che possono ancora dare gli slot da `slot` in poi (il migliore di ogni slot, anche ripetuto):
  // un ramo che non può arrivare al quintetto migliore trovato finora si salta. Con il margine di 1e-6 si saltano
  // solo rami che non potrebbero comunque superarlo: il quintetto scelto è lo stesso della ricerca completa.
  const rest = new Array<number>(6).fill(0);
  for (let slot = 4; slot >= 0; slot--)
    rest[slot] = (rest[slot + 1] as number) + Math.max(...fit.map((f) => f[slot] as number));
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
    if (score + (rest[slot] as number) < bestScore - 1e-6) return;
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
  const table = style?.rotation ?? ROTATION_MINUTES;
  order.forEach((p, i) => {
    minutes[p.id] = table[i] ?? 0;
  });
  // Con meno giocatori della rotazione i minuti mancanti vanno ai titolari
  let missing = 240 - Object.values(minutes).reduce((a, b) => a + b, 0);
  for (let i = 0; missing > 0; i = (i + 1) % starters.length, missing--) {
    const id = (order[i] as Player).id;
    minutes[id] = (minutes[id] ?? 0) + 1;
  }
  if (style && style.restBelow > 0) restTired(order, minutes, style.restBelow);

  return {
    teamId,
    players: active,
    starters: starters.map((p) => p.id) as TeamSetup['starters'],
    minutes,
    tactics,
  };
}

/**
 * Riposo: chi è sotto la soglia di energia perde minuti (0,4 per punto, fino a restarne con 18), che vanno uno alla
 * volta ai riposati della rotazione con meno minuti, fino a 30 a testa; se non ne resta nessuno tornano agli stanchi.
 * La somma resta 240.
 */
function restTired(order: readonly Player[], minutes: Record<string, number>, restBelow: number): void {
  let pool = 0;
  for (const p of order) {
    const m = minutes[p.id] ?? 0;
    if (p.energy >= restBelow || m <= REST_FLOOR_MINUTES) continue;
    const cut = Math.min(m - REST_FLOOR_MINUTES, Math.round((restBelow - p.energy) * REST_CUT_PER_POINT));
    minutes[p.id] = m - cut;
    pool += cut;
  }
  const fresh = order.filter((p) => p.energy >= restBelow);
  const receivers = fresh.length ? fresh : [...order];
  const cap = fresh.length ? 30 : MAX_MINUTES;
  for (let guard = 0; pool > 0 && guard < 240 * 13; guard++) {
    // Prima chi è già in rotazione, poi gli altri
    const inRotation = receivers.filter((p) => (minutes[p.id] ?? 0) > 0 && (minutes[p.id] ?? 0) < cap);
    const open = inRotation.length ? inRotation : receivers.filter((p) => (minutes[p.id] ?? 0) < cap);
    const target = (open.length ? open : receivers).reduce((a, b) =>
      (minutes[b.id] ?? 0) < (minutes[a.id] ?? 0) ? b : a,
    );
    minutes[target.id] = (minutes[target.id] ?? 0) + 1;
    pool--;
  }
}

/** Impostazioni salvate dal manager (tabella team_settings). */
export interface SavedSettings {
  /** Titolari negli slot PG, SG, SF, PF, C. */
  starters: readonly string[];
  /** Minuti obiettivo per id; la somma salvata fa 240. */
  minutes: Readonly<Record<string, number>>;
  tactics: Partial<Tactics>;
}

const MAX_MINUTES = 48;
const MAX_ACTIVE = 13;

const TACTIC_VALUES: { [K in keyof Tactics]: readonly Tactics[K][] } = {
  pace: ['slow', 'normal', 'fast'],
  focus: ['perimeter', 'balanced', 'inside'],
  defense: ['man', 'zone'],
  intensity: ['low', 'medium', 'high'],
};

/** Tattiche salvate, con i valori non validi riportati a quelli di default. */
export function validTactics(t: Partial<Tactics> | undefined): Tactics {
  const out = { ...DEFAULT_TACTICS };
  for (const k of Object.keys(TACTIC_VALUES) as (keyof Tactics)[]) {
    const v = t?.[k];
    if (v !== undefined && (TACTIC_VALUES[k] as readonly string[]).includes(v))
      (out as Record<string, string>)[k] = v;
  }
  return out;
}

/**
 * Le impostazioni salvate applicate ai giocatori disponibili (sani e a disposizione). Se manca qualcuno, perché
 * ceduto, tagliato o infortunato, il bot corregge solo gli slot mancanti: un titolare assente lo sostituisce il
 * migliore per quello slot tra chi non è titolare, e il sostituto ne eredita i minuti; i minuti di chi manca
 * dalla panchina passano agli altri della rotazione, fino a 48 a testa. A referto al massimo 13, prima chi ha
 * minuti. Senza almeno 5 disponibili decide il bot da solo.
 */
export function setupFromSettings(
  teamId: string,
  roster: readonly Player[],
  saved: SavedSettings,
): TeamSetup {
  const tactics = validTactics(saved.tactics);
  const healthy = roster.filter((p) => p.injury === null);
  if (healthy.length < 5) return autoSetup(teamId, roster, tactics);
  const byId = new Map(healthy.map((p) => [p.id, p]));
  const ovr = new Map(healthy.map((p) => [p.id, overall(p)]));
  const minutes = new Map<string, number>();
  for (const p of healthy) {
    const m = saved.minutes[p.id];
    if (typeof m === 'number' && m > 0) minutes.set(p.id, Math.min(MAX_MINUTES, Math.round(m)));
  }

  // Titolari: si tengono quelli disponibili, gli slot vuoti li riempie il bot
  const starters: (string | null)[] = SLOT_ROLES.map((_, i) => {
    const id = saved.starters[i];
    return id !== undefined && byId.has(id) ? id : null;
  });
  const unique = new Set<string>();
  starters.forEach((id, i) => {
    if (id === null) return;
    if (unique.has(id)) starters[i] = null;
    else unique.add(id);
  });
  starters.forEach((id, i) => {
    if (id !== null) return;
    const slot = SLOT_ROLES[i] as Role;
    const candidates = healthy.filter((p) => !starters.includes(p.id));
    const best = candidates.reduce<Player | null>(
      (b, p) =>
        b === null ||
        (ovr.get(p.id) as number) * roleFit(p, slot) > (ovr.get(b.id) as number) * roleFit(b, slot)
          ? p
          : b,
      null,
    ) as Player;
    starters[i] = best.id;
    // Il sostituto eredita i minuti del titolare che manca
    const missing = saved.starters[i];
    const inherited = missing !== undefined && !byId.has(missing) ? (saved.minutes[missing] ?? 0) : 0;
    minutes.set(best.id, Math.min(MAX_MINUTES, (minutes.get(best.id) ?? 0) + Math.round(inherited)));
  });
  const starterIds = starters as string[];

  // A referto: titolari, poi chi ha più minuti, poi i migliori, fino a 13
  const ranked = [...healthy].sort(
    (a, b) =>
      (minutes.get(b.id) ?? 0) - (minutes.get(a.id) ?? 0) ||
      (ovr.get(b.id) as number) - (ovr.get(a.id) as number),
  );
  const active = [
    ...starterIds.map((id) => byId.get(id) as Player),
    ...ranked.filter((p) => !starterIds.includes(p.id)),
  ].slice(0, MAX_ACTIVE);
  const activeIds = new Set(active.map((p) => p.id));
  for (const id of [...minutes.keys()]) if (!activeIds.has(id)) minutes.delete(id);

  // I minuti tornano a 240: quelli che mancano a chi è già in rotazione (prima i migliori), poi agli altri
  let total = [...minutes.values()].reduce((a, b) => a + b, 0);
  const byQuality = [...active].sort((a, b) => (ovr.get(b.id) as number) - (ovr.get(a.id) as number));
  const inRotation = byQuality.filter((p) => (minutes.get(p.id) ?? 0) > 0);
  const order = [...inRotation, ...byQuality.filter((p) => !inRotation.includes(p))];
  for (let guard = 0; total < 240 && guard < 240 * MAX_ACTIVE; guard++) {
    const p = order[guard % order.length] as Player;
    const m = minutes.get(p.id) ?? 0;
    if (m < MAX_MINUTES) {
      minutes.set(p.id, m + 1);
      total++;
    }
  }
  for (let guard = 0; total > 240 && guard < 240 * MAX_ACTIVE; guard++) {
    const p = order[order.length - 1 - (guard % order.length)] as Player;
    const m = minutes.get(p.id) ?? 0;
    if (m > 0) {
      minutes.set(p.id, m - 1);
      total--;
    }
  }

  return {
    teamId,
    players: active,
    starters: starterIds as unknown as TeamSetup['starters'],
    minutes: Object.fromEntries(active.map((p) => [p.id, minutes.get(p.id) ?? 0])),
    tactics,
  };
}
