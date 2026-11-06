import { describe, expect, it } from 'vitest';
import { RELOAD_GUARD_MS, shouldReload } from './lazyPage.ts';

describe('pezzo di pagina mancante dopo un aggiornamento', () => {
  const now = 1_800_000_000_000;

  it('la prima volta la pagina si ricarica', () => {
    expect(shouldReload(now, null)).toBe(true);
    expect(shouldReload(now, '')).toBe(true);
    expect(shouldReload(now, 'non un numero')).toBe(true);
  });

  it('subito dopo una ricarica no: niente ricariche a catena, decide il manager con Ricarica', () => {
    expect(shouldReload(now, String(now - 5_000))).toBe(false);
    expect(shouldReload(now, String(now - RELOAD_GUARD_MS))).toBe(false);
  });

  it('passato un minuto sì, e anche con un orario nel futuro (orologio cambiato)', () => {
    expect(shouldReload(now, String(now - RELOAD_GUARD_MS - 1))).toBe(true);
    expect(shouldReload(now, String(now + 60_000))).toBe(true);
  });
});
