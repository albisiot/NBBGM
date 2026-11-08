// Date della stagione. Il motore conta i giorni dall'apertura della regular season: il giorno 0 è il martedì tra il
// 20 e il 26 ottobre dell'anno della stagione, come nella NBA, e la regular season finisce 173 giorni dopo, di
// domenica. Un turno è un giorno con partite (i giorni senza partite non sono turni). Le date vere si ricavano
// dall'anno: le usano l'app (calendario, etichette) e il server. Solo la libreria standard: i giorni si contano in
// UTC, senza fusi né ora legale, e i nomi di giorni e mesi sono scritti qui.

/** Giorno di calendario come numero di giorni dal 1° gennaio 1970 (UTC). */
export type EpochDay = number;

const DAY_MS = 86_400_000;

export const dayOf = (year: number, month: number, date: number): EpochDay =>
  Math.round(Date.UTC(year, month - 1, date) / DAY_MS);

/** Anno, mese (1-12) e giorno del mese. */
export function ymd(day: EpochDay): { year: number; month: number; date: number } {
  const d = new Date(day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
}

/** Giorno della settimana: 0 lunedì ... 6 domenica (il 1° gennaio 1970 era un giovedì). */
export const weekday = (day: EpochDay): number => (((day + 3) % 7) + 7) % 7;

/** L'n-esimo giorno della settimana (0 lunedì) di un mese. */
function nthWeekday(year: number, month: number, wd: number, n: number): EpochDay {
  const first = dayOf(year, month, 1);
  return first + ((wd - weekday(first) + 7) % 7) + 7 * (n - 1);
}

/** Primo giorno della stagione: il martedì tra il 20 e il 26 ottobre dell'anno della stagione. */
export function openingDay(year: number): EpochDay {
  const oct20 = dayOf(year, 10, 20);
  return oct20 + ((1 - weekday(oct20) + 7) % 7);
}

/** Ultimo giorno della regular season, in giorni dall'apertura: una domenica di metà aprile, con tutte e 30 in campo. */
export const LAST_REGULAR_DAY = 173;

/** Il giorno di calendario di un giorno della stagione (giorni dall'apertura). */
export const seasonDate = (year: number, day: number): EpochDay => openingDay(year) + day;

/** Giorni della stagione (dall'apertura) di una data. */
export const seasonDay = (year: number, date: EpochDay): number => date - openingDay(year);

/**
 * Giorni di regular season senza partite, come nella NBA, con il motivo: le elezioni americane (negli anni pari,
 * martedì dopo il primo lunedì di novembre), Thanksgiving (quarto giovedì di novembre), la vigilia di Natale, la
 * pausa per l'All-Star (sei giorni dal venerdì tra il 13 e il 19 febbraio) e il penultimo giorno.
 */
export function noGameDays(year: number): Map<number, string> {
  const open = openingDay(year);
  const out = new Map<number, string>();
  if (year % 2 === 0) out.set(nthWeekday(year, 11, 0, 1) + 1 - open, 'Elezioni negli Stati Uniti');
  out.set(nthWeekday(year, 11, 3, 4) - open, 'Thanksgiving');
  out.set(dayOf(year, 12, 24) - open, 'Vigilia di Natale');
  const feb13 = dayOf(year + 1, 2, 13);
  const allStar = feb13 + ((4 - weekday(feb13) + 7) % 7) - open;
  for (let i = 0; i < 6; i++) out.set(allStar + i, 'Pausa per l’All-Star');
  out.set(LAST_REGULAR_DAY - 1, 'Vigilia dell’ultima giornata');
  return out;
}

/** Natale, in giorni dall'apertura: si giocano 5 partite. */
export const christmasDay = (year: number): number => dayOf(year, 12, 25) - openingDay(year);

/**
 * Trade deadline: il primo giovedì di febbraio, come nella NBA (circa 3/5 della regular season). Gli scambi si
 * fanno fino ai turni di quel giorno compreso, poi sono bloccati fino all'offseason.
 */
export const tradeDeadlineDay = (year: number): number => nthWeekday(year + 1, 2, 3, 1) - openingDay(year);

/** Giorni tra la fine della regular season e il primo giorno di play-in. */
export const PLAY_IN_GAP = 2;
