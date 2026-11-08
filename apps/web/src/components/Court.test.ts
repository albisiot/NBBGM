import { DEFAULT_TACTICS } from '@nbbgm/engine';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { CourtPlayer } from '../lib/court.ts';
import { slotCandidates } from '../lib/court.ts';
import { Bench, Court, PlayerPanel } from './Court.tsx';
import { StarterSheet, TacticsSheet } from './LineupSheets.tsx';
import { SaveBar } from './SaveBar.tsx';

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

const lineup = [
  player({ id: 'Pritchard', role: 'PG' }),
  player({ id: 'Hauser', role: 'SF' }),
  player({
    id: 'Brown',
    role: 'SF',
    injury: { bodyPart: 'knees', severity: 'medium', gamesRemaining: 6 },
  }),
  player({ id: 'Gilgeous-Alexander', role: 'PF' }),
  player({ id: 'Queta', role: 'C', energy: 71 }),
];
const minutes = { Pritchard: 30, Hauser: 28, Brown: 35, 'Gilgeous-Alexander': 36, Queta: 26, Garza: 13 };

describe('quintetto sul campo', () => {
  const html = renderToStaticMarkup(
    createElement(Court, {
      starters: lineup,
      ovrOf: () => 70,
      minutes,
      selectedId: 'Gilgeous-Alexander',
      onSelect: () => {},
      onEmpty: () => {},
    }),
  );

  it('cinque pulsanti sopra le linee del campo, che i lettori di schermo saltano', () => {
    expect(html).toContain('aria-label="Quintetto sul campo"');
    expect(html.match(/<button/g)).toHaveLength(5);
    expect(html.match(/<svg aria-hidden="true"/g)).toHaveLength(2);
    // Il scelto è d'inchiostro pieno e premuto, gli altri no
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-pressed="true"[^>]*class="[^"]*bg-stampa-900/);
  });

  it('nomi lunghi a capo al trattino, problemi in rosso', () => {
    expect(html).toContain('<span class="block">Gilgeous-</span><span class="block">Alexander</span>');
    expect(html).toContain('Infortunato · 6 partite');
    expect(html).toContain('line-through');
    expect(html).toContain('Fuori ruolo · −3%');
    expect(html).toContain('border-dashed border-rosso-600');
    expect(html).toContain('stanco, energia 71');
    expect(html).toContain(
      'aria-label="ala piccola: Nome Brown, voto 70, 35 minuti, infortunato, fuori 6 partite"',
    );
  });

  it('uno slot senza titolare si sceglie toccandolo', () => {
    const empty = renderToStaticMarkup(
      createElement(Court, {
        starters: [null, ...lineup.slice(1)],
        ovrOf: () => 70,
        minutes,
        selectedId: null,
        onSelect: () => {},
        onEmpty: () => {},
      }),
    );
    expect(empty).toContain('aria-label="playmaker: manca il titolare, tocca per sceglierlo"');
    expect(empty).toContain('aria-haspopup="dialog"');
  });
});

describe('giocatore scelto e panchina', () => {
  it('minuti con − e + da 44 px, cambio e scheda', () => {
    const html = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(PlayerPanel, {
          player: lineup[4]!,
          ovr: 70,
          minutes: 26,
          slot: 'C',
          playerHref: '/lega/l/giocatore/Queta',
          onMinutes: () => {},
          onChange: () => {},
        }),
      ),
    );
    expect(html).toContain('aria-label="Meno minuti a Queta"');
    expect(html).toContain('aria-label="Più minuti a Queta"');
    expect(html.match(/size-11/g)).toHaveLength(2);
    expect(html).toContain('value="26"');
    expect(html).toContain('Cambia giocatore');
    expect(html).toContain('href="/lega/l/giocatore/Queta"');
    // Stanco: energia in rosso, barra rossa
    expect(html).toContain('bg-rosso-600');
    // In panchina niente cambio
    const bench = renderToStaticMarkup(
      createElement(
        MemoryRouter,
        null,
        createElement(PlayerPanel, {
          player: player({ id: 'Garza' }),
          ovr: 63,
          minutes: 13,
          slot: null,
          playerHref: '/x',
          onMinutes: () => {},
          onChange: () => {},
        }),
      ),
    );
    expect(bench).not.toContain('Cambia giocatore');
    expect(bench).not.toContain('bg-rosso-600');
  });

  it('panchina a filo, con il two-way e la stanchezza', () => {
    const html = renderToStaticMarkup(
      createElement(Bench, {
        players: [
          player({ id: 'Garza', energy: 60 }),
          player({ id: 'González', contractType: 'two-way', stats: { g: 31 } }),
        ],
        minutes: { Garza: 13, González: 4 },
        selectedId: 'Garza',
        onSelect: () => {},
      }),
    );
    expect(html).toContain('A disposizione');
    expect(html.match(/min-h-11/g)).toHaveLength(2);
    expect(html).toContain('13′ · stanco');
    expect(html).toContain('4′ · 31 su 50');
    expect(html).toContain('2W');
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
  });
});

describe('pannelli dal basso', () => {
  it('cambio del titolare: il titolare di adesso e i candidati', () => {
    const roster = [...lineup, player({ id: 'Scheierman', role: 'SF' })];
    const html = renderToStaticMarkup(
      createElement(StarterSheet, {
        slot: 2,
        current: lineup[2]!,
        candidates: slotCandidates(
          roster,
          lineup.map((p) => p.id),
          2,
          () => 70,
        ),
        ovrOf: () => 70,
        onPick: () => {},
        onClose: () => {},
      }),
    );
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Chi gioca da ala piccola?');
    expect(html).toContain('Adesso');
    expect(html).toContain('ora SG, si scambiano');
    expect(html).toContain('in panchina, energia 95');
    expect(html).toContain('Annulla');
  });

  it('tattiche come scelte affiancate, con la riga che spiega', () => {
    const html = renderToStaticMarkup(
      createElement(TacticsSheet, {
        tactics: { ...DEFAULT_TACTICS, defense: 'zone' },
        onTactics: () => {},
        coach: null,
        headCoach: null,
        roundNumber: 22,
        onCoach: async () => {},
        onClose: () => {},
      }),
    );
    expect(html.match(/<fieldset/g)).toHaveLength(4);
    expect(html.match(/aria-pressed="true"/g)).toHaveLength(4);
    expect(html).toContain('concede più tiri da tre');
    expect(html).toContain('Affida all&#x27;allenatore');
    expect(html).toContain('Fatto');
  });
});

describe('barra del turno con le modifiche da salvare', () => {
  it('Da salvare, i minuti, Annulla e Salva', () => {
    const ok = renderToStaticMarkup(
      createElement(SaveBar, {
        unsaved: { leagueId: 'l', save: async () => true, minutes: 240, problem: null, discard: () => {} },
        busy: false,
        onSave: () => {},
      }),
    );
    expect(ok).toContain('Da salvare');
    expect(ok).toContain('240 su 240 minuti');
    expect(ok).toContain('Annulla');
    expect(ok).not.toContain('disabled=""');
    const short = renderToStaticMarkup(
      createElement(SaveBar, {
        unsaved: {
          leagueId: 'l',
          save: async () => true,
          minutes: 236,
          problem: 'La somma dei minuti deve fare 240 (ora 236).',
          discard: () => {},
        },
        busy: false,
        onSave: () => {},
      }),
    );
    expect(short).toContain('236 su 240 minuti: ne mancano 4');
    expect(short).toContain('text-rosso-300');
    // Salva non si può premere finché i minuti non tornano
    expect(short).toMatch(/<button[^>]*disabled=""[^>]*>Salva<\/button>/);
  });
});
