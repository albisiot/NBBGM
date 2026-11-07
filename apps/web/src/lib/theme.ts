// Tema dell'app scelto nel profilo: automatico (segue il telefono o il computer), chiaro o scuro. La scelta vale per
// il dispositivo (memoria del browser, nbbgm:tema). index.css lega la variante dark: di Tailwind a data-tema su
// <html>; uno script in index.html lo mette prima del primo disegno, qui si aggiornano anche i controlli del browser
// (color-scheme) e il colore della barra di sistema (theme-color).

export type ThemeChoice = 'auto' | 'chiaro' | 'scuro';

/** Chiave nella memoria del browser: la legge anche lo script in index.html. */
export const THEME_KEY = 'nbbgm:tema';

/** Colore della barra di sistema: carta rosa (stampa-50) nel chiaro, inchiostro (stampa-900) nello scuro. */
export const THEME_COLOR = { chiaro: '#f4dcd3', scuro: '#1b1716' } as const;

/** Un valore salvato: solo chiaro e scuro sono una scelta, tutto il resto è automatico. */
export function parseTheme(value: string | null | undefined): ThemeChoice {
  return value === 'chiaro' || value === 'scuro' ? value : 'auto';
}

/** La scelta di questo dispositivo; automatico se la memoria del browser non c'è o non si legge. */
export function readTheme(): ThemeChoice {
  try {
    return parseTheme(localStorage.getItem(THEME_KEY));
  } catch {
    return 'auto';
  }
}

interface ThemeMeta {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/** Quello che serve del documento (così i test passano un documento finto). */
export interface ThemeDocument {
  documentElement: { dataset: DOMStringMap; style: { colorScheme: string } };
  querySelector(selector: string): ThemeMeta | null;
  querySelectorAll(selector: string): Iterable<ThemeMeta>;
}

/** Applica la scelta alla pagina: data-tema, controlli del browser e colore della barra di sistema. */
export function applyTheme(choice: ThemeChoice, doc: ThemeDocument = document): void {
  const root = doc.documentElement;
  if (choice === 'auto') delete root.dataset.tema;
  else root.dataset.tema = choice;
  // Campi, barre di scorrimento e fondo del browser: con una scelta solo quel tema, altrimenti quello del sistema
  root.style.colorScheme = choice === 'auto' ? '' : choice === 'scuro' ? 'dark' : 'light';
  doc
    .querySelector('meta[name="color-scheme"]')
    ?.setAttribute('content', choice === 'auto' ? 'light dark' : choice === 'scuro' ? 'dark' : 'light');
  // Le due theme-color di index.html (una per tema del sistema): con una scelta tutte e due del colore scelto
  for (const meta of doc.querySelectorAll('meta[name="theme-color"]')) {
    const own = meta.getAttribute('media')?.includes('dark') ? THEME_COLOR.scuro : THEME_COLOR.chiaro;
    meta.setAttribute('content', choice === 'auto' ? own : THEME_COLOR[choice]);
  }
}

/** Salva la scelta su questo dispositivo e la applica subito. */
export function saveTheme(choice: ThemeChoice): void {
  try {
    if (choice === 'auto') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, choice);
  } catch {
    // Senza memoria del browser vale fino alla chiusura della pagina
  }
  applyTheme(choice);
}

/** All'avvio: applica la scelta salvata e segue i cambi fatti da un'altra scheda aperta. */
export function startTheme(): void {
  applyTheme(readTheme());
  window.addEventListener('storage', (e) => {
    if (e.key === THEME_KEY || e.key === null) applyTheme(readTheme());
  });
}
