import {
  ARCHETYPE_PROFILES,
  autoSetup,
  DEFAULT_TACTICS,
  generateLeague,
  overall,
  Rng,
  setupFromSettings,
} from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import { chunks, IDS_PER_REQUEST, liteOf, settingsForRoster, settingsProblems } from './roster.ts';

const roster = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];

describe('controlli delle impostazioni', () => {
  it('impostazioni valide', () => {
    const minutes = { a: 36, b: 36, c: 36, d: 36, e: 36, f: 30, g: 30 };
    expect(
      settingsProblems({ starters: ['a', 'b', 'c', 'd', 'e'], minutes, tactics: DEFAULT_TACTICS }, roster),
    ).toEqual([]);
  });

  it('segnalano somma, titolari ripetuti e minuti fuori scala', () => {
    const problems = settingsProblems(
      { starters: ['a', 'a', 'c', 'd', 'z'], minutes: { a: 50, b: 20 }, tactics: DEFAULT_TACTICS },
      roster,
    );
    expect(problems.join(' ')).toMatch(/5 titolari diversi/);
    expect(problems.join(' ')).toMatch(/non è più in squadra/);
    expect(problems.join(' ')).toMatch(/240 \(ora 70\)/);
    expect(problems.join(' ')).toMatch(/da 0 a 48/);
  });
});

describe('impostazioni dopo che qualcuno lascia la squadra', () => {
  const league = generateLeague(new Rng('rosa-cambiata'), ARCHETYPE_PROFILES);
  const roster = league.players.filter((p) => p.teamId === 'BOS');
  const setup = autoSetup('BOS', roster);
  const saved = { starters: [...setup.starters], minutes: { ...setup.minutes }, tactics: DEFAULT_TACTICS };
  const ids = (players: readonly { id: string }[]) => players.map((p) => p.id);

  it('con tutti in squadra non cambia niente', () => {
    expect(settingsForRoster(saved, roster)).toBeNull();
  });

  it('un titolare ceduto: lo sostituisce il bot, i minuti tornano a 240 e si può salvare', () => {
    const gone = saved.starters[2]!;
    const left = roster.filter((p) => p.id !== gone);
    // Prima della correzione il salvataggio era bloccato
    expect(settingsProblems(saved, ids(left)).length).toBeGreaterThan(0);
    const fixed = settingsForRoster(saved, left)!;
    expect(fixed.starters).not.toContain(gone);
    expect(fixed.minutes[gone]).toBeUndefined();
    // Gli altri titolari restano al loro posto
    saved.starters.forEach((id, i) => i !== 2 && expect(fixed.starters[i]).toBe(id));
    expect(settingsProblems(fixed, ids(left))).toEqual([]);
    // Lo stesso quintetto che userà il motore alla partita
    const engine = setupFromSettings('BOS', left, saved);
    expect(fixed.starters).toEqual([...engine.starters]);
  });

  it('un giocatore della panchina tagliato: i suoi minuti vanno agli altri', () => {
    const bench = Object.keys(saved.minutes).find(
      (id) => !saved.starters.includes(id) && saved.minutes[id]! > 0,
    )!;
    const left = roster.filter((p) => p.id !== bench);
    const fixed = settingsForRoster(saved, left)!;
    expect(fixed.starters).toEqual(saved.starters);
    expect(fixed.minutes[bench]).toBeUndefined();
    expect(settingsProblems(fixed, ids(left))).toEqual([]);
  });

  it('un infortunato resta al suo posto: alla partita lo sostituisce il motore', () => {
    const gone = saved.starters[0]!;
    const hurt = saved.starters[1]!;
    const left = roster
      .filter((p) => p.id !== gone)
      .map((p) =>
        p.id === hurt
          ? { ...p, injury: { bodyPart: 'knees' as const, severity: 'medium' as const, gamesRemaining: 5 } }
          : p,
      );
    const fixed = settingsForRoster(saved, left)!;
    expect(fixed.starters[1]).toBe(hurt);
    expect(fixed.minutes[hurt]).toBeGreaterThanOrEqual(saved.minutes[hurt]!);
  });

  it('con meno di 5 in rosa lo slot resta vuoto e va scelto a mano', () => {
    const left = roster.filter((p) => saved.starters.slice(0, 4).includes(p.id));
    const fixed = settingsForRoster(saved, left)!;
    expect(fixed.starters[4]).toBe('');
    expect(settingsProblems(fixed, ids(left)).join(' ')).toMatch(/Manca un titolare/);
  });
});

describe('giocatori in breve', () => {
  it('liteOf: nome, ruolo, età e overall del motore', () => {
    const p = generateLeague(new Rng('lite'), ARCHETYPE_PROFILES).players[0]!;
    expect(liteOf(p)).toEqual({
      id: p.id,
      teamId: p.teamId,
      name: `${p.firstName} ${p.lastName}`,
      role: p.role,
      age: p.age,
      overall: overall(p),
    });
    expect(liteOf({ ...p, teamId: undefined }).teamId).toBeNull();
  });

  it('gli id si chiedono a pezzi, per non superare la lunghezza di un indirizzo', () => {
    const ids = Array.from({ length: 274 }, (_, i) => `id-${i}`);
    const parts = chunks(ids, IDS_PER_REQUEST);
    expect(parts.map((x) => x.length)).toEqual([100, 100, 74]);
    expect(parts.flat()).toEqual(ids);
    // 100 uuid nell'indirizzo (36 caratteri più la virgola codificata) stanno sotto i 4 KB
    expect(IDS_PER_REQUEST * (36 + 3)).toBeLessThan(4096);
    expect(chunks([], IDS_PER_REQUEST)).toEqual([]);
  });
});
