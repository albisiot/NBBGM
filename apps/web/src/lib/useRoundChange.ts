// Pagine con i dati del turno (squadra, mercato, risultati, classifica): quando la lega passa al turno
// successivo si rileggono, così nessuno decide guardando un turno vecchio. Il cambio lo dice lo stato del turno
// condiviso con la barra (lib/turnStore.ts): in tempo reale, ogni 30 secondi o al ritorno in primo piano, senza un
// canale e una lettura in più per ogni pagina.
import { useEffect, useRef } from 'react';
import { useUserId } from './auth.tsx';
import { roundChangeWatcher, turnKey, turnSource, turnStore } from './turnStore.ts';

/** Chiama onChange quando cambia il turno corrente della lega. */
export function useRoundChange(leagueId: string | undefined, onChange: () => void): void {
  const userId = useUserId();
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  useEffect(() => {
    if (!leagueId) return;
    const key = turnKey(leagueId, userId);
    const changed = roundChangeWatcher();
    const check = () => {
      if (changed(turnStore.snapshot(key).data)) callback.current();
    };
    const stop = turnStore.subscribe(key, turnSource(leagueId, userId), check);
    // Dati già in memoria (la barra li ha letti): sono il turno di partenza
    check();
    return stop;
  }, [leagueId, userId]);
}
