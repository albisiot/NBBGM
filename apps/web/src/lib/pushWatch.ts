// Iscrizione alle notifiche riallineata con il server: all'avvio dell'app (con il permesso già concesso) e quando
// il service worker avvisa che il browser l'ha cambiata. lib/push.ts (con Supabase e le iscrizioni) si carica
// solo se serve, fuori dal pezzo iniziale.
import { PUSH_CHANGED_MESSAGE } from '../pwa/messages.ts';

const KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();

/** Il messaggio del service worker chiede di riallineare l'iscrizione? */
export function isPushChanged(data: unknown): boolean {
  return (
    typeof data === 'object' && data !== null && (data as { type?: unknown }).type === PUSH_CHANGED_MESSAGE
  );
}

/** Avvia il riallineamento per l'account collegato; restituisce la funzione per smettere. */
export function watchPushSubscription(userId: string): () => void {
  if (!KEY || !('serviceWorker' in navigator)) return () => undefined;
  const sync = () => {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
    import('./push.ts')
      .then((m) => m.syncPush(userId))
      .catch(() => {
        // Senza rete o senza service worker si riprova al prossimo avvio
      });
  };
  sync();
  const onMessage = (e: MessageEvent) => {
    if (isPushChanged(e.data)) sync();
  };
  navigator.serviceWorker.addEventListener('message', onMessage);
  return () => navigator.serviceWorker.removeEventListener('message', onMessage);
}
