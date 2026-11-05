// Pagine con i dati del turno (squadra, mercato, risultati, classifica): quando la lega passa al turno
// successivo si rileggono, così nessuno decide guardando un turno vecchio. Il cambio arriva in tempo reale o, se
// l'app era in background e gli eventi si sono persi, al ritorno in primo piano.
import { useEffect, useRef } from 'react';
import { supabase } from './supabase.ts';
import { channelName, currentRoundId, onResume } from './turns.ts';

/** Chiama onChange quando cambia il turno corrente della lega. */
export function useRoundChange(leagueId: string | undefined, onChange: () => void): void {
  const callback = useRef(onChange);
  useEffect(() => {
    callback.current = onChange;
  });
  useEffect(() => {
    if (!leagueId) return;
    let alive = true;
    let last: string | null | undefined;
    const check = () => {
      currentRoundId(leagueId).then(
        (id) => {
          if (!alive) return;
          if (last !== undefined && id !== last) callback.current();
          last = id;
        },
        () => {
          // Rete assente: si riprova al prossimo segnale
        },
      );
    };
    check();
    const channel = supabase.channel(channelName('pagina', leagueId));
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'rounds', filter: `league_id=eq.${leagueId}` },
      check,
    );
    channel.subscribe();
    const stopResume = onResume(check);
    return () => {
      alive = false;
      stopResume();
      void supabase.removeChannel(channel);
    };
  }, [leagueId]);
}
