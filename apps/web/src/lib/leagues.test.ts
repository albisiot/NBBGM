import { describe, expect, it } from 'vitest';
import { DEADLINE_OPTIONS, deadlineLabel, PACE_OPTIONS, paceLabel, withCurrent } from './leagues.ts';

describe('impostazioni dei turni per il commissario', () => {
  it('il valore attuale resta tra le scelte anche se non è tra quelle proposte', () => {
    expect(withCurrent(DEADLINE_OPTIONS, 15, deadlineLabel)).toEqual(DEADLINE_OPTIONS);
    const deadlines = withCurrent(DEADLINE_OPTIONS, 90, deadlineLabel);
    expect(deadlines).toHaveLength(DEADLINE_OPTIONS.length + 1);
    expect(deadlines.at(-1)).toEqual({ label: '90 minuti', value: 90 });
    expect(withCurrent(PACE_OPTIONS, 30, paceLabel).at(-1)).toEqual({
      label: 'un turno ogni 30 secondi',
      value: 30,
    });
  });
});
