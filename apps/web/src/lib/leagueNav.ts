// Menu della lega: le voci, quale è attiva per un indirizzo e quali stanno nella barra in basso su telefono; le
// schede di Campionato (Risultati, Calendario, Classifica, Playoff). Modulo puro: lo usano Layout, BottomNav e
// ChampionshipLayout, e i test.

export interface LeagueLink {
  /** Nome della voce (chiave delle icone e della voce attiva). */
  key: string;
  /** Pagina sotto /lega/<id>/ ('' è la pagina della lega). */
  to: string;
  label: string;
}

/** Tutte le voci, nell'ordine del menu in alto (da sm in su). */
export const LEAGUE_LINKS: readonly LeagueLink[] = [
  { key: 'lega', to: '', label: 'Lega' },
  { key: 'squadra', to: 'squadra', label: 'Squadra' },
  { key: 'mercato', to: 'mercato', label: 'Mercato' },
  { key: 'campionato', to: 'risultati', label: 'Campionato' },
  { key: 'statistiche', to: 'statistiche', label: 'Statistiche' },
  { key: 'cronaca', to: 'cronaca', label: 'Cronaca' },
  { key: 'storico', to: 'storico', label: 'Storico' },
  { key: 'confronta', to: 'confronta', label: 'Confronta' },
  { key: 'info', to: 'info', label: 'Info lega' },
];

/** Voci della barra in basso su telefono (le pagine di ogni turno); le altre stanno in Altro. */
export const MAIN_LINKS: readonly string[] = ['lega', 'squadra', 'mercato', 'campionato'];

// Voce di ogni pagina, dal primo pezzo dell'indirizzo dopo /lega/<id>/. Le pagine che non sono qui (squadre degli
// altri, giocatori, draft) non accendono nessuna voce
const SECTION: Record<string, string> = {
  '': 'lega',
  squadra: 'squadra',
  mercato: 'mercato',
  risultati: 'campionato',
  calendario: 'campionato',
  classifica: 'campionato',
  playoff: 'campionato',
  partita: 'campionato',
  statistiche: 'statistiche',
  cronaca: 'cronaca',
  storico: 'storico',
  confronta: 'confronta',
  info: 'info',
};

/** Indirizzo di una pagina della lega. */
export const leagueHref = (leagueId: string, to: string) =>
  to ? `/lega/${leagueId}/${to}` : `/lega/${leagueId}`;

/** Primo pezzo dell'indirizzo dopo /lega/<id>/ ('' per la pagina della lega), o null fuori dalla lega. */
function section(pathname: string, leagueId: string): string | null {
  const base = `/lega/${leagueId}`;
  if (pathname !== base && !pathname.startsWith(`${base}/`)) return null;
  return (
    pathname
      .slice(base.length)
      .split('/')
      .find((p) => p !== '') ?? ''
  );
}

/** La voce del menu attiva per un indirizzo (la sua key), o null. */
export function activeLink(pathname: string, leagueId: string): string | null {
  const s = section(pathname, leagueId);
  return s === null ? null : (SECTION[s] ?? null);
}

export type ChampionshipTab = 'risultati' | 'calendario' | 'classifica' | 'playoff';

const TAB_LABEL: Record<ChampionshipTab, string> = {
  risultati: 'Risultati',
  calendario: 'Calendario',
  classifica: 'Classifica',
  playoff: 'Playoff',
};

/** La scheda di Campionato aperta (risultati, risultati/<turno>, calendario, classifica, playoff), o null. */
export function championshipTab(pathname: string, leagueId: string): ChampionshipTab | null {
  const s = section(pathname, leagueId);
  return s === 'risultati' || s === 'calendario' || s === 'classifica' || s === 'playoff' ? s : null;
}

/**
 * Schede di Campionato. Playoff c'è fuori dalla regular season (play-in, playoff e offseason, con il tabellone
 * della stagione appena finita), come il link "Tabellone" della scheda del turno; in regular season la classifica
 * dice già chi va ai playoff e al play-in. Con il turno non ancora letto (kind null) la scheda non c'è, salvo
 * quando è quella aperta (un link vecchio alla pagina dei playoff).
 */
export function championshipTabs(
  roundKind: string | null,
  current: ChampionshipTab | null,
): { to: ChampionshipTab; label: string }[] {
  const playoff = (roundKind !== null && roundKind !== 'regular') || current === 'playoff';
  return (['risultati', 'calendario', 'classifica', 'playoff'] as const)
    .filter((t) => t !== 'playoff' || playoff)
    .map((t) => ({ to: t, label: TAB_LABEL[t] }));
}
