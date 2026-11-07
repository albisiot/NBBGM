import { describe, expect, it } from 'vitest';
import { roundChangeWatcher, turnKey } from './turnStore.ts';

const at = (id: string | null) => ({ round: id === null ? null : ({ id } as never) });

describe('cambio di turno visto dalle pagine', () => {
  it('non alla prima lettura né senza dati; sì quando il turno cambia, una volta', () => {
    const changed = roundChangeWatcher();
    expect(changed(null)).toBe(false);
    expect(changed(at('r1'))).toBe(false);
    expect(changed(at('r1'))).toBe(false);
    expect(changed(null)).toBe(false);
    expect(changed(at('r2'))).toBe(true);
    expect(changed(at('r2'))).toBe(false);
    // Una lega senza turno (draft iniziale) e poi il primo turno
    const fresh = roundChangeWatcher();
    expect(fresh(at(null))).toBe(false);
    expect(fresh(at('r1'))).toBe(true);
  });

  it('lo stato è per lega e utente', () => {
    expect(turnKey('L', 'u')).not.toBe(turnKey('L', 'v'));
    expect(turnKey('L', 'u')).not.toBe(turnKey('M', 'u'));
  });
});
