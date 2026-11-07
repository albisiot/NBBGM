import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import './index.css';
import { captureInstallPrompt } from './lib/install.ts';
import { restorePage } from './lib/returnTo.ts';
import { startTheme } from './lib/theme.ts';
import { registerServiceWorker } from './pwa/register.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Elemento #root mancante');

// Tema scelto nel profilo (chiaro, scuro o automatico): anche controlli del browser e barra di sistema
startTheme();

// Di ritorno dal login con Google: la pagina che si stava aprendo (per esempio un invito), prima del router
restorePage();
// La proposta d'installazione del browser arriva una volta sola, presto: si tiene per il pulsante Installa
captureInstallPrompt();

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// PWA: il service worker c'è solo nella build (in sviluppo darebbe file vecchi)
if (import.meta.env.PROD) registerServiceWorker();
