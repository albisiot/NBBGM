// Pagina da riaprire dopo il login con Google. L'indirizzo di ritorno da Google non tiene la parte dopo #, che
// con l'HashRouter è la pagina (per esempio #/entra/CODICE di un link d'invito): la si salva prima di andare a
// Google e la si rimette al ritorno, prima che parta il router. Con il codice via email non serve: la pagina
// resta nell'indirizzo.

const KEY = 'nbbgm:dopo-login';

/** Il minimo di sessionStorage che serve qui (nei test basta una Map). */
export interface ReturnStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Una pagina dell'app diversa dalla home: "#/entra/ABC123", "#/lega/…". */
const isAppPage = (hash: string) => /^#\/[^/]/.test(hash);

/** Prima di andare a Google: si ricorda la pagina, se non è la home. */
export function saveReturnTo(hash: string, storage: ReturnStorage): void {
  if (isAppPage(hash)) storage.setItem(KEY, hash);
  else storage.removeItem(KEY);
}

/**
 * Al caricamento dell'app: la pagina salvata, se si torna dal login con Google (?code= o ?error= nell'indirizzo)
 * e l'indirizzo non ne indica già un'altra. Il valore salvato si consuma comunque, così non riapre la pagina a
 * un caricamento successivo.
 */
export function takeReturnTo(search: string, hash: string, storage: ReturnStorage): string | null {
  const saved = storage.getItem(KEY);
  storage.removeItem(KEY);
  if (saved === null || !isAppPage(saved)) return null;
  const params = new URLSearchParams(search);
  if (!params.has('code') && !params.has('error')) return null;
  if (isAppPage(hash)) return null;
  return saved;
}

/** sessionStorage del browser, se si può usare (in alcune modalità private dà errore). */
function browserStorage(): ReturnStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/** LoginPage, prima del redirect a Google. */
export function rememberPage(): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    saveReturnTo(window.location.hash, storage);
  } catch {
    // Spazio pieno o storage bloccato: dopo il login si apre la home
  }
}

/** main.tsx, prima di disegnare l'app: rimette nell'indirizzo la pagina salvata. Il ?code= resta a Supabase. */
export function restorePage(): void {
  const storage = browserStorage();
  if (!storage) return;
  try {
    const page = takeReturnTo(window.location.search, window.location.hash, storage);
    if (page)
      window.history.replaceState(
        window.history.state,
        '',
        window.location.pathname + window.location.search + page,
      );
  } catch {
    // Come sopra: si apre la home
  }
}

/**
 * Codice invito della pagina d'invito (#/entra/CODICE), per iscriversi: l'iscrizione è solo su invito e il server
 * accetta un account nuovo con un codice valido nei metadati. Null se la pagina non è un invito.
 */
export function inviteCodeFromHash(hash: string): string | null {
  const m = /^#\/entra\/([^/?#]+)/.exec(hash);
  if (!m?.[1]) return null;
  let code: string;
  try {
    code = decodeURIComponent(m[1]);
  } catch {
    return null;
  }
  code = code.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.length === 6 ? code : null;
}

/** L'iscrizione è stata rifiutata perché manca l'invito (messaggio dell'hook del server). */
export const isInviteRequired = (message: string): boolean => /solo su invito/i.test(message);

/**
 * Errore tornato da Google nell'indirizzo (?error_description=...), per esempio l'iscrizione rifiutata perché
 * l'email non è invitata. Null se non c'è.
 */
export function oauthError(search: string): string | null {
  const params = new URLSearchParams(search);
  if (!params.has('error')) return null;
  return params.get('error_description') || 'Accesso con Google non riuscito.';
}
