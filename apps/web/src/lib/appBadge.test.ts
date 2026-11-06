import { describe, expect, it, vi } from 'vitest';
import { setBadge } from './appBadge.ts';

describe('numero sull’icona', () => {
  it('mette il numero delle decisioni e lo toglie a zero', () => {
    const nav = {
      setAppBadge: vi.fn(() => Promise.resolve()),
      clearAppBadge: vi.fn(() => Promise.resolve()),
    };
    setBadge(3, nav);
    expect(nav.setAppBadge).toHaveBeenCalledWith(3);
    setBadge(0, nav);
    expect(nav.clearAppBadge).toHaveBeenCalled();
  });

  it('dove il browser non lo permette non fa nulla', () => {
    expect(() => setBadge(2, {})).not.toThrow();
  });
});
