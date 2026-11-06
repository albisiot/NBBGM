// Caricamento di dati con stato di attesa ed errore; reload() rilegge.
//
// I dati restano legati ai parametri (deps) con cui sono stati letti: passando dalla lega A alla B la pagina
// non mostra più A mentre carica B, ma aspetta (data null, loading true). Con reload() invece i dati restano
// visibili finché arrivano quelli nuovi. keep: true tiene i dati vecchi anche al cambio dei parametri, per gli
// elenchi che si rileggono solo per sicurezza (le leghe nell'intestazione).
import { useCallback, useEffect, useState } from 'react';
import { friendlyError } from './errors.ts';

/** Stessi parametri, elemento per elemento (come li confronta React). */
export function sameDeps(a: readonly unknown[], b: readonly unknown[]): boolean {
  return a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
}

export interface Loaded<T> {
  /** Parametri con cui sono stati letti dati ed errore. */
  deps: readonly unknown[];
  data: T | null;
  error: string | null;
}

/** Quello che la pagina vede con i parametri attuali: niente dei parametri vecchi, salvo con keep. */
export function visible<T>(
  loaded: Loaded<T> | null,
  deps: readonly unknown[],
  keep = false,
): { data: T | null; error: string | null; current: boolean } {
  if (loaded === null) return { data: null, error: null, current: false };
  const current = sameDeps(loaded.deps, deps);
  if (current) return { data: loaded.data, error: loaded.error, current };
  return { data: keep ? loaded.data : null, error: null, current };
}

export function useAsync<T>(
  load: () => Promise<T>,
  deps: readonly unknown[],
  options: { keep?: boolean } = {},
) {
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let alive = true;
    const key = deps;
    setLoading(true);
    load()
      .then((d) => {
        if (alive) setLoaded({ deps: key, data: d, error: null });
      })
      .catch((e: unknown) => {
        if (!alive) return;
        // Dopo un errore restano i dati letti prima con gli stessi parametri
        setLoaded((old) => ({
          deps: key,
          data: old && sameDeps(old.deps, key) ? old.data : null,
          error: friendlyError(e),
        }));
      })
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // deps decide quando rileggere: load cambia a ogni render
  }, [...deps, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);
  const { data, error, current } = visible(loaded, deps, options.keep);
  // Con parametri nuovi si sta caricando anche prima che parta l'effetto
  return { data, error, loading: loading || !current, reload };
}
