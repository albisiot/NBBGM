import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { defineConfig, type Plugin } from 'vite';

// File di public/ che il service worker tiene in cache insieme a quelli della build
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icon.svg',
  'privacy.html',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

/**
 * Service worker generato in build con l'elenco dei file: l'app installata si apre anche senza rete (i dati no,
 * vengono sempre da Supabase) e a ogni pubblicazione la versione cambia, quindi la cache si rinnova.
 */
function serviceWorker(): Plugin {
  return {
    name: 'nbbgm-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .sort();
      const version = createHash('sha256').update(files.join('|')).digest('hex').slice(0, 12);
      const shell = ['./', ...[...files, ...PUBLIC_FILES].map((f) => `./${f}`)];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `// Service worker di NBBGM, generato in build (apps/web/vite.config.ts).
const CACHE = 'nbbgm-${version}';
const SHELL = ${JSON.stringify(shell)};

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('nbbgm-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  // Supabase e gli altri siti: sempre dalla rete
  if (new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate') {
    // La pagina: dalla rete se c'è (così arriva subito l'ultima versione), altrimenti dalla cache
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put('./', copy));
          return response;
        })
        .catch(() => caches.match('./')),
    );
    return;
  }
  event.respondWith(caches.match(request).then((hit) => hit || fetch(request)));
});
`,
      });
    },
  };
}

// base relativo: il sito viene pubblicato su GitHub Pages in una sottocartella.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
});
