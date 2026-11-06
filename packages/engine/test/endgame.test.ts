import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { autoSetup } from '../src/game/setup.ts';
import { simulateGame, type GameSituation } from '../src/game/simulate.ts';
import type { GameEvent, GameResult } from '../src/game/types.ts';
import { generateLeague } from '../src/generator.ts';
import { Rng } from '../src/rng.ts';

const league = generateLeague(new Rng('test-finali'), ARCHETYPE_PROFILES);
const setup = (teamId: string) =>
  autoSetup(
    teamId,
    league.players.filter((p) => p.teamId === teamId),
  );
const HOME = setup('BOS');
const AWAY = setup('LAL');

const play = (from: GameSituation, n = 40): GameResult[] =>
  Array.from({ length: n }, (_, i) => simulateGame(HOME, AWAY, `finale-${i}`, undefined, from));

/** Prima azione di gioco dopo la ripartenza (niente cambi, inizio periodo o infortuni). */
const firstAction = (g: GameResult): GameEvent =>
  g.playByPlay.find(
    (e) => e.team !== null && !e.text.startsWith('Entra') && !e.text.includes('infortuna'),
  ) as GameEvent;

describe('finale di partita', () => {
  it('sotto di 2 a 20 secondi senza palla: fallo subito', () => {
    for (const g of play({ period: 4, clock: 20, home: 100, away: 98, ball: 'home' })) {
      const e = firstAction(g);
      expect(e.text, e.text).toMatch(/^fallo sistematico di /);
      expect(e.team).toBe('away');
      expect(e.clock).toBeGreaterThanOrEqual(16);
    }
  });

  it('sotto di 5 a 40 secondi senza palla: fallo; a 70 secondi non ancora', () => {
    for (const g of play({ period: 4, clock: 40, home: 105, away: 100, ball: 'home' }))
      expect(firstAction(g).text).toMatch(/^fallo sistematico di /);
    for (const g of play({ period: 4, clock: 70, home: 105, away: 100, ball: 'home' }))
      expect(firstAction(g).text).not.toMatch(/^fallo sistematico/);
  });

  it('chi è avanti fa scorrere il cronometro', () => {
    for (const g of play({ period: 4, clock: 90, home: 104, away: 100, ball: 'home' })) {
      const e = firstAction(g);
      expect(e.text).not.toMatch(/^fallo sistematico/);
      expect(e.clock).toBeLessThanOrEqual(90 - 12);
    }
  });

  it('in parità con la palla si gioca per l’ultimo tiro', () => {
    // Fino agli ultimi secondi non succede niente (la prima azione può essere anche un fallo o una stoppata della
    // difesa, ma arriva solo sull'ultimo tiro)
    for (const g of play({ period: 4, clock: 20, home: 100, away: 100, ball: 'home' })) {
      const e = firstAction(g);
      expect(e.text).not.toMatch(/^fallo sistematico/);
      expect(e.clock, e.text).toBeLessThanOrEqual(3);
      expect(e.clock).toBeGreaterThanOrEqual(1);
    }
  });

  it('sotto di 3 sull’ultimo tiro si cerca la tripla del pareggio', () => {
    let threes = 0;
    let shots = 0;
    for (const g of play({ period: 4, clock: 15, home: 97, away: 100, ball: 'home' }, 80)) {
      const shot = g.home.box.reduce((a, l) => a + l.fga, 0);
      if (!shot) continue;
      const first = g.playByPlay.find((e) => e.team === 'home' && /segna|sbaglia|stoppa/.test(e.text));
      if (!first) continue;
      shots++;
      if (/da tre|tripla/.test(first.text)) threes++;
    }
    expect(shots).toBeGreaterThan(40);
    expect(threes / shots).toBeGreaterThan(0.8);
  });

  it('ripartire da una situazione: punteggio di partenza e partita fino in fondo', () => {
    const [g] = play({ period: 4, clock: 30, home: 90, away: 90, ball: 'away' }, 1);
    expect(g!.home.score).toBeGreaterThanOrEqual(90);
    expect(g!.away.score).toBeGreaterThanOrEqual(90);
    expect(g!.home.score).not.toBe(g!.away.score);
    expect(g!.home.box.reduce((a, l) => a + l.seconds, 0)).toBe((30 + 300 * g!.overtimes) * 5);
  });
});
