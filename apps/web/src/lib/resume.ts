// Ritorno in primo piano: un modulo piccolo, perché lo usa anche l'intestazione che si carica all'avvio.

/**
 * Chiama onVisible quando l'app torna in primo piano o la rete torna: mentre era in background (PWA chiusa,
 * telefono bloccato) gli eventi in tempo reale si sono persi. Restituisce la funzione per smettere.
 */
export function onResume(onVisible: () => void): () => void {
  const handler = () => {
    if (document.visibilityState === 'visible') onVisible();
  };
  document.addEventListener('visibilitychange', handler);
  window.addEventListener('online', handler);
  return () => {
    document.removeEventListener('visibilitychange', handler);
    window.removeEventListener('online', handler);
  };
}
