import { describe, expect, it } from 'vitest';
import { appLink, shareMessage, shareText } from './share.ts';
import { summaryText, type TurnSummary } from './summary.ts';

const base: TurnSummary = {
  leagueName: 'Amici',
  teamName: 'Boston Celtics',
  teamCode: 'BOS',
  lastGame: {
    roundNumber: 6,
    kind: 'regular',
    day: 22,
    seasonYear: 2026,
    homeCode: 'BOS',
    awayCode: 'LAL',
    homeScore: 112,
    awayScore: 105,
    overtimes: 0,
    home: true,
  },
  standing: { conference: 'East', rank: 3, w: 5, l: 2 },
  injuries: [{ name: 'Jayson Tatum', bodyPart: 'ginocchia', games: 4 }],
  signings: [{ name: 'Mario Rossi', salary: 2_100_000, years: 2 }],
  nextGame: { roundNumber: 7, kind: 'regular', day: 24, seasonYear: 2026, opponentCode: 'NYK', home: false },
  link: 'https://albisiot.github.io/NBBGM/#/lega/L',
};

describe('riepilogo del turno', () => {
  it('risultato, classifica, infortuni, firme, prossima partita e link, una riga ciascuno', () => {
    expect(summaryText(base).split('\n')).toEqual([
      '🏀 Amici · Boston Celtics',
      'Ultima partita (mercoledì 11 novembre): LAL 105 – 112 BOS, vinta',
      'Classifica: 3ª nella Eastern Conference (5-2)',
      'Infortuni: Jayson Tatum (ginocchia, 4 partite)',
      'Firmati: Mario Rossi (2,10 mln per 2 anni)',
      'Prossima partita (venerdì 13 novembre): in trasferta contro NYK',
      'https://albisiot.github.io/NBBGM/#/lega/L',
    ]);
  });

  it('sconfitta in trasferta ai supplementari, niente infortuni né firme, post-season', () => {
    const text = summaryText({
      ...base,
      lastGame: {
        ...base.lastGame!,
        home: false,
        homeScore: 120,
        awayScore: 118,
        overtimes: 2,
        roundNumber: 170,
        kind: 'playoffs',
        day: 180,
      },
      injuries: [],
      signings: [],
      nextGame: null,
      standing: null,
    });
    expect(text).toContain(
      'Ultima partita (playoff, domenica 18 aprile): LAL 118 – 120 BOS, persa, 2 supplementari',
    );
    expect(text).toContain('Infortuni: nessuno');
    expect(text).not.toContain('Firmati');
    expect(text).not.toContain('Classifica');
    expect(text).not.toContain('Prossima');
  });

  it('una partita, un anno, un supplementare', () => {
    const text = summaryText({
      ...base,
      lastGame: { ...base.lastGame!, overtimes: 1 },
      injuries: [{ name: 'A B', bodyPart: 'caviglie', games: 1 }],
      signings: [{ name: 'C D', salary: 1_500_000, years: 1 }],
    });
    expect(text).toContain('vinta, dopo un supplementare');
    expect(text).toContain('A B (caviglie, 1 partita)');
    expect(text).toContain('C D (1,50 mln per 1 anno)');
  });
});

describe('condivisione', () => {
  it('pannello del sistema; chiuso senza scegliere non copia', async () => {
    const shared: string[] = [];
    const copied: string[] = [];
    const clipboard = { writeText: async (t: string) => void copied.push(t) };
    expect(
      await shareText('ciao', 'T', { share: async (d) => void shared.push(d.text ?? ''), clipboard }),
    ).toBe('shared');
    const abort = Object.assign(new Error('chiuso'), { name: 'AbortError' });
    expect(
      await shareText('ciao', 'T', {
        share: () => Promise.reject(abort),
        clipboard,
      }),
    ).toBe('cancelled');
    expect(shared).toEqual(['ciao']);
    expect(copied).toEqual([]);
  });

  it('senza pannello, o con il pannello non permesso, copia negli appunti', async () => {
    const copied: string[] = [];
    const clipboard = { writeText: async (t: string) => void copied.push(t) };
    expect(await shareText('a', 'T', { clipboard })).toBe('copied');
    const denied = Object.assign(new Error('no'), { name: 'NotAllowedError' });
    expect(await shareText('b', 'T', { share: () => Promise.reject(denied), clipboard })).toBe('copied');
    expect(copied).toEqual(['a', 'b']);
    expect(await shareText('c', 'T', {})).toBe('failed');
    expect(
      await shareText('c', 'T', { clipboard: { writeText: () => Promise.reject(new Error('x')) } }),
    ).toBe('failed');
  });

  it('messaggi in basso e link alla pagina', () => {
    expect(shareMessage('shared')).toBeNull();
    expect(shareMessage('cancelled')).toBeNull();
    expect(shareMessage('copied')?.ok).toBe(true);
    expect(shareMessage('failed')?.ok).toBe(false);
    expect(appLink('/lega/L', { origin: 'https://x.io', pathname: '/NBBGM/' })).toBe(
      'https://x.io/NBBGM/#/lega/L',
    );
  });
});
