import { describe, expect, it } from 'vitest';
import { chronicleWhen, groupChronicle, mentions, splitTeams, type ChronicleEntry } from './chronicle.ts';

const entry = (over: Partial<ChronicleEntry>): ChronicleEntry => ({
  id: 1,
  seasonYear: 2026,
  roundNumber: 4,
  type: 'signing',
  text: '',
  teamCodes: [],
  createdAt: '',
  ...over,
});

describe('cronaca della lega', () => {
  it('sigle delle squadre come collegamenti, il resto come testo', () => {
    expect(splitTeams('Scambio: LAL cede Mario Rossi a NYK per niente', ['LAL', 'NYK'])).toEqual([
      { text: 'Scambio: ' },
      { code: 'LAL' },
      { text: ' cede Mario Rossi a ' },
      { code: 'NYK' },
      { text: ' per niente' },
    ]);
    expect(splitTeams('BOS firma X', ['BOS'])).toEqual([{ code: 'BOS' }, { text: ' firma X' }]);
    // Solo parole intere: "BOSTON" non è BOS
    expect(splitTeams('Ritorno a BOSTON', ['BOS'])).toEqual([{ text: 'Ritorno a BOSTON' }]);
    expect(splitTeams('Si ritira', [])).toEqual([{ text: 'Si ritira' }]);
  });

  it('la sigla citata come parola intera', () => {
    expect(mentions('BOS taglia Mario', 'BOS')).toBe(true);
    expect(mentions('Draft: BOSX sceglie', 'BOS')).toBe(false);
    expect(mentions('qualunque', '')).toBe(false);
  });

  it('intestazioni per stagione e giornata', () => {
    expect(chronicleWhen(entry({ roundNumber: 12 }))).toBe('Stagione 2026-27 · giornata 13');
    expect(chronicleWhen(entry({ roundNumber: null, seasonYear: 2027 }))).toBe(
      'Stagione 2027-28 · offseason',
    );
    expect(chronicleWhen(entry({ roundNumber: 85 }))).toBe('Stagione 2026-27 · post-season');
    const groups = groupChronicle([
      entry({ id: 3, roundNumber: 5 }),
      entry({ id: 2, roundNumber: 5 }),
      entry({ id: 1, roundNumber: 4 }),
    ]);
    expect(groups.map((g) => [g.when, g.entries.map((e) => e.id)])).toEqual([
      ['Stagione 2026-27 · giornata 6', [3, 2]],
      ['Stagione 2026-27 · giornata 5', [1]],
    ]);
  });
});
