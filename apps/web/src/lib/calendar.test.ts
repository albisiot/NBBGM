import { describe, expect, it } from 'vitest';
import {
  dayAriaLabel,
  dayKey,
  dayOf,
  dayRoundLabel,
  defaultDay,
  leagueToday,
  longDate,
  monthWeeks,
  nextGameDay,
  openingDay,
  parseDayKey,
  periodTitle,
  readView,
  roundDay,
  seasonCalendar,
  shiftPeriod,
  shortDate,
  teamGame,
  teamSide,
  WEEKDAY_HEADERS,
  weekday,
  weekOf,
} from './calendar.ts';
import type { GameKind, SeasonGame } from './results.ts';

const key = (year: number, month: number, date: number) => dayOf(year, month, date);

function game(round: number, home: string, away: string, score: [number, number] | null = null): SeasonGame {
  const kind: GameKind = round < 82 ? 'regular' : round < 84 ? 'play-in' : 'playoffs';
  return {
    id: `${round}-${home}-${away}`,
    roundNumber: round,
    kind,
    homeTeamId: home,
    awayTeamId: away,
    seriesId: null,
    homeScore: score?.[0] ?? null,
    awayScore: score?.[1] ?? null,
    overtimes: 0,
  };
}

/** Una stagione di 82 giornate con due partite a giornata, giocate fino alla giornata `played` esclusa. */
function season(played: number): SeasonGame[] {
  return Array.from({ length: 82 }, (_, r) => [
    game(r, 'BOS', 'NYK', r < played ? [110, 100] : null),
    game(r, 'LAL', 'GSW', r < played ? [99, 101] : null),
  ]).flat();
}

describe('date', () => {
  it("giorno della settimana da lunedì, e date nell'indirizzo", () => {
    expect(weekday(key(2026, 11, 8))).toBe(6); // domenica
    expect(weekday(key(2026, 10, 20))).toBe(1); // martedì
    expect(dayKey(key(2026, 11, 14))).toBe('2026-11-14');
    expect(parseDayKey('2026-11-14')).toBe(key(2026, 11, 14));
    expect(parseDayKey('2026-02-30')).toBeNull();
    expect(parseDayKey('14/11/2026')).toBeNull();
    expect(parseDayKey(null)).toBeNull();
  });

  it('in italiano, senza dipendere dalla lingua del sistema', () => {
    expect(longDate(key(2026, 11, 14))).toBe('sabato 14 novembre 2026');
    expect(shortDate(key(2027, 1, 1))).toBe('ven 1 gen');
    expect(WEEKDAY_HEADERS.map((h) => h.short)).toEqual(['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']);
  });

  it('titolo del mese e della settimana, anche a cavallo di mese e di anno', () => {
    expect(periodTitle('mese', key(2026, 11, 14))).toBe('Novembre 2026');
    expect(periodTitle('settimana', key(2026, 11, 14))).toBe('9 – 15 novembre 2026');
    expect(periodTitle('settimana', key(2026, 12, 2))).toBe('30 novembre – 6 dicembre 2026');
    expect(periodTitle('settimana', key(2026, 12, 31))).toBe('28 dicembre 2026 – 3 gennaio 2027');
  });

  it('settimane del mese da lunedì, con i giorni fuori dal mese vuoti', () => {
    const weeks = monthWeeks(key(2026, 11, 20));
    expect(weeks).toHaveLength(6);
    expect(weeks[0]).toEqual([null, null, null, null, null, null, key(2026, 11, 1)]);
    expect(weeks[5]).toEqual([key(2026, 11, 30), null, null, null, null, null, null]);
    expect(weekOf(key(2026, 11, 14))).toEqual(Array.from({ length: 7 }, (_, i) => key(2026, 11, 9) + i));
  });

  it("vista dall'indirizzo: mese salvo settimana", () => {
    expect(readView('settimana')).toBe('settimana');
    expect(readView('mese')).toBe('mese');
    expect(readView(null)).toBe('mese');
    expect(readView('anno')).toBe('mese');
  });
});

describe('giorni dei turni', () => {
  it('si parte dal martedì tra il 20 e il 26 ottobre', () => {
    expect(dayKey(openingDay(2026))).toBe('2026-10-20');
    expect(dayKey(openingDay(2025))).toBe('2025-10-21');
    expect(dayKey(openingDay(2027))).toBe('2027-10-26');
    for (let y = 2026; y < 2040; y++) {
      expect(weekday(openingDay(y))).toBe(1);
      expect(ymd10(openingDay(y))).toBeGreaterThanOrEqual(20);
      expect(ymd10(openingDay(y))).toBeLessThanOrEqual(26);
    }
  });

  it('regular season da ottobre a metà aprile, play-in e playoff fino a giugno', () => {
    expect(dayKey(roundDay(2026, 0))).toBe('2026-10-20');
    expect(dayKey(roundDay(2026, 1))).toBe('2026-10-22');
    // Ogni settima pausa è di 3 giorni
    expect(roundDay(2026, 7) - roundDay(2026, 6)).toBe(3);
    expect(dayKey(roundDay(2026, 81))).toBe('2027-04-11');
    expect(dayKey(roundDay(2026, 82))).toBe('2027-04-14');
    expect(dayKey(roundDay(2026, 83))).toBe('2027-04-16');
    expect(dayKey(roundDay(2026, 84))).toBe('2027-04-18');
    expect(dayKey(roundDay(2026, 111))).toBe('2027-06-11');
  });

  it('un giorno per turno: due turni non cadono mai nello stesso giorno', () => {
    const days = Array.from({ length: 112 }, (_, r) => roundDay(2026, r));
    for (let i = 1; i < days.length; i++)
      expect((days[i] as number) - (days[i - 1] as number)).toBeGreaterThanOrEqual(2);
  });

  it('nome del turno di un giorno', () => {
    expect(dayRoundLabel({ round: 12, kind: 'regular' })).toBe('Giornata 13');
    expect(dayRoundLabel({ round: 83, kind: 'play-in' })).toBe('Play-in');
    expect(dayRoundLabel({ round: 84, kind: 'playoffs' })).toBe('Playoff · turno 1');
    expect(dayRoundLabel({ round: 86, kind: 'playoffs' })).toBe('Playoff · turno 3');
  });
});

describe('calendario della stagione', () => {
  const cal = seasonCalendar(2026, season(10));

  it('le partite divise per giorno', () => {
    expect(cal.size).toBe(82);
    const first = cal.get(key(2026, 10, 20));
    expect(first?.round).toBe(0);
    expect(first?.games).toHaveLength(2);
    expect(cal.has(key(2026, 10, 21))).toBe(false);
  });

  it('oggi è il giorno del turno aperto, se ha partite', () => {
    expect(leagueToday(cal, 2026, { number: 10, kind: 'regular' })).toBe(roundDay(2026, 10));
    expect(leagueToday(cal, 2026, { number: 90, kind: 'offseason' })).toBeNull();
    expect(leagueToday(cal, 2026, { number: 84, kind: 'playoffs' })).toBeNull();
    expect(leagueToday(cal, 2026, { number: null, kind: null })).toBeNull();
  });

  it("il giorno da aprire: oggi, altrimenti l'ultimo giocato, poi il primo", () => {
    expect(defaultDay(cal, 2026, roundDay(2026, 10))).toBe(roundDay(2026, 10));
    expect(defaultDay(cal, 2026, null)).toBe(roundDay(2026, 9));
    expect(defaultDay(seasonCalendar(2026, season(0)), 2026, null)).toBe(roundDay(2026, 0));
    expect(defaultDay(new Map(), 2026, null)).toBe(openingDay(2026));
  });

  it('mese e settimana prima e dopo, solo dentro la stagione', () => {
    const opening = roundDay(2026, 0);
    expect(shiftPeriod('mese', opening, -1, cal)).toBeNull();
    // A novembre il primo giorno con partite è domenica 1 (giornata 7)
    expect(dayKey(shiftPeriod('mese', opening, 1, cal) as number)).toBe('2026-11-01');
    expect(shiftPeriod('mese', roundDay(2026, 81), 1, cal)).toBeNull();
    expect(shiftPeriod('settimana', opening, -1, cal)).toBeNull();
    expect(dayKey(shiftPeriod('settimana', opening, 1, cal) as number)).toBe('2026-10-26');
    expect(shiftPeriod('mese', opening, 1, new Map())).toBeNull();
  });

  it('il prossimo giorno con partite', () => {
    expect(nextGameDay(cal, key(2026, 10, 21))).toBe(key(2026, 10, 22));
    expect(nextGameDay(cal, roundDay(2026, 81))).toBeNull();
  });

  it('la partita di una squadra vista da lei', () => {
    const entry = cal.get(roundDay(2026, 0));
    const g = teamGame(entry, 'NYK');
    expect(g?.homeTeamId).toBe('BOS');
    expect(teamGame(entry, 'MIA')).toBeNull();
    expect(teamGame(entry, null)).toBeNull();
    expect(teamGame(undefined, 'BOS')).toBeNull();
    expect(teamSide(g as SeasonGame, 'BOS')).toEqual({
      opponentId: 'NYK',
      home: true,
      result: 'V',
      score: '110-100',
    });
    expect(teamSide(g as SeasonGame, 'NYK')).toEqual({
      opponentId: 'BOS',
      home: false,
      result: 'S',
      score: '100-110',
    });
    const later = teamGame(cal.get(roundDay(2026, 20)), 'LAL') as SeasonGame;
    expect(teamSide(later, 'LAL')).toEqual({ opponentId: 'GSW', home: true, result: null, score: null });
  });
});

/** Giorno del mese, per controllare la finestra dell'apertura. */
function ymd10(day: number): number {
  return Number(dayKey(day).slice(8));
}

describe('giorno per i lettori di schermo', () => {
  const cal = seasonCalendar(2026, season(1));
  const code = (id: string) => id;
  const opening = cal.get(roundDay(2026, 0)) as NonNullable<ReturnType<typeof cal.get>>;
  const next = cal.get(roundDay(2026, 1)) as NonNullable<ReturnType<typeof cal.get>>;

  it("la partita della squadra in evidenza, con l'esito", () => {
    expect(dayAriaLabel(opening, 'NYK', code, { spoilerFree: false, today: false })).toBe(
      'martedì 20 ottobre 2026, Giornata 1, NYK in trasferta a BOS, persa 100-110',
    );
    expect(dayAriaLabel(next, 'BOS', code, { spoilerFree: false, today: true })).toBe(
      'giovedì 22 ottobre 2026, Giornata 2, BOS in casa contro NYK, da giocare, oggi',
    );
  });

  it('senza spoiler niente esito; senza squadra il numero delle partite', () => {
    expect(dayAriaLabel(opening, 'BOS', code, { spoilerFree: true, today: false })).toBe(
      'martedì 20 ottobre 2026, Giornata 1, BOS in casa contro NYK, giocata',
    );
    expect(dayAriaLabel(opening, null, code, { spoilerFree: false, today: false })).toBe(
      'martedì 20 ottobre 2026, Giornata 1, 2 partite',
    );
    expect(dayAriaLabel(opening, 'MIA', code, { spoilerFree: false, today: false })).toBe(
      'martedì 20 ottobre 2026, Giornata 1, 2 partite',
    );
  });
});
