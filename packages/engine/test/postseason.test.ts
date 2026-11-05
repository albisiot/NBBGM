// Fase 10: classifica e post-season come le vede l'app. Il tabellone si ricostruisce dalle partite giocate,
// la classifica completa ha gli stessi totali delle partite.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { Rng } from '../src/rng.ts';
import {
  playPostseasonTurn,
  playRegularTurn,
  postseasonSeeds,
  replayPostseason,
  standingsSeed,
  createLeagueState,
} from '../src/season/season.ts';
import { standingsTable } from '../src/season/standings.ts';
import { quickGame } from './helpers.ts';

function season() {
  const data = generateLeague(new Rng('post-season'), ARCHETYPE_PROFILES);
  const state = createLeagueState(data, 'segreto', { potentialOnOverallScale: true });
  state.publicSeed = 'lega-pubblica';
  while (state.phase === 'regular') playRegularTurn(state, quickGame);
  return state;
}

describe('classifica', () => {
  it('i totali coincidono con le partite e l’ordine è quello del tabellone', () => {
    const state = season();
    const games = state.games.filter((g) => g.phase === 'regular');
    const table = standingsTable(state.teams, games, standingsSeed('lega-pubblica', state.config.year));
    const lines = [...table.East, ...table.West];
    expect(lines).toHaveLength(30);
    expect(lines.reduce((a, l) => a + l.w, 0)).toBe(games.length);
    expect(lines.reduce((a, l) => a + l.l, 0)).toBe(games.length);
    for (const l of lines) {
      expect(l.w + l.l).toBe(82);
      expect(l.home.w + l.home.l).toBe(41);
      expect(l.home.w + l.away.w).toBe(l.w);
      expect(l.last10.w + l.last10.l).toBe(10);
      expect(Math.abs(l.streak)).toBeGreaterThan(0);
    }
    expect(table.East[0]?.gamesBehind).toBe(0);
    // Le prime 10 della classifica sono le squadre di play-in e playoff, nello stesso ordine
    const seeds = postseasonSeeds(state);
    expect(table.East.slice(0, 10).map((l) => l.teamId)).toEqual(seeds.East);
    expect(table.West.slice(0, 10).map((l) => l.teamId)).toEqual(seeds.West);
    expect(state.postseason?.seeds).toEqual(seeds);
    // Divisioni: un primo, un secondo... per ognuna
    for (const div of new Set(lines.map((l) => l.division)))
      expect(
        lines
          .filter((l) => l.division === div)
          .map((l) => l.divRank)
          .sort(),
      ).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('post-season', () => {
  it('il tabellone ricostruito dalle partite è quello giocato, turno dopo turno', () => {
    const state = season();
    expect(JSON.stringify(replayPostseason(state))).toBe(JSON.stringify(state.postseason));
    while (state.phase === 'postseason') {
      playPostseasonTurn(state, quickGame);
      expect(JSON.stringify(replayPostseason(state))).toBe(JSON.stringify(state.postseason));
    }
    const ps = state.postseason!;
    expect(ps.stage).toBe('done');
    expect(ps.championId).not.toBeNull();
    expect(ps.playIn).toHaveLength(6);
    expect(ps.series).toHaveLength(15);
    for (const s of ps.series) expect(Math.max(s.winsHigh, s.winsLow)).toBe(4);
  });
});
