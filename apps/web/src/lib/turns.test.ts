import { describe, expect, it } from 'vitest';
import {
  alertText,
  barView,
  coachActive,
  countsAsReady,
  MEMBER_REOPEN_HOURS,
  memberReopenAt,
  readiness,
  readinessNote,
  readyWarnings,
  roundStuck,
  roundTitle,
  timeLeft,
  type BarStatus,
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

describe('avviso dello spazio', () => {
  it('dice quanto occupa il database', () => {
    const t = alertText({ kind: 'storage', payload: { mb: 412.3, limit_mb: 500 } });
    expect(t.title).toBe('Database quasi pieno');
    expect(t.body).toContain('412.3 MB su 500');
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

  it('gli altri membri lo riaprono solo qualche ora dopo il blocco', () => {
    expect(memberReopenAt(null)).toBeNull();
    expect(memberReopenAt({ attempts: 1, failedAt: null })).toBeNull();
    const failedAt = new Date(NOW).toISOString();
    expect(memberReopenAt({ attempts: 3, failedAt })).toBe(NOW + MEMBER_REOPEN_HOURS * 3600_000);
    expect(MEMBER_REOPEN_HOURS).toBe(6);
  });
});

describe('barra del turno', () => {
  const round = { id: 'r', number: 12, kind: 'regular', state: 'open' as const, stage: null };
  const bar = (over: Partial<BarStatus> = {}): BarStatus => ({
    round,
    paused: false,
    draftPending: false,
    myTeamId: 't',
    myState: 'waiting',
    decisions: [],
    ...over,
  });

  it('titolo del turno', () => {
    expect(roundTitle('regular', 12, null)).toBe('Giornata 13 di 82');
    expect(roundTitle('play-in', 82, null)).toBe('Play-in');
    expect(roundTitle('playoffs', 90, null)).toBe('Playoff');
    expect(roundTitle('offseason', 3, 'renewals')).toBe('Offseason · Rinnovi');
    expect(roundTitle('offseason', 3, null)).toBe('Offseason');
  });

  it('non pronto: si segna pronto; pronto: toglie il Pronto', () => {
    expect(barView(bar())).toMatchObject({
      title: 'Giornata 13 di 82',
      badge: { label: 'Non pronto' },
      action: 'ready',
    });
    expect(barView(bar({ myState: 'ready' }))).toMatchObject({
      badge: { label: 'Pronto' },
      action: 'unready',
    });
  });

  it('allenatore fermo da un avviso: da decidere, con il numero delle decisioni', () => {
    const v = barView(bar({ myState: 'blocked', decisions: [{ id: 'a', kind: 'trade_offer' }] }));
    expect(v).toMatchObject({
      badge: { label: 'Da decidere', tone: 'amber' },
      action: 'ready',
      decisions: 1,
    });
  });

  it('chi non gioca in play-in e playoff non ha il pulsante', () => {
    expect(barView(bar({ myState: 'out' }))).toMatchObject({ badge: { label: 'Non gioca' }, action: null });
  });

  it('simulazione in corso e draft iniziale: niente pulsante', () => {
    expect(barView(bar({ round: { ...round, state: 'closing' } }))).toMatchObject({
      badge: { label: 'Simulazione…' },
      action: null,
    });
    expect(barView(bar({ draftPending: true }))).toMatchObject({ title: 'Draft iniziale', action: null });
  });

  it('senza turno o senza squadra la barra non c’è', () => {
    expect(barView(bar({ round: null }))).toBeNull();
    expect(barView(bar({ myTeamId: null }))).toBeNull();
  });
});

describe('prima di segnarsi pronti (seconda analisi)', () => {
  it('senza decisioni né modifiche non c’è nulla da dire', () => {
    expect(readyWarnings([])).toEqual([]);
  });

  it('dice che cosa succede alle decisioni aperte se il turno si chiude', () => {
    const one = readyWarnings([{ kind: 'trade_offer' }]);
    expect(one).toHaveLength(1);
    expect(one[0]).toMatch(/rifiutata/);
    expect(readyWarnings([{ kind: 'trade_offer' }, { kind: 'trade_offer' }])[0]).toMatch(/Le 2 proposte/);
    // Un rinnovo non fatto lascia andare il giocatore; con l'allenatore decide lui
    expect(readyWarnings([{ kind: 'renewals' }])[0]).toMatch(/svincolati/);
    expect(readyWarnings([{ kind: 'renewals' }], { coach: true })[0]).toMatch(/allenatore/);
    expect(readyWarnings([{ kind: 'roster_minimum' }])[0]).toMatch(/firma al minimo/);
    expect(readyWarnings([{ kind: 'draft_pick' }])[0]).toMatch(/lista/);
    expect(readyWarnings([{ kind: 'free_agency' }])[0]).toMatch(/offerte già fatte/);
    expect(readyWarnings([{ kind: 'preparation' }])[0]).toMatch(/esuberi/);
    expect(readyWarnings([{ kind: 'nuovo' }])[0]).toMatch(/scaduti/);
  });

  it('le modifiche non salvate in Squadra vengono per prime', () => {
    const w = readyWarnings([{ kind: 'trade_offer' }], { unsaved: true });
    expect(w).toHaveLength(2);
    expect(w[0]).toMatch(/non salvate/);
    expect(readyWarnings([], { unsaved: true })).toHaveLength(1);
  });
});
