import { describe, expect, it } from 'vitest';
import { leagueListLine, roundShort } from './leagueList.ts';
import type { LeagueLive } from './leaguesLive.ts';

const league = { seasonYear: 2026, roundKind: 'regular', roundNumber: 22 };

const live = (l: Partial<LeagueLive>): LeagueLive => ({
  leagueId: 'l1',
  phase: 'open',
  myState: 'waiting',
  ready: 3,
  humans: 5,
  decisions: 0,
  ...l,
});

describe('elenco delle leghe', () => {
  it('turno in breve', () => {
    expect(roundShort('regular', 0)).toBe('Giornata 1');
    expect(roundShort('play-in', 82)).toBe('Play-in');
    expect(roundShort('playoffs', 84)).toBe('Playoff');
    expect(roundShort('offseason', 110)).toBe('Offseason');
    expect(roundShort(null, null)).toBeNull();
  });

  it('tocca a te in rosso, con chi è pronto e le decisioni', () => {
    expect(leagueListLine(league, live({ decisions: 2 }))).toEqual({
      tag: { label: 'Tocca a te', tone: 'red' },
      parts: ['Giornata 23', 'pronti 3 su 5'],
      decisions: '2 decisioni',
      quiet: false,
    });
    // Allenatore fermo da una decisione: tocca comunque a te
    expect(leagueListLine(league, live({ myState: 'blocked', decisions: 1 }))).toMatchObject({
      tag: { label: 'Tocca a te', tone: 'red' },
      decisions: '1 decisione',
    });
  });

  it('pronto o con l’allenatore: niente etichetta', () => {
    expect(leagueListLine(league, live({ myState: 'ready', ready: 4 }))).toEqual({
      tag: null,
      parts: ['Giornata 23', 'pronti 4 su 5', 'sei pronto'],
      decisions: null,
      quiet: false,
    });
    expect(leagueListLine(league, live({ myState: 'coach' })).parts).toContain('con l’allenatore');
  });

  it('simulazione d’inchiostro, turno bloccato in rosso, draft a filo', () => {
    expect(leagueListLine(league, live({ phase: 'closing' }))).toMatchObject({
      tag: { label: 'Si gioca', tone: 'ink' },
      parts: ['Giornata 23', 'la simulazione è in corso'],
    });
    expect(leagueListLine(league, live({ phase: 'late' })).tag).toEqual({ label: 'Si gioca', tone: 'ink' });
    expect(leagueListLine(league, live({ phase: 'failed' })).tag).toEqual({
      label: 'Turno bloccato',
      tone: 'red',
    });
    expect(leagueListLine(league, live({ phase: 'draft' })).tag).toEqual({ label: 'Draft', tone: 'outline' });
  });

  it('lega in pausa in corsivo, senza etichetta', () => {
    expect(
      leagueListLine({ ...league, roundKind: 'offseason' }, live({ phase: 'paused', myState: 'ready' })),
    ).toEqual({
      tag: null,
      parts: ['In pausa', 'Offseason', 'sei pronto'],
      decisions: null,
      quiet: true,
    });
  });

  it('senza stato dal vivo solo il turno', () => {
    expect(leagueListLine(league, null)).toEqual({
      tag: null,
      parts: ['Giornata 23'],
      decisions: null,
      quiet: false,
    });
    expect(leagueListLine({ seasonYear: null, roundKind: null, roundNumber: null }, null).parts).toEqual([
      'In preparazione',
    ]);
  });
});
