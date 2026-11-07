import { describe, expect, it } from 'vitest';
import { initials, mastheadDate } from './masthead.ts';

describe('testata', () => {
  it('la data come sotto il nome del giornale, con la maiuscola', () => {
    expect(mastheadDate(new Date(2026, 10, 7))).toBe('Sabato 7 novembre 2026');
    expect(mastheadDate(new Date(2027, 0, 1))).toBe('Venerdì 1 gennaio 2027');
  });

  it('iniziali del profilo: prima e ultima parola, al più due lettere', () => {
    expect(initials('Alberto Lunghi')).toBe('AL');
    expect(initials('  anna  ')).toBe('A');
    expect(initials('Maria De Santis')).toBe('MS');
    expect(initials('élodie')).toBe('É');
    expect(initials('')).toBe('');
  });
});
