// Seconda analisi dopo la Fase 13: su iPhone un campo con il testo sotto i 16 px fa ingrandire la pagina quando lo
// si tocca. La regola di index.css porta ogni campo a 16 px su telefono, sopra le classi di Tailwind.
import { readFileSync } from 'node:fs';
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
    expect(html).toContain(
      '<meta name="theme-color" content="#ea580c" media="(prefers-color-scheme: light)" />',
    );
    // Nel tema scuro il colore dell'intestazione (slate-900)
    expect(html).toContain(
      '<meta name="theme-color" content="#0f172a" media="(prefers-color-scheme: dark)" />',
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
    expect(block).toContain('padding-bottom: calc(3.5rem + env(safe-area-inset-bottom) + 1.5rem);');
    expect(block).toContain('.has-bottom-nav .dock-above-nav');
    expect(block).toContain('bottom: calc(3.5rem + env(safe-area-inset-bottom));');
  });
});
