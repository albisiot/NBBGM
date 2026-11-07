import { describe, expect, it } from 'vitest';
import { leagueLive, type LeagueLiveRow } from './leaguesLive.ts';

const NOW = Date.parse('2026-11-07T12:00:00Z');

const row = (over: Partial<LeagueLiveRow> = {}): LeagueLiveRow => ({
  league_id: 'L',
  paused: false,
  draft_state: null,
  round: {
    id: 'R',
    number: 6,
    kind: 'regular',
    state: 'open',
    stage: null,
    closing_started_at: null,
    attempts: 0,
    failed_at: null,
  },
  my_team_id: 'BOS',
  decisions: 0,
  readiness: [
    { team_id: 'BOS', state: 'waiting' },
    { team_id: 'LAL', state: 'ready' },
    { team_id: 'NYK', state: 'coach' },
  ],
  ...over,
});

const live = (r: LeagueLiveRow) => leagueLive(r, NOW);

describe('stato dal vivo nell’elenco delle leghe', () => {
  it('tocca a te, umani pronti (Pronto o allenatore) sul totale, decisioni aperte', () => {
    const l = leagueLive(row({ decisions: 2 }), NOW);
    expect(l).toMatchObject({ phase: 'open', myState: 'waiting', ready: 2, humans: 3, decisions: 2 });
  });

  it('allenatore fermo da un avviso: tocca a te; pronto o allenatore: niente "tocca a te"', () => {
    const blocked = row({
      decisions: 1,
      readiness: [
        { team_id: 'BOS', state: 'blocked' },
        { team_id: 'LAL', state: 'ready' },
      ],
    });
    expect(live(blocked)).toMatchObject({ myState: 'blocked', ready: 1, humans: 2, decisions: 1 });
    expect(live(row({ readiness: [{ team_id: 'BOS', state: 'ready' }] }))).toMatchObject({
      myState: 'ready',
      ready: 1,
      humans: 1,
    });
    expect(live(row({ readiness: [{ team_id: 'BOS', state: 'coach' }] }))).toMatchObject({
      myState: 'coach',
      ready: 1,
      humans: 1,
    });
  });

  it('in play-in e playoff chi non gioca non conta tra gli umani', () => {
    const r = row({
      round: { ...row().round!, kind: 'playoffs' },
      readiness: [
        { team_id: 'BOS', state: 'out' },
        { team_id: 'LAL', state: 'ready' },
        { team_id: 'NYK', state: 'waiting' },
      ],
    });
    expect(leagueLive(r, NOW)).toMatchObject({ myState: 'out', ready: 1, humans: 2 });
  });

  it('stato della lega: pausa, draft iniziale, simulazione, ritardo, turno bloccato', () => {
    // In pausa il Pronto si dà lo stesso: si vede ancora che tocca a te
    expect(live(row({ paused: true }))).toMatchObject({ phase: 'paused', myState: 'waiting' });
    expect(live(row({ draft_state: 'running' })).phase).toBe('draft');
    const closing = (startedMinAgo: number, failed: string | null) =>
      row({
        round: {
          ...row().round!,
          state: 'closing',
          closing_started_at: new Date(NOW - startedMinAgo * 60_000).toISOString(),
          attempts: failed ? 3 : 1,
          failed_at: failed,
        },
      });
    expect(live(closing(1, null)).phase).toBe('closing');
    expect(live(closing(10, null)).phase).toBe('late');
    expect(live(closing(10, new Date(NOW).toISOString())).phase).toBe('failed');
  });

  it('senza turno nessuna fase; stati sconosciuti ignorati', () => {
    expect(live(row({ round: null, decisions: 0 })).phase).toBeNull();
    const l = leagueLive(row({ readiness: [{ team_id: 'BOS', state: 'boh' }] }), NOW);
    expect(l).toMatchObject({ myState: null, humans: 0 });
  });
});
