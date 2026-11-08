import { Rng } from '../rng.ts';
import type { Team } from '../types.ts';
import { LAST_REGULAR_DAY, christmasDay, noGameDays, openingDay, weekday } from './calendar.ts';

/**
 * Una partita del calendario: turn è il turno (l'indice del giorno con partite, da 0), day il giorno della stagione
 * (giorni dall'apertura). Un turno è un giorno: ogni squadra gioca al più una partita a turno.
 */
export interface ScheduledGame {
  turn: number;
  day: number;
  homeId: string;
  awayId: string;
}

/** Partite di regular season di ogni squadra. */
export const REGULAR_SEASON_GAMES = 82;

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

/** Cerca un abbinamento perfetto per un giro tra le coppie con partite rimaste. */
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
 * Giri del calendario: 82 abbinamenti in cui ogni squadra gioca una partita (casa e trasferta bilanciate, mai la
 * stessa sfida in due giri di fila). Sono la base del calendario a giorni (spreadDays): [casa, trasferta].
 */
function generateRounds(teams: readonly Team[], year: number, seed: string): [string, string][][] {
  const { games, home } = seriesPlan(teams, year);
  const n = teams.length;
  for (let attempt = 0; attempt < 500; attempt++) {
    const rng = new Rng(`${seed}:calendario:${year}:${attempt}`);
    const remaining = games.map((r) => [...r]);
    const homeLeft = home.map((r) => [...r]);
    const homeCount = new Array<number>(n).fill(0);
    const last = new Array<number>(n).fill(-1);
    const out: [string, string][][] = [];
    let ok = true;
    for (let r = 0; r < REGULAR_SEASON_GAMES; r++) {
      const round = findRound(remaining, last, rng, { left: 20000 });
      if (!round) {
        ok = false;
        break;
      }
      const pairs: [string, string][] = [];
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
        pairs.push([(teams[h] as Team).id, (teams[v] as Team).id]);
      }
      out.push(pairs);
    }
    if (ok) return out;
  }
  throw new Error('Calendario non trovato');
}

/**
 * Partite medie per giorno della settimana (da lunedì a domenica) nella NBA, contate su novembre 2025 e gennaio
 * 2026: mercoledì e venerdì pieni, giovedì leggero, per i contratti delle televisioni.
 */
export const WEEKDAY_WEIGHTS: readonly number[] = [8.2, 6.0, 9.5, 4.6, 9.3, 6.9, 7.6];
/**
 * Quota di back-to-back a stagione per squadra: oltre la quota un back-to-back si evita quando si può. Con 15 ne
 * escono da 12 a 15, in media 14, come nella NBA del 2026-27 (da 12 a 16, media 14,2).
 */
export const BACK_TO_BACK_TARGET = 15;
/** Partite della prima sera e di Natale, come nella NBA. */
export const OPENING_NIGHT_GAMES = 3;
export const CHRISTMAS_GAMES = 5;

/** Partite per giorno di una finestra: fisse la prima sera e a Natale, le altre con i pesi del giorno della settimana. */
function windowCounts(
  win: readonly number[],
  games: number,
  fixed: Map<number, number>,
  year: number,
  rng: Rng,
) {
  const open = openingDay(year);
  const free = win.filter((d) => !fixed.has(d));
  const left = games - [...fixed.values()].reduce((a, b) => a + b, 0);
  const share = free.map((d) => (WEEKDAY_WEIGHTS[weekday(open + d)] as number) * (0.7 + 0.6 * rng.next()));
  const sum = share.reduce((a, b) => a + b, 0);
  const target = share.map((x) => (x / sum) * left);
  const counts = target.map((x) => Math.max(1, Math.floor(x)));
  while (counts.reduce((a, b) => a + b, 0) < left) {
    let j = 0;
    for (let k = 1; k < counts.length; k++)
      if ((target[k] as number) - (counts[k] as number) > (target[j] as number) - (counts[j] as number))
        j = k;
    counts[j] = (counts[j] as number) + 1;
  }
  while (counts.reduce((a, b) => a + b, 0) > left) {
    const j = counts.indexOf(Math.max(...counts));
    counts[j] = (counts[j] as number) - 1;
  }
  const out = new Map(fixed);
  free.forEach((d, k) => out.set(d, counts[k] as number));
  return out;
}

/**
 * Porta i giri sui giorni della stagione, come il calendario NBA. I giorni con partite (tutti, tranne quelli di
 * noGameDays) si dividono in finestre consecutive, una per giro: 2 giorni ciascuna (qualcuna di 3 per i giorni in
 * più), e l'ultimo giro tutto nell'ultimo giorno, con le 30 squadre in campo. In ogni finestra ogni squadra gioca una
 * volta, quindi mai 3 partite in 3 giorni. Le partite della finestra si dividono tra i giorni con i pesi del giorno
 * della settimana e un po' di caso (3 la prima sera, 5 a Natale); i primi giorni della finestra prendono le partite
 * che non fanno back-to-back, o di chi ne ha meno della sua quota (circa BACK_TO_BACK_TARGET a stagione).
 */
function spreadDays(rounds: [string, string][][], year: number, rng: Rng): ScheduledGame[] {
  const off = noGameDays(year);
  const christmas = christmasDay(year);
  const days: number[] = [];
  for (let d = 0; d < LAST_REGULAR_DAY; d++) if (!off.has(d)) days.push(d);
  const count = rounds.length;
  // Finestre dei giri prima dell'ultimo: i giorni in più (o in meno) sparsi nella stagione
  const extra = days.length - (count - 1) * 2;
  const spread = (r: number) => Math.floor((r * Math.abs(extra)) / (count - 1));
  const windows: number[][] = [];
  let at = 0;
  for (let r = 0; r < count - 1; r++) {
    const size = 2 + Math.sign(extra) * (spread(r + 1) - spread(r));
    windows.push(days.slice(at, at + size));
    at += size;
  }
  windows.push([LAST_REGULAR_DAY]);

  const lastPlayed = new Map<string, number>();
  const backToBack = new Map<string, number>();
  const placed: Omit<ScheduledGame, 'turn'>[] = [];
  rounds.forEach((pairs, r) => {
    const win = windows[r] as number[];
    const fixed = new Map<number, number>();
    if (r === 0 && win.length > 1) fixed.set(win[0] as number, OPENING_NIGHT_GAMES);
    if (win.length > 1 && win.includes(christmas)) fixed.set(christmas, CHRISTMAS_GAMES);
    const counts = windowCounts(win, pairs.length, fixed, year, rng);
    const quota = (BACK_TO_BACK_TARGET * (r + 1)) / count;
    const noise = new Map(pairs.map((p) => [p, rng.next()]));
    // Costo di giocare il giorno d: un back-to-back pesa solo oltre la quota della squadra a questo punto
    const cost = (p: [string, string], d: number) =>
      p.reduce((c, t) => {
        if (lastPlayed.get(t) !== d - 1) return c;
        const next = (backToBack.get(t) ?? 0) + 1;
        return c + (next <= quota ? 0 : 1 + next - quota);
      }, 0) +
      (noise.get(p) as number) * 0.01;
    let pool = [...pairs];
    win.forEach((d, k) => {
      const pick =
        k === win.length - 1
          ? pool
          : [...pool].sort((a, b) => cost(a, d) - cost(b, d)).slice(0, counts.get(d) as number);
      for (const p of pick) {
        for (const t of p) {
          if (lastPlayed.get(t) === d - 1) backToBack.set(t, (backToBack.get(t) ?? 0) + 1);
          lastPlayed.set(t, d);
        }
        placed.push({ day: d, homeId: p[0], awayId: p[1] });
      }
      pool = pool.filter((p) => !pick.includes(p));
    });
  });
  // Un turno per ogni giorno con partite, in ordine
  const turnOf = new Map(
    [...new Set(placed.map((g) => g.day))].sort((a, b) => a - b).map((d, i) => [d, i] as const),
  );
  return placed.map((g) => ({ turn: turnOf.get(g.day) as number, ...g })).sort((a, b) => a.turn - b.turn);
}

/**
 * Calendario di regular season a giorni, come la NBA: dal martedì di metà ottobre alla domenica di metà aprile,
 * circa 7 partite al giorno, ogni squadra una partita ogni 2 giorni circa con qualche back-to-back. Deterministico
 * dato il seed.
 */
export function generateSchedule(teams: readonly Team[], year: number, seed: string): ScheduledGame[] {
  return spreadDays(generateRounds(teams, year, seed), year, new Rng(`${seed}:giorni:${year}`));
}

/** Turni di regular season del calendario (giorni con partite). */
export function regularTurns(schedule: readonly ScheduledGame[]): number {
  let max = -1;
  for (const g of schedule) if (g.turn > max) max = g.turn;
  return max + 1;
}

/** Giorno della stagione di un turno del calendario, o null se il turno non c'è. */
export function turnDay(schedule: readonly ScheduledGame[], turn: number): number | null {
  return schedule.find((g) => g.turn === turn)?.day ?? null;
}

/** Giorni in cui gioca ogni squadra, in ordine. */
export function teamDays(schedule: readonly ScheduledGame[]): Map<string, number[]> {
  const out = new Map<string, number[]>();
  for (const g of schedule)
    for (const t of [g.homeId, g.awayId]) {
      const list = out.get(t);
      if (list) list.push(g.day);
      else out.set(t, [g.day]);
    }
  for (const list of out.values()) list.sort((a, b) => a - b);
  return out;
}

/** Back-to-back di ogni squadra in un calendario (partite in due giorni consecutivi). */
export function backToBacks(schedule: readonly ScheduledGame[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const [t, days] of teamDays(schedule))
    out.set(t, days.filter((d, i) => i > 0 && d - (days[i - 1] as number) === 1).length);
  return out;
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
  const off = noGameDays(year);
  const turns = regularTurns(schedule);
  const byTurn = new Map<number, ScheduledGame[]>();
  for (const g of schedule) byTurn.set(g.turn, [...(byTurn.get(g.turn) ?? []), g]);
  let prevDay = -1;
  for (let turn = 0; turn < turns; turn++) {
    const inTurn = byTurn.get(turn) ?? [];
    if (inTurn.length === 0) {
      problems.push(`Turno ${turn + 1}: nessuna partita`);
      continue;
    }
    const day = (inTurn[0] as ScheduledGame).day;
    if (inTurn.some((g) => g.day !== day)) problems.push(`Turno ${turn + 1}: partite in giorni diversi`);
    if (day <= prevDay) problems.push(`Turno ${turn + 1}: giorno ${day} non viene dopo il turno prima`);
    if (day < 0 || day > LAST_REGULAR_DAY) problems.push(`Turno ${turn + 1}: giorno ${day} fuori stagione`);
    if (off.has(day)) problems.push(`Turno ${turn + 1}: partite il giorno ${day} (${off.get(day)})`);
    prevDay = day;
    const seen = new Set<string>();
    for (const g of inTurn) {
      for (const id of [g.homeId, g.awayId]) {
        if (seen.has(id)) problems.push(`Turno ${turn + 1}: ${id} gioca due volte`);
        seen.add(id);
      }
    }
    if (turn === turns - 1 && (seen.size !== n || day !== LAST_REGULAR_DAY))
      problems.push(`Ultimo turno: giocano ${seen.size} squadre su ${n}, il giorno ${day}`);
  }
  for (const [t, days] of teamDays(schedule))
    for (let i = 2; i < days.length; i++)
      if ((days[i] as number) - (days[i - 2] as number) === 2)
        problems.push(`${t}: tre partite in tre giorni (dal giorno ${days[i - 2]})`);
  for (const g of schedule) {
    const h = index.get(g.homeId) as number;
    const a = index.get(g.awayId) as number;
    played[h]![a]!++;
    played[a]![h]!++;
    homeGames[h]!++;
  }
  for (let i = 0; i < n; i++) {
    const total = (played[i] as number[]).reduce((x, y) => x + y, 0);
    if (total !== REGULAR_SEASON_GAMES) problems.push(`${(teams[i] as Team).id}: ${total} partite`);
    if (homeGames[i] !== REGULAR_SEASON_GAMES / 2)
      problems.push(`${(teams[i] as Team).id}: ${homeGames[i]} partite in casa`);
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
