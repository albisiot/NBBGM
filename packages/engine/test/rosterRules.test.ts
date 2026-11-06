// Regole di rosa corrette dopo la Fase 13: chi va a referto con tanti infortunati, limiti dei two-way negli
// scambi e nelle firme dell'offseason, guarigione degli svincolati.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { Rng } from '../src/rng.ts';
import {
  canSign,
  contractOf,
  MAX_TWO_WAY,
  OFFSEASON_MAX_ROSTER,
  roster,
  standardRoster,
  twoWayRoster,
  TWO_WAY_GAME_LIMIT,
} from '../src/season/finance.ts';
import { createLeagueState, gamePlayers, MIN_PLAYERS } from '../src/season/season.ts';
import type { LeagueState, PlayerState } from '../src/season/state.ts';
import { validateTrade } from '../src/season/trades.ts';
import { endTurn } from '../src/season/turn.ts';
import { quickGame } from './helpers.ts';
import { autoSetup } from '../src/game/setup.ts';

function league(): LeagueState {
  const data = generateLeague(new Rng('regole-rosa'), ARCHETYPE_PROFILES);
  return createLeagueState(data, 'regole-rosa', { humanTeams: ['BOS'], potentialOnOverallScale: true });
}

const injure = (p: PlayerState, games: number) => {
  p.injury = { bodyPart: 'knees', severity: games > 15 ? 'severe' : 'medium', gamesRemaining: games };
};

/** Fa diventare two-way un giocatore della squadra. */
function makeTwoWay(state: LeagueState, p: PlayerState): void {
  const c = contractOf(state, p.id)!;
  c.type = 'two-way';
  c.salaries = [c.salaries[0] ?? 1];
}

describe('chi va a referto', () => {
  it('con 5 o più sani giocano solo i sani, anche se sono pochi', () => {
    const s = league();
    const players = roster(s, 'MIA');
    players.slice(6).forEach((p, i) => injure(p, 5 + i));
    const ids = gamePlayers(s, 'MIA', true).map((p) => p.id);
    expect(ids).toHaveLength(6);
    for (const p of players.slice(6)) expect(ids).not.toContain(p.id);
    // E la partita si gioca
    expect(() => autoSetup('MIA', gamePlayers(s, 'MIA', true))).not.toThrow();
  });

  it('sotto i 5 sani si completa con gli infortuni più brevi, mai con quelli lunghi', () => {
    const s = league();
    const players = roster(s, 'MIA');
    const rest = players.slice(3);
    rest.forEach((p, i) => injure(p, i === 0 ? 1 : i === 1 ? 2 : 40 + i));
    const chosen = gamePlayers(s, 'MIA', true);
    expect(chosen).toHaveLength(MIN_PLAYERS);
    const ids = chosen.map((p) => p.id);
    expect(ids).toContain(rest[0]!.id);
    expect(ids).toContain(rest[1]!.id);
    for (const p of rest.slice(2)) expect(ids).not.toContain(p.id);
    // In campo giocano da sani, ma lo stato della lega non cambia
    expect(chosen.every((p) => p.injury === null)).toBe(true);
    expect(rest[0]!.injury).not.toBeNull();
  });

  it('i two-way nei playoff o oltre le 50 partite non vanno a referto se ci sono 5 sani', () => {
    const s = league();
    const tw = standardRoster(s, 'MIA')[0]!;
    makeTwoWay(s, tw);
    expect(gamePlayers(s, 'MIA', false).map((p) => p.id)).not.toContain(tw.id);
    tw.twoWayGames = TWO_WAY_GAME_LIMIT;
    expect(gamePlayers(s, 'MIA', true).map((p) => p.id)).not.toContain(tw.id);
  });
});

describe('two-way', () => {
  it('uno scambio non porta una squadra oltre 3 two-way', () => {
    const s = league();
    const bos = standardRoster(s, 'BOS');
    for (const p of twoWayRoster(s, 'BOS')) makeTwoWay(s, p);
    while (twoWayRoster(s, 'BOS').length < MAX_TWO_WAY) makeTwoWay(s, bos[twoWayRoster(s, 'BOS').length]!);
    const other = standardRoster(s, 'LAL').at(-1)!;
    makeTwoWay(s, other);
    const mine = standardRoster(s, 'BOS').at(-1)!;
    const problems = validateTrade(s, {
      teamA: 'BOS',
      teamB: 'LAL',
      playersA: [mine.id],
      playersB: [other.id],
      picksA: [],
      picksB: [],
    });
    expect(problems.join(' ')).toMatch(/oltre 3 two-way/);
  });

  it('in offseason un two-way non si firma con la rosa già a 21', () => {
    const s = league();
    s.phase = 'offseason';
    const free = s.players.filter((p) => p.teamId === null);
    while (roster(s, 'BOS').length < OFFSEASON_MAX_ROSTER) {
      const p = free.pop()!;
      p.teamId = 'BOS';
      s.contracts.push({
        playerId: p.id,
        teamId: 'BOS',
        type: 'standard',
        salaries: [1_000_000],
        options: [null],
        guaranteed: null,
      });
    }
    // Nessun two-way: il limite dei 3 non c'entra, conta la rosa piena
    for (const p of twoWayRoster(s, 'BOS')) contractOf(s, p.id)!.type = 'standard';
    expect(canSign(s, 'BOS', { yearsInLeague: 0 }, 0, 'two-way')).toEqual({
      ok: false,
      reason: 'rosa piena',
    });
  });
});

describe('svincolati infortunati', () => {
  it('guariscono un turno alla volta anche senza squadra', () => {
    const s = league();
    const fa = s.players.find((p) => p.teamId === null)!;
    injure(fa, 2);
    const setup = (t: string) => autoSetup(t, roster(s, t));
    const played = new Map([['BOS', { won: true, result: quickGame(setup('BOS'), setup('LAL'), 'x') }]]);
    endTurn(s, played);
    expect(fa.injury?.gamesRemaining).toBe(1);
    endTurn(s, played);
    expect(fa.injury).toBeNull();
  });
});
