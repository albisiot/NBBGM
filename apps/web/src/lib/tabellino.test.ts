import { describe, expect, it } from 'vitest';
import type { BoxLine, Play } from './results.ts';
import {
  boxTotals,
  livePartials,
  overtimeShort,
  partialsText,
  rowRule,
  seedZone,
  shotLine,
  standingsRule,
  teamHighs,
  winnerSide,
} from './tabellino.ts';

const line = (over: Partial<BoxLine>): BoxLine => ({
  playerId: 'p',
  teamId: 't',
  name: 'Nome',
  role: 'PG',
  starter: false,
  seconds: 0,
  pts: 0,
  fgm: 0,
  fga: 0,
  tpm: 0,
  tpa: 0,
  ftm: 0,
  fta: 0,
  orb: 0,
  drb: 0,
  ast: 0,
  stl: 0,
  blk: 0,
  tov: 0,
  pf: 0,
  plusMinus: 0,
  ...over,
});

describe('classifica come un tabellino', () => {
  it('filetto pieno dopo il 6° posto, a puntini dopo il 10°, sottile altrove', () => {
    expect([5, 6, 7, 10, 11].map(standingsRule)).toEqual(['thin', 'solid', 'thin', 'dotted', 'thin']);
    expect(seedZone(1)).toBe('playoff');
    expect(seedZone(6)).toBe('playoff');
    expect(seedZone(7)).toBe('play-in');
    expect(seedZone(10)).toBe('play-in');
    expect(seedZone(11)).toBeNull();
  });

  it('i filetti stanno sulle celle (bordi separati), così seguono la colonna fissa', () => {
    expect(rowRule('solid')).toContain('*:border-b-2');
    expect(rowRule('dotted')).toContain('*:border-dotted');
    expect(rowRule('thin')).toContain('*:border-b ');
    expect(rowRule('none')).toBe('');
  });
});

describe('risultati', () => {
  it('supplementari abbreviati come sul giornale', () => {
    expect(overtimeShort(0)).toBe('');
    expect(overtimeShort(null)).toBe('');
    expect(overtimeShort(1)).toBe('d.t.s.');
    expect(overtimeShort(3)).toBe('d.t.s. (3)');
  });

  it('chi ha vinto, e niente vincitore per le partite da giocare', () => {
    expect(winnerSide(104, 112)).toBe('home');
    expect(winnerSide(120, 115)).toBe('away');
    expect(winnerSide(null, null)).toBeNull();
  });

  it('parziali con la squadra in trasferta per prima', () => {
    expect(partialsText({ away: [24, 31], home: [28, 27] })).toBe('24–28, 31–27');
    expect(partialsText(null)).toBe('');
  });
});

describe('partita dal vivo', () => {
  // [periodo, secondi alla fine, squadra, testo, punti casa, punti trasferta]
  const plays: Play[] = [
    [1, 600, 'h', 'canestro', 2, 0],
    [1, 300, 'a', 'tripla', 2, 3],
    [2, 500, 'h', 'canestro', 4, 3],
    [3, 100, 'a', 'canestro', 4, 5],
  ];

  it('mostra i parziali dei soli periodi finiti', () => {
    // Nel 3° quarto: finiti il 1° (3-2 per la trasferta) e il 2° (0-2)
    expect(livePartials(plays, 4, 3, false)).toEqual([
      [3, 2],
      [0, 2],
    ]);
    // Nel 1° quarto nessun parziale
    expect(livePartials(plays, 1, 1, false)).toEqual([]);
  });

  it('a partita finita tutti i periodi, anche quelli senza canestri', () => {
    expect(livePartials(plays, 4, 4, true)).toEqual([
      [3, 2],
      [0, 2],
      [2, 0],
      [0, 0],
    ]);
  });

  it('non guarda le azioni non ancora avvenute', () => {
    // Al 2° quarto con 2 azioni mostrate: il 1° finisce 3-2 anche se dopo arrivano altri canestri
    expect(livePartials(plays, 2, 2, false)).toEqual([[3, 2]]);
  });
});

describe('box score', () => {
  const lines = [
    line({ seconds: 2280, pts: 31, fgm: 11, fga: 21, orb: 2, drb: 6, ast: 5 }),
    line({ seconds: 2160, pts: 22, fgm: 9, fga: 18, orb: 0, drb: 11, ast: 7 }),
    line({ seconds: 9960, pts: 59, fgm: 22, fga: 50, drb: 27, ast: 16 }),
    line({ seconds: 0 }),
  ];

  it('totale con i minuti arrotondati sulla somma', () => {
    const t = boxTotals(lines);
    expect(t.minutes).toBe(240);
    expect(t.pts).toBe(112);
    expect(t.reb).toBe(46);
    expect(shotLine(t.fgm, t.fga)).toBe('42/89');
  });

  it('il migliore della squadra in punti, rimbalzi e assist', () => {
    expect(teamHighs(lines.slice(0, 2))).toEqual({ pts: 31, reb: 11, ast: 7 });
    expect(teamHighs([line({ seconds: 0, pts: 5 })])).toEqual({ pts: 0, reb: 0, ast: 0 });
  });
});
