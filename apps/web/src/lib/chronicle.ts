// Cronaca della lega: scambi, firme, tagli, rinnovi, infortuni, ritiri, draft e opzioni, dalla tabella
// transactions (la leggono tutti i membri). Dalla più recente, a pagine, filtrabile per tipo e per squadra.
import { supabase } from './supabase.ts';

export interface ChronicleEntry {
  id: number;
  seasonYear: number;
  roundNumber: number | null;
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
  type: string;
  text: string;
  team_codes?: string[];
  created_at: string;
};

/**
 * Una pagina di cronaca (from = quante righe sono già state lette). more dice se ce ne sono altre: si chiede
 * una riga in più del necessario.
 */
export async function chroniclePage(
  leagueId: string,
  filter: ChronicleFilter,
  from = 0,
  size = CHRONICLE_PAGE,
): Promise<{ entries: ChronicleEntry[]; more: boolean }> {
  const query = (withTeams: boolean) => {
    // Colonne scritte come stringa qualsiasi: i tipi di supabase-js non le ricavano da un testo composto
    const columns: string = `id, season_year, round_number, type, text, created_at${withTeams ? ', team_codes' : ''}`;
    let q = supabase.from('transactions').select(columns).eq('league_id', leagueId);
    if (filter.types.length > 0) q = q.in('type', [...filter.types]);
    if (withTeams && filter.team) q = q.contains('team_codes', [filter.team]);
    return q
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(from, from + size);
  };
  let res = await query(true);
  let rows: Row[];
  // Database non ancora aggiornato (l'app si pubblica insieme alle migrazioni): senza la colonna delle squadre
  // si filtra sul testo
  if (res.error?.code === '42703') {
    res = await query(false);
    if (res.error) throw res.error;
    rows = ((res.data ?? []) as unknown as Row[]).filter(
      (r) => !filter.team || mentions(r.text, filter.team),
    );
  } else {
    if (res.error) throw res.error;
    rows = (res.data ?? []) as unknown as Row[];
  }
  return {
    entries: rows.slice(0, size).map((r) => ({
      id: r.id,
      seasonYear: r.season_year,
      roundNumber: r.round_number,
      type: r.type,
      text: r.text,
      teamCodes: r.team_codes ?? [],
      createdAt: r.created_at,
    })),
    more: rows.length > size,
  };
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

/** "Stagione 2026-27 · giornata 13", "Stagione 2026-27 · offseason" */
export function chronicleWhen(e: Pick<ChronicleEntry, 'seasonYear' | 'roundNumber'>): string {
  const season = `Stagione ${e.seasonYear}-${String((e.seasonYear + 1) % 100).padStart(2, '0')}`;
  if (e.roundNumber === null) return `${season} · offseason`;
  if (e.roundNumber < 82) return `${season} · giornata ${e.roundNumber + 1}`;
  return `${season} · post-season`;
}

/** Righe consecutive con la stessa intestazione (stagione e giornata) insieme, nell'ordine in cui arrivano. */
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
  draft: 'Draft',
  option: 'Opzione',
};
