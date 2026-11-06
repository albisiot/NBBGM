import { describe, expect, it } from 'vitest';
import { saveReturnTo, takeReturnTo, type ReturnStorage } from './returnTo.ts';

function memory(): ReturnStorage & { size: () => number } {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    size: () => m.size,
  };
}

describe('pagina da riaprire dopo il login con Google', () => {
  it('il link d’invito torna dopo il ritorno da Google', () => {
    const s = memory();
    saveReturnTo('#/entra/ABC123', s);
    expect(takeReturnTo('?code=xyz', '', s)).toBe('#/entra/ABC123');
    // Si consuma: al caricamento dopo non riapre l'invito
    expect(s.size()).toBe(0);
    expect(takeReturnTo('?code=xyz', '', s)).toBeNull();
  });

  it('anche se il login non riesce o viene annullato', () => {
    const s = memory();
    saveReturnTo('#/lega/1/mercato?tab=scambi', s);
    expect(takeReturnTo('?error=access_denied&error_description=x', '#/', s)).toBe(
      '#/lega/1/mercato?tab=scambi',
    );
  });

  it('la home non si salva, e senza ritorno da Google non si riapre nulla', () => {
    const s = memory();
    saveReturnTo('#/', s);
    expect(s.size()).toBe(0);
    saveReturnTo('', s);
    expect(s.size()).toBe(0);
    saveReturnTo('#/entra/ABC123', s);
    expect(takeReturnTo('', '', s)).toBeNull();
    expect(s.size()).toBe(0);
  });

  it('se l’indirizzo indica già una pagina vale quella', () => {
    const s = memory();
    saveReturnTo('#/entra/ABC123', s);
    expect(takeReturnTo('?code=xyz', '#/profilo', s)).toBeNull();
  });
});
