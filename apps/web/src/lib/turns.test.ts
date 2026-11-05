import { describe, expect, it } from 'vitest';
import { alertText, coachActive, readiness, timeLeft, type TurnStatus } from './turns.ts';

const NOW = Date.parse('2026-11-05T12:00:00Z');

function status(over: Partial<TurnStatus> = {}): TurnStatus {
  return {
    round: {
      id: 'r',
      number: 4,
      kind: 'regular',
      state: 'open',
      deadline: null,
      createdAt: '2026-11-05T11:59:00Z',
      forcedAt: null,
    },
    paused: false,
    maxPaceSeconds: 60,
    ready: new Set(),
    delegations: [],
    alerts: [],
    lastGame: null,
    ...over,
  };
}

describe('chi è pronto', () => {
  it('Pronto premuto, allenatore attivo o in attesa', () => {
    const s = status({
      ready: new Set(['a']),
      delegations: [
        { teamId: 'b', active: true, untilRound: null, untilAt: null },
        { teamId: 'c', active: true, untilRound: 3, untilAt: null },
        { teamId: 'd', active: true, untilRound: null, untilAt: '2026-11-05T11:00:00Z' },
        { teamId: 'e', active: false, untilRound: null, untilAt: null },
      ],
    });
    expect(['a', 'b', 'c', 'd', 'e', 'f'].map((t) => readiness(s, t, NOW))).toEqual([
      'ready',
      'coach',
      'waiting',
      'waiting',
      'waiting',
      'waiting',
    ]);
  });

  it('la delega fino a un turno vale fino a quel turno compreso', () => {
    const d = { teamId: 'x', active: true, untilRound: 4, untilAt: null };
    expect(coachActive(d, 4, NOW)).toBe(true);
    expect(coachActive(d, 5, NOW)).toBe(false);
  });
});

describe('testi', () => {
  it('avvisi', () => {
    expect(alertText({ kind: 'roster_minimum', payload: { standard: 11, minimum: 13 } }).body).toMatch(
      /11 contratti standard: ne servono almeno 13/,
    );
    expect(
      alertText({
        kind: 'injury',
        payload: { player: 'Mario Rossi', body_part_label: 'caviglie', games: 1 },
      }).body,
    ).toBe('Mario Rossi si è fatto male (caviglie): starà fuori 1 partita.');
  });

  it('tempo alla scadenza', () => {
    expect(timeLeft('2026-11-05T12:00:30Z', NOW)).toBe('tra 30 s');
    expect(timeLeft('2026-11-05T12:12:00Z', NOW)).toBe('tra 12 min');
    expect(timeLeft('2026-11-05T15:20:00Z', NOW)).toBe('tra 3 h 20 min');
    expect(timeLeft('2026-11-05T11:00:00Z', NOW)).toBe('scaduta');
  });
});
