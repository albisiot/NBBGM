import { describe, expect, it, vi } from 'vitest';
import { badgeRefresher, setBadge } from './appBadge.ts';

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

  it('una richiesta durante una lettura non si perde: si rilegge dopo, e l’ultimo numero è quello nuovo', async () => {
    // Il server ha 2 decisioni; mentre la prima lettura è in corso il manager risponde a un avviso (ne resta 1)
    let open = 2;
    const pending: (() => void)[] = [];
    const read = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          const value = open;
          pending.push(() => resolve(value));
        }),
    );
    const written: number[] = [];
    const refresh = badgeRefresher(read, (n) => written.push(n));
    const first = refresh();
    open = 1;
    // Due richieste durante la lettura valgono come una sola lettura in più
    void refresh();
    const last = refresh();
    expect(read).toHaveBeenCalledTimes(1);
    pending.shift()?.();
    await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    pending.shift()?.();
    await Promise.all([first, last]);
    expect(written).toEqual([2, 1]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('un errore di rete non ferma gli aggiornamenti successivi', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('rete')).mockResolvedValueOnce(4);
    const written: number[] = [];
    const refresh = badgeRefresher(read, (n) => written.push(n));
    await refresh();
    await refresh();
    expect(written).toEqual([4]);
  });
});
