import { describe, expect, it, vi } from 'vitest';
import {
  afterCursor,
  appendEntries,
  chroniclePage,
  chronicleWhen,
  groupChronicle,
  mentions,
  splitTeams,
  type ChronicleEntry,
} from './chronicle.ts';

// Finto PostgREST per la tabella transactions: ordine (created_at, id) dal più recente, filtro or del cursore
// interpretato come lo interpreta il database, limit. Le righe si possono aggiungere tra una pagina e l'altra.
const server = vi.hoisted(() => {
  type Row = { id: number; created_at: string; type: string; text: string; season_year: number };
  const state = { rows: [] as Row[], missingTeams: false, ors: [] as string[] };
  const parseOr = (expr: string) => {
    const m = /^created_at\.lt\.("[^"]+"),and\(created_at\.eq\.("[^"]+"),id\.lt\.(\d+)\)$/.exec(expr);
    if (!m) throw new Error(`filtro inatteso: ${expr}`);
    const at = JSON.parse(m[1] as string) as string;
    const id = Number(m[3]);
    return (r: Row) => r.created_at < at || (r.created_at === at && r.id < id);
  };
  const from = () => {
    const filters: ((r: Row) => boolean)[] = [];
    let limit = Infinity;
    let columns = '';
    const q = {
      select(c: string) {
        columns = c;
        return q;
      },
      eq: () => q,
      in: () => q,
      contains: () => q,
      or(expr: string) {
        state.ors.push(expr);
        filters.push(parseOr(expr));
        return q;
      },
      order: () => q,
      limit(n: number) {
        limit = n;
        return q;
      },
      then(ok: (v: unknown) => unknown) {
        if (state.missingTeams && columns.includes('team_codes'))
          return Promise.resolve({ data: null, error: { code: '42703', message: 'colonna' } }).then(ok);
        const data = [...state.rows]
          .filter((r) => filters.every((f) => f(r)))
          .sort((a, b) =>
            a.created_at === b.created_at ? b.id - a.id : a.created_at < b.created_at ? 1 : -1,
          )
          .slice(0, limit);
        return Promise.resolve({ data, error: null }).then(ok);
      },
    };
    return q;
  };
  return { state, from };
});
vi.mock('./supabase.ts', () => ({ supabase: { from: server.from } }));

const row = (id: number, at: string, text = `riga ${id}`) => ({
  id,
  created_at: `2026-11-06T10:00:${at}.123456+00:00`,
  type: 'draft',
  text,
  season_year: 2026,
});

const entry = (over: Partial<ChronicleEntry>): ChronicleEntry => ({
  id: 1,
  seasonYear: 2026,
  roundNumber: 4,
  day: 4,
  type: 'signing',
  text: '',
  teamCodes: [],
  createdAt: '',
  ...over,
});

describe('cronaca della lega', () => {
  it('sigle delle squadre come collegamenti, il resto come testo', () => {
    expect(splitTeams('Scambio: LAL cede Mario Rossi a NYK per niente', ['LAL', 'NYK'])).toEqual([
      { text: 'Scambio: ' },
      { code: 'LAL' },
      { text: ' cede Mario Rossi a ' },
      { code: 'NYK' },
      { text: ' per niente' },
    ]);
    expect(splitTeams('BOS firma X', ['BOS'])).toEqual([{ code: 'BOS' }, { text: ' firma X' }]);
    // Solo parole intere: "BOSTON" non è BOS
    expect(splitTeams('Ritorno a BOSTON', ['BOS'])).toEqual([{ text: 'Ritorno a BOSTON' }]);
    expect(splitTeams('Si ritira', [])).toEqual([{ text: 'Si ritira' }]);
  });

  it('la sigla citata come parola intera', () => {
    expect(mentions('BOS taglia Mario', 'BOS')).toBe(true);
    expect(mentions('Draft: BOSX sceglie', 'BOS')).toBe(false);
    expect(mentions('qualunque', '')).toBe(false);
  });

  it('intestazioni per stagione e giorno', () => {
    expect(chronicleWhen(entry({ roundNumber: 12, day: 22 }))).toBe(
      'Stagione 2026-27 · mercoledì 11 novembre',
    );
    // In offseason (e nel draft iniziale) non c'è un giorno
    expect(chronicleWhen(entry({ roundNumber: null, day: null, seasonYear: 2027 }))).toBe(
      'Stagione 2027-28 · offseason',
    );
    expect(chronicleWhen(entry({ roundNumber: 3, day: null }))).toBe('Stagione 2026-27 · offseason');
    // Anche i playoff hanno il loro giorno
    expect(chronicleWhen(entry({ roundNumber: 170, day: 180 }))).toBe(
      'Stagione 2026-27 · domenica 18 aprile',
    );
    const groups = groupChronicle([
      entry({ id: 3, roundNumber: 5, day: 5 }),
      entry({ id: 2, roundNumber: 5, day: 5 }),
      entry({ id: 1, roundNumber: 4, day: 4 }),
    ]);
    expect(groups.map((g) => [g.when, g.entries.map((e) => e.id)])).toEqual([
      ['Stagione 2026-27 · domenica 25 ottobre', [3, 2]],
      ['Stagione 2026-27 · sabato 24 ottobre', [1]],
    ]);
  });
});

describe('cronaca a pagine per chiave (seconda analisi)', () => {
  it('il filtro del cursore: più vecchie, o della stessa ora con id più piccolo', () => {
    expect(afterCursor({ createdAt: '2026-11-06T10:00:01.5+00:00', id: 42 })).toBe(
      'created_at.lt."2026-11-06T10:00:01.5+00:00",and(created_at.eq."2026-11-06T10:00:01.5+00:00",id.lt.42)',
    );
  });

  it('righe nuove tra una pagina e l’altra (draft dal vivo): nessuna riga ripetuta, nessuna persa', async () => {
    // 5 scelte del draft, due con la stessa ora
    server.state.rows = [row(1, '01'), row(2, '02'), row(3, '03'), row(4, '03'), row(5, '04')];
    const first = await chroniclePage('L', { types: [], team: null }, null, 2);
    expect(first.entries.map((e) => e.id)).toEqual([5, 4]);
    expect(first.more).toBe(true);
    // Intanto arrivano altre 3 scelte: con la posizione la pagina dopo ripeterebbe 5 e 4
    server.state.rows.push(row(6, '05'), row(7, '05'), row(8, '06'));
    const second = await chroniclePage('L', { types: [], team: null }, first.cursor, 2);
    expect(second.entries.map((e) => e.id)).toEqual([3, 2]);
    const third = await chroniclePage('L', { types: [], team: null }, second.cursor, 2);
    expect(third.entries.map((e) => e.id)).toEqual([1]);
    expect(third.more).toBe(false);
    // Il cursore tiene i microsecondi della data, come arrivano dal database
    expect(first.cursor).toEqual({ createdAt: '2026-11-06T10:00:03.123456+00:00', id: 4 });
  });

  it('database senza la colonna delle squadre: il cursore è l’ultima riga letta, anche se il filtro la scarta', async () => {
    server.state.missingTeams = true;
    server.state.rows = [row(1, '01', 'BOS firma'), row(2, '02', 'NYK firma'), row(3, '03', 'BOS taglia')];
    const page = await chroniclePage('L', { types: [], team: 'BOS' }, null, 2);
    expect(page.entries.map((e) => e.id)).toEqual([3]);
    expect(page.cursor?.id).toBe(2);
    expect(page.more).toBe(true);
    const next = await chroniclePage('L', { types: [], team: 'BOS' }, page.cursor, 2);
    expect(next.entries.map((e) => e.id)).toEqual([1]);
    server.state.missingTeams = false;
  });

  it('le righe aggiunte in fondo non hanno doppioni', () => {
    const e = (id: number): ChronicleEntry => ({
      id,
      seasonYear: 2026,
      roundNumber: null,
      day: null,
      type: 'draft',
      text: '',
      teamCodes: [],
      createdAt: '',
    });
    expect(appendEntries([e(5), e(4)], [e(4), e(3)]).map((x) => x.id)).toEqual([5, 4, 3]);
  });
});
