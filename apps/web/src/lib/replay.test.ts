import { describe, expect, it } from 'vitest';
import {
  advanceReplay,
  elapsedAt,
  gameLength,
  periodStart,
  readSpoilerFree,
  replayFrame,
  SPOILER_KEY,
  writeSpoilerFree,
} from './replay.ts';
import type { Play } from './results.ts';

// [periodo, secondi alla fine, squadra, testo, punti casa, punti trasferta]
const PLAYS: Play[] = [
  [1, 720, null, 'Palla a due', 0, 0],
  [1, 700, 'h', 'Canestro da 2', 2, 0],
  [1, 650, 'a', 'Tripla', 2, 3],
  [2, 400, 'h', 'Tripla', 5, 3],
  [4, 5, 'a', 'Canestro da 2', 5, 5],
  [5, 0, 'h', 'Libero sulla sirena', 6, 5],
];

describe('tempo della partita', () => {
  it('quarti da 12 minuti, supplementari da 5', () => {
    expect(periodStart(1)).toBe(0);
    expect(periodStart(2)).toBe(720);
    expect(periodStart(5)).toBe(2880);
    expect(periodStart(6)).toBe(3180);
    expect(elapsedAt(1, 720)).toBe(0);
    expect(elapsedAt(2, 400)).toBe(720 + 320);
    expect(elapsedAt(5, 0)).toBe(3180);
    expect(gameLength(PLAYS)).toBe(3180);
    // Senza supplementari la partita dura sempre 48 minuti, anche se la cronaca finisce prima
    expect(gameLength(PLAYS.slice(0, 3))).toBe(2880);
  });

  it('punteggio, periodo, cronometro e azioni già avvenute al secondo t', () => {
    expect(replayFrame(PLAYS, 0)).toMatchObject({ period: 1, clock: 720, home: 0, away: 0, shown: 1 });
    expect(replayFrame(PLAYS, 25)).toMatchObject({ period: 1, clock: 695, home: 2, away: 0, shown: 2 });
    expect(replayFrame(PLAYS, 800)).toMatchObject({ period: 2, clock: 640, home: 2, away: 3, shown: 3 });
    expect(replayFrame(PLAYS, 2000)).toMatchObject({ period: 3, home: 5, away: 3, shown: 4 });
    // A fine quarto si passa al successivo
    expect(replayFrame(PLAYS, 720)).toMatchObject({ period: 2, clock: 720 });
    const ot = replayFrame(PLAYS, 2900);
    expect(ot).toMatchObject({ period: 5, clock: 280, home: 5, away: 5, finished: false });
  });

  it('alla fine: punteggio finale, tutte le azioni, cronometro a zero', () => {
    const end = replayFrame(PLAYS, 99_999);
    expect(end).toMatchObject({ period: 5, clock: 0, home: 6, away: 5, shown: PLAYS.length, finished: true });
    expect(replayFrame([], 3000)).toMatchObject({ finished: true, home: 0, away: 0, period: 4 });
  });

  it('il replay avanza con il tempo vero per la velocità, senza andare oltre la fine', () => {
    expect(advanceReplay(0, 1000, 30, 2880)).toBe(30);
    expect(advanceReplay(100, 500, 10, 2880)).toBe(105);
    expect(advanceReplay(2870, 1000, 90, 2880)).toBe(2880);
    expect(advanceReplay(10, -50, 30, 2880)).toBe(10);
  });
});

describe('senza spoiler', () => {
  it('si ricorda sul dispositivo; senza memoria del browser vale spento', () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(readSpoilerFree(storage)).toBe(false);
    writeSpoilerFree(true, storage);
    expect(store.get(SPOILER_KEY)).toBe('1');
    expect(readSpoilerFree(storage)).toBe(true);
    writeSpoilerFree(false, storage);
    expect(readSpoilerFree(storage)).toBe(false);
    const broken = {
      getItem: () => {
        throw new Error('bloccata');
      },
      setItem: () => {
        throw new Error('bloccata');
      },
      removeItem: () => undefined,
    };
    expect(readSpoilerFree(broken)).toBe(false);
    expect(() => writeSpoilerFree(true, broken)).not.toThrow();
    expect(readSpoilerFree(null)).toBe(false);
  });
});
