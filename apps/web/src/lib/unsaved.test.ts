import { describe, expect, it } from 'vitest';
import { clearUnsaved, getUnsaved, setUnsaved, type Unsaved } from './unsaved.ts';

describe('modifiche non salvate in Squadra (seconda analisi)', () => {
  it('valgono per la loro lega e le toglie solo chi le ha messe', async () => {
    const saves: string[] = [];
    const a: Unsaved = { leagueId: 'A', save: async () => (saves.push('A'), true) };
    expect(getUnsaved('A')).toBeNull();
    setUnsaved(a);
    expect(getUnsaved('A')).toBe(a);
    expect(getUnsaved('B')).toBeNull();
    expect(await getUnsaved('A')!.save()).toBe(true);
    expect(saves).toEqual(['A']);
    // Una pagina nuova le ha già sostituite: quella vecchia che se ne va non le toglie
    const b: Unsaved = { leagueId: 'A', save: async () => false };
    setUnsaved(b);
    clearUnsaved(a);
    expect(getUnsaved('A')).toBe(b);
    clearUnsaved(b);
    expect(getUnsaved('A')).toBeNull();
  });
});
