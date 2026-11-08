import { describe, expect, it } from 'vitest';
import { draftShort, draftText } from './playerDraft.ts';

describe('draft in parole', () => {
  it('scelti al primo e al secondo giro', () => {
    expect(draftText({ year: 2018, round: 1, pick: 3 })).toBe('2018, 3ª scelta (1° giro)');
    expect(draftText({ year: 2014, round: 2, pick: 41 })).toBe('2014, 41ª scelta (2° giro)');
    expect(draftShort({ year: 2014, round: 2, pick: 41 })).toBe('2014, n. 41');
  });

  it('non scelti, con e senza anno', () => {
    expect(draftText({ year: null, round: null, pick: null })).toBe('non scelto');
    expect(draftText({ year: 2027, round: null, pick: null })).toBe('non scelto (2027)');
    expect(draftShort({ year: 2027, round: null, pick: null })).toBe('non scelto');
  });

  it('non noto', () => {
    expect(draftText(null)).toBe('—');
    expect(draftText(undefined)).toBe('—');
    expect(draftShort(null)).toBe('—');
  });
});
