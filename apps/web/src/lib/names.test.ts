import { describe, expect, it } from 'vitest';
import { shortName } from './names.ts';

describe('nome puntato', () => {
  it('iniziale del nome e cognome intero', () => {
    expect(shortName('Jayson', 'Tatum')).toBe('J. Tatum');
    expect(shortName('Shai', 'Gilgeous-Alexander')).toBe('S. Gilgeous-Alexander');
    expect(shortName('Nick', 'Smith Jr.')).toBe('N. Smith Jr.');
    expect(shortName('Nikola', 'Jokić')).toBe('N. Jokić');
  });

  it('nomi con il trattino, con più parole, con l’apostrofo o in minuscolo', () => {
    expect(shortName('Karl-Anthony', 'Towns')).toBe('K.-A. Towns');
    expect(shortName('Jo Jo', 'Rossi')).toBe('J. J. Rossi');
    expect(shortName("De'Aaron", 'Fox')).toBe('D. Fox');
    expect(shortName('şengün', 'Alperen')).toBe('Ş. Alperen');
  });

  it('senza nome o senza cognome', () => {
    expect(shortName('', 'Nenê')).toBe('Nenê');
    expect(shortName('  ', 'Nenê')).toBe('Nenê');
    expect(shortName('Nenê', '')).toBe('Nenê');
  });
});
