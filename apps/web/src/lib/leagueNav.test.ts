import { describe, expect, it } from 'vitest';
import {
  activeLink,
  championshipTab,
  championshipTabs,
  LEAGUE_LINKS,
  leagueHref,
  MAIN_LINKS,
} from './leagueNav.ts';

const L = 'lega-1';

describe('menu della lega', () => {
  it('cinque voci in basso su telefono: quattro pagine di ogni turno più Altro', () => {
    expect(LEAGUE_LINKS.filter((l) => MAIN_LINKS.includes(l.key)).map((l) => l.label)).toEqual([
      'Lega',
      'Squadra',
      'Mercato',
      'Campionato',
    ]);
    expect(LEAGUE_LINKS.filter((l) => !MAIN_LINKS.includes(l.key)).map((l) => l.label)).toEqual([
      'Statistiche',
      'Cronaca',
      'Storico',
      'Confronta',
      'Info lega',
    ]);
  });

  it('chiavi uniche e indirizzi delle voci', () => {
    expect(new Set(LEAGUE_LINKS.map((l) => l.key)).size).toBe(LEAGUE_LINKS.length);
    expect(leagueHref(L, '')).toBe('/lega/lega-1');
    expect(leagueHref(L, 'risultati')).toBe('/lega/lega-1/risultati');
    // Campionato apre i risultati
    expect(LEAGUE_LINKS.find((l) => l.key === 'campionato')?.to).toBe('risultati');
  });

  it('ogni voce è attiva nella sua pagina', () => {
    for (const l of LEAGUE_LINKS) expect(activeLink(leagueHref(L, l.to), L)).toBe(l.key);
  });

  it('Campionato è attiva su risultati, classifica, playoff e partite', () => {
    for (const path of ['risultati', 'risultati/12', 'classifica', 'playoff', 'partita/abc'])
      expect(activeLink(`/lega/${L}/${path}`, L)).toBe('campionato');
  });

  it('Lega solo nella pagina della lega; le altre pagine non accendono voci', () => {
    expect(activeLink(`/lega/${L}/`, L)).toBe('lega');
    for (const path of ['squadre/BOS', 'giocatore/p1', 'draft', 'draft-annuale'])
      expect(activeLink(`/lega/${L}/${path}`, L)).toBeNull();
  });

  it('fuori dalla lega, o in un’altra lega, nessuna voce', () => {
    expect(activeLink('/', L)).toBeNull();
    expect(activeLink('/profilo', L)).toBeNull();
    expect(activeLink('/lega/lega-10/squadra', L)).toBeNull();
    expect(activeLink('/lega/altra/squadra', L)).toBeNull();
  });
});

describe('schede di Campionato', () => {
  it('la scheda aperta', () => {
    expect(championshipTab(`/lega/${L}/risultati`, L)).toBe('risultati');
    expect(championshipTab(`/lega/${L}/risultati/40`, L)).toBe('risultati');
    expect(championshipTab(`/lega/${L}/classifica`, L)).toBe('classifica');
    expect(championshipTab(`/lega/${L}/playoff`, L)).toBe('playoff');
    expect(championshipTab(`/lega/${L}/partita/abc`, L)).toBeNull();
    expect(championshipTab(`/lega/${L}`, L)).toBeNull();
  });

  const labels = (kind: string | null, current: Parameters<typeof championshipTabs>[1] = 'risultati') =>
    championshipTabs(kind, current).map((t) => t.label);

  it('Playoff fuori dalla regular season, come il tabellone della scheda del turno', () => {
    expect(labels('regular')).toEqual(['Risultati', 'Classifica']);
    expect(labels('play-in')).toEqual(['Risultati', 'Classifica', 'Playoff']);
    expect(labels('playoffs')).toEqual(['Risultati', 'Classifica', 'Playoff']);
    // In offseason il tabellone della stagione appena finita
    expect(labels('offseason')).toEqual(['Risultati', 'Classifica', 'Playoff']);
  });

  it('turno non ancora letto: niente Playoff, salvo se è la pagina aperta (un link vecchio)', () => {
    expect(labels(null)).toEqual(['Risultati', 'Classifica']);
    expect(labels(null, 'playoff')).toEqual(['Risultati', 'Classifica', 'Playoff']);
    expect(labels('regular', 'playoff')).toEqual(['Risultati', 'Classifica', 'Playoff']);
  });

  it('le schede portano alle rotte di sempre', () => {
    expect(championshipTabs('playoffs', null).map((t) => t.to)).toEqual([
      'risultati',
      'classifica',
      'playoff',
    ]);
  });
});
