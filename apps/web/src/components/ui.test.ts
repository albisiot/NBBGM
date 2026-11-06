import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ConfirmButton, Toast } from './ui.tsx';

describe('avviso fisso in basso', () => {
  it('la regione per i lettori di schermo c’è sempre, il messaggio solo quando serve', () => {
    const empty = renderToStaticMarkup(createElement(Toast, { message: null, onClose: () => {} }));
    expect(empty).toContain('aria-live="polite"');
    expect(empty).not.toContain('Chiudi il messaggio');
    const html = renderToStaticMarkup(
      createElement(Toast, { message: { ok: false, text: 'Offerta sotto la richiesta' }, onClose: () => {} }),
    );
    expect(html).toContain('Offerta sotto la richiesta');
    expect(html).toContain('Chiudi il messaggio');
    // In basso, sopra la barra di sistema dell'iPhone
    expect(html).toContain('fixed inset-x-0 bottom-0');
    expect(html).toContain('env(safe-area-inset-bottom)');
  });

  it('il pulsante da confermare parte con la sua etichetta', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmButton, { confirmLabel: 'Confermi?', onConfirm: () => {} }, 'Accetta'),
    );
    expect(html).toContain('Accetta');
    expect(html).not.toContain('Confermi?');
  });
});
