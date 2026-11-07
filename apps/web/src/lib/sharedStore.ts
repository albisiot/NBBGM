// Negozio di dati condiviso per chiave: più parti dell'app che vogliono gli stessi dati (barra del turno, scheda del
// turno, pagine che si rileggono al cambio di turno) li leggono una volta sola e li ascoltano insieme.
//   - alla prima iscrizione parte l'ascolto (tempo reale, timer, ritorno in primo piano) e la prima lettura;
//   - i segnali dell'ascolto arrivati a raffica valgono come uno (debounceMs) e le letture vanno in fila: una alla
//     volta, e una richiesta arrivata durante una lettura ne fa partire una sola subito dopo;
//   - quando l'ultimo se ne va, l'ascolto resta ancora graceMs: passando da una pagina all'altra (scheda del turno
//     -> barra) i dati restano e non si rileggono.
// Il modulo non conosce Supabase: le letture e l'ascolto li passa chi si iscrive (lib/turnStore.ts).

export interface Source<T> {
  load: () => Promise<T>;
  /** Ascolta i cambiamenti e chiama changed; restituisce la funzione per smettere. */
  listen: (changed: () => void) => () => void;
}

export interface Snapshot<T> {
  data: T | null;
  error: unknown;
}

export interface SharedStore<T> {
  /** Si iscrive ai dati della chiave; restituisce la funzione per lasciarli. */
  subscribe(key: string, source: Source<T>, listener: () => void): () => void;
  /** Ultimi dati della chiave (lo stesso oggetto finché non cambiano). */
  snapshot(key: string): Snapshot<T>;
  /** Rilegge subito (per esempio dopo un'azione del manager). */
  refresh(key: string): Promise<void>;
  /** Chiavi con l'ascolto attivo (per i test). */
  keys(): string[];
}

interface Timers {
  set: (fn: () => void, ms: number) => unknown;
  clear: (handle: unknown) => void;
}

const realTimers: Timers = {
  set: (fn, ms) => setTimeout(fn, ms),
  clear: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

interface Entry<T> {
  source: Source<T>;
  listeners: Set<() => void>;
  snap: Snapshot<T>;
  stop: () => void;
  running: Promise<void> | null;
  again: boolean;
  debounce: unknown;
  grace: unknown;
}

const EMPTY: Snapshot<never> = Object.freeze({ data: null, error: null });

export function sharedStore<T>(
  opts: { debounceMs?: number; graceMs?: number; timers?: Timers } = {},
): SharedStore<T> {
  const debounceMs = opts.debounceMs ?? 300;
  const graceMs = opts.graceMs ?? 5_000;
  const timers = opts.timers ?? realTimers;
  const entries = new Map<string, Entry<T>>();

  const notify = (e: Entry<T>) => {
    for (const l of [...e.listeners]) l();
  };

  function run(e: Entry<T>): Promise<void> {
    if (e.running) {
      e.again = true;
      return e.running;
    }
    const loop = async () => {
      do {
        e.again = false;
        try {
          e.snap = { data: await e.source.load(), error: null };
        } catch (error) {
          // Restano i dati di prima, con l'errore
          e.snap = { data: e.snap.data, error };
        }
        notify(e);
      } while (e.again);
    };
    e.running = loop().finally(() => {
      e.running = null;
    });
    return e.running;
  }

  function schedule(e: Entry<T>) {
    if (e.debounce !== null) return;
    e.debounce = timers.set(() => {
      e.debounce = null;
      void run(e);
    }, debounceMs);
  }

  return {
    subscribe(key, source, listener) {
      let e = entries.get(key);
      if (!e) {
        const entry: Entry<T> = {
          source,
          listeners: new Set(),
          snap: EMPTY,
          stop: () => undefined,
          running: null,
          again: false,
          debounce: null,
          grace: null,
        };
        entries.set(key, entry);
        entry.stop = source.listen(() => schedule(entry));
        void run(entry);
        e = entry;
      } else if (e.grace !== null) {
        timers.clear(e.grace);
        e.grace = null;
      }
      const entry = e;
      entry.listeners.add(listener);
      return () => {
        entry.listeners.delete(listener);
        if (entry.listeners.size > 0 || entry.grace !== null) return;
        entry.grace = timers.set(() => {
          entry.grace = null;
          if (entry.listeners.size > 0) return;
          entries.delete(key);
          if (entry.debounce !== null) timers.clear(entry.debounce);
          entry.debounce = null;
          entry.stop();
        }, graceMs);
      };
    },
    snapshot(key) {
      return entries.get(key)?.snap ?? EMPTY;
    },
    refresh(key) {
      const e = entries.get(key);
      return e ? run(e) : Promise.resolve();
    },
    keys() {
      return [...entries.keys()];
    },
  };
}
