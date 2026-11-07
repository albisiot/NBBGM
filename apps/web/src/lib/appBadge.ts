// Numero sull'icona dell'app installata (navigator.setAppBadge): le decisioni bloccanti aperte in tutte le leghe.
// Dove il browser non lo permette (Firefox, Safari fuori dalla PWA, iPhone senza il permesso per le notifiche)
// non succede nulla. Lo aggiorna anche il service worker quando arriva una notifica.
import { supabase } from './supabase.ts';

interface BadgeNavigator {
  setAppBadge?: (n?: number) => Promise<void>;
  clearAppBadge?: () => Promise<void>;
}

/** Mette sull'icona il numero, o lo toglie se è zero. */
export function setBadge(n: number, nav: BadgeNavigator = navigator as BadgeNavigator): void {
  if (!nav.setAppBadge) return;
  const done = n > 0 ? nav.setAppBadge(n) : (nav.clearAppBadge?.() ?? nav.setAppBadge(0));
  done.catch(() => undefined);
}

/**
 * Decisioni bloccanti aperte in tutte le leghe del manager (la RLS lascia vedere solo gli avvisi delle proprie
 * squadre).
 */
export async function openDecisionsCount(): Promise<number> {
  const { count, error } = await supabase
    .from('alerts')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .eq('blocking', true);
  if (error) throw error;
  return count ?? 0;
}

/**
 * Aggiornamenti del numero in fila: una lettura alla volta, e una richiesta arrivata durante una lettura non si
 * perde ma ne fa partire un'altra subito dopo (le richieste arrivate nel frattempo valgono tutte come una). Così
 * l'ultimo numero scritto viene da una lettura partita dopo l'ultima richiesta: mai un numero vecchio.
 */
export function badgeRefresher(read: () => Promise<number>, write: (n: number) => void): () => Promise<void> {
  let running: Promise<void> | null = null;
  let again = false;
  const loop = async () => {
    do {
      again = false;
      try {
        write(await read());
      } catch {
        // Rete assente: il numero resta com'era fino al prossimo aggiornamento
      }
    } while (again);
  };
  return () => {
    if (running) {
      again = true;
      return running;
    }
    running = loop().finally(() => {
      running = null;
    });
    return running;
  };
}

const refresh = badgeRefresher(openDecisionsCount, (n) => setBadge(n));

/** Rilegge le decisioni aperte e aggiorna il numero sull'icona. */
export function refreshAppBadge(): void {
  if (!(navigator as BadgeNavigator).setAppBadge) return;
  void refresh();
}
