// Service worker di NBBGM: il testo di sw.js lo genera la build (vite.config.ts) con serviceWorkerSource. Le
// regole che contano stanno in funzioni pure, copiate così come sono nel service worker e provate nei test:
//   - la pagina si chiede sempre alla rete senza la cache HTTP (cache: 'no-cache'): una pagina vecchia
//     punterebbe a file della build precedente, che dopo l'aggiornamento non ci sono più;
//   - come pagina dell'app (per aprirla senza rete) si salva solo la pagina dell'app vera: risposta 200, non
//     deviata, HTML con il segno di NBBGM. Non privacy.html, non la pagina di un portale Wi-Fi;
//   - senza rete: la pagina chiesta se è in cache (privacy.html), altrimenti la pagina dell'app.
// Supabase e gli altri siti non passano mai dal service worker.

/** Quanto serve di una Response per decidere se è la pagina dell'app. */
export interface ResponseInfo {
  ok: boolean;
  status: number;
  redirected: boolean;
  type: string;
  url: string;
  headers: { get(name: string): string | null };
}

/** La risposta a una navigazione è la pagina dell'app (la radice del sito o index.html), intera e non deviata. */
export function isAppShellResponse(response: ResponseInfo, scope: string): boolean {
  if (!response.ok || response.status !== 200 || response.redirected || response.type === 'opaqueredirect')
    return false;
  if (!(response.headers.get('content-type') || '').includes('text/html')) return false;
  const path = new URL(response.url).pathname;
  const root = new URL(scope).pathname;
  return path === root || path === root + 'index.html';
}

/** L'HTML è quello dell'app (index.html ha il meta application-name NBBGM e il div root), non un'altra pagina. */
export function looksLikeAppShell(html: string): boolean {
  return /<meta\s+name="application-name"\s+content="NBBGM"/.test(html) && html.includes('id="root"');
}

/** Testo di sw.js: versione della build (cambia a ogni pubblicazione) e file da tenere in cache. */
export function serviceWorkerSource(version: string, shell: readonly string[]): string {
  return `// Service worker di NBBGM, generato in build (apps/web/src/pwa/serviceWorker.ts).
const CACHE = 'nbbgm-${version}';
const SHELL = ${JSON.stringify(shell)};
const isAppShellResponse = ${isAppShellResponse.toString()};
const looksLikeAppShell = ${looksLikeAppShell.toString()};

// I file si scaricano senza la cache HTTP: una pagina vecchia di qualche minuto punterebbe alla build di prima
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nbbgm-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// La pagina dell'app vera si salva per aprirla senza rete; qualunque altra risposta passa e basta
function remember(event, response) {
  if (!isAppShellResponse(response, self.registration.scope)) return;
  const copy = response.clone();
  event.waitUntil(
    copy.text().then((html) => {
      if (!looksLikeAppShell(html)) return;
      return caches.open(CACHE).then((c) =>
        c.put('./', new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } })),
      );
    }),
  );
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // Supabase e gli altri siti: sempre dalla rete
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // Dalla rete senza cache HTTP; i reindirizzamenti li segue il browser
    const fresh = new Request(request.url, { cache: 'no-cache', credentials: 'same-origin', redirect: 'manual' });
    event.respondWith(
      fetch(fresh)
        .then((response) => {
          remember(event, response);
          return response;
        })
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./'))),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`;
}
