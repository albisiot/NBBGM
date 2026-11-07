import { describe, expect, it } from 'vitest';
import { LINK_BUTTON, ROW_LINK, TEXT_LINK } from './linkStyles.ts';

describe('link con l’aspetto dei pulsanti', () => {
  it('alti almeno 44 px, come i pulsanti, in ogni variante', () => {
    for (const cls of Object.values(LINK_BUTTON)) {
      expect(cls).toContain('min-h-11');
      expect(cls).toContain('font-titolo');
    }
    expect(ROW_LINK).toContain('min-h-11');
  });

  it('colori del tema chiaro e scuro', () => {
    expect(LINK_BUTTON.primary).toContain('bg-stampa-900');
    expect(LINK_BUTTON.primary).toContain('dark:bg-stampa-100');
    expect(LINK_BUTTON.secondary).toContain('border-stampa-900');
    expect(LINK_BUTTON.accent).toContain('bg-rosso-600');
    // Testo rosso leggibile: 700 sulla carta, 300 sull'inchiostro
    expect(TEXT_LINK).toContain('text-rosso-700');
    expect(TEXT_LINK).toContain('dark:text-rosso-300');
    expect(TEXT_LINK).toContain('italic');
  });
});
