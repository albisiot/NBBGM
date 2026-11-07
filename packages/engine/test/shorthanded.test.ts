// Seconda analisi dopo la Fase 13: con la rosa cortissima (5-7 disponibili) chi si infortunava senza un
// sostituto sano restava in campo e continuava a giocare. Ora esce lo stesso e la squadra resta in 4 (o meno, fino
// a 2 in campo); un infortunio nuovo non accorcia lo stop di prima.
import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { generateLeague } from '../src/generator.ts';
import { DEFAULT_PARAMS } from '../src/game/params.ts';
import { autoSetup } from '../src/game/setup.ts';
import { simulateGame } from '../src/game/simulate.ts';
import type { GameResult } from '../src/game/types.ts';
import { Rng } from '../src/rng.ts';
import { roster } from '../src/season/finance.ts';
import { createLeagueState } from '../src/season/season.ts';
import { applyGameToPlayers } from '../src/season/turn.ts';
import { quickGame } from './helpers.ts';

const state = createLeagueState(generateLeague(new Rng('rosa-corta'), ARCHETYPE_PROFILES), 'rosa-corta', {
  humanTeams: [],
  potentialOnOverallScale: true,
});
const healthy = (team: string) => roster(state, team).map((p) => ({ ...p, injury: null }));

/** Partite con MIA in 5 contro BOS al completo e infortuni molto più frequenti del normale. */
function shortGames(count: number, injuryFactor: number): GameResult[] {
  const params = { ...DEFAULT_PARAMS, injuryPerMinute: DEFAULT_PARAMS.injuryPerMinute * injuryFactor };
  const home = autoSetup('MIA', healthy('MIA').slice(0, 5));
  const away = autoSetup('BOS', healthy('BOS'));
  return Array.from({ length: count }, (_, i) => simulateGame(home, away, `rosa-corta-${i}`, params));
}

describe('infortunati con la rosa cortissima', () => {
  it('chi si fa male senza sostituti esce lo stesso: niente più minuti, tiri o azioni', () => {
    let shorthanded = 0;
    for (const g of shortGames(40, 40)) {
      // Chi esce senza sostituti (non chi resta perché in campo ne rimarrebbe uno solo: vedi sotto)
      const out = (id: string) =>
        g.playByPlay.some((e) => e.players.includes(id) && e.text.includes('nessuno può sostituirlo'));
      for (const inj of g.injuries.filter((x) => x.team === 'home' && out(x.playerId))) {
        const line = g.home.box.find((l) => l.playerId === inj.playerId)!;
        // In campo al massimo fino al momento dell'infortunio
        expect(line.seconds).toBeLessThanOrEqual(inj.elapsed);
        // Dopo l'infortunio il suo nome non compare più in nessuna azione
        const at = g.playByPlay.findIndex(
          (e) => e.players.includes(inj.playerId) && e.text.includes('infortuna'),
        );
        expect(at).toBeGreaterThanOrEqual(0);
        const later = g.playByPlay
          .slice(at + 1)
          .filter((e) => e.players.includes(inj.playerId) && !e.text.includes('nessuno può sostituirlo'));
        expect(later).toEqual([]);
      }
      shorthanded += g.playByPlay.filter((e) => e.text.includes('nessuno può sostituirlo')).length;
      // La partita resta coerente: i punti sono la somma dei canestri
      const pts = g.home.box.reduce((a, l) => a + l.pts, 0);
      expect(pts).toBe(g.home.score);
    }
    // La prova ha senso solo se qualcuno è davvero uscito senza sostituti
    expect(shorthanded).toBeGreaterThan(5);
  });

  it('in 4 si gioca peggio, ma si gioca: minuti di squadra sotto i 240', () => {
    const games = shortGames(40, 40).filter((g) =>
      g.playByPlay.some((e) => e.team === 'home' && e.text.includes('si gioca in 4')),
    );
    expect(games.length).toBeGreaterThan(0);
    for (const g of games) {
      const seconds = g.home.box.reduce((a, l) => a + l.seconds, 0);
      const regulation = (48 + 5 * g.overtimes) * 60 * 5;
      expect(seconds).toBeLessThan(regulation);
    }
  });

  it('in campo ne restano almeno 2, anche con infortuni a catena: dal quarto infortunio si continua', () => {
    let chained = 0;
    for (const g of shortGames(30, 600)) {
      const out = g.playByPlay.filter((e) => e.team === 'home' && e.text.includes('nessuno può sostituirlo'));
      expect(out.length).toBeLessThanOrEqual(3);
      if (out.length === 3) expect(out[2]!.text).toContain('si gioca in 2');
      if (g.injuries.filter((x) => x.team === 'home').length > 3) chained++;
    }
    // Infortuni a catena davvero provati: la partita finisce comunque
    expect(chained).toBeGreaterThan(0);
  });

  it('con la panchina normale non cambia nulla: entra un sostituto', () => {
    const params = { ...DEFAULT_PARAMS, injuryPerMinute: DEFAULT_PARAMS.injuryPerMinute * 20 };
    const home = autoSetup('MIA', healthy('MIA'));
    const away = autoSetup('BOS', healthy('BOS'));
    for (let i = 0; i < 10; i++) {
      const g = simulateGame(home, away, `panchina-${i}`, params);
      expect(g.playByPlay.some((e) => e.text.includes('nessuno può sostituirlo'))).toBe(false);
    }
  });
});

describe('infortunio nuovo di chi era già infortunato', () => {
  it('resta lo stop più lungo', () => {
    const s = structuredCloneState();
    const [a, b] = roster(s, 'MIA');
    a!.injury = { bodyPart: 'knees', severity: 'severe', gamesRemaining: 30 };
    b!.injury = { bodyPart: 'back', severity: 'light', gamesRemaining: 2 };
    const result = quickGame(autoSetup('MIA', healthy('MIA')), autoSetup('BOS', healthy('BOS')), 'stop');
    result.injuries = [
      { playerId: a!.id, team: 'home', bodyPart: 'ankles', severity: 'light', games: 2, elapsed: 100 },
      { playerId: b!.id, team: 'home', bodyPart: 'feet', severity: 'medium', games: 8, elapsed: 200 },
    ];
    applyGameToPlayers(s, result, true);
    // Il ginocchio da 30 partite resta; la schiena da 2 diventa il piede da 8
    expect(a!.injury).toEqual({ bodyPart: 'knees', severity: 'severe', gamesRemaining: 30 });
    expect(b!.injury).toEqual({ bodyPart: 'feet', severity: 'medium', gamesRemaining: 8 });
  });
});

/** Una lega nuova per il test che la modifica (lo stato condiviso resta com'è). */
function structuredCloneState() {
  return createLeagueState(generateLeague(new Rng('rosa-corta'), ARCHETYPE_PROFILES), 'rosa-corta', {
    humanTeams: [],
    potentialOnOverallScale: true,
  });
}
