import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
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
  return {
    name: 'nbbgm-service-worker',
    apply: 'build',
    generateBundle(_, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map'))
        .sort();
      // La versione cambia con i file della build, con quelli di public/ e con le regole del service worker
      const hash = createHash('sha256').update(files.join('|')).update(serviceWorkerSource('', []));
      for (const f of PUBLIC_FILES) hash.update(readFileSync(new URL(`./public/${f}`, import.meta.url)));
      const version = hash.digest('hex').slice(0, 12);
      const shell = ['./', ...[...files, ...PUBLIC_FILES].map((f) => `./${f}`)];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(version, shell),
      });
    },
  };
}

// base relativo: il sito viene pubblicato su GitHub Pages in una sottocartella.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
});
