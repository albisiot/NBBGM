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

let pending: Promise<void> | null = null;

/** Rilegge le decisioni aperte e aggiorna il numero (una lettura alla volta). */
export function refreshAppBadge(): void {
  if (!(navigator as BadgeNavigator).setAppBadge || pending) return;
  pending = openDecisionsCount()
    .then((n) => setBadge(n))
    .catch(() => undefined)
    .finally(() => {
      pending = null;
    });
}
