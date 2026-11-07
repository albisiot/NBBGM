import { describe, expect, it } from 'vitest';
import { navScrollDelta } from './navScroll.ts';

describe('voce attiva del menu della lega in vista', () => {
  const view = { left: 0, right: 375 };

  it('già in vista: il menu non si muove', () => {
    expect(navScrollDelta(view, { left: 80, right: 160 })).toBe(0);
  });

  it('fuori a destra (Storico su telefono): scorre quanto basta, più un margine', () => {
    expect(navScrollDelta(view, { left: 600, right: 680 })).toBe(680 - 375 + 24);
  });

  it('fuori a sinistra: torna indietro', () => {
    expect(navScrollDelta(view, { left: -200, right: -120 })).toBe(-224);
  });

  it('una voce più larga del menu resta allineata a sinistra', () => {
    expect(navScrollDelta({ left: 0, right: 100 }, { left: 50, right: 300 })).toBe(50);
  });
});
