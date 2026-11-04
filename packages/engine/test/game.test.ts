import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { autoSetup } from '../src/game/setup.ts';
import { simulateGame } from '../src/game/simulate.ts';
import type { GameResult, Tactics, TeamSetup } from '../src/game/types.ts';
import { generateLeague } from '../src/generator.ts';
import { Rng } from '../src/rng.ts';
import type { Player } from '../src/types.ts';

const league = generateLeague(new Rng('test-motore'), ARCHETYPE_PROFILES);
const roster = (teamId: string) => league.players.filter((p) => p.teamId === teamId);
const setup = (teamId: string, tactics?: Tactics) => autoSetup(teamId, roster(teamId), tactics);
const BOS = setup('BOS');
const LAL = setup('LAL');

const games: GameResult[] = Array.from({ length: 120 }, (_, i) => simulateGame(BOS, LAL, `test-${i}`));

describe('autoSetup', () => {
  it('quintetto valido e minuti che sommano 240', () => {
    expect(new Set(BOS.starters).size).toBe(5);
    expect(BOS.players.length).toBeLessThanOrEqual(13);
    expect(Object.values(BOS.minutes).reduce((a, b) => a + b, 0)).toBe(240);
    for (const id of BOS.starters) expect(BOS.players.some((p) => p.id === id)).toBe(true);
  });

  it('esclude gli infortunati', () => {
    const players = roster('MIA').map((p, i): Player =>
      i === 0 ? { ...p, injury: { bodyPart: 'knees', severity: 'medium', gamesRemaining: 5 } } : p,
    );
    const s = autoSetup('MIA', players);
    expect(s.players.some((p) => p.id === players[0]!.id)).toBe(false);
  });
});

describe('simulateGame', () => {
  it('stesso input e stesso seed: stessa partita', () => {
    expect(simulateGame(BOS, LAL, 'ripeti')).toEqual(simulateGame(BOS, LAL, 'ripeti'));
  });

  it('seed diversi: partite diverse', () => {
    expect(simulateGame(BOS, LAL, 'uno').playByPlay).not.toEqual(simulateGame(BOS, LAL, 'due').playByPlay);
  });

  it('non modifica i giocatori in ingresso', () => {
    const before = JSON.stringify(BOS);
    simulateGame(BOS, LAL, 'puro');
    expect(JSON.stringify(BOS)).toBe(before);
  });

  it('240 minuti per squadra nei tempi regolamentari, 25 per ogni supplementare', () => {
    for (const g of games) {
      const expected = (2880 + 300 * g.overtimes) * 5;
      for (const side of [g.home, g.away]) expect(side.box.reduce((a, l) => a + l.seconds, 0)).toBe(expected);
    }
  });

  it('i punti sono la somma dei canestri', () => {
    for (const g of games) {
      for (const side of [g.home, g.away]) {
        for (const l of side.box) {
          expect(l.pts).toBe(2 * (l.fgm - l.tpm) + 3 * l.tpm + l.ftm);
          expect(l.fgm).toBeLessThanOrEqual(l.fga);
          expect(l.tpm).toBeLessThanOrEqual(l.tpa);
          expect(l.tpa).toBeLessThanOrEqual(l.fga);
          expect(l.ftm).toBeLessThanOrEqual(l.fta);
        }
        expect(side.box.reduce((a, l) => a + l.pts, 0)).toBe(side.score);
        expect(side.quarters.reduce((a, q) => a + q, 0)).toBe(side.score);
        expect(side.quarters).toHaveLength(4 + g.overtimes);
      }
      expect(g.home.score).not.toBe(g.away.score);
      expect(g.home.box.reduce((a, l) => a + l.plusMinus, 0)).toBe(5 * (g.home.score - g.away.score));
    }
  });

  it('nessuno supera i 6 falli e i possessi sono bilanciati', () => {
    for (const g of games) {
      for (const side of [g.home, g.away]) for (const l of side.box) expect(l.pf).toBeLessThanOrEqual(6);
      expect(Math.abs(g.home.totals.possessions - g.away.totals.possessions)).toBeLessThanOrEqual(4);
    }
  });

  it('un infortunato non è mai in campo', () => {
    // Prima della partita: chi è infortunato non gioca
    const players = roster('BOS');
    const hurt = players.find((p) => !BOS.starters.includes(p.id))!;
    const withInjury: TeamSetup = {
      ...BOS,
      players: BOS.players.map((p) =>
        p.id === hurt.id ? { ...p, injury: { bodyPart: 'ankles', severity: 'light', gamesRemaining: 2 } } : p,
      ),
    };
    const g = simulateGame(withInjury, LAL, 'infortunato');
    expect(g.home.box.some((l) => l.playerId === hurt.id)).toBe(false);
    expect(() =>
      simulateGame(
        {
          ...BOS,
          players: BOS.players.map((p) =>
            p.id === BOS.starters[0]
              ? { ...p, injury: { bodyPart: 'back', severity: 'light', gamesRemaining: 1 } }
              : p,
          ),
        },
        LAL,
        'x',
      ),
    ).toThrow(/non è disponibile/);

    // Durante la partita: dopo l'infortunio il giocatore non compare più nelle azioni
    const injuries = games.flatMap((game) => game.injuries.map((inj) => ({ game, inj })));
    expect(injuries.length).toBeGreaterThan(0);
    for (const { game, inj } of injuries) {
      const later = game.playByPlay.filter(
        (e) => e.elapsed > inj.elapsed && e.players.includes(inj.playerId) && !e.text.startsWith('Entra'),
      );
      expect(later).toEqual([]);
    }
  });

  it('le tattiche contano: focus sul perimetro, più tiri da 3', () => {
    const perimeter = setup('BOS', {
      pace: 'normal',
      focus: 'perimeter',
      defense: 'man',
      intensity: 'medium',
    });
    const inside = setup('BOS', { pace: 'normal', focus: 'inside', defense: 'man', intensity: 'medium' });
    const threes = (s: TeamSetup) =>
      Array.from({ length: 40 }, (_, i) => simulateGame(s, LAL, `tattica-${i}`).home.totals.tpa).reduce(
        (a, b) => a + b,
        0,
      );
    expect(threes(perimeter)).toBeGreaterThan(threes(inside) * 1.15);
  });

  it('ritmo veloce, più possessi', () => {
    const fast = setup('BOS', { pace: 'fast', focus: 'balanced', defense: 'man', intensity: 'medium' });
    const slow = setup('BOS', { pace: 'slow', focus: 'balanced', defense: 'man', intensity: 'medium' });
    const poss = (s: TeamSetup) =>
      Array.from({ length: 30 }, (_, i) => simulateGame(s, LAL, `ritmo-${i}`).home.totals.possessions).reduce(
        (a, b) => a + b,
        0,
      );
    expect(poss(fast)).toBeGreaterThan(poss(slow) * 1.05);
  });
});
