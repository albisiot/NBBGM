import { HIDDEN_FIELDS, RATING_FIELDS, TENDENCY_FIELDS } from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import { parseLeague, slug, type ParseInput, type Row } from '../src/import/parse.ts';

const IDENTITY = [
  'Squadra NBA',
  'Nome',
  'Cognome',
  'Nazionalità',
  'Ruolo principale',
  'Ruolo secondario',
  'Mano dominante',
  'Archetipo',
  'Età',
  'Altezza (cm)',
  'Apertura alare (cm, stima)',
  'Peso (kg)',
];
const NUMERIC = [...RATING_FIELDS, ...TENDENCY_FIELDS, ...HIDDEN_FIELDS].map((f) => f.label);
const PLAYER_HEADER = [...IDENTITY, ...NUMERIC, 'Prezzo Dunkest (sett. 2026)'];
const CONTRACT_HEADER = [
  'Squadra NBA',
  'Nome',
  'Cognome',
  'Tipo contratto',
  'Anni nella lega',
  'Anni di contratto',
  'Stipendio 2026-27',
  'Stipendio 2027-28',
  'Stipendio 2028-29',
  'Stipendio 2029-30',
  'Stipendio 2030-31',
  'Stipendio 2031-32',
  'Opzioni',
  'Garantito residuo',
];
const DEAD_HEADER = ['Squadra che paga', 'Nome', 'Cognome', 'Residuo 2026-27'];

function playerRow(
  team: string,
  first: string,
  last: string,
  overrides: Record<string, number | string> = {},
): Row {
  const values: Record<string, number | string> = {
    'Squadra NBA': team,
    Nome: first,
    Cognome: last,
    Nazionalità: 'Italia',
    'Ruolo principale': 'SG',
    'Ruolo secondario': 'PG',
    'Mano dominante': 'Sinistra (pres.)',
    Archetipo: 'Tiratore / scorer',
    Età: 24,
    'Altezza (cm)': 196,
    'Apertura alare (cm, stima)': 203,
    'Peso (kg)': 92,
    'Prezzo Dunkest (sett. 2026)': 9,
    ...Object.fromEntries(NUMERIC.map((l) => [l, 60])),
    ...overrides,
  };
  return PLAYER_HEADER.map((h) => values[h] ?? null);
}

function input(rows: Row[], contracts: Row[], playerHeader = PLAYER_HEADER): ParseInput {
  return {
    playerHeader,
    playerRows: rows,
    firstPlayerRow: 3,
    contractHeader: CONTRACT_HEADER,
    contractRows: contracts,
    deadHeader: DEAD_HEADER,
    deadRows: [['Atlanta Hawks', 'Mario', 'Rossi', 2_000_000]],
    season: '2026-27',
  };
}

const contract = (team: string, first: string, last: string, kind = 'standard'): Row => [
  team,
  first,
  last,
  kind,
  4,
  2,
  10_000_000,
  11_000_000,
  null,
  null,
  null,
  null,
  '2027-28 giocatore',
  21_000_000,
];

describe('parseLeague', () => {
  it('importa giocatori, contratti e residui', () => {
    const { league, errors, dunkestPrice } = parseLeague(
      input(
        [playerRow('Boston Celtics', 'Luca', 'Bianchi'), playerRow('Svincolato', 'Paolo', 'Verdi')],
        [
          contract('Boston Celtics', 'Luca', 'Bianchi'),
          contract('Svincolato', 'Paolo', 'Verdi', 'svincolato'),
        ],
      ),
    );
    expect(errors).toEqual([]);
    expect(league.players.map((p) => [p.id, p.teamId, p.hand])).toEqual([
      ['luca-bianchi', 'BOS', 'L'],
      ['paolo-verdi', null, 'L'],
    ]);
    expect(league.contracts).toEqual([
      {
        playerId: 'luca-bianchi',
        teamId: 'BOS',
        type: 'standard',
        salaries: [10_000_000, 11_000_000],
        options: [null, 'player'],
        guaranteed: 21_000_000,
      },
    ]);
    expect(league.deadMoney).toEqual([{ teamId: 'ATL', playerName: 'Mario Rossi', salaries: [2_000_000] }]);
    expect(dunkestPrice.get('luca-bianchi')).toBe(9);
  });

  it('rifiuta valori fuori scala con riga e campo', () => {
    const { errors } = parseLeague(
      input(
        [playerRow('Boston Celtics', 'Luca', 'Bianchi', { 'Tiro da 3 (abilità)': 140 })],
        [contract('Boston Celtics', 'Luca', 'Bianchi')],
      ),
    );
    expect(errors).toEqual(['GIOCATORI riga 3 (Luca Bianchi): "Tiro da 3 (abilità)" = 140, fuori da 0-100']);
  });

  it('rifiuta squadre e ruoli sconosciuti e valori mancanti', () => {
    const { errors } = parseLeague(
      input(
        [playerRow('Bologna', 'Luca', 'Bianchi', { 'Ruolo principale': 'G', Grinta: '' })],
        [contract('Bologna', 'Luca', 'Bianchi')],
      ),
    );
    expect(errors).toEqual([
      'GIOCATORI riga 3 (Luca Bianchi): squadra "Bologna" sconosciuta',
      'GIOCATORI riga 3 (Luca Bianchi): ruolo principale "G" non valido (PG, SG, SF, PF, C)',
      'GIOCATORI riga 3 (Luca Bianchi): "Grinta" mancante o non numerico',
    ]);
  });

  it('rifiuta un file senza una colonna richiesta', () => {
    const header = PLAYER_HEADER.filter((h) => h !== 'Stoppate');
    const { errors } = parseLeague(input([], [], header));
    expect(errors).toEqual(['Foglio GIOCATORI: colonna "Stoppate" mancante']);
  });

  it('rifiuta tipi di contratto sconosciuti e giocatori senza contratto', () => {
    const { errors } = parseLeague(
      input(
        [playerRow('Boston Celtics', 'Luca', 'Bianchi'), playerRow('Boston Celtics', 'Ugo', 'Neri')],
        [contract('Boston Celtics', 'Luca', 'Bianchi', 'prestito')],
      ),
    );
    expect(errors).toEqual([
      'CONTRATTI (Luca Bianchi): tipo "prestito" sconosciuto',
      'GIOCATORI riga 4 (Ugo Neri): nessuna riga nel foglio CONTRATTI',
    ]);
  });

  it('slug toglie accenti e simboli', () => {
    expect(slug('Nikola Jokić')).toBe('nikola-jokic');
    expect(slug("Nae'Qwan Tomlin")).toBe('nae-qwan-tomlin');
  });
});
