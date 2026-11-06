import { describe, expect, it } from 'vitest';
import { sameDeps, visible, type Loaded } from './useAsync.ts';

describe('dati legati ai parametri', () => {
  const leagueA: Loaded<string> = { deps: ['A', 'u1'], data: 'lega A', error: null };

  it('confronta i parametri elemento per elemento', () => {
    expect(sameDeps(['A', 1], ['A', 1])).toBe(true);
    expect(sameDeps(['A', 1], ['B', 1])).toBe(false);
    expect(sameDeps(['A'], ['A', undefined])).toBe(false);
    expect(sameDeps([NaN], [NaN])).toBe(true);
  });

  it('con gli stessi parametri si vedono dati ed errore', () => {
    expect(visible(leagueA, ['A', 'u1'])).toEqual({ data: 'lega A', error: null, current: true });
    expect(visible({ ...leagueA, error: 'Rete assente' }, ['A', 'u1']).error).toBe('Rete assente');
  });

  it('passando dalla lega A alla B non si vede più A mentre B carica', () => {
    expect(visible(leagueA, ['B', 'u1'])).toEqual({ data: null, error: null, current: false });
    // Nemmeno l'errore di A
    expect(visible({ ...leagueA, error: 'Rete assente' }, ['B', 'u1']).error).toBeNull();
  });

  it('con keep i dati vecchi restano finché arrivano i nuovi', () => {
    expect(visible(leagueA, ['B', 'u1'], true)).toEqual({ data: 'lega A', error: null, current: false });
  });

  it('prima del primo caricamento non c’è niente', () => {
    expect(visible(null, ['A'])).toEqual({ data: null, error: null, current: false });
  });
});
