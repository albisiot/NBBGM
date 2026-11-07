// Seconda analisi dopo la Fase 13: su iPhone un campo con il testo sotto i 16 px fa ingrandire la pagina quando lo
// si tocca. La regola di index.css porta ogni campo a 16 px su telefono, sopra le classi di Tailwind.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./index.css', import.meta.url), 'utf8');

describe('campi a 16 px su telefono', () => {
  it('sotto sm input, select e textarea hanno 16 px, fuori dai layer di Tailwind', () => {
    const at = css.indexOf('@media (max-width: 39.99rem)');
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at, css.indexOf('}\n}', at) + 3);
    for (const selector of ['input:not(', 'select', 'textarea']) expect(block).toContain(selector);
    expect(block).toContain('font-size: 1rem;');
    // Dentro un @layer la regola perderebbe contro le utility text-sm e text-xs: qui non si è dentro nessun blocco
    const before = css.slice(0, at);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(depth).toBe(0);
    // Caselle da spuntare e scelte singole restano come sono
    expect(block).toContain("[type='checkbox']");
    expect(block).toContain("[type='radio']");
  });
});

describe('colori del tema scuro (seconda analisi)', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

  it('barra del browser e controlli seguono il tema del sistema', () => {
    // Stile Edicola: il colore della testata, carta rosa (stampa-50) nel chiaro e inchiostro (stampa-900) nello scuro
    expect(html).toContain(
      '<meta name="theme-color" content="#f4dcd3" media="(prefers-color-scheme: light)" />',
    );
    expect(html).toContain(
      '<meta name="theme-color" content="#1b1716" media="(prefers-color-scheme: dark)" />',
    );
    expect(html).toContain('<meta name="color-scheme" content="light dark" />');
  });
});

describe('menu della lega in basso su telefono (funzioni nuove)', () => {
  it('pagina e pezzi fissi in basso stanno sopra la barra, fuori dai layer di Tailwind', () => {
    const at = css.indexOf('.has-bottom-nav .main-above-nav');
    expect(at).toBeGreaterThan(0);
    const media = css.lastIndexOf('@media (max-width: 39.99rem)', at);
    const before = css.slice(0, media);
    const depth = (before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length;
    expect(depth).toBe(0);
    const block = css.slice(media, css.indexOf('}\n}', at) + 3);
    // La barra è staccata dal fondo (stile Edicola): 4,25rem di barra più 0,625rem di stacco
    expect(block).toContain('padding-bottom: calc(4.875rem + env(safe-area-inset-bottom) + 1.5rem);');
    expect(block).toContain('.has-bottom-nav .dock-above-nav');
    expect(block).toContain('bottom: calc(4.875rem + env(safe-area-inset-bottom));');
  });
});

describe('stile Edicola', () => {
  it('scale stampa e rosso al posto di slate e orange, nessuna classe vecchia rimasta', () => {
    expect(css).toContain('--color-slate-*: initial;');
    expect(css).toContain('--color-orange-*: initial;');
    expect(css).toContain('--color-stampa-50: #f4dcd3;');
    expect(css).toContain('--color-stampa-900: #1b1716;');
    expect(css).toContain('--color-rosso-600: #b3122a;');
    const dir = new URL('./', import.meta.url);
    const files = readdirSync(dir, { recursive: true, encoding: 'utf8' }).filter(
      (f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts'),
    );
    expect(files.length).toBeGreaterThan(20);
    for (const file of files) {
      const text = readFileSync(new URL(file.replaceAll('\\', '/'), dir), 'utf8');
      expect(text, file).not.toMatch(/\b(slate|orange)-\d{2,3}\b/);
    }
  });

  it('caratteri nella build, non da Google Fonts', () => {
    expect(css).toContain("font-family: 'Oswald Variable';");
    expect(css).toContain("font-family: 'Source Serif 4 Variable';");
    expect(css).toContain("url('./assets/fonts/source-serif-4-latin-wght-italic.woff2')");
    expect(css).not.toContain('fonts.googleapis.com');
    expect(css).toContain('--default-font-family: var(--font-serif);');
  });
});
