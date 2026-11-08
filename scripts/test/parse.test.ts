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

  it('legge il formato del v4: Free Agent, Fuori NBA, apertura alare misurata', () => {
    // stesse colonne, con il nome nuovo dell'apertura alare (le righe restano allineate per posizione)
    const header = PLAYER_HEADER.map((h) => (h === 'Apertura alare (cm, stima)' ? 'Apertura alare (cm)' : h));
    const { league, errors } = parseLeague(
      input(
        [
          playerRow('Boston Celtics', 'Luca', 'Bianchi', {
            'Ruolo secondario': 'SG',
            'Apertura alare (cm, stima)': 199,
          }),
          playerRow('Free Agent', 'Paolo', 'Verdi', { Età: 33 }),
          playerRow('Fuori NBA', 'Ugo', 'Neri', { Età: 19 }),
        ],
        [
          contract('Boston Celtics', 'Luca', 'Bianchi'),
          contract('Svincolato', 'Paolo', 'Verdi', 'svincolato'),
        ],
        header,
      ),
    );
    expect(errors).toEqual([]);
    expect(
      league.players.map((p) => [p.id, p.teamId, p.secondaryRole, p.wingspanCm, p.yearsInLeague]),
    ).toEqual([
      // il ruolo secondario uguale al principale vale come nessuno
      ['luca-bianchi', 'BOS', null, 199, 4],
      // svincolato: anni dalla riga di "Svincolato" nei contratti
      ['paolo-verdi', null, 'PG', 203, 4],
      // senza riga nei contratti: anni stimati dall'età
      ['ugo-neri', null, 'PG', 203, 0],
    ]);
    expect(league.contracts.map((c) => c.playerId)).toEqual(['luca-bianchi']);
  });

  it('senza nessuna colonna dell’apertura alare il file è rifiutato', () => {
    const header = PLAYER_HEADER.filter((h) => h !== 'Apertura alare (cm, stima)');
    const { errors } = parseLeague(input([], [], header));
    expect(errors).toEqual(['Foglio GIOCATORI: colonna "Apertura alare (cm)" mancante']);
  });

  it('stima gli anni nella lega di chi non ha contratto', () => {
    const { league } = parseLeague(input([playerRow('Fuori NBA', 'Ugo', 'Neri', { Età: 31 })], []));
    expect(league.players[0]?.yearsInLeague).toBe(11);
  });

  describe('foglio DRAFT', () => {
    const DRAFT_HEADER = ['Squadra NBA', 'Nome', 'Cognome', 'Anno draft', 'Giro', 'Scelta', 'Scelto da'];
    const players = [
      playerRow('Boston Celtics', 'Luca', 'Bianchi'),
      playerRow('Fuori NBA', 'Ugo', 'Neri'),
      playerRow('Free Agent', 'Paolo', 'Verdi'),
    ];
    const withDraft = (rows: Row[]): ParseInput => ({
      ...input(players, [contract('Boston Celtics', 'Luca', 'Bianchi')]),
      draftHeader: DRAFT_HEADER,
      draftRows: rows,
    });

    it('legge anno, giro e scelta, "non scelto" e le righe mancanti, per nome senza accenti', () => {
      const { league, errors, warnings } = parseLeague(
        withDraft([
          ['Boston Celtics', 'Luca', 'Bianchi', 2018, 1, 3, 'ATL'],
          ['Svincolato', 'Ugo', 'Néri', null, 'Non scelto', null, null],
          ['Svincolato', 'Mario', 'Rossi', 2010, '2', 45, 'BOS'],
        ]),
      );
      expect(errors).toEqual([]);
      expect(league.players.map((p) => [p.id, p.draft])).toEqual([
        ['luca-bianchi', { year: 2018, round: 1, pick: 3 }],
        ['ugo-neri', { year: null, round: null, pick: null }],
        ['paolo-verdi', null],
      ]);
      expect(warnings).toEqual([
        'GIOCATORI riga 5 (Paolo Verdi): nessuna riga nel foglio DRAFT, draft non noto',
        'DRAFT riga 4 (Mario Rossi): nessun giocatore con questo nome nel foglio GIOCATORI',
      ]);
    });

    it('senza il foglio il draft resta non noto, senza avvisi', () => {
      const { league, warnings } = parseLeague(
        input(players, [contract('Boston Celtics', 'Luca', 'Bianchi')]),
      );
      expect(league.players.every((p) => p.draft === null)).toBe(true);
      expect(warnings).toEqual([]);
    });

    it('rifiuta righe incoerenti', () => {
      const { errors } = parseLeague(
        withDraft([
          ['Boston Celtics', 'Luca', 'Bianchi', 2018, 3, 3, null],
          ['Svincolato', 'Ugo', 'Neri', 2019, 'non scelto', 40, null],
          ['Svincolato', 'Paolo', 'Verdi', 2020, 1, 61, null],
          ['Svincolato', 'Paolo', 'Verdi', 2020, 1, 5, null],
          ['Svincolato', 'Gino', 'Gialli', 2020.5, 1, 5, null],
          ['Svincolato', 'Leo', 'Blu', null, 1, 5, null],
          ['Svincolato', 'Ivo', 'Viola', 2021, null, 5, null],
        ]),
      );
      expect(errors).toEqual([
        'DRAFT riga 2 (Luca Bianchi): giro "3" non valido (1, 2 o "non scelto")',
        'DRAFT riga 3 (Ugo Neri): "non scelto" con una scelta',
        'DRAFT riga 4 (Paolo Verdi): scelta del draft 61 non valida',
        "DRAFT riga 5 (Paolo Verdi): giocatore già presente in un'altra riga",
        'DRAFT riga 6 (Gino Gialli): anno e scelta devono essere numeri interi',
        'DRAFT riga 7 (Leo Blu): giro 1 senza anno o scelta',
        'DRAFT riga 8 (Ivo Viola): manca il giro (1, 2 o "non scelto")',
      ]);
    });

    it('rifiuta un foglio senza una colonna richiesta', () => {
      const { errors } = parseLeague({
        ...withDraft([]),
        draftHeader: DRAFT_HEADER.filter((h) => h !== 'Scelta'),
      });
      expect(errors).toEqual(['Foglio DRAFT: colonna "Scelta" mancante']);
    });
  });

  it('slug toglie accenti e simboli', () => {
    expect(slug('Nikola Jokić')).toBe('nikola-jokic');
    expect(slug("Nae'Qwan Tomlin")).toBe('nae-qwan-tomlin');
  });
});
