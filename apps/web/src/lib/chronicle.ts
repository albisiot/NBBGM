// Cronaca della lega: scambi, firme, tagli, rinnovi, infortuni, ritiri, draft e opzioni, dalla tabella
// transactions (la leggono tutti i membri). Dalla più recente, a pagine, filtrabile per tipo e per squadra.
import { dateText } from './roundDate.ts';
import { supabase } from './supabase.ts';

export interface ChronicleEntry {
  id: number;
  seasonYear: number;
  roundNumber: number | null;
  /** Giorno del turno (giorni dall'apertura della stagione); null in offseason e nel draft iniziale. */
  day: number | null;
  type: string;
  text: string;
  /** Sigle delle squadre citate (le ricava il database dal testo). */
  teamCodes: string[];
  createdAt: string;
}

export const CHRONICLE_TYPES: { value: string; label: string }[] = [
  { value: 'trade', label: 'Scambi' },
  { value: 'signing', label: 'Firme' },
  { value: 'release', label: 'Tagli' },
  { value: 'renewal', label: 'Rinnovi' },
  { value: 'injury', label: 'Infortuni' },
  { value: 'retirement', label: 'Ritiri' },
  { value: 'coach', label: 'Allenatori' },
  { value: 'draft', label: 'Draft' },
  { value: 'option', label: 'Opzioni' },
];

/** Tipi delle "ultime notizie" nella pagina della lega: senza draft e opzioni, che arrivano a centinaia insieme. */
export const NEWS_TYPES = ['trade', 'signing', 'release', 'renewal', 'injury', 'retirement'];

export const CHRONICLE_PAGE = 30;

export interface ChronicleFilter {
  /** Tipi da mostrare; vuoto = tutti. */
  types: readonly string[];
  /** Sigla della squadra, o null per tutte. */
  team: string | null;
}

type Row = {
  id: number;
  season_year: number;
  round_number: number | null;
  day?: number | null;
  type: string;
  text: string;
  team_codes?: string[];
  created_at: string;
};

/** Ultima riga letta (nell'ordine della cronaca): la pagina dopo parte da qui. */
export interface ChronicleCursor {
  /** created_at così come arriva dal database (microsecondi compresi: passando da Date si perderebbero). */
  createdAt: string;
  id: number;
}

export interface ChroniclePage {
  entries: ChronicleEntry[];
  more: boolean;
  /** Dove riprendere con "Mostra altri" (null se non ci sono righe). */
  cursor: ChronicleCursor | null;
}

/**
 * Filtro PostgREST (or) per le righe che vengono dopo il cursore nell'ordine della cronaca, (created_at, id) dal
 * più recente: più vecchie, o della stessa ora con id più piccolo. La data va tra virgolette (ha ":" e "+").
 */
export function afterCursor(c: ChronicleCursor): string {
  const at = JSON.stringify(c.createdAt);
  return `created_at.lt.${at},and(created_at.eq.${at},id.lt.${Math.trunc(c.id)})`;
}

/**
 * Una pagina di cronaca: le prime righe, o quelle dopo il cursore della pagina prima. Paginazione per chiave e
 * non per posizione: le transazioni che arrivano nel frattempo (per esempio durante il draft iniziale dal vivo,
 * senza cambio di turno) non fanno ripetere righe già lette. more dice se ce ne sono altre: si chiede una riga
 * in più del necessario.
 */
export async function chroniclePage(
  leagueId: string,
  filter: ChronicleFilter,
  after: ChronicleCursor | null = null,
  size = CHRONICLE_PAGE,
): Promise<ChroniclePage> {
  const query = (withTeams: boolean) => {
    // Colonne scritte come stringa qualsiasi: i tipi di supabase-js non le ricavano da un testo composto
    const columns: string = `id, season_year, round_number, type, text, created_at${withTeams ? ', team_codes, day' : ''}`;
    let q = supabase.from('transactions').select(columns).eq('league_id', leagueId);
    if (filter.types.length > 0) q = q.in('type', [...filter.types]);
    if (withTeams && filter.team) q = q.contains('team_codes', [filter.team]);
    if (after) q = q.or(afterCursor(after));
    return q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(size + 1);
  };
  let res = await query(true);
  // Database non ancora aggiornato (l'app si pubblica insieme alle migrazioni): senza le colonne delle squadre e
  // del giorno si filtra sul testo, dopo aver preso la pagina (il cursore resta quello dell'ultima riga letta)
  const legacy = res.error?.code === '42703';
  if (legacy) {
    res = await query(false);
    if (res.error) throw res.error;
  } else if (res.error) throw res.error;
  let rows = (res.data ?? []) as unknown as Row[];
  const page = rows.slice(0, size);
  const last = page[page.length - 1];
  if (legacy && filter.team) rows = page.filter((r) => mentions(r.text, filter.team ?? ''));
  return {
    entries: rows.slice(0, size).map((r) => ({
      id: r.id,
      seasonYear: r.season_year,
      roundNumber: r.round_number,
      day: r.day ?? null,
      type: r.type,
      text: r.text,
      teamCodes: r.team_codes ?? [],
      createdAt: r.created_at,
    })),
    more: (res.data ?? []).length > size,
    cursor: last ? { createdAt: last.created_at, id: last.id } : null,
  };
}

/** Righe nuove in fondo a quelle già mostrate, senza doppioni (le chiavi di React restano uniche). */
export function appendEntries(
  shown: readonly ChronicleEntry[],
  next: readonly ChronicleEntry[],
): ChronicleEntry[] {
  const ids = new Set(shown.map((e) => e.id));
  return [...shown, ...next.filter((e) => !ids.has(e.id))];
}

/** Il testo cita la sigla come parola intera (come il trigger del database). */
export function mentions(text: string, code: string): boolean {
  return code !== '' && new RegExp(`\\b${code.replace(/[^A-Z0-9]/gi, '')}\\b`).test(text);
}

/**
 * Il testo diviso in pezzi, con le sigle delle squadre a parte (per farne collegamenti alle loro pagine):
 * "BOS firma X" -> [{ code: 'BOS' }, { text: ' firma X' }].
 */
export function splitTeams(text: string, codes: readonly string[]): ({ text: string } | { code: string })[] {
  const valid = codes.filter((c) => /^[A-Z0-9]+$/.test(c));
  if (valid.length === 0) return [{ text }];
  const re = new RegExp(`\\b(${valid.join('|')})\\b`, 'g');
  const out: ({ text: string } | { code: string })[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ code: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}

/** "Stagione 2026-27 · mercoledì 21 ottobre", "Stagione 2026-27 · offseason" */
export function chronicleWhen(e: Pick<ChronicleEntry, 'seasonYear' | 'day'>): string {
  const season = `Stagione ${e.seasonYear}-${String((e.seasonYear + 1) % 100).padStart(2, '0')}`;
  return `${season} · ${dateText(e.day, e.seasonYear) ?? 'offseason'}`;
}

/** Righe consecutive con la stessa intestazione (stagione e giorno) insieme, nell'ordine in cui arrivano. */
export function groupChronicle(
  entries: readonly ChronicleEntry[],
): { when: string; entries: ChronicleEntry[] }[] {
  const groups: { when: string; entries: ChronicleEntry[] }[] = [];
  for (const e of entries) {
    const when = chronicleWhen(e);
    const last = groups[groups.length - 1];
    if (last && last.when === when) last.entries.push(e);
    else groups.push({ when, entries: [e] });
  }
  return groups;
}

/** Etichetta di una riga della cronaca. */
export const TYPE_LABEL: Record<string, string> = {
  trade: 'Scambio',
  signing: 'Firma',
  release: 'Taglio',
  renewal: 'Rinnovo',
  injury: 'Infortunio',
  retirement: 'Ritiro',
  coach: 'Allenatore',
  draft: 'Draft',
  option: 'Opzione',
};
