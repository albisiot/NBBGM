import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { applyTheme, parseTheme, THEME_COLOR, THEME_KEY, type ThemeDocument } from './theme.ts';

class FakeMeta {
  attrs: Record<string, string>;
  constructor(attrs: Record<string, string>) {
    this.attrs = { ...attrs };
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attrs[name] = value;
  }
}

/** Un documento con le meta di index.html. */
function fakeDocument() {
  const scheme = new FakeMeta({ name: 'color-scheme', content: 'light dark' });
  const light = new FakeMeta({
    name: 'theme-color',
    content: '#f4dcd3',
    media: '(prefers-color-scheme: light)',
  });
  const dark = new FakeMeta({
    name: 'theme-color',
    content: '#1b1716',
    media: '(prefers-color-scheme: dark)',
  });
  const doc: ThemeDocument & { documentElement: { dataset: Record<string, string | undefined> } } = {
    documentElement: { dataset: {}, style: { colorScheme: '' } },
    querySelector: (s) => (s === 'meta[name="color-scheme"]' ? scheme : null),
    querySelectorAll: (s) => (s === 'meta[name="theme-color"]' ? [light, dark] : []),
  };
  return { doc, scheme, light, dark };
}

describe('tema scelto nel profilo', () => {
  it('solo chiaro e scuro sono una scelta, il resto è automatico', () => {
    expect(parseTheme('chiaro')).toBe('chiaro');
    expect(parseTheme('scuro')).toBe('scuro');
    expect(parseTheme(null)).toBe('auto');
    expect(parseTheme('dark')).toBe('auto');
    expect(parseTheme('')).toBe('auto');
  });

  it('scuro: data-tema, controlli del browser e barra di sistema scuri anche col sistema chiaro', () => {
    const { doc, scheme, light, dark } = fakeDocument();
    applyTheme('scuro', doc);
    expect(doc.documentElement.dataset.tema).toBe('scuro');
    expect(doc.documentElement.style.colorScheme).toBe('dark');
    expect(scheme.attrs.content).toBe('dark');
    expect(light.attrs.content).toBe(THEME_COLOR.scuro);
    expect(dark.attrs.content).toBe(THEME_COLOR.scuro);
  });

  it('chiaro, poi di nuovo automatico: tutto torna come in index.html', () => {
    const { doc, scheme, light, dark } = fakeDocument();
    applyTheme('chiaro', doc);
    expect(doc.documentElement.dataset.tema).toBe('chiaro');
    expect(doc.documentElement.style.colorScheme).toBe('light');
    expect(dark.attrs.content).toBe(THEME_COLOR.chiaro);
    applyTheme('auto', doc);
    expect(doc.documentElement.dataset.tema).toBeUndefined();
    expect(doc.documentElement.style.colorScheme).toBe('');
    expect(scheme.attrs.content).toBe('light dark');
    expect(light.attrs.content).toBe('#f4dcd3');
    expect(dark.attrs.content).toBe('#1b1716');
  });

  it('index.html e index.css usano la stessa chiave, gli stessi valori e gli stessi colori', () => {
    const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
    const css = readFileSync(new URL('../index.css', import.meta.url), 'utf8');
    // Lo script prima del primo disegno legge la stessa chiave e mette data-tema solo per chiaro e scuro
    expect(html).toContain(`localStorage.getItem('${THEME_KEY}')`);
    expect(html).toContain("if (tema === 'chiaro' || tema === 'scuro')");
    expect(html.indexOf('data-tema')).toBeLessThan(html.indexOf('<body>'));
    expect(html).toContain(`content="${THEME_COLOR.chiaro}" media="(prefers-color-scheme: light)"`);
    expect(html).toContain(`content="${THEME_COLOR.scuro}" media="(prefers-color-scheme: dark)"`);
    // La variante dark: segue data-tema, e il sistema solo senza la scelta del chiaro
    expect(css).toContain('@custom-variant dark {');
    expect(css).toContain("&:where([data-tema='scuro'], [data-tema='scuro'] *)");
    expect(css).toContain("&:where(:not([data-tema='chiaro'], [data-tema='chiaro'] *))");
    expect(css).toContain(`--color-stampa-50: ${THEME_COLOR.chiaro};`);
    expect(css).toContain(`--color-stampa-900: ${THEME_COLOR.scuro};`);
  });
});
