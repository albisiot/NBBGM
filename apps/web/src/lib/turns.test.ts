import { describe, expect, it } from 'vitest';
import {
  alertText,
  coachActive,
  countsAsReady,
  readiness,
  readinessNote,
  roundStuck,
  timeLeft,
  type TurnStatus,
} from './turns.ts';

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
      closingStartedAt: null,
    },
    paused: false,
    maxPaceSeconds: 60,
    ready: new Set(),
    delegations: [],
    alerts: [],
    lastGame: null,
    playing: null,
    championId: null,
    trouble: null,
    myTeamId: null,
    teamStates: null,
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

  it('in play-in e playoff chi non gioca non deve essere pronto', () => {
    const s = status({ playing: new Set(['a', 'b']), ready: new Set(['a']) });
    expect(['a', 'b', 'c'].map((t) => readiness(s, t, NOW))).toEqual(['ready', 'waiting', 'out']);
  });

  it('senza lo stato del server, l’avviso bloccante si vede solo per la propria squadra', () => {
    const coach = (teamId: string) => ({ teamId, active: true, untilRound: null, untilAt: null });
    const alert = { id: 'x', kind: 'trade_offer', blocking: true, payload: {}, createdAt: '' };
    const s = status({ myTeamId: 'a', alerts: [alert], delegations: [coach('a'), coach('b')] });
    expect(readiness(s, 'a', NOW)).toBe('blocked');
    expect(readiness(s, 'b', NOW)).toBe('coach');
  });

  it('con lo stato del server vale quello: anche gli avvisi delle altre squadre', () => {
    const s = status({
      ready: new Set(),
      delegations: [
        { teamId: 'b', active: true, untilRound: null, untilAt: null },
        { teamId: 'c', active: true, untilRound: null, untilAt: '2026-11-05T11:00:00Z' },
      ],
      teamStates: new Map([
        ['a', 'ready'],
        ['b', 'blocked'],
        // Delega scaduta dopo la lettura: non è più con l'allenatore
        ['c', 'coach'],
        ['d', 'out'],
      ]),
    });
    expect(['a', 'b', 'c', 'd'].map((t) => readiness(s, t, NOW))).toEqual([
      'ready',
      'blocked',
      'waiting',
      'out',
    ]);
    // Una squadra che il server non conosce ancora (appena entrata) si ricava dalle tabelle
    expect(readiness({ ...s, ready: new Set(['e']) }, 'e', NOW)).toBe('ready');
    expect(['ready', 'coach', 'blocked', 'waiting'].map((r) => countsAsReady(r as never))).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('la delega fino a un turno vale fino a quel turno compreso', () => {
    const d = { teamId: 'x', active: true, untilRound: 4, untilAt: null };
    expect(coachActive(d, 4, NOW)).toBe(true);
    expect(coachActive(d, 5, NOW)).toBe(false);
  });
});

describe('nota sotto i manager', () => {
  const t = (name: string, state: Parameters<typeof readinessNote>[0][number]['state'], mine = false) => ({
    name,
    state,
    mine,
  });

  it('tutti pronti o tutti con l’allenatore', () => {
    expect(readinessNote([t('Anna', 'ready'), t('Bruno', 'coach'), t('Carla', 'out')])).toBe(
      'Tutti pronti: il turno parte a momenti.',
    );
    expect(readinessNote([t('Anna', 'coach'), t('Bruno', 'coach')])).toMatch(/la lega avanza da sola/);
  });

  it('con l’allenatore fermo da un avviso non dice che la lega avanza: dice chi deve decidere', () => {
    expect(readinessNote([t('Anna', 'coach'), t('Bruno', 'blocked')])).toBe(
      'Si aspetta una decisione da Bruno: con un avviso aperto l’allenatore si ferma finché il manager non risponde.',
    );
    expect(readinessNote([t('Anna', 'blocked', true), t('Bruno', 'blocked'), t('Carla', 'blocked')])).toMatch(
      /^Si aspetta una decisione da Bruno, Carla e te:/,
    );
    // Qualcuno non ha ancora premuto Pronto e nessuno è fermo: niente da dire
    expect(readinessNote([t('Anna', 'coach'), t('Bruno', 'waiting')])).toBeNull();
    expect(readinessNote([t('Anna', 'out')])).toBeNull();
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

describe('turno fermo in chiusura', () => {
  const closing = (startedMinutesAgo: number) => ({
    ...(status().round as NonNullable<TurnStatus['round']>),
    state: 'closing' as const,
    closingStartedAt: new Date(NOW - startedMinutesAgo * 60_000).toISOString(),
  });

  it('un turno aperto o in chiusura da poco non è fermo', () => {
    expect(roundStuck(status().round!, null, NOW)).toBe(false);
    expect(roundStuck(closing(2), { attempts: 1, failedAt: null }, NOW)).toBe(false);
  });

  it('è fermo dopo 5 minuti in chiusura o dopo l’ultimo tentativo', () => {
    expect(roundStuck(closing(6), { attempts: 1, failedAt: null }, NOW)).toBe(true);
    expect(roundStuck(closing(6), null, NOW)).toBe(true);
    expect(roundStuck(closing(1), { attempts: 3, failedAt: new Date(NOW).toISOString() }, NOW)).toBe(true);
  });
});
