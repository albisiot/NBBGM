// Stato del turno condiviso per lega e utente: la barra in cima alle pagine, la scheda nella pagina della lega e le
// pagine che si rileggono al cambio di turno (useRoundChange) lo leggono con una sola lettura (turn_status) e lo
// ascoltano con un solo canale in tempo reale e un solo timer di 30 secondi. Prima la barra e la scheda avevano
// ciascuna letture, canale e timer, e ogni pagina un altro canale sui turni.
import { useCallback, useSyncExternalStore } from 'react';
import { friendlyError } from './errors.ts';
import { sharedStore, type Source } from './sharedStore.ts';
import { loadTurn, subscribeTurn, type TurnStatus } from './turns.ts';

export const turnStore = sharedStore<TurnStatus>();

export const turnKey = (leagueId: string, userId: string): string => `${leagueId}:${userId}`;

export function turnSource(leagueId: string, userId: string): Source<TurnStatus> {
  return {
    load: () => loadTurn(leagueId, userId),
    listen: (changed) => subscribeTurn(leagueId, changed),
  };
}

/** Stato del turno della lega, condiviso; reload() lo rilegge subito (dopo un Pronto, una risposta, ...). */
export function useTurn(leagueId: string, userId: string) {
  const key = turnKey(leagueId, userId);
  const subscribe = useCallback(
    (listener: () => void) => turnStore.subscribe(key, turnSource(leagueId, userId), listener),
    [key, leagueId, userId],
  );
  const snapshot = useCallback(() => turnStore.snapshot(key), [key]);
  const snap = useSyncExternalStore(subscribe, snapshot);
  const reload = useCallback(() => void turnStore.refresh(key), [key]);
  return { data: snap.data, error: snap.error ? friendlyError(snap.error) : null, reload };
}

/**
 * Chi guarda il turno corrente: restituisce true quando il turno visto cambia rispetto a quello visto prima (non
 * alla prima lettura, né finché non ci sono dati).
 */
export function roundChangeWatcher(): (data: Pick<TurnStatus, 'round'> | null) => boolean {
  let last: string | null | undefined;
  return (data) => {
    if (!data) return false;
    const id = data.round?.id ?? null;
    const changed = last !== undefined && id !== last;
    last = id;
    return changed;
  };
}
