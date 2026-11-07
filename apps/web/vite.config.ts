import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import { isHashedAsset, serviceWorkerSource, type ShellEntry } from './src/pwa/serviceWorker.ts';

// File di public/ che il service worker tiene in cache insieme a quelli della build
const PUBLIC_FILES = [
  'manifest.webmanifest',
  'icon.svg',
  'privacy.html',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
  'icons/badge-96.png',
];

/** Impronta di un contenuto, per riconoscere i file senza hash nel nome che non sono cambiati. */
const fingerprint = (content: string | Uint8Array) =>
  createHash('sha256').update(content).digest('hex').slice(0, 16);

/**
 * Service worker generato in build con l'elenco dei file: l'app installata si apre anche senza rete (i dati no,
 * vengono sempre da Supabase) e a ogni pubblicazione la versione cambia, quindi la cache si rinnova, scaricando
 * solo i file cambiati (i file con l'hash nel nome per nome, gli altri con l'impronta del contenuto). Le regole
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
      // Impronta dei file senza hash nel nome (quelli di public/)
      const content = (f: string): string | Uint8Array => {
        const out = bundle[f];
        if (out?.type === 'chunk') return out.code;
        if (out?.type === 'asset') return out.source;
        return readFileSync(new URL(`./public/${f}`, import.meta.url));
      };
      const entries: ShellEntry[] = [...files, ...PUBLIC_FILES].map((f) => ({
        url: `./${f}`,
        rev: isHashedAsset(f) ? null : fingerprint(content(f)),
      }));
      // La versione cambia con i file della build, con quelli di public/ e con le regole del service worker
      const version = createHash('sha256')
        .update(JSON.stringify(entries))
        .update(serviceWorkerSource('', [], vapidKey))
        .digest('hex')
        .slice(0, 12);
      // La pagina dell'app (index.html, che qui non c'è ancora) si riscarica a ogni versione: punta ai file nuovi
      const shell: ShellEntry[] = [{ url: './', rev: version }, ...entries];
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: serviceWorkerSource(version, shell, vapidKey),
      });
    },
  };
}

/**
 * Moduli del pezzo d'ingresso, che nessun altro pezzo importa: index.html (il modulo d'ingresso per Vite), main.tsx
 * e quelli con gli import() delle pagine.
 */
const ENTRY_MODULES =
  /([\\/]index\.html|[\\/]src[\\/](main\.tsx|App\.tsx|components[\\/]Layout\.tsx|lib[\\/]pushWatch\.ts))($|\?)/;

/**
 * Divisione in pezzi per gli aggiornamenti. Il nome di un pezzo ha l'hash del contenuto, compresi i nomi dei pezzi
 * che importa: se le pagine importassero dal pezzo d'ingresso (che contiene l'elenco delle pagine), cambiando una
 * pagina cambierebbero i nomi di tutte e il service worker le riscaricherebbe tutte. Quindi le librerie (React,
 * router, Supabase) e il codice dell'avvio stanno in pezzi propri, e nel pezzo d'ingresso solo i moduli con gli
 * import() (ENTRY_MODULES): una pagina cambiata cambia solo lei e il pezzo d'ingresso, che è piccolo.
 */
const codeSplitting = {
  groups: [
    { name: 'react', test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/, priority: 4 },
    { name: 'router', test: /node_modules[\\/](react-router|cookie|set-cookie-parser)[\\/]/, priority: 3 },
    { name: 'supabase', test: /node_modules[\\/](@supabase|tslib|whatwg-url|ws)[\\/]/, priority: 3 },
    {
      name: 'avvio',
      tags: ['$initial' as const],
      test: (id: string) => !ENTRY_MODULES.test(id),
      priority: 1,
    },
  ],
};

// base relativo: il sito viene pubblicato su GitHub Pages in una sottocartella.
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), serviceWorker()],
  build: { rolldownOptions: { output: { codeSplitting } } },
  resolve: {
    // L'app non usa lo Storage di Supabase: al posto del pacchetto (con iceberg-js) un modulo vuoto con gli stessi
    // nomi (src/lib/noStorage.ts)
    alias: { '@supabase/storage-js': fileURLToPath(new URL('./src/lib/noStorage.ts', import.meta.url)) },
  },
});
