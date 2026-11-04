import { Rng } from '../rng.ts';
import type { Team } from '../types.ts';

export interface ScheduledGame {
  turn: number;
  homeId: string;
  awayId: string;
}

export const REGULAR_SEASON_TURNS = 82;

/**
 * Partite tra ogni coppia (formato NBA): 4 nella division, 4 o 3 con le altre squadre della conference
 * (le serie da 3 ruotano di stagione in stagione), 2 con l'altra conference. Restituisce anche quante
 * partite ospita ciascuna squadra: per le serie da 3 la casa in più va metà a uno e metà all'altro,
 * così ogni squadra gioca 41 partite in casa.
 */
export function seriesPlan(teams: readonly Team[], year: number): { games: number[][]; home: number[][] } {
  const n = teams.length;
  const games = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const home = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const three: [number, number][] = [];
  for (const conf of ['East', 'West'] as const) {
    const divisions: number[][] = [];
    const seen = new Map<string, number[]>();
    teams.forEach((t, i) => {
      if (t.conference !== conf) return;
      if (!seen.has(t.division)) {
        seen.set(t.division, []);
        divisions.push(seen.get(t.division) as number[]);
      }
      (seen.get(t.division) as number[]).push(i);
    });
    let pairIndex = 0;
    for (let a = 0; a < divisions.length; a++) {
      for (let b = a + 1; b < divisions.length; b++, pairIndex++) {
        const shift = (((year + pairIndex) % 5) + 5) % 5;
        const da = divisions[a] as number[];
        const db = divisions[b] as number[];
        da.forEach((ti, i) =>
          db.forEach((tj, j) => {
            if ((((j - i - shift) % 5) + 5) % 5 <= 1) three.push([ti, tj]);
          }),
        );
      }
    }
  }
  const isThree = new Set(three.map(([a, b]) => `${Math.min(a, b)}|${Math.max(a, b)}`));
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const a = teams[i] as Team;
      const b = teams[j] as Team;
      let g = 2;
      if (a.conference === b.conference) g = a.division === b.division ? 4 : isThree.has(`${i}|${j}`) ? 3 : 4;
      games[i]![j] = games[j]![i] = g;
      if (g !== 3) home[i]![j] = home[j]![i] = g / 2;
    }
  }
  // Serie da 3: orientamento euleriano del grafo (ogni squadra ha 4 serie da 3, ne ospita 2 volte su 2)
  const adj = new Map<number, { to: number; edge: number }[]>();
  three.forEach(([a, b], e) => {
    adj.set(a, [...(adj.get(a) ?? []), { to: b, edge: e }]);
    adj.set(b, [...(adj.get(b) ?? []), { to: a, edge: e }]);
  });
  const used = new Array<boolean>(three.length).fill(false);
  for (const start of adj.keys()) {
    const stack = [start];
    while (stack.length) {
      const v = stack[stack.length - 1] as number;
      const next = (adj.get(v) ?? []).find((x) => !used[x.edge]);
      if (!next) {
        stack.pop();
        continue;
      }
      used[next.edge] = true;
      // v -> to: v ospita 2 partite, to ne ospita 1
      home[v]![next.to] = 2;
      home[next.to]![v] = 1;
      stack.push(next.to);
    }
  }
  return { games, home };
}

/** Cerca un abbinamento perfetto per un turno tra le coppie con partite rimaste. */
function findRound(
  remaining: number[][],
  last: number[],
  rng: Rng,
  budget: { left: number },
): [number, number][] | null {
  const n = remaining.length;
  const mate = new Array<number>(n).fill(-1);
  const order = rng.shuffle(Array.from({ length: n }, (_, i) => i));
  const rec = (): boolean => {
    let u = -1;
    let best = Infinity;
    for (const i of order) {
      if (mate[i] !== -1) continue;
      let count = 0;
      for (let j = 0; j < n; j++) if (j !== i && mate[j] === -1 && (remaining[i]![j] as number) > 0) count++;
      if (count === 0) return false;
      if (count < best) {
        best = count;
        u = i;
      }
    }
    if (u === -1) return true;
    const cand: number[] = [];
    for (let j = 0; j < n; j++)
      if (j !== u && mate[j] === -1 && (remaining[u]![j] as number) > 0) cand.push(j);
    const noise = new Map(cand.map((j) => [j, rng.next()]));
    cand.sort(
      (a, b) =>
        (remaining[u]![b] as number) - (remaining[u]![a] as number) ||
        Number(a === last[u]) - Number(b === last[u]) ||
        (noise.get(a) as number) - (noise.get(b) as number),
    );
    for (const v of cand) {
      if (--budget.left < 0) return false;
      mate[u] = v;
      mate[v] = u;
      if (rec()) return true;
      mate[u] = mate[v] = -1;
    }
    return false;
  };
  if (!rec()) return null;
  const pairs: [number, number][] = [];
  for (let i = 0; i < n; i++) if ((mate[i] as number) > i) pairs.push([i, mate[i] as number]);
  return pairs;
}

/**
 * Calendario di regular season: 82 turni, a ogni turno ogni squadra gioca una partita. Deterministico dato il seed.
 */
export function generateSchedule(teams: readonly Team[], year: number, seed: string): ScheduledGame[] {
  const { games, home } = seriesPlan(teams, year);
  const n = teams.length;
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = new Rng(`${seed}:calendario:${year}:${attempt}`);
    const remaining = games.map((r) => [...r]);
    const homeLeft = home.map((r) => [...r]);
    const homeCount = new Array<number>(n).fill(0);
    const last = new Array<number>(n).fill(-1);
    const out: ScheduledGame[] = [];
    let ok = true;
    for (let turn = 0; turn < REGULAR_SEASON_TURNS; turn++) {
      const round = findRound(remaining, last, rng, { left: 20000 });
      if (!round) {
        ok = false;
        break;
      }
      for (const [a, b] of round) {
        remaining[a]![b]!--;
        remaining[b]![a]!--;
        last[a] = b;
        last[b] = a;
        const aCan = (homeLeft[a]![b] as number) > 0;
        const bCan = (homeLeft[b]![a] as number) > 0;
        const aHome =
          aCan &&
          (!bCan ||
            (homeCount[a] as number) < (homeCount[b] as number) ||
            ((homeCount[a] as number) === (homeCount[b] as number) && rng.chance(0.5)));
        const [h, v] = aHome ? [a, b] : [b, a];
        homeLeft[h]![v]!--;
        homeCount[h]!++;
        out.push({ turn, homeId: (teams[h] as Team).id, awayId: (teams[v] as Team).id });
      }
    }
    if (ok) return out;
  }
  throw new Error('Calendario non trovato');
}

/** Controlla un calendario: elenco dei problemi, vuoto se è valido. */
export function validateSchedule(
  teams: readonly Team[],
  year: number,
  schedule: readonly ScheduledGame[],
): string[] {
  const problems: string[] = [];
  const { games } = seriesPlan(teams, year);
  const index = new Map(teams.map((t, i) => [t.id, i]));
  const n = teams.length;
  const played = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const homeGames = new Array<number>(n).fill(0);
  for (let turn = 0; turn < REGULAR_SEASON_TURNS; turn++) {
    const inTurn = schedule.filter((g) => g.turn === turn);
    const seen = new Set<string>();
    for (const g of inTurn) {
      for (const id of [g.homeId, g.awayId]) {
        if (seen.has(id)) problems.push(`Turno ${turn + 1}: ${id} gioca due volte`);
        seen.add(id);
      }
    }
    if (seen.size !== n) problems.push(`Turno ${turn + 1}: giocano ${seen.size} squadre su ${n}`);
  }
  for (const g of schedule) {
    const h = index.get(g.homeId) as number;
    const a = index.get(g.awayId) as number;
    played[h]![a]!++;
    played[a]![h]!++;
    homeGames[h]!++;
  }
  for (let i = 0; i < n; i++) {
    const total = (played[i] as number[]).reduce((x, y) => x + y, 0);
    if (total !== 82) problems.push(`${(teams[i] as Team).id}: ${total} partite`);
    if (homeGames[i] !== 41) problems.push(`${(teams[i] as Team).id}: ${homeGames[i]} partite in casa`);
    for (let j = i + 1; j < n; j++) {
      if (played[i]![j] !== games[i]![j]) {
        problems.push(
          `${(teams[i] as Team).id}-${(teams[j] as Team).id}: ${played[i]![j]} partite invece di ${games[i]![j]}`,
        );
      }
    }
  }
  return problems;
}
