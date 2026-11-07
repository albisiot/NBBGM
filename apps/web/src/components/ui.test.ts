import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { confirmAnnouncement, ConfirmButton, Toast, toastDuration, TOAST_ERROR_MS, TOAST_MS } from './ui.tsx';

describe('avviso fisso in basso', () => {
  it('la regione per i lettori di schermo c’è sempre, il messaggio solo quando serve', () => {
    const empty = renderToStaticMarkup(createElement(Toast, { message: null, onClose: () => {} }));
    expect(empty).toContain('aria-live="polite"');
    expect(empty).toContain('role="alert"');
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

  it('gli errori si annunciano subito (alert), le conferme con calma (status)', () => {
    const error = renderToStaticMarkup(
      createElement(Toast, { message: { ok: false, text: 'Offerta rifiutata' }, onClose: () => {} }),
    );
    expect(error).toMatch(/role="alert"[^>]*>.*Offerta rifiutata/);
    const ok = renderToStaticMarkup(
      createElement(Toast, { message: { ok: true, text: 'Offerta fatta' }, onClose: () => {} }),
    );
    expect(ok).toMatch(/role="status"[^>]*>.*Offerta fatta/);
    expect(ok).not.toMatch(/role="alert"[^>]*>.*Offerta fatta/);
  });

  it('anche gli errori si chiudono da soli, dopo più tempo', () => {
    expect(toastDuration({ ok: true, text: '' })).toBe(TOAST_MS);
    expect(toastDuration({ ok: false, text: '' })).toBe(TOAST_ERROR_MS);
    expect(TOAST_ERROR_MS).toBeGreaterThan(TOAST_MS);
  });

  it('la richiesta di conferma si annuncia ai lettori di schermo', () => {
    const html = renderToStaticMarkup(
      createElement(ConfirmButton, { confirmLabel: 'Confermi?', onConfirm: () => {} }, 'Espelli'),
    );
    // La regione c'è sempre (vuota finché non si chiede conferma), fuori dal flusso
    expect(html).toContain('role="status" class="sr-only"');
    expect(confirmAnnouncement(false, 'Confermi?')).toBe('');
    expect(confirmAnnouncement(true, 'Confermi l’espulsione?')).toBe(
      'Confermi l’espulsione? Tocca di nuovo entro 5 secondi per confermare.',
    );
  });
});
