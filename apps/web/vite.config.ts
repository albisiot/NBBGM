import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { serviceWorkerSource } from './src/pwa/serviceWorker.ts';

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
 * vengono sempre da Supabase) e a ogni pubblicazione la versione cambia, quindi la cache si rinnova. Le regole
 * stanno in src/pwa/serviceWorker.ts.
 */
function serviceWorker(): Plugin {
  // Chiave pubblica VAPID (da .env.local o dalla variabile del repository in Pages): serve per rifare
  // l'iscrizione alle notifiche quando il browser la cambia
  let vapidKey = '';
  return {
    name: 'nbbgm-service-worker',
    apply: 'build',
    configResolved(config) {
      vapidKey = String(config.env.VITE_VAPID_PUBLIC_KEY ?? '').trim();
    },
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .sort();
      // La versione cambia con i file della build, con quelli di public/ e con le regole del service worker
      const hash = createHash('sha256')
        .update(files.join('|'))
        .update(serviceWorkerSource('', [], vapidKey));
      for (const f of PUBLIC_FILES) hash.update(readFileSync(new URL(`./public/${f}`, import.meta.url)));
      const version = hash.digest('hex').slice(0, 12);
      const shell = ['./', ...[...files, ...PUBLIC_FILES].map((f) => `./${f}`)];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(version, shell, vapidKey),
      });
    },
  };
}

// base relativo: il sito viene pubblicato su GitHub Pages in una sottocartella.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
  resolve: {
    // L'app non usa lo Storage di Supabase: al posto del pacchetto (con iceberg-js) un modulo vuoto con gli stessi
    // nomi (src/lib/noStorage.ts)
    alias: { '@supabase/storage-js': fileURLToPath(new URL('./src/lib/noStorage.ts', import.meta.url)) },
  },
});
