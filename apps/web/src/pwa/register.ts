// Registrazione del service worker e avviso di nuova versione. Il service worker nuovo prende subito il posto
// del vecchio (skipWaiting e clients.claim): la pagina aperta resta però alla versione di prima finché non si
// ricarica, quindi si avvisa il manager. L'app installata su iPhone resta in memoria a lungo: gli aggiornamenti
// si cercano anche a ogni ritorno in primo piano.
import { useSyncExternalStore } from 'react';

let updateReady = false;
const listeners = new Set<() => void>();

function announceUpdate(): void {
  if (updateReady) return;
  updateReady = true;
  for (const l of listeners) l();
}

/** true quando è arrivata una versione nuova dell'app e la pagina va ricaricata. */
export function useUpdateReady(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => updateReady,
    () => false,
  );
}

const HOUR = 60 * 60_000;

/** Registra sw.js (solo nella build) e controlla gli aggiornamenti al ritorno in primo piano e ogni ora. */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const sw = navigator.serviceWorker;
  // Il primo service worker che prende il controllo non è un aggiornamento; quelli dopo sì
  let controlled = sw.controller !== null;
  sw.addEventListener('controllerchange', () => {
    if (controlled) announceUpdate();
    controlled = true;
  });
  window.addEventListener('load', () => {
    sw.register('./sw.js')
      .then((registration) => {
        const check = () => {
          if (document.visibilityState === 'visible') registration.update().catch(() => undefined);
        };
        document.addEventListener('visibilitychange', check);
        window.addEventListener('online', check);
        setInterval(check, HOUR);
      })
      .catch(() => {
        // Senza service worker l'app funziona lo stesso, solo non si apre senza rete
      });
  });
}
