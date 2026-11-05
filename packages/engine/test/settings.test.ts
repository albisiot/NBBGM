import { describe, expect, it } from 'vitest';
import { ARCHETYPE_PROFILES } from '../src/archetype-profiles.ts';
import { autoSetup, setupFromSettings, validTactics, type SavedSettings } from '../src/game/setup.ts';
import { simulateGame } from '../src/game/simulate.ts';
import type { TeamSetup } from '../src/game/types.ts';
import { generateLeague } from '../src/generator.ts';
import { Rng } from '../src/rng.ts';
import type { Player } from '../src/types.ts';

const league = generateLeague(new Rng('impostazioni'), ARCHETYPE_PROFILES);
const rosterOf = (team: string): Player[] => league.players.filter((p) => p.teamId === team);
const bos = rosterOf('BOS');

function checkSetup(s: TeamSetup) {
  expect(Object.values(s.minutes).reduce((a, b) => a + b, 0)).toBe(240);
  expect(new Set(s.starters).size).toBe(5);
  expect(s.players.length).toBeLessThanOrEqual(13);
  const ids = new Set(s.players.map((p) => p.id));
  for (const id of s.starters) expect(ids.has(id)).toBe(true);
  for (const [id, m] of Object.entries(s.minutes)) {
    expect(ids.has(id)).toBe(true);
    expect(m).toBeGreaterThanOrEqual(0);
    expect(m).toBeLessThanOrEqual(48);
  }
}

/** Impostazioni "strane" del manager: titolari cinque riserve, minuti distribuiti a modo suo. */
function savedFor(players: Player[]): SavedSettings {
  const sorted = [...players].sort((a, b) => a.id.localeCompare(b.id));
  const starters = sorted.slice(5, 10).map((p) => p.id);
  const minutes: Record<string, number> = {};
  for (const id of starters) minutes[id] = 36;
  minutes[sorted[0]!.id] = 30;
  minutes[sorted[1]!.id] = 30;
  return {
    starters,
    minutes,
    tactics: { pace: 'fast', focus: 'inside', defense: 'zone', intensity: 'high' },
  };
}

describe('impostazioni salvate', () => {
  it('con tutti disponibili valgono così come sono', () => {
    const saved = savedFor(bos);
    const s = setupFromSettings('BOS', bos, saved);
    checkSetup(s);
    expect(s.starters).toEqual(saved.starters);
    for (const [id, m] of Object.entries(saved.minutes)) expect(s.minutes[id]).toBe(m);
    expect(s.tactics).toEqual(saved.tactics);
  });

  it('un titolare infortunato lo sostituisce il bot, che ne eredita i minuti', () => {
    const saved = savedFor(bos);
    const out = saved.starters[2] as string;
    const roster = bos.map((p) =>
      p.id === out
        ? { ...p, injury: { bodyPart: 'knees' as const, severity: 'medium' as const, gamesRemaining: 5 } }
        : p,
    );
    const s = setupFromSettings('BOS', roster, saved);
    checkSetup(s);
    expect(s.starters).not.toContain(out);
    // Gli altri quattro restano dove li ha messi il manager
    for (const i of [0, 1, 3, 4]) expect(s.starters[i]).toBe(saved.starters[i]);
    const sub = s.starters[2] as string;
    expect(s.minutes[sub]).toBeGreaterThanOrEqual(36);
  });

  it('un giocatore ceduto dalla panchina: i suoi minuti vanno agli altri', () => {
    const saved = savedFor(bos);
    const benchId = Object.keys(saved.minutes).find((id) => !saved.starters.includes(id)) as string;
    const s = setupFromSettings(
      'BOS',
      bos.filter((p) => p.id !== benchId),
      saved,
    );
    checkSetup(s);
    expect(s.starters).toEqual(saved.starters);
    expect(s.minutes[benchId]).toBeUndefined();
  });

  it('tattiche non valide tornano a quelle di default', () => {
    expect(validTactics({ pace: 'warp' as never, defense: 'zone' })).toEqual({
      pace: 'normal',
      focus: 'balanced',
      defense: 'zone',
      intensity: 'medium',
    });
  });

  it('il motore gioca con i titolari e i minuti salvati', () => {
    // Rotazione a dieci del manager, con titolari scelti da lui e non dal bot
    const sorted = [...bos].sort((a, b) => a.id.localeCompare(b.id));
    const rotation = [32, 32, 32, 30, 30, 22, 20, 14, 14, 14];
    const minutes = Object.fromEntries(sorted.slice(0, 10).map((p, i) => [p.id, rotation[i] as number]));
    const saved: SavedSettings = { starters: sorted.slice(0, 5).map((p) => p.id), minutes, tactics: {} };
    const home = setupFromSettings('BOS', bos, saved);
    expect(home.starters).not.toEqual(autoSetup('BOS', bos).starters);
    let unplanned = 0;
    let deviation = 0;
    const games = 10;
    for (let g = 0; g < games; g++) {
      const r = simulateGame(home, autoSetup('LAL', rosterOf('LAL')), `impostazioni-${g}`);
      const starters = r.home.box.filter((l) => l.starter).map((l) => l.playerId);
      expect(new Set(starters)).toEqual(new Set(saved.starters));
      for (const l of r.home.box) {
        const target = minutes[l.playerId] ?? 0;
        if (target === 0) unplanned += l.seconds / 60;
        else deviation += Math.abs(l.seconds / 60 - target);
      }
    }
    // I minuti obiettivo si rispettano, salvo cambi per stanchezza, falli o infortuni
    expect(unplanned / games).toBeLessThan(15);
    expect(deviation / (games * 10)).toBeLessThan(4);
  });
});
