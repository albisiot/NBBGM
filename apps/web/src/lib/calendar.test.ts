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
  seasonBreaks,
  seasonCalendar,
  seasonDate,
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

/** Una partita del turno round, giocata il giorno round * 2 della stagione (un turno è un giorno con partite). */
function game(round: number, home: string, away: string, score: [number, number] | null = null): SeasonGame {
  const kind: GameKind = round < 82 ? 'regular' : round < 84 ? 'play-in' : 'playoffs';
  return {
    id: `${round}-${home}-${away}`,
    roundNumber: round,
    day: dayOfRound(round),
    kind,
    homeTeamId: home,
    awayTeamId: away,
    seriesId: null,
    homeScore: score?.[0] ?? null,
    awayScore: score?.[1] ?? null,
    overtimes: 0,
  };
}

/** Giorno della stagione del turno: uno ogni 2 giorni (il primo 0), per i test. */
const dayOfRound = (round: number) => 2 * round;

/** Il giorno di calendario del turno nella stagione 2026. */
const roundDay = (round: number) => seasonDate(2026, dayOfRound(round));

/** 82 turni con due partite al giorno, giocati fino al turno `played` escluso. */
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

describe('date della stagione', () => {
  it('si parte dal martedì tra il 20 e il 26 ottobre; i giorni si contano da lì', () => {
    expect(dayKey(openingDay(2026))).toBe('2026-10-20');
    expect(dayKey(openingDay(2025))).toBe('2025-10-21');
    expect(dayKey(openingDay(2027))).toBe('2027-10-26');
    for (let y = 2026; y < 2040; y++) {
      expect(weekday(openingDay(y))).toBe(1);
      expect(ymd10(openingDay(y))).toBeGreaterThanOrEqual(20);
      expect(ymd10(openingDay(y))).toBeLessThanOrEqual(26);
    }
    expect(dayKey(seasonDate(2026, 0))).toBe('2026-10-20');
    expect(dayKey(seasonDate(2026, 173))).toBe('2027-04-11');
  });

  it('i giorni senza partite della NBA, con il motivo', () => {
    const breaks = seasonBreaks(2026);
    expect(breaks.get(key(2026, 11, 26))).toBe('Thanksgiving');
    expect(breaks.get(key(2026, 12, 24))).toBe('Vigilia di Natale');
    expect(breaks.get(key(2027, 2, 20))).toBe('Pausa per l’All-Star');
    expect(breaks.has(key(2026, 12, 25))).toBe(false);
  });

  it('fase del giorno', () => {
    expect(dayRoundLabel({ kind: 'regular' })).toBe('Regular season');
    expect(dayRoundLabel({ kind: 'play-in' })).toBe('Play-in');
    expect(dayRoundLabel({ kind: 'playoffs' })).toBe('Playoff');
  });
});

describe('calendario della stagione', () => {
  const cal = seasonCalendar(2026, season(10));

  it('le partite divise per giorno, quello che dà il server', () => {
    expect(cal.size).toBe(82);
    const first = cal.get(key(2026, 10, 20));
    expect(first?.round).toBe(0);
    expect(first?.games).toHaveLength(2);
    expect(cal.has(key(2026, 10, 21))).toBe(false);
    expect(cal.get(key(2026, 10, 22))?.round).toBe(1);
    // Una partita senza giorno resta fuori
    expect(seasonCalendar(2026, [{ ...game(0, 'BOS', 'NYK'), day: null }]).size).toBe(0);
  });

  it('oggi è il giorno del turno aperto, se ha partite', () => {
    expect(leagueToday(cal, 2026, { kind: 'regular', day: dayOfRound(10) })).toBe(roundDay(10));
    expect(leagueToday(cal, 2026, { kind: 'offseason', day: null })).toBeNull();
    // Un giorno senza partite nel calendario (qui i playoff non ci sono)
    expect(leagueToday(cal, 2026, { kind: 'playoffs', day: 180 })).toBeNull();
    expect(leagueToday(cal, 2026, { kind: null, day: null })).toBeNull();
  });

  it("il giorno da aprire: oggi, altrimenti l'ultimo giocato, poi il primo", () => {
    expect(defaultDay(cal, 2026, roundDay(10))).toBe(roundDay(10));
    expect(defaultDay(cal, 2026, null)).toBe(roundDay(9));
    expect(defaultDay(seasonCalendar(2026, season(0)), 2026, null)).toBe(roundDay(0));
    expect(defaultDay(new Map(), 2026, null)).toBe(openingDay(2026));
  });

  it('mese e settimana prima e dopo, solo dentro la stagione', () => {
    const opening = roundDay(0);
    expect(shiftPeriod('mese', opening, -1, cal)).toBeNull();
    // A novembre il primo giorno con partite è domenica 1 (il turno 6, 12 giorni dopo l'apertura)
    expect(dayKey(shiftPeriod('mese', opening, 1, cal) as number)).toBe('2026-11-01');
    expect(shiftPeriod('mese', roundDay(81), 1, cal)).toBeNull();
    expect(shiftPeriod('settimana', opening, -1, cal)).toBeNull();
    expect(dayKey(shiftPeriod('settimana', opening, 1, cal) as number)).toBe('2026-10-26');
    expect(shiftPeriod('mese', opening, 1, new Map())).toBeNull();
  });

  it('il prossimo giorno con partite', () => {
    expect(nextGameDay(cal, key(2026, 10, 21))).toBe(key(2026, 10, 22));
    expect(nextGameDay(cal, roundDay(81))).toBeNull();
  });

  it('la partita di una squadra vista da lei', () => {
    const entry = cal.get(roundDay(0));
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
    const later = teamGame(cal.get(roundDay(20)), 'LAL') as SeasonGame;
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
  const opening = cal.get(roundDay(0)) as NonNullable<ReturnType<typeof cal.get>>;
  const next = cal.get(roundDay(1)) as NonNullable<ReturnType<typeof cal.get>>;

  it("la partita della squadra in evidenza, con l'esito", () => {
    expect(dayAriaLabel(opening, 'NYK', code, { spoilerFree: false, today: false })).toBe(
      'martedì 20 ottobre 2026, Regular season, NYK in trasferta a BOS, persa 100-110',
    );
    expect(dayAriaLabel(next, 'BOS', code, { spoilerFree: false, today: true })).toBe(
      'giovedì 22 ottobre 2026, Regular season, BOS in casa contro NYK, da giocare, oggi',
    );
  });

  it('senza spoiler niente esito; senza squadra il numero delle partite', () => {
    expect(dayAriaLabel(opening, 'BOS', code, { spoilerFree: true, today: false })).toBe(
      'martedì 20 ottobre 2026, Regular season, BOS in casa contro NYK, giocata',
    );
    expect(dayAriaLabel(opening, null, code, { spoilerFree: false, today: false })).toBe(
      'martedì 20 ottobre 2026, Regular season, 2 partite',
    );
    expect(dayAriaLabel(opening, 'MIA', code, { spoilerFree: false, today: false })).toBe(
      'martedì 20 ottobre 2026, Regular season, MIA riposa, 2 partite',
    );
  });
});
