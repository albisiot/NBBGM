import { describe, expect, it } from 'vitest';
import { sharedStore, type Source } from './sharedStore.ts';

/** Timer finti: si fanno scattare a mano. */
function fakeTimers() {
  let next = 1;
  const pending = new Map<number, { fn: () => void; at: number }>();
  let now = 0;
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        const id = next++;
        pending.set(id, { fn, at: now + ms });
        return id;
      },
      clear: (h: unknown) => void pending.delete(h as number),
    },
    /** Avanza il tempo e fa scattare i timer scaduti. */
    advance(ms: number) {
      now += ms;
      for (const [id, t] of [...pending]) {
        if (t.at <= now) {
          pending.delete(id);
          t.fn();
        }
      }
    },
    pending: () => pending.size,
  };
}

/** Sorgente finta: conta letture e ascolti; ogni lettura aspetta resolve() del test. */
function fakeSource() {
  let value = 0;
  const waiting: (() => void)[] = [];
  const s = {
    loads: 0,
    listens: 0,
    stops: 0,
    changed: null as (() => void) | null,
    fail: false,
    source: {
      load: () => {
        s.loads++;
        return new Promise<number>((resolve, reject) =>
          waiting.push(() => (s.fail ? reject(new Error('rete')) : resolve(++value))),
        );
      },
      listen: (changed: () => void) => {
        s.listens++;
        s.changed = changed;
        return () => {
          s.stops++;
        };
      },
    } satisfies Source<number>,
    /** Completa le letture in corso. */
    async resolve() {
      while (waiting.length) waiting.shift()!();
      await new Promise((r) => setTimeout(r, 0));
    },
  };
  return s;
}

describe('dati condivisi per chiave', () => {
  it('più iscritti alla stessa chiave: un solo ascolto e una sola lettura', async () => {
    const t = fakeTimers();
    const store = sharedStore<number>({ timers: t.timers });
    const src = fakeSource();
    let seen = 0;
    const a = store.subscribe('L', src.source, () => seen++);
    const b = store.subscribe('L', src.source, () => seen++);
    expect(src.listens).toBe(1);
    expect(src.loads).toBe(1);
    await src.resolve();
    expect(store.snapshot('L').data).toBe(1);
    expect(seen).toBe(2);
    a();
    b();
  });

  it('segnali a raffica valgono come uno; letture in fila, una sola in più se ne arrivano durante una lettura', async () => {
    const t = fakeTimers();
    const store = sharedStore<number>({ timers: t.timers, debounceMs: 300 });
    const src = fakeSource();
    store.subscribe('L', src.source, () => undefined);
    await src.resolve();
    expect(src.loads).toBe(1);
    // Cinque Pronto in pochi istanti: una lettura
    for (let i = 0; i < 5; i++) src.changed!();
    t.advance(299);
    expect(src.loads).toBe(1);
    t.advance(1);
    expect(src.loads).toBe(2);
    // Durante quella lettura arrivano due richieste: una sola lettura dopo, non in parallelo
    void store.refresh('L');
    void store.refresh('L');
    expect(src.loads).toBe(2);
    await src.resolve();
    expect(src.loads).toBe(3);
    await src.resolve();
    expect(store.snapshot('L').data).toBe(3);
  });

  it('cambiando pagina i dati restano: l’ascolto si chiude solo dopo il tempo di grazia', async () => {
    const t = fakeTimers();
    const store = sharedStore<number>({ timers: t.timers, graceMs: 5_000 });
    const src = fakeSource();
    const card = store.subscribe('L', src.source, () => undefined);
    await src.resolve();
    card();
    t.advance(1_000);
    // La barra arriva: stessi dati, nessuna lettura nuova
    const bar = store.subscribe('L', src.source, () => undefined);
    expect(src.loads).toBe(1);
    expect(store.snapshot('L').data).toBe(1);
    t.advance(10_000);
    expect(store.keys()).toEqual(['L']);
    bar();
    t.advance(4_999);
    expect(src.stops).toBe(0);
    t.advance(1);
    expect(src.stops).toBe(1);
    expect(store.keys()).toEqual([]);
    expect(store.snapshot('L').data).toBeNull();
  });

  it('una lettura fallita lascia i dati di prima, con l’errore', async () => {
    const t = fakeTimers();
    const store = sharedStore<number>({ timers: t.timers });
    const src = fakeSource();
    store.subscribe('L', src.source, () => undefined);
    await src.resolve();
    src.fail = true;
    void store.refresh('L');
    await src.resolve();
    expect(store.snapshot('L').data).toBe(1);
    expect((store.snapshot('L').error as Error).message).toBe('rete');
    src.fail = false;
    void store.refresh('L');
    await src.resolve();
    expect(store.snapshot('L')).toEqual({ data: 2, error: null });
  });

  it('chiavi diverse (due leghe) hanno ascolti diversi', async () => {
    const t = fakeTimers();
    const store = sharedStore<number>({ timers: t.timers });
    const a = fakeSource();
    const b = fakeSource();
    store.subscribe('A', a.source, () => undefined);
    store.subscribe('B', b.source, () => undefined);
    expect([a.listens, b.listens]).toEqual([1, 1]);
    expect(store.snapshot('A')).toBe(store.snapshot('B'));
    await a.resolve();
    expect(store.snapshot('A').data).toBe(1);
    expect(store.snapshot('B').data).toBeNull();
  });
});
