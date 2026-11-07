// Partita "dal vivo": si rigioca dalla cronaca salvata (formato compatto di compactPlayByPlay: [periodo, secondi
// alla fine del periodo, squadra, testo, punti casa, punti trasferta]) con il punteggio e il cronometro che
// scorrono. Funzioni pure: il tempo della partita in secondi dall'inizio, quarti da 12 minuti e supplementari da 5.
import type { Play } from './results.ts';

/** Durata di un periodo in secondi: 12 minuti i quarti, 5 i supplementari. */
export const periodLength = (period: number): number => (period <= 4 ? 720 : 300);

/** Secondi di gioco prima dell'inizio del periodo. */
export function periodStart(period: number): number {
  let t = 0;
  for (let p = 1; p < period; p++) t += periodLength(p);
  return t;
}

/** Secondi di gioco dall'inizio della partita per un momento della cronaca. */
export const elapsedAt = (period: number, secondsLeft: number): number =>
  periodStart(period) + periodLength(period) - Math.max(0, Math.min(secondsLeft, periodLength(period)));

/** Durata della partita: fino alla fine dell'ultimo periodo giocato (almeno 4 quarti). */
export function gameLength(plays: readonly Play[]): number {
  const last = plays.reduce((m, p) => Math.max(m, p[0]), 4);
  return periodStart(last) + periodLength(last);
}

export interface ReplayFrame {
  /** Periodo e secondi alla fine del periodo al momento t. */
  period: number;
  clock: number;
  home: number;
  away: number;
  /** Azioni avvenute fino a t: le prime `shown` della cronaca. */
  shown: number;
  finished: boolean;
}

/**
 * Situazione al secondo t della partita. La cronaca è in ordine di tempo; il punteggio è quello dell'ultima azione
 * già avvenuta. Alla fine (t oltre la durata) il punteggio è quello finale e si vedono tutte le azioni.
 */
export function replayFrame(plays: readonly Play[], t: number): ReplayFrame {
  const total = gameLength(plays);
  const time = Math.max(0, Math.min(t, total));
  let shown = 0;
  while (shown < plays.length) {
    const p = plays[shown] as Play;
    if (elapsedAt(p[0], p[1]) > time) break;
    shown++;
  }
  const finished = time >= total;
  if (finished) shown = plays.length;
  const last = shown > 0 ? (plays[shown - 1] as Play) : null;
  // Periodo e cronometro dal tempo: allo scadere di un periodo si passa al successivo (12:00 o 5:00)
  let period = 1;
  while (period < 99 && time >= periodStart(period) + periodLength(period) && !finished) period++;
  if (finished) period = Math.max(4, ...plays.map((p) => p[0]));
  const clock = finished ? 0 : periodStart(period) + periodLength(period) - time;
  return { period, clock, home: last?.[4] ?? 0, away: last?.[5] ?? 0, shown, finished };
}

/** Velocità del replay: secondi di gioco per secondo vero (una partita a ×30 dura poco più di un minuto e mezzo). */
export const REPLAY_SPEEDS = [10, 30, 90] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** Il tempo dopo dt millisecondi veri alla velocità data, senza andare oltre la fine. */
export function advanceReplay(t: number, dtMs: number, speed: number, total: number): number {
  return Math.min(total, t + (Math.max(0, dtMs) / 1000) * speed);
}

/** Memoria del browser per i Risultati senza spoiler (punteggi nascosti finché non si guarda la partita). */
export const SPOILER_KEY = 'nbbgm:senza-spoiler';

export function readSpoilerFree(storage: Pick<Storage, 'getItem'> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(SPOILER_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSpoilerFree(
  on: boolean,
  storage: Pick<Storage, 'setItem' | 'removeItem'> | null = safeStorage(),
): void {
  try {
    if (on) storage?.setItem(SPOILER_KEY, '1');
    else storage?.removeItem(SPOILER_KEY);
  } catch {
    // Senza memoria del browser l'opzione vale finché la pagina resta aperta
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
