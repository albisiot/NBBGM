import { DEFAULT_TACTICS } from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import { settingsProblems } from './roster.ts';

const roster = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

describe('controlli delle impostazioni', () => {
  it('impostazioni valide', () => {
    const minutes = { a: 36, b: 36, c: 36, d: 36, e: 36, f: 30, g: 30 };
    expect(
      settingsProblems({ starters: ['a', 'b', 'c', 'd', 'e'], minutes, tactics: DEFAULT_TACTICS }, roster),
    ).toEqual([]);
  });

  it('segnalano somma, titolari ripetuti e minuti fuori scala', () => {
    const problems = settingsProblems(
      { starters: ['a', 'a', 'c', 'd', 'z'], minutes: { a: 50, b: 20 }, tactics: DEFAULT_TACTICS },
      roster,
    );
    expect(problems.join(' ')).toMatch(/5 titolari diversi/);
    expect(problems.join(' ')).toMatch(/non è più in squadra/);
    expect(problems.join(' ')).toMatch(/240 \(ora 70\)/);
    expect(problems.join(' ')).toMatch(/da 0 a 48/);
  });
});
