import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { coachFromRow } from '../lib/coaches.ts';
import { CoachCard, CoachLine, Stars } from './CoachCard.tsx';

const coach = coachFromRow({
  id: 'c1',
  team_id: 't1',
  first_name: 'Mike',
  last_name: 'Carter',
  nationality: 'Stati Uniti',
  age: 52,
  philosophy: 'grit',
  traits: { rotation: 'deep', trust: 'veterans', rest: 'low', flexible: false },
  ratings: { tactics: 70, development: 30, motivation: 55 },
  salaries: [7_300_000, 7_519_000, 7_745_000],
  since: 2025,
});

describe('scheda dell’allenatore', () => {
  it('idea di gioco, carattere, qualità in stelle e contratto', () => {
    const html = renderToStaticMarkup(
      createElement(CoachCard, { coach, contract: { label: 'Contratto', salaries: coach.salaries } }),
    );
    expect(html).toContain('Mike Carter');
    expect(html).toContain('52 anni · Stati Uniti · in panchina dal 2025');
    expect(html).toContain('Difesa e fatica');
    expect(html).toContain('Rotazione lunga');
    expect(html).toContain('Si fida dei veterani');
    expect(html).toContain('Fedele alla sua idea');
    // Tattica 70: 4 stelle; Sviluppo 30: 1; Gestione del gruppo 55: 3
    expect(html).toContain('4 stelle su 5');
    expect(html).toContain('1 stella su 5');
    expect(html).toContain('3 stelle su 5');
    expect(html).toContain('7,30 mln · 3 anni');
  });

  it('le stelle si leggono come numero, non come simboli', () => {
    const html = renderToStaticMarkup(createElement(Stars, { n: 2 }));
    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain('2 stelle su 5');
  });

  it('la riga compatta per gli elenchi', () => {
    const html = renderToStaticMarkup(createElement(CoachLine, { coach }));
    expect(html).toContain('Mike Carter');
    expect(html).toContain('Difesa e fatica · 52 anni · Tattica');
  });
});
