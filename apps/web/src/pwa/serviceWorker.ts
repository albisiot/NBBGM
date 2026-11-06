// Service worker di NBBGM: il testo di sw.js lo genera la build (vite.config.ts) con serviceWorkerSource. Le
// regole che contano stanno in funzioni pure, copiate così come sono nel service worker e provate nei test:
//   - la pagina si chiede sempre alla rete senza la cache HTTP (cache: 'no-cache'): una pagina vecchia
//     punterebbe a file della build precedente, che dopo l'aggiornamento non ci sono più;
//   - come pagina dell'app (per aprirla senza rete) si salva solo la pagina dell'app vera: risposta 200, non
//     deviata, HTML con il segno di NBBGM. Non privacy.html, non la pagina di un portale Wi-Fi;
//   - senza rete: la pagina chiesta se è in cache (privacy.html), altrimenti la pagina dell'app;
//   - notifiche push: testo, pagina e numero sull'icona arrivano dal server (Edge Function push); toccando la
//     notifica si apre quella pagina, nella finestra dell'app se è già aperta;
//   - se il browser cambia l'iscrizione (pushsubscriptionchange) se ne fa una nuova e lo si dice alle finestre
//     aperte, che la salvano sul server.
// Supabase e gli altri siti non passano mai dal service worker.
import { PUSH_CHANGED_MESSAGE } from './messages.ts';

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

/** Notifica da mostrare per un messaggio push (JSON della Edge Function push), con valori di riserva. */
export function notificationFromPush(
  data: unknown,
  scope: string,
): {
  title: string;
  options: {
    body: string;
    tag: string;
    renotify: boolean;
    icon: string;
    badge: string;
    data: { url: string };
  };
  badge: number | null;
} {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  const text = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v : fallback);
  const tag = text(d.tag, 'nbbgm');
  return {
    title: text(d.title, 'NBBGM'),
    options: {
      body: text(d.body, 'C’è una novità nella tua lega.'),
      tag,
      renotify: d.renotify !== false,
      icon: new URL('icons/icon-192.png', scope).href,
      badge: new URL('icons/icon-192.png', scope).href,
      data: { url: notificationTarget(d.url, scope) },
    },
    badge: typeof d.badge === 'number' && d.badge >= 0 ? Math.floor(d.badge) : null,
  };
}

/** Pagina da aprire toccando la notifica: solo pagine del sito dell'app, altrimenti la home dell'app. */
export function notificationTarget(url: unknown, scope: string): string {
  const fallback = new URL('./', scope).href;
  if (typeof url !== 'string' || !url) return fallback;
  try {
    const target = new URL(url, scope);
    return target.href.startsWith(fallback) ? target.href : fallback;
  } catch {
    return fallback;
  }
}

/** Chiave pubblica VAPID in base64url -> byte (come in lib/push.ts), per scriverla dentro sw.js. */
export function vapidKeyBytes(key: string): number[] {
  if (!key) return [];
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  return Array.from(bin, (c) => c.charCodeAt(0));
}

/**
 * Testo di sw.js: versione della build (cambia a ogni pubblicazione), file da tenere in cache e chiave pubblica
 * VAPID (per rifare l'iscrizione quando il browser la cambia; vuota senza notifiche).
 */
export function serviceWorkerSource(version: string, shell: readonly string[], vapidKey = ''): string {
  return `// Service worker di NBBGM, generato in build (apps/web/src/pwa/serviceWorker.ts).
const CACHE = 'nbbgm-${version}';
const SHELL = ${JSON.stringify(shell)};
const VAPID_KEY = ${JSON.stringify(vapidKeyBytes(vapidKey))};
const PUSH_CHANGED = ${JSON.stringify(PUSH_CHANGED_MESSAGE)};
const isAppShellResponse = ${isAppShellResponse.toString()};
const looksLikeAppShell = ${looksLikeAppShell.toString()};
const notificationTarget = ${notificationTarget.toString()};
const notificationFromPush = ${notificationFromPush.toString()};

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

// Notifica push dal server: si mostra (obbligatorio per le notifiche visibili) e aggiorna il numero sull'icona
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const n = notificationFromPush(data, self.registration.scope);
  const badge =
    n.badge === null || !self.navigator || !self.navigator.setAppBadge
      ? Promise.resolve()
      : (n.badge > 0 ? self.navigator.setAppBadge(n.badge) : self.navigator.clearAppBadge()).catch(() => undefined);
  event.waitUntil(Promise.all([self.registration.showNotification(n.title, n.options), badge]));
});

// Tocco sulla notifica: la pagina giusta, nella finestra dell'app se c'è già
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = notificationTarget(event.notification.data && event.notification.data.url, self.registration.scope);
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      const open = list.find((c) => c.url.startsWith(self.registration.scope));
      if (open) return open.focus().then((c) => (c || open).navigate(url)).catch(() => self.clients.openWindow(url));
      return self.clients.openWindow(url);
    }),
  );
});

// Il browser ha cambiato (o tolto) l'iscrizione alle notifiche: se ne fa una nuova con la chiave dell'app e si
// avvisano le finestre aperte, che la salvano sul server (il service worker non ha il login). Senza finestre aperte
// la salva l'app al prossimo avvio, quando riallinea l'iscrizione.
self.addEventListener('pushsubscriptionchange', (event) => {
  const old = event.oldSubscription;
  const key = VAPID_KEY.length
    ? new Uint8Array(VAPID_KEY)
    : old && old.options && old.options.applicationServerKey;
  const renew = event.newSubscription
    ? Promise.resolve(event.newSubscription)
    : key
      ? self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key })
      : Promise.resolve(null);
  event.waitUntil(
    renew
      .catch(() => null)
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then((list) => {
        for (const c of list) c.postMessage({ type: PUSH_CHANGED });
      }),
  );
});
`;
}
