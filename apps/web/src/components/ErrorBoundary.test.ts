import { createElement, isValidElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary, ErrorScreen } from './ErrorBoundary.tsx';

describe('errore durante il disegno', () => {
  it('passa allo schermo di errore', () => {
    expect(ErrorBoundary.getDerivedStateFromError(new Error('rotto'))).toEqual({ error: new Error('rotto') });
    // Anche quello che non è un Error diventa un messaggio
    expect(ErrorBoundary.getDerivedStateFromError('stringa').error?.message).toBe('stringa');
  });

  it('senza errori mostra la pagina, con un errore il messaggio con Ricarica', () => {
    const boundary = new ErrorBoundary({ children: 'pagina' });
    expect(boundary.render()).toBe('pagina');
    boundary.state = { error: new Error('Cannot read properties of undefined') };
    const out = boundary.render();
    expect(isValidElement(out) && out.type).toBe(ErrorScreen);
    const html = renderToStaticMarkup(createElement(ErrorScreen, { error: new Error('Cannot read x') }));
    expect(html).toContain('Qualcosa è andato storto');
    expect(html).toContain('Ricarica');
    expect(html).toContain('Torna alle leghe');
    expect(html).toContain('Cannot read x');
  });
});
