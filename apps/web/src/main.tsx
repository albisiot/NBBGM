import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root mancante');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: il service worker c'è solo nella build (in sviluppo darebbe file vecchi)
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      // Senza service worker l'app funziona lo stesso, solo non si apre senza rete
    });
  });
}
