// Pagine caricate a pezzi (React.lazy): all'avvio si scarica e si legge solo il codice che serve, il resto
// arriva quando si apre la pagina (dalla cache del service worker, che li tiene tutti).
//
// Un pezzo può mancare se nel frattempo è uscita una versione nuova: il service worker nuovo toglie dalla cache i
// file della vecchia, che sul sito non ci sono più. In quel caso la pagina si ricarica una volta da sola e con la
// pagina nuova arrivano i pezzi nuovi. Se il pezzo manca ancora (per esempio senza rete) l'errore va
// all'ErrorBoundary, con il pulsante Ricarica.
import { lazy, type ComponentType, type LazyExoticComponent } from 'react';

const RELOAD_KEY = 'nbbgm:ricarica-per-pezzo';
/** Entro quanto un secondo errore non fa ricaricare di nuovo (niente ricariche a catena). */
export const RELOAD_GUARD_MS = 60_000;

/** Ricaricare dopo un pezzo mancante? Sì, se non si è già ricaricato per questo da poco. */
export function shouldReload(now: number, lastReload: string | null): boolean {
  const last = Number(lastReload);
  return !lastReload || !Number.isFinite(last) || now - last > RELOAD_GUARD_MS || now < last;
}

function reloadOnce(): boolean {
  try {
    const now = Date.now();
    if (!shouldReload(now, sessionStorage.getItem(RELOAD_KEY))) return false;
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    // Senza sessionStorage non si può evitare una ricarica a catena: decide il manager con Ricarica
    return false;
  }
  window.location.reload();
  return true;
}

/** Una pagina esportata con nome, caricata quando serve. */
export function lazyPage<K extends string>(
  load: () => Promise<Record<K, ComponentType>>,
  name: K,
): LazyExoticComponent<ComponentType> {
  return lazy<ComponentType>(() =>
    load().then(
      (m) => ({ default: m[name] }),
      (e: unknown) => {
        // La pagina si sta ricaricando: si aspetta senza mostrare l'errore
        if (reloadOnce()) return new Promise<never>(() => undefined);
        throw e;
      },
    ),
  );
}
