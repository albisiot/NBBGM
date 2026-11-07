import { describe, expect, it } from 'vitest';
import { clearUnsaved, getUnsaved, minutesLine, setUnsaved, unsavedLine, type Unsaved } from './unsaved.ts';

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

describe('barra del turno con le modifiche da salvare (stile Edicola)', () => {
  it('i minuti: giusti, mancanti o di troppo', () => {
    expect(minutesLine(240)).toBe('240 su 240 minuti');
    expect(minutesLine(239)).toBe('239 su 240 minuti: ne manca 1');
    expect(minutesLine(232)).toBe('232 su 240 minuti: ne mancano 8');
    expect(minutesLine(243)).toBe('243 su 240 minuti: 3 di troppo');
  });

  it('in rosso i minuti sbagliati, poi quello che impedisce di salvare', () => {
    expect(unsavedLine({ minutes: 240, problem: null })).toEqual({ text: '240 su 240 minuti', alert: false });
    // Con i minuti sbagliati conta il totale, non la frase del controllo
    expect(unsavedLine({ minutes: 238, problem: 'La somma dei minuti deve fare 240 (ora 238).' })).toEqual({
      text: '238 su 240 minuti: ne mancano 2',
      alert: true,
    });
    expect(unsavedLine({ minutes: 240, problem: 'Manca un titolare: sceglilo nel quintetto.' })).toEqual({
      text: 'Manca un titolare: sceglilo nel quintetto.',
      alert: true,
    });
    // Una pagina che non dice i minuti (app di prima)
    expect(unsavedLine({})).toEqual({ text: 'Modifiche non salvate', alert: false });
  });

  it('i dati della barra viaggiano con le modifiche', () => {
    let discarded = false;
    const entry: Unsaved = {
      leagueId: 'C',
      save: async () => true,
      minutes: 236,
      problem: 'La somma dei minuti deve fare 240 (ora 236).',
      discard: () => {
        discarded = true;
      },
    };
    setUnsaved(entry);
    getUnsaved('C')?.discard?.();
    expect(discarded).toBe(true);
    expect(getUnsaved('C')?.minutes).toBe(236);
    clearUnsaved(entry);
  });
});
