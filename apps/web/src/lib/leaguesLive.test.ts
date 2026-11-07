import { describe, expect, it } from 'vitest';
import { leagueLive, liveBadges, type LeagueLiveRow } from './leaguesLive.ts';

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

const labels = (r: LeagueLiveRow) => liveBadges(leagueLive(r, NOW)).map((b) => b.label);

describe('stato dal vivo nell’elenco delle leghe', () => {
  it('tocca a te, umani pronti (Pronto o allenatore) sul totale, decisioni aperte', () => {
    const l = leagueLive(row({ decisions: 2 }), NOW);
    expect(l).toMatchObject({ phase: 'open', myState: 'waiting', ready: 2, humans: 3, decisions: 2 });
    expect(labels(row({ decisions: 2 }))).toEqual(['Tocca a te', 'Pronti 2/3', '2 decisioni']);
  });

  it('allenatore fermo da un avviso: tocca a te; pronto o allenatore: niente "tocca a te"', () => {
    const blocked = row({
      decisions: 1,
      readiness: [
        { team_id: 'BOS', state: 'blocked' },
        { team_id: 'LAL', state: 'ready' },
      ],
    });
    expect(labels(blocked)).toEqual(['Tocca a te', 'Pronti 1/2', '1 decisione']);
    expect(labels(row({ readiness: [{ team_id: 'BOS', state: 'ready' }] }))).toEqual([
      'Pronto',
      'Pronti 1/1',
    ]);
    expect(labels(row({ readiness: [{ team_id: 'BOS', state: 'coach' }] }))).toEqual([
      'Allenatore',
      'Pronti 1/1',
    ]);
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
    expect(labels(r)).toEqual(['Non gioca', 'Pronti 1/2']);
  });

  it('stato della lega: pausa, draft iniziale, simulazione, ritardo, turno bloccato', () => {
    expect(labels(row({ paused: true }))[0]).toBe('Lega in pausa');
    // In pausa il Pronto si dà lo stesso: si vede ancora che tocca a te
    expect(labels(row({ paused: true }))).toContain('Tocca a te');
    expect(labels(row({ draft_state: 'running' }))).toEqual(['Draft in corso']);
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
    expect(labels(closing(1, null))).toEqual(['Simulazione in corso…']);
    expect(labels(closing(10, null))).toEqual(['Simulazione in ritardo']);
    expect(labels(closing(10, new Date(NOW).toISOString()))).toEqual(['Turno bloccato']);
  });

  it('senza turno niente etichette; stati sconosciuti ignorati', () => {
    expect(labels(row({ round: null, decisions: 0 }))).toEqual([]);
    const l = leagueLive(row({ readiness: [{ team_id: 'BOS', state: 'boh' }] }), NOW);
    expect(l).toMatchObject({ myState: null, humans: 0 });
  });
});
