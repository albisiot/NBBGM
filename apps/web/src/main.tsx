import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';
import { restorePage } from './lib/returnTo.ts';
import { registerServiceWorker } from './pwa/register.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root mancante');

// Di ritorno dal login con Google: la pagina che si stava aprendo (per esempio un invito), prima del router
restorePage();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: il service worker c'è solo nella build (in sviluppo darebbe file vecchi)
if (import.meta.env.PROD) registerServiceWorker();
