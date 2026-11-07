import { describe, expect, it } from 'vitest';
import { ceremonyKey, ceremonyText, finalsNote, type Ceremony } from './ceremony.ts';
import type { LeagueTeam } from './leagues.ts';

const team = (code: string, fullName: string): LeagueTeam => ({
  id: `id-${code}`,
  code,
  fullName,
  conference: 'East',
  division: 'Atlantic',
  ownerId: null,
  ownerName: null,
});

describe('cerimonia di fine stagione', () => {
  it('testo da condividere: campione, finale, MVP delle Finali e premi, link allo Storico', () => {
    const c: Ceremony = {
      year: 2026,
      champion: team('BOS', 'Boston Celtics'),
      finalist: team('LAL', 'Los Angeles Lakers'),
      wins: [4, 2],
      awards: [
        {
          key: 'finals',
          label: 'MVP delle Finali',
          playerId: 'a',
          name: 'Jayson Tatum',
          teamCode: 'BOS',
          note: finalsNote({ games: 6, perGame: { pts: 28.5, reb: 9.1, ast: 6 } }),
        },
        {
          key: 'mvp',
          label: 'MVP',
          playerId: 'b',
          name: 'Nikola Jokic',
          teamCode: 'DEN',
          note: '33,1 di valutazione',
        },
      ],
    };
    expect(ceremonyText(c, 'Amici', 'https://x/#/lega/L/storico?stagione=2026').split('\n')).toEqual([
      '🏆 Amici · Stagione 2026-27',
      'Campioni: Boston Celtics (4-2 in finale su Los Angeles Lakers)',
      'MVP delle Finali: Jayson Tatum (BOS), 28,5 punti, 9,1 rimbalzi e 6,0 assist a partita in 6 partite',
      'MVP: Nikola Jokic (DEN), 33,1 di valutazione',
      'https://x/#/lega/L/storico?stagione=2026',
    ]);
    expect(finalsNote({ games: 1, perGame: { pts: 10, reb: 2, ast: 3 } })).toContain('in 1 partita');
  });

  it('una chiave per lega e stagione nella memoria del browser', () => {
    expect(ceremonyKey('L', 2026)).toBe('nbbgm:cerimonia:L:2026');
    expect(ceremonyKey('L', 2027)).not.toBe(ceremonyKey('L', 2026));
  });
});
