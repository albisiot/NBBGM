import { readFileSync } from 'node:fs';
import {
  ARCHETYPE_PROFILES,
  autoSetup,
  DEFAULT_TACTICS,
  generateLeague,
  overall,
  Rng,
  setupFromSettings,
  SLOT_ROLES,
  type Player,
} from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import {
  benchLabel,
  benchNote,
  benchOrder,
  boxRole,
  candidateNote,
  coachUntilText,
  COURT_SPOTS,
  courtIssues,
  courtLabel,
  courtName,
  courtNote,
  rolesText,
  slotCandidates,
  slotPenalty,
  TACTIC_LEGEND,
  TACTIC_NOTES,
  twoWayGames,
  type CourtPlayer,
} from './court.ts';
import { TACTIC_OPTIONS } from './roster.ts';

/** Un giocatore finto con quello che serve al campo. */
function player(over: Partial<CourtPlayer> & { id: string }): CourtPlayer {
  return {
    firstName: 'Nome',
    lastName: over.id,
    role: 'SF',
    secondaryRole: null,
    energy: 95,
    injury: null,
    contractType: 'standard',
    stats: {},
    ...over,
  };
}

const hurt = (games: number) => ({
  bodyPart: 'knees' as const,
  severity: 'medium' as const,
  gamesRemaining: games,
});

describe('posti sul mezzo campo', () => {
  it('centro e ala grande vicino al canestro, ali sui lati, playmaker in punta', () => {
    expect(COURT_SPOTS).toHaveLength(5);
    const [pg, sg, sf, pf, c] = COURT_SPOTS;
    const rem = (v: string | undefined) => Number(v?.replace('rem', ''));
    // In alto, sotto il canestro
    expect(rem(c?.top)).toBeLessThan(rem(sf?.top));
    expect(rem(pf?.top)).toBeLessThan(rem(sg?.top));
    // Il centro a sinistra, l'ala grande a destra; l'ala piccola a sinistra, la guardia a destra
    expect(c?.left).toBeDefined();
    expect(pf?.right).toBeDefined();
    expect(sf?.left).toBeDefined();
    expect(sg?.right).toBeDefined();
    // Le ali più verso il bordo dei lunghi
    expect(parseFloat(sf!.left!)).toBeLessThan(parseFloat(c!.left!));
    expect(parseFloat(sg!.right!)).toBeLessThan(parseFloat(pf!.right!));
    // Il playmaker in fondo, al centro
    expect(pg?.bottom).toBeDefined();
    expect(pg?.left).toBe('50%');
    expect(pg?.transform).toBe('translateX(-50%)');
  });
});

describe('cognomi nei riquadri', () => {
  it('fino a 10 lettere a 14 px su una riga', () => {
    expect(courtName('Queta')).toEqual({ lines: ['Queta'], size: 14 });
    expect(courtName('Scheierman')).toEqual({ lines: ['Scheierman'], size: 14 });
    // Spazi e punti non contano come lettere
    expect(courtName('Jaquez Jr.')).toEqual({ lines: ['Jaquez Jr.'], size: 14 });
  });

  it('oltre, a capo al trattino a 13 px, oppure 12 px su una riga; mai abbreviato', () => {
    expect(courtName('Gilgeous-Alexander')).toEqual({ lines: ['Gilgeous-', 'Alexander'], size: 13 });
    expect(courtName('Antetokounmpo')).toEqual({ lines: ['Antetokounmpo'], size: 12 });
    const spaced = courtName('Van Der Hoeven Smith');
    expect(spaced.size).toBe(13);
    expect(spaced.lines.join(' ')).toBe('Van Der Hoeven Smith');
    // Il taglio che rende le due righe più pari
    expect(spaced.lines).toEqual(['Van Der', 'Hoeven Smith']);
    for (const name of ['Walker-Kabengele', 'Robinson-Earl', 'Hollis-Jefferson']) {
      const n = courtName(name);
      expect(n.lines).toHaveLength(2);
      expect(n.lines.join('')).toBe(name);
      expect(n.lines[0]!.endsWith('-')).toBe(true);
    }
  });
});

describe('ruoli e problemi in campo', () => {
  it('fuori ruolo: 0 nel ruolo principale o secondario, poi 3, 8 e 15%', () => {
    expect(slotPenalty({ role: 'SF', secondaryRole: 'PF' }, 'PF')).toBe(0);
    expect(slotPenalty({ role: 'SF', secondaryRole: null }, 'SG')).toBe(3);
    expect(slotPenalty({ role: 'PG', secondaryRole: null }, 'SF')).toBe(8);
    expect(slotPenalty({ role: 'PG', secondaryRole: null }, 'C')).toBe(15);
    expect(rolesText({ role: 'SF', secondaryRole: 'PF' })).toBe('SF/PF');
    // Nel riquadro lo slot se lo gioca senza penalità, altrimenti il suo ruolo
    expect(boxRole({ role: 'SF', secondaryRole: 'PF' }, 'PF')).toBe('PF');
    expect(boxRole({ role: 'SF', secondaryRole: null }, 'SG')).toBe('SF');
  });

  it('la riga del riquadro: infortunio, poi fuori ruolo, poi stanchezza, poi partite del two-way', () => {
    const base = player({ id: 'Brown', role: 'SF' });
    expect(courtNote(base, 'SF')).toBeNull();
    expect(courtNote({ ...base, injury: hurt(6), energy: 50 }, 'PG')?.text).toBe('Infortunato · 6 partite');
    expect(courtNote({ ...base, injury: hurt(1) }, 'SF')?.text).toBe('Infortunato · 1 partita');
    expect(courtNote({ ...base, energy: 50 }, 'SG')?.text).toBe('Fuori ruolo · −3%');
    expect(courtNote({ ...base, energy: 71.4 }, 'SF')).toMatchObject({
      kind: 'tired',
      text: 'stanco, energia 71',
    });
    // 75 non è ancora stanco
    expect(courtNote({ ...base, energy: 75 }, 'SF')).toBeNull();
    const twoWay = { ...base, contractType: 'two-way', stats: { g: 31 } };
    expect(courtNote(twoWay, 'SF')?.text).toBe('31 partite su 50');
    expect(twoWayGames(twoWay)).toBe(31);
    // Senza statistiche (inizio stagione) il dato non c'è
    expect(twoWayGames({ contractType: 'two-way', stats: {} })).toBeNull();
    expect(twoWayGames({ contractType: 'standard', stats: { g: 31 } })).toBeNull();
    // In panchina niente fuori ruolo
    expect(courtNote(base, null)).toBeNull();
  });

  it('nomi per i lettori di schermo e note della panchina', () => {
    const p = player({ id: 'x', firstName: 'Sam', lastName: 'Hauser', role: 'SF' });
    expect(courtLabel('SG', p, 68, 28)).toBe(
      'guardia: Sam Hauser, voto 68, 28 minuti, fuori ruolo, rende il 3% in meno',
    );
    expect(courtLabel('C', null, 0, 0)).toMatch(/^centro: manca il titolare/);
    expect(benchNote(p)).toBeNull();
    expect(benchNote({ ...p, energy: 60 })).toEqual({ text: 'stanco', alert: true });
    expect(benchNote({ ...p, injury: hurt(3) })).toEqual({ text: 'infortunato, 3 partite', alert: true });
    expect(benchNote({ ...p, contractType: 'two-way', stats: { g: 4 } })).toEqual({
      text: '4 su 50',
      alert: false,
    });
    expect(benchLabel({ ...p, contractType: 'two-way', stats: { g: 4 } }, 4)).toBe(
      'Sam Hauser, 4 minuti, two-way, 4 partite su 50',
    );
  });
});

describe('cambio del titolare', () => {
  const roster = [
    player({ id: 'pg', role: 'PG' }),
    player({ id: 'sg', role: 'SG' }),
    player({ id: 'sf', role: 'SF', injury: hurt(6) }),
    player({ id: 'pf', role: 'SF', secondaryRole: 'PF' }),
    player({ id: 'c', role: 'C' }),
    player({ id: 'sf2', role: 'SF', energy: 94 }),
    player({ id: 'sf3', role: 'SF', contractType: 'two-way', stats: { g: 31 } }),
    player({ id: 'sg2', role: 'SG' }),
    player({ id: 'pg2', role: 'PG' }),
    player({ id: 'out', role: 'C', injury: hurt(2) }),
  ];
  const starters = ['pg', 'sg', 'sf', 'pf', 'c'];
  const rating: Record<string, number> = {
    pg: 74,
    sg: 79,
    sf: 83,
    pf: 88,
    c: 70,
    sf2: 62,
    sf3: 60,
    sg2: 75,
    pg2: 65,
    out: 80,
  };
  const ovr = (p: CourtPlayer) => rating[p.id] ?? 0;

  it('prima chi è nel ruolo, poi gli altri dalla penalità più piccola; niente infortunati né il titolare di adesso', () => {
    const list = slotCandidates(roster, starters, 2, ovr);
    expect(list.map((c) => c.player.id)).toEqual(['pf', 'sf2', 'sf3', 'sg', 'sg2', 'pg', 'c', 'pg2']);
    expect(list.map((c) => c.penalty)).toEqual([0, 0, 0, 3, 3, 8, 8, 8]);
    expect(list.find((c) => c.player.id === 'out')).toBeUndefined();
    expect(list.find((c) => c.player.id === 'sf')).toBeUndefined();
    // Chi è già in campo dice da dove arriva: si scambiano di posto
    expect(list[0]?.from).toBe(3);
    expect(list[1]?.from).toBeNull();
  });

  it('la riga di ogni candidato', () => {
    const list = slotCandidates(roster, starters, 2, ovr);
    const note = (id: string) => candidateNote(list.find((c) => c.player.id === id)!);
    expect(note('pf')).toEqual({ text: 'SF/PF · nel ruolo · ora PF, si scambiano', alert: false });
    expect(note('sf2')).toEqual({ text: 'SF · nel ruolo · in panchina, energia 94', alert: false });
    expect(note('sf3')).toEqual({ text: 'SF · nel ruolo · two-way, 31 partite su 50', alert: false });
    expect(note('sg2')).toEqual({ text: 'SG · fuori ruolo, −3% · in panchina, energia 95', alert: true });
  });

  it('la panchina: prima chi ha più minuti, poi il voto', () => {
    const minutes = { pg: 30, sg: 34, sf: 35, pf: 36, c: 26, sg2: 20, sf2: 12, pg2: 12, sf3: 4 };
    expect(benchOrder(roster, starters, minutes, ovr).map((p) => p.id)).toEqual([
      'sg2',
      'pg2',
      'sf2',
      'sf3',
      'out',
    ]);
  });
});

describe('titolari da sistemare', () => {
  const league = generateLeague(new Rng('campo'), ARCHETYPE_PROFILES);
  const roster = league.players.filter((p) => p.teamId === 'BOS') as (Player & CourtPlayer)[];
  const setup = autoSetup('BOS', roster);
  const saved = { starters: [...setup.starters], minutes: { ...setup.minutes }, tactics: DEFAULT_TACTICS };

  it('con il quintetto del bot non c’è niente da sistemare', () => {
    const fitting = courtIssues('BOS', roster, saved).filter((i) => !i.text.includes('rende il'));
    expect(fitting).toEqual([]);
  });

  it('un titolare infortunato: alla partita lo sostituisce chi sceglie il motore', () => {
    const injured = saved.starters[2]!;
    const withInjury = roster.map((p) => (p.id === injured ? { ...p, injury: hurt(6) } : p));
    const issues = courtIssues('BOS', withInjury, saved);
    const issue = issues.find((i) => i.slot === 2);
    const sub = withInjury.find((p) => p.id === setupFromSettings('BOS', withInjury, saved).starters[2])!;
    expect(issue?.text).toBe(
      `${withInjury.find((p) => p.id === injured)!.lastName} è fuori 6 partite. Alla partita lo sostituisce ${sub.firstName} ${sub.lastName}.`,
    );
  });

  it('un titolare fuori ruolo: quanto perde', () => {
    // Il playmaker messo da centro
    const starters = [...saved.starters];
    const pg = starters[0]!;
    starters[0] = starters[4]!;
    starters[4] = pg;
    const issues = courtIssues('BOS', roster, { ...saved, starters });
    const p = roster.find((x) => x.id === pg)!;
    const penalty = slotPenalty(p, 'C');
    if (penalty > 0)
      expect(issues.find((i) => i.slot === 4)?.text).toBe(
        `${p.lastName} gioca da centro: in campo rende il ${penalty}% in meno.`,
      );
    expect(overall(p)).toBeGreaterThan(0);
  });

  it('con meno di 5 sani non si sa chi entra: si dice del migliore libero', () => {
    const fewHealthy = roster.map((p, i) => (i >= 4 ? { ...p, injury: hurt(10) } : p));
    const injured = courtIssues('BOS', fewHealthy, saved).filter((x) => x.text.includes('è fuori'));
    // Sani solo i primi 4 della rosa: almeno uno dei 5 titolari è infortunato
    expect(injured.length).toBeGreaterThan(0);
    for (const i of injured) expect(i.text).toMatch(/il migliore libero per il ruolo\.$/);
    expect(injured.every((i) => i.slot >= 0 && i.slot < SLOT_ROLES.length)).toBe(true);
  });
});

describe('tattiche e allenatore', () => {
  it('ogni scelta delle tattiche ha la sua riga', () => {
    for (const t of TACTIC_OPTIONS) {
      expect(TACTIC_LEGEND[t.key]).toBeTruthy();
      for (const o of t.options)
        expect((TACTIC_NOTES[t.key] as Record<string, string>)[o.value]).toMatch(/^.+: /);
    }
  });

  it('fino a quando dura la delega', () => {
    expect(coachUntilText({ untilPhaseEnd: true, untilRound: null, untilAt: null })).toBe(
      'fino alla fine della fase',
    );
    expect(coachUntilText({ untilPhaseEnd: false, untilRound: 22, untilAt: null })).toBe('per questo turno');
    expect(coachUntilText({ untilPhaseEnd: false, untilRound: null, untilAt: null })).toBe(
      'finché non la riprendi',
    );
    expect(
      coachUntilText({ untilPhaseEnd: false, untilRound: null, untilAt: '2026-11-08T18:00:00Z' }),
    ).toMatch(/^fino al /);
  });
});

describe('colori della pagina Squadra (stile Edicola)', () => {
  it('niente verdi, gialli, azzurri e rossi di Tailwind: inchiostro, stampa e rosso', () => {
    for (const file of [
      '../pages/RosterPage.tsx',
      '../components/Court.tsx',
      '../components/LineupSheets.tsx',
      '../components/TurnBar.tsx',
      '../components/SaveBar.tsx',
    ]) {
      const text = readFileSync(new URL(file, import.meta.url), 'utf8');
      expect(text, file).not.toMatch(/\b(green|emerald|lime|amber|yellow|red|sky|blue)-\d{2,3}\b/);
    }
  });
});
