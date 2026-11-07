// Confronto tra giocatori (fino a 3): abilità visibili, overall, stime (mai i valori nascosti), contratto e
// statistiche, fianco a fianco. L'elenco sta nell'indirizzo (#/lega/<id>/confronta?g=a,b,c) e, per la sessione, nella
// memoria del browser: "Confronta" da una scheda aggiunge il giocatore al confronto aperto prima.
import { playerCard, playerScouting, type RosterPlayer, type Scouting } from './roster.ts';
import { supabase } from './supabase.ts';

export const COMPARE_MAX = 3;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Id del confronto dall'indirizzo: senza doppioni e al massimo 3 (gli ultimi aggiunti). */
export function parseCompare(value: string | null): string[] {
  const ids = (value ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter((x) => UUID.test(x));
  return [...new Set(ids)].slice(-COMPARE_MAX);
}

/** Il confronto con un giocatore in più: se sono già 3 esce il primo. */
export function withPlayer(ids: readonly string[], pid: string): string[] {
  return [...ids.filter((x) => x !== pid), pid].slice(-COMPARE_MAX);
}

export const compareHref = (leagueId: string, ids: readonly string[]) =>
  `/lega/${leagueId}/confronta${ids.length ? `?g=${ids.join(',')}` : ''}`;

const key = (leagueId: string) => `nbbgm:confronto:${leagueId}`;

/** Confronto aperto in questa sessione per la lega (vuoto se non c'è). */
export function recalledCompare(leagueId: string): string[] {
  try {
    return parseCompare(sessionStorage.getItem(key(leagueId)));
  } catch {
    return [];
  }
}

export function rememberCompare(leagueId: string, ids: readonly string[]): void {
  try {
    sessionStorage.setItem(key(leagueId), ids.join(','));
  } catch {
    // Senza memoria del browser il confronto resta solo nell'indirizzo
  }
}

/** Link "Confronta" di un giocatore: lo aggiunge al confronto aperto nella sessione. */
export const compareWith = (leagueId: string, pid: string) =>
  compareHref(leagueId, withPlayer(recalledCompare(leagueId), pid));

export interface Compared {
  player: RosterPlayer;
  scouting: Scouting;
}

/** Scheda e stime dei giocatori del confronto (quelli che non si trovano più restano fuori). */
export async function loadCompared(ids: readonly string[]): Promise<Compared[]> {
  const rows = await Promise.all(
    ids.map(async (id) => {
      const [player, scouting] = await Promise.all([playerCard(id), playerScouting(id)]);
      return player ? { player, scouting } : null;
    }),
  );
  return rows.filter((r): r is Compared => r !== null);
}

export interface FoundPlayer {
  id: string;
  name: string;
  role: string;
  teamId: string | null;
}

/**
 * Testo di ricerca sicuro per un filtro PostgREST: solo lettere (accenti compresi: nel database i nomi li hanno),
 * cifre, spazi, apostrofi, punti e trattini; niente virgole, parentesi, asterischi o percentuali.
 */
export const searchText = (text: string) =>
  text
    .normalize('NFC')
    .replace(/[^\p{L}\p{N}' .-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** Giocatori della lega per nome o cognome (non ritirati), al massimo 8. */
export async function searchPlayers(leagueId: string, text: string): Promise<FoundPlayer[]> {
  const q = searchText(text);
  if (q.length < 2) return [];
  const { data, error } = await supabase
    .from('players')
    .select('id, first_name, last_name, role, team_id')
    .eq('league_id', leagueId)
    .eq('retired', false)
    .or(`first_name.ilike.*${q}*,last_name.ilike.*${q}*`)
    .order('last_name')
    .limit(8);
  if (error) throw error;
  return (
    (data ?? []) as {
      id: string;
      first_name: string;
      last_name: string;
      role: string;
      team_id: string | null;
    }[]
  ).map((p) => ({ id: p.id, name: `${p.first_name} ${p.last_name}`, role: p.role, teamId: p.team_id }));
}

/** Una riga del confronto: etichetta, valore mostrato per giocatore e numero per evidenziare il migliore. */
export interface CompareLine {
  label: string;
  values: { text: string; score: number | null }[];
  /** Più alto è meglio (true), più basso è meglio (false), nessun confronto (null). */
  higher: boolean | null;
}

/** Indici dei valori migliori della riga (più d'uno a pari merito); nessuno se sono tutti uguali o senza confronto. */
export function bestOf(line: CompareLine): Set<number> {
  if (line.higher === null) return new Set();
  const scores = line.values.map((v) => v.score);
  const valid = scores.filter((x): x is number => x !== null);
  if (valid.length < 2) return new Set();
  const best = line.higher ? Math.max(...valid) : Math.min(...valid);
  if (valid.every((x) => x === best)) return new Set();
  return new Set(scores.flatMap((x, i) => (x === best ? [i] : [])));
}
