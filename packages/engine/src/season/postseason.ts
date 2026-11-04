import type { Conference } from '../types.ts';

export interface PlayInGame {
  id: string;
  conference: Conference;
  kind: '7v8' | '9v10' | 'final';
  homeId: string;
  awayId: string;
  winnerId: string | null;
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
}

export interface PostseasonState {
  stage: 'play-in-1' | 'play-in-2' | 'playoffs' | 'done';
  /** Prime 10 di ogni conference a fine regular season. */
  seeds: Record<Conference, string[]>;
  playIn: PlayInGame[];
  series: Series[];
  championId: string | null;
}

export interface PostseasonGame {
  ref: string;
  homeId: string;
  awayId: string;
  phase: 'play-in' | 'playoffs';
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

export function startPostseason(seeds: Record<Conference, string[]>): PostseasonState {
  const playIn: PlayInGame[] = [];
  for (const c of CONFERENCES) {
    const s = seeds[c];
    playIn.push({
      id: `${c}-7v8`,
      conference: c,
      kind: '7v8',
      homeId: s[6] as string,
      awayId: s[7] as string,
      winnerId: null,
    });
    playIn.push({
      id: `${c}-9v10`,
      conference: c,
      kind: '9v10',
      homeId: s[8] as string,
      awayId: s[9] as string,
      winnerId: null,
    });
  }
  return { stage: 'play-in-1', seeds, playIn, series: [], championId: null };
}

/** Partite da giocare in questo turno di post-season. */
export function postseasonGames(state: PostseasonState): PostseasonGame[] {
  if (state.stage === 'play-in-1' || state.stage === 'play-in-2') {
    return state.playIn
      .filter((g) => g.winnerId === null)
      .map((g) => ({ ref: g.id, homeId: g.homeId, awayId: g.awayId, phase: 'play-in' }));
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
      };
    });
}

/** Registra il risultato di una partita di post-season e fa avanzare il tabellone. */
export function applyPostseasonResult(
  state: PostseasonState,
  ref: string,
  winnerId: string,
  betterRecord: (a: string, b: string) => string,
): void {
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
      });
    }
    state.stage = 'play-in-2';
    return;
  }
  if (state.stage === 'play-in-2' && state.playIn.every((g) => g.winnerId)) {
    for (const c of CONFERENCES) {
      const seeds = state.seeds[c];
      const seventh = (state.playIn.find((g) => g.id === `${c}-7v8`) as PlayInGame).winnerId as string;
      const eighth = (state.playIn.find((g) => g.id === `${c}-final`) as PlayInGame).winnerId as string;
      const bySeed = [...seeds.slice(0, 6), seventh, eighth];
      for (const [hi, lo] of BRACKET) {
        state.series.push(
          makeSeries(`${c}-R1-${hi}v${lo}`, 1, c, bySeed[hi - 1] as string, hi, bySeed[lo - 1] as string, lo),
        );
      }
    }
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
  if (round === 3) {
    const [e, w] = CONFERENCES.map((c) => done.find((s) => s.conference === c) as Series);
    const a = (e as Series).winnerId as string;
    const b = (w as Series).winnerId as string;
    const high = betterRecord(a, b);
    state.series.push(makeSeries('Finale', 4, null, high, 0, high === a ? b : a, 0));
    return;
  }
  for (const c of CONFERENCES) {
    const mine = done.filter((s) => s.conference === c);
    // Tabellone fisso: le vincenti di serie vicine si incontrano (1-8 con 4-5, 3-6 con 2-7)
    for (let i = 0; i < mine.length; i += 2) {
      const x = mine[i] as Series;
      const y = mine[i + 1] as Series;
      const seedOf = (s: Series) => (s.winnerId === s.highId ? s.highSeed : s.lowSeed);
      const [hi, lo] = seedOf(x) < seedOf(y) ? [x, y] : [y, x];
      state.series.push(
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
  return { id, round, conference, highId, lowId, highSeed, lowSeed, winsHigh: 0, winsLow: 0, winnerId: null };
}

/** Squadre eliminate al play-in o fuori dalle prime 10: vanno in lottery. */
export function lotteryTeams(
  state: PostseasonState,
  allConferenceRanks: Record<Conference, string[]>,
): string[] {
  const playoff = new Set(state.series.filter((s) => s.round === 1).flatMap((s) => [s.highId, s.lowId]));
  return [...allConferenceRanks.East, ...allConferenceRanks.West].filter((id) => !playoff.has(id));
}
