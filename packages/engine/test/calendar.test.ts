// Date della stagione e calendario a giorni, con i numeri del calendario NBA vero (2026-27; conteggi di novembre 2025
// e gennaio 2026): 174 giorni dal martedì 20 ottobre alla domenica 11 aprile, circa 7 partite al giorno, da 12 a 16
// back-to-back a squadra, mai 3 partite in 3 giorni.
import { describe, expect, it } from 'vitest';
import {
  LAST_REGULAR_DAY,
  christmasDay,
  dayOf,
  noGameDays,
  openingDay,
  seasonDate,
  tradeDeadlineDay,
  weekday,
  ymd,
} from '../src/season/calendar.ts';
import {
  CHRISTMAS_GAMES,
  OPENING_NIGHT_GAMES,
  backToBacks,
  generateSchedule,
  regularTurns,
  teamDays,
  validateSchedule,
} from '../src/season/schedule.ts';
import { recoverEnergy } from '../src/season/turn.ts';
import { TEAMS } from '../src/teams.ts';

const key = (year: number, day: number) => {
  const d = ymd(seasonDate(year, day));
  return `${d.year}-${String(d.month).padStart(2, '0')}-${String(d.date).padStart(2, '0')}`;
};

describe('date della stagione', () => {
  it('si parte dal martedì tra il 20 e il 26 ottobre e si finisce di domenica, 173 giorni dopo', () => {
    expect(key(2026, 0)).toBe('2026-10-20');
    expect(key(2026, LAST_REGULAR_DAY)).toBe('2027-04-11');
    for (let y = 2026; y < 2040; y++) {
      expect(weekday(openingDay(y))).toBe(1);
      expect(ymd(openingDay(y)).date).toBeGreaterThanOrEqual(20);
      expect(ymd(openingDay(y)).date).toBeLessThanOrEqual(26);
      expect(weekday(seasonDate(y, LAST_REGULAR_DAY))).toBe(6);
    }
  });

  it('giorni senza partite come nel 2026-27 della NBA', () => {
    const off = noGameDays(2026);
    expect([...off.keys()].sort((a, b) => a - b).map((d) => key(2026, d))).toEqual([
      '2026-11-03', // elezioni
      '2026-11-26', // Thanksgiving
      '2026-12-24',
      '2027-02-19', // pausa All-Star, dal venerdì al mercoledì
      '2027-02-20',
      '2027-02-21',
      '2027-02-22',
      '2027-02-23',
      '2027-02-24',
      '2027-04-10', // penultimo giorno
    ]);
    // Negli anni dispari niente elezioni
    expect(noGameDays(2027).size).toBe(9);
    expect(key(2026, christmasDay(2026))).toBe('2026-12-25');
    // Trade deadline: il primo giovedì di febbraio
    expect(key(2026, tradeDeadlineDay(2026))).toBe('2027-02-04');
    expect(weekday(seasonDate(2030, tradeDeadlineDay(2030)))).toBe(3);
    expect(dayOf(2027, 2, 4) - openingDay(2026)).toBe(tradeDeadlineDay(2026));
  });
});

describe('calendario a giorni', () => {
  const years = [2026, 2027, 2028, 2029, 2030];
  const schedules = years.map((y) => [y, generateSchedule(TEAMS, y, `giorni-${y}`)] as const);

  it('un turno è un giorno: valido, 1.230 partite, circa 164 turni', () => {
    for (const [year, s] of schedules) {
      expect(s).toHaveLength(1230);
      expect(validateSchedule(TEAMS, year, s)).toEqual([]);
      expect(regularTurns(s)).toBeGreaterThanOrEqual(163);
      expect(regularTurns(s)).toBeLessThanOrEqual(165);
    }
  });

  it('3 partite la prima sera, 5 a Natale, tutte e 30 l’ultimo giorno; mai nei giorni senza partite', () => {
    for (const [year, s] of schedules) {
      const perDay = new Map<number, number>();
      for (const g of s) perDay.set(g.day, (perDay.get(g.day) ?? 0) + 1);
      expect(perDay.get(0)).toBe(OPENING_NIGHT_GAMES);
      expect(perDay.get(christmasDay(year))).toBe(CHRISTMAS_GAMES);
      expect(perDay.get(LAST_REGULAR_DAY)).toBe(15);
      for (const d of noGameDays(year).keys()) expect(perDay.has(d)).toBe(false);
      // Tutti gli altri giorni hanno partite, da 1 a 13 (nella NBA da 1 a 12)
      const counts = [...perDay.entries()].filter(([d]) => d !== LAST_REGULAR_DAY).map(([, n]) => n);
      expect(perDay.size).toBe(LAST_REGULAR_DAY + 1 - noGameDays(year).size);
      expect(Math.min(...counts)).toBeGreaterThanOrEqual(1);
      expect(Math.max(...counts)).toBeLessThanOrEqual(13);
    }
  });

  it('mercoledì e venerdì più pieni del giovedì, come nella NBA', () => {
    const byWeekday = Array.from({ length: 7 }, () => ({ games: 0, days: new Set<number>() }));
    for (const [year, s] of schedules)
      for (const g of s) {
        const w = byWeekday[weekday(seasonDate(year, g.day))]!;
        w.games++;
        w.days.add(year * 1000 + g.day);
      }
    const avg = byWeekday.map((w) => w.games / w.days.size);
    expect(avg[2]).toBeGreaterThan(avg[3]! + 2);
    expect(avg[4]).toBeGreaterThan(avg[3]! + 2);
  });

  it('back-to-back da 10 a 16 a squadra (NBA: 12-16, media 14,2), mai 3 partite in 3 giorni', () => {
    for (const [, s] of schedules) {
      const b = [...backToBacks(s).values()];
      expect(Math.min(...b)).toBeGreaterThanOrEqual(10);
      expect(Math.max(...b)).toBeLessThanOrEqual(16);
      const mean = b.reduce((x, y) => x + y, 0) / b.length;
      expect(mean).toBeGreaterThan(13);
      expect(mean).toBeLessThan(15);
      for (const days of teamDays(s).values()) {
        for (let i = 2; i < days.length; i++) expect(days[i]! - days[i - 2]!).toBeGreaterThan(2);
        // Ogni squadra gioca una partita ogni 2 giorni circa: mai più di una settimana ferma (pausa All-Star a parte)
        for (let i = 1; i < days.length; i++) expect(days[i]! - days[i - 1]!).toBeLessThanOrEqual(9);
      }
    }
  });
});

describe('recupero per notti di riposo', () => {
  it('più notti, più energia; nessuna notte, niente recupero', () => {
    expect(recoverEnergy(70, 50, 0)).toBe(70);
    const one = recoverEnergy(70, 50, 1);
    const two = recoverEnergy(70, 50, 2);
    expect(one).toBeGreaterThan(70);
    expect(two).toBeGreaterThan(one);
    expect(recoverEnergy(70, 50, 10)).toBeLessThanOrEqual(100);
    // Con più Resistenza si recupera di più
    expect(recoverEnergy(70, 90, 1)).toBeGreaterThan(recoverEnergy(70, 10, 1));
  });
});
