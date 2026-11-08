// Play-in e playoff a giorni, come nella NBA. Il play-in si gioca il secondo giorno dopo la fine della regular
// season (l'Est), il terzo (l'Ovest) e il quinto (le due partite per l'ottavo posto); il primo turno di playoff parte
// il giorno dopo. In ogni turno di playoff le serie si dividono in due gruppi che giocano a giorni alterni, e ogni
// serie gioca una partita ogni 2 giorni; il turno dopo parte 2 giorni dopo l'ultima partita del turno prima. Un
// turno del gioco è un giorno con partite: i giorni senza partite si saltano (ma contano come riposo).
import { PLAY_IN_GAP } from './calendar.ts';
import type { Conference } from '../types.ts';

export interface PlayInGame {
  id: string;
  conference: Conference;
  kind: '7v8' | '9v10' | 'final';
  homeId: string;
  awayId: string;
  winnerId: string | null;
  /** Giorno della stagione (giorni dall'apertura) in cui si gioca. */
  day: number;
}

export interface Series {
  id: string;
  /** 1 = primo turno, 2 = semifinali di conference, 3 = finali di conference, 4 = finale. */
  round: 1 | 2 | 3 | 4;
  conference: Conference | null;
  /** Squadra con il fattore campo. */
  highId: string;
  lowId: string;
  highSeed: number;
  lowSeed: number;
  winsHigh: number;
  winsLow: number;
  winnerId: string | null;
  /** Giorno di gara 1: le gare seguono ogni 2 giorni. */
  firstDay: number;
}

export interface PostseasonState {
  stage: 'play-in-1' | 'play-in-2' | 'playoffs' | 'done';
  /** Prime 10 di ogni conference a fine regular season. */
  seeds: Record<Conference, string[]>;
  playIn: PlayInGame[];
  series: Series[];
  championId: string | null;
  /** Giorno dell'ultima partita giocata (all'inizio, l'ultimo giorno di regular season). */
  lastDay: number;
}

export interface PostseasonGame {
  ref: string;
  homeId: string;
  awayId: string;
  phase: 'play-in' | 'playoffs';
  day: number;
}

const CONFERENCES: Conference[] = ['East', 'West'];
const BRACKET: [number, number][] = [
  [1, 8],
  [4, 5],
  [3, 6],
  [2, 7],
];
/** Fattore campo 2-2-1-1-1: partite 1, 2, 5 e 7 in casa della meglio classificata. */
const HIGH_HOME = [true, true, false, false, true, false, true];
/** Giorni tra due gare della stessa serie. */
export const SERIES_GAP = 2;
/** Giorni tra l'ultima partita di un turno di playoff e la prima del turno dopo. */
export const ROUND_BREAK = 2;

export function startPostseason(
  seeds: Record<Conference, string[]>,
  lastRegularDay: number,
): PostseasonState {
  const playIn: PlayInGame[] = [];
  CONFERENCES.forEach((c, i) => {
    const s = seeds[c];
    const day = lastRegularDay + PLAY_IN_GAP + i;
    playIn.push({
      id: `${c}-7v8`,
      conference: c,
      kind: '7v8',
      homeId: s[6] as string,
      awayId: s[7] as string,
      winnerId: null,
      day,
    });
    playIn.push({
      id: `${c}-9v10`,
      conference: c,
      kind: '9v10',
      homeId: s[8] as string,
      awayId: s[9] as string,
      winnerId: null,
      day,
    });
  });
  return { stage: 'play-in-1', seeds, playIn, series: [], championId: null, lastDay: lastRegularDay };
}

/** Giorno della prossima gara di una serie aperta. */
const seriesDay = (s: Series) => s.firstDay + SERIES_GAP * (s.winsHigh + s.winsLow);

/** Tutte le partite ancora da giocare che il tabellone conosce, ognuna con il suo giorno. */
function pending(state: PostseasonState): PostseasonGame[] {
  if (state.stage === 'play-in-1' || state.stage === 'play-in-2') {
    return state.playIn
      .filter((g) => g.winnerId === null)
      .map((g) => ({ ref: g.id, homeId: g.homeId, awayId: g.awayId, phase: 'play-in', day: g.day }));
  }
  if (state.stage !== 'playoffs') return [];
  return state.series
    .filter((s) => s.winnerId === null)
    .map((s) => {
      const highHome = HIGH_HOME[s.winsHigh + s.winsLow] as boolean;
      return {
        ref: s.id,
        homeId: highHome ? s.highId : s.lowId,
        awayId: highHome ? s.lowId : s.highId,
        phase: 'playoffs',
        day: seriesDay(s),
      };
    });
}

/** Partite del prossimo giorno di post-season (il prossimo turno), tutte con lo stesso giorno. */
export function postseasonGames(state: PostseasonState): PostseasonGame[] {
  const all = pending(state);
  if (all.length === 0) return [];
  const day = Math.min(...all.map((g) => g.day));
  return all.filter((g) => g.day === day);
}

/** Giorno del prossimo turno di post-season, o null a post-season finita. */
export function nextPostseasonDay(state: PostseasonState): number | null {
  const all = pending(state);
  return all.length ? Math.min(...all.map((g) => g.day)) : null;
}

/** Registra il risultato di una partita di post-season (giocata il giorno day) e fa avanzare il tabellone. */
export function applyPostseasonResult(
  state: PostseasonState,
  ref: string,
  winnerId: string,
  betterRecord: (a: string, b: string) => string,
  day: number,
): void {
  state.lastDay = Math.max(state.lastDay, day);
  const pi = state.playIn.find((g) => g.id === ref);
  if (pi) {
    pi.winnerId = winnerId;
    advance(state, betterRecord);
    return;
  }
  const s = state.series.find((x) => x.id === ref);
  if (!s || s.winnerId) throw new Error(`Serie ${ref} non attiva`);
  if (winnerId === s.highId) s.winsHigh++;
  else s.winsLow++;
  if (s.winsHigh === 4) s.winnerId = s.highId;
  if (s.winsLow === 4) s.winnerId = s.lowId;
  advance(state, betterRecord);
}

function advance(state: PostseasonState, betterRecord: (a: string, b: string) => string): void {
  if (state.stage === 'play-in-1' && state.playIn.every((g) => g.winnerId)) {
    for (const c of CONFERENCES) {
      const g78 = state.playIn.find((g) => g.id === `${c}-7v8`) as PlayInGame;
      const g910 = state.playIn.find((g) => g.id === `${c}-9v10`) as PlayInGame;
      const loser78 = g78.winnerId === g78.homeId ? g78.awayId : g78.homeId;
      state.playIn.push({
        id: `${c}-final`,
        conference: c,
        kind: 'final',
        homeId: loser78,
        awayId: g910.winnerId as string,
        winnerId: null,
        day: state.lastDay + ROUND_BREAK,
      });
    }
    state.stage = 'play-in-2';
    return;
  }
  if (state.stage === 'play-in-2' && state.playIn.every((g) => g.winnerId)) {
    const created: Series[] = [];
    for (const c of CONFERENCES) {
      const seeds = state.seeds[c];
      const seventh = (state.playIn.find((g) => g.id === `${c}-7v8`) as PlayInGame).winnerId as string;
      const eighth = (state.playIn.find((g) => g.id === `${c}-final`) as PlayInGame).winnerId as string;
      const bySeed = [...seeds.slice(0, 6), seventh, eighth];
      for (const [hi, lo] of BRACKET)
        created.push(
          makeSeries(`${c}-R1-${hi}v${lo}`, 1, c, bySeed[hi - 1] as string, hi, bySeed[lo - 1] as string, lo),
        );
    }
    // Il primo turno parte il giorno dopo le partite per l'ottavo posto
    schedule(state, created, state.lastDay + 1);
    state.stage = 'playoffs';
    return;
  }
  if (state.stage !== 'playoffs') return;
  const open = state.series.filter((s) => !s.winnerId);
  if (open.length) return;
  const round = Math.max(...state.series.map((s) => s.round)) as Series['round'];
  const done = state.series.filter((s) => s.round === round);
  if (round === 4) {
    state.championId = (done[0] as Series).winnerId;
    state.stage = 'done';
    return;
  }
  const start = state.lastDay + ROUND_BREAK;
  if (round === 3) {
    const [e, w] = CONFERENCES.map((c) => done.find((s) => s.conference === c) as Series);
    const a = (e as Series).winnerId as string;
    const b = (w as Series).winnerId as string;
    const high = betterRecord(a, b);
    schedule(state, [makeSeries('Finale', 4, null, high, 0, high === a ? b : a, 0)], start);
    return;
  }
  const created: Series[] = [];
  for (const c of CONFERENCES) {
    const mine = done.filter((s) => s.conference === c);
    // Tabellone fisso: le vincenti di serie vicine si incontrano (1-8 con 4-5, 3-6 con 2-7)
    for (let i = 0; i < mine.length; i += 2) {
      const x = mine[i] as Series;
      const y = mine[i + 1] as Series;
      const seedOf = (s: Series) => (s.winnerId === s.highId ? s.highSeed : s.lowSeed);
      const [hi, lo] = seedOf(x) < seedOf(y) ? [x, y] : [y, x];
      created.push(
        makeSeries(
          `${c}-R${round + 1}-${i / 2 + 1}`,
          (round + 1) as Series['round'],
          c,
          hi.winnerId as string,
          seedOf(hi),
          lo.winnerId as string,
          seedOf(lo),
        ),
      );
    }
  }
  schedule(state, created, start);
}

/** Serie nuove di un turno: a giorni alterni in due gruppi (una sì e una no, nell'ordine del tabellone). */
function schedule(state: PostseasonState, created: Series[], start: number): void {
  created.forEach((s, i) => {
    s.firstDay = start + (i % 2);
    state.series.push(s);
  });
}

function makeSeries(
  id: string,
  round: Series['round'],
  conference: Conference | null,
  highId: string,
  highSeed: number,
  lowId: string,
  lowSeed: number,
): Series {
  return {
    id,
    round,
    conference,
    highId,
    lowId,
    highSeed,
    lowSeed,
    winsHigh: 0,
    winsLow: 0,
    winnerId: null,
    firstDay: 0,
  };
}

/** Squadre eliminate al play-in o fuori dalle prime 10: vanno in lottery. */
export function lotteryTeams(
  state: PostseasonState,
  allConferenceRanks: Record<Conference, string[]>,
): string[] {
  const playoff = new Set(state.series.filter((s) => s.round === 1).flatMap((s) => [s.highId, s.lowId]));
  return [...allConferenceRanks.East, ...allConferenceRanks.West].filter((id) => !playoff.has(id));
}
