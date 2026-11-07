import { describe, expect, it } from 'vitest';
import {
  closingLabel,
  deadlineNote,
  gameHeadline,
  gameWhen,
  readinessMark,
  readyConfirmTitle,
  teamCity,
} from './frontPage.ts';
import type { LastGame } from './turnStatus.ts';

const teams = [
  { id: 't-bos', fullName: 'Boston Celtics' },
  { id: 't-mia', fullName: 'Miami Heat' },
  { id: 't-por', fullName: 'Portland Trail Blazers' },
];

const game = (g: Partial<LastGame>): LastGame => ({
  roundNumber: 22,
  homeTeamId: 't-bos',
  awayTeamId: 't-mia',
  homeScore: 112,
  awayScore: 104,
  overtimes: 0,
  ...g,
});

describe('prima pagina della lega', () => {
  it('la città dal nome della squadra, anche con un soprannome di due parole', () => {
    expect(teamCity('Boston Celtics')).toBe('Boston');
    expect(teamCity('Oklahoma City Thunder')).toBe('Oklahoma City');
    expect(teamCity('Portland Trail Blazers')).toBe('Portland');
    expect(teamCity('LA Clippers')).toBe('LA');
    expect(teamCity('Bot')).toBe('Bot');
  });

  it('occhiello: giornata in regular season, post-season dopo', () => {
    expect(gameWhen(0)).toBe('Giornata 1');
    expect(gameWhen(81)).toBe('Giornata 82');
    expect(gameWhen(82)).toBe('Post-season');
  });

  it('titolo con chi vince, sommario dal punto di vista della propria squadra', () => {
    expect(gameHeadline(game({}), teams, 't-bos', false)).toEqual({
      kicker: 'Giornata 23 · ultima partita',
      title: 'Boston batte Miami',
      dek: '112–104, vittoria in casa.',
    });
    // La stessa partita vista da Miami
    expect(gameHeadline(game({}), teams, 't-mia', false).dek).toBe('112–104, sconfitta in trasferta.');
    // Vince la squadra in trasferta
    const away = gameHeadline(game({ homeScore: 99, awayScore: 101 }), teams, 't-mia', false);
    expect(away.title).toBe('Miami batte Boston di misura');
    expect(away.dek).toBe('101–99, vittoria in trasferta.');
  });

  it('scarti larghi e supplementari nel titolo', () => {
    expect(gameHeadline(game({ homeScore: 130, awayScore: 100 }), teams, 't-bos', false).title).toBe(
      'Boston travolge Miami',
    );
    expect(
      gameHeadline(game({ homeScore: 120, awayScore: 118, overtimes: 1 }), teams, 't-bos', false).title,
    ).toBe('Boston batte Miami al supplementare');
    expect(
      gameHeadline(game({ homeScore: 130, awayScore: 128, overtimes: 2 }), teams, 't-bos', false).title,
    ).toBe('Boston batte Miami dopo 2 supplementari');
    expect(gameHeadline(game({ homeTeamId: 't-por', roundNumber: 85 }), teams, 't-mia', false)).toMatchObject(
      {
        kicker: 'Post-season · ultima partita',
        title: 'Portland batte Miami',
      },
    );
  });

  it('senza spoiler il titolo non dice il risultato', () => {
    const h = gameHeadline(game({}), teams, 't-bos', true);
    expect(h.title).toBe('Miami – Boston');
    expect(`${h.title} ${h.dek}`).not.toMatch(/112|104|batte|vittoria|sconfitta/);
  });

  it('stato delle squadre nel turno: etichette e note in corsivo', () => {
    expect(readinessMark('ready')).toEqual({ kind: 'tag', tone: 'ink', label: 'Pronto' });
    expect(readinessMark('coach')).toEqual({ kind: 'tag', tone: 'outline', label: 'Allenatore' });
    expect(readinessMark('blocked')).toEqual({ kind: 'tag', tone: 'red', label: 'Deve decidere' });
    expect(readinessMark('waiting')).toEqual({ kind: 'note', label: 'non ancora pronto' });
    expect(readinessMark('out')).toEqual({ kind: 'note', label: 'non gioca' });
  });

  it('scadenza sotto il Pronto', () => {
    expect(deadlineNote('tra 11 h 40 min')).toBe(
      'Il turno chiude tra 11 h 40 min, o prima se tutti sono pronti.',
    );
    expect(deadlineNote('scaduta')).toBe('La scadenza è passata: il turno si chiude a momenti.');
  });

  it('striscia della simulazione', () => {
    expect(closingLabel('regular', 22)).toBe('Si gioca la giornata 23');
    expect(closingLabel('play-in', 82)).toBe('Si gioca il play-in');
    expect(closingLabel('playoffs', 90)).toBe('Si giocano i playoff');
    expect(closingLabel('offseason', 120)).toBe('Simulazione in corso');
  });

  it('titolo della conferma del Pronto', () => {
    expect(readyConfirmTitle(2, false)).toBe('Hai decisioni aperte');
    expect(readyConfirmTitle(1, true)).toBe('Hai modifiche non salvate');
    expect(readyConfirmTitle(3, true)).toBe('Decisioni aperte e modifiche non salvate');
  });
});
