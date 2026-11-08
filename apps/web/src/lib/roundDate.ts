// Date dei turni e delle partite: un turno è un giorno del calendario (dalla Fase 2 di "un turno = un giorno" il
// server dà il giorno di ogni turno e partita, in giorni dall'apertura della stagione). Modulo puro, con le sole
// date del motore (@nbbgm/engine/calendar, senza il resto del motore): lo usano anche barra del turno e prima pagina.
import { dayLabel, shortDayLabel } from '@nbbgm/engine/calendar';

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "mercoledì 21 ottobre" (short: "mer 21 ott"), o null senza giorno o anno. */
export function dateText(day: number | null, seasonYear: number | null, short = false): string | null {
  if (day === null || seasonYear === null) return null;
  return (short ? shortDayLabel : dayLabel)(seasonYear, day);
}

/**
 * Quando si gioca: la data in regular season ("Mercoledì 21 ottobre"), con la fase in play-in e playoff
 * ("Playoff · domenica 18 aprile"). Senza giorno: fallback in regular season, la fase altrimenti.
 */
export function whenText(
  kind: string,
  day: number | null,
  seasonYear: number | null,
  opts: { short?: boolean; fallback: string },
): string {
  const date = dateText(day, seasonYear, opts.short);
  if (kind === 'play-in') return date ? `Play-in · ${date}` : 'Play-in';
  if (kind === 'playoffs') return date ? `Playoff · ${date}` : 'Playoff';
  return date ? capital(date) : opts.fallback;
}
