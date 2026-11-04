import { describe, expect, it } from 'vitest';
import { generateSchedule, seriesPlan, validateSchedule } from '../src/season/schedule.ts';
import { TEAMS } from '../src/teams.ts';

describe('calendario', () => {
  it('rispetta il formato NBA per cinque stagioni di fila', () => {
    for (const year of [2026, 2027, 2028, 2029, 2030]) {
      const schedule = generateSchedule(TEAMS, year, 'test');
      expect(schedule).toHaveLength(30 * 41);
      expect(validateSchedule(TEAMS, year, schedule)).toEqual([]);
    }
  });

  it('ogni squadra: 16 partite nella division, 36 nella conference, 30 con l’altra', () => {
    const { games } = seriesPlan(TEAMS, 2026);
    TEAMS.forEach((t, i) => {
      let division = 0;
      let conference = 0;
      let other = 0;
      let threes = 0;
      TEAMS.forEach((u, j) => {
        const g = games[i]![j]!;
        if (u.conference !== t.conference) other += g;
        else if (u.division === t.division) division += g;
        else {
          conference += g;
          if (g === 3) threes++;
        }
      });
      expect([division, conference, other, threes]).toEqual([16, 36, 30, 4]);
    });
  });

  it('le serie da 3 partite ruotano di stagione in stagione', () => {
    const a = seriesPlan(TEAMS, 2026).games;
    const b = seriesPlan(TEAMS, 2027).games;
    expect(a).not.toEqual(b);
  });

  it('stesso seed, stesso calendario', () => {
    expect(generateSchedule(TEAMS, 2026, 'x')).toEqual(generateSchedule(TEAMS, 2026, 'x'));
  });

  it('la stessa sfida in due turni di fila è rara', () => {
    const s = generateSchedule(TEAMS, 2026, 'consecutive');
    let repeats = 0;
    for (let t = 1; t < 82; t++) {
      const prev = new Set(
        s.filter((g) => g.turn === t - 1).map((g) => [g.homeId, g.awayId].sort().join('|')),
      );
      repeats += s.filter((g) => g.turn === t && prev.has([g.homeId, g.awayId].sort().join('|'))).length;
    }
    expect(repeats).toBeLessThan(20);
  });
});
