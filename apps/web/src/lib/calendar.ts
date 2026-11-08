// Calendario della stagione. Il gioco non ha date: un turno avanza quando tutti sono pronti, che sia dopo un minuto
// o dopo un giorno. Per vedere la stagione come un calendario ogni turno con partite ha un giorno fisso, uguale per
// tutti e ricavato solo dall'anno della stagione e dal numero del turno, come nella NBA: si parte dal martedì tra il
// 20 e il 26 ottobre, una giornata ogni 2 giorni (ogni settima pausa di 3) fino a metà aprile, poi play-in e playoff
// ogni 2 giorni fino a giugno. Modulo puro: niente Supabase, niente formati del browser (i nomi di giorni e mesi
// sono scritti qui, così i test non dipendono dalla lingua del sistema).
import type { GameKind, SeasonGame } from './results.ts';

/** Giorno come numero di giorni dal 1° gennaio 1970 (UTC): le date si contano senza fusi orari né ora legale. */
export type Day = number;

/** Giornate di regular season (turni 0-81); poi play-in (82-83) e playoff. */
export const REGULAR_ROUNDS = 82;

const DAY_MS = 86_400_000;

export const dayOf = (year: number, month: number, date: number): Day =>
  Math.round(Date.UTC(year, month - 1, date) / DAY_MS);

/** Anno, mese (1-12) e giorno del mese. */
export function ymd(day: Day): { year: number; month: number; date: number } {
  const d = new Date(day * DAY_MS);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, date: d.getUTCDate() };
}

/** Giorno della settimana: 0 lunedì ... 6 domenica (il 1° gennaio 1970 era un giovedì). */
export const weekday = (day: Day): number => (((day + 3) % 7) + 7) % 7;

/** "2026-11-14": il giorno nell'indirizzo della pagina. */
export function dayKey(day: Day): string {
  const { year, month, date } = ymd(day);
  return `${year}-${String(month).padStart(2, '0')}-${String(date).padStart(2, '0')}`;
}

/** Il giorno di "2026-11-14", o null se il testo non è una data vera (2026-02-30 compreso). */
export function parseDayKey(text: string | null): Day | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '');
  if (!m) return null;
  const day = dayOf(Number(m[1]), Number(m[2]), Number(m[3]));
  return dayKey(day) === text ? day : null;
}

/** Primo giorno della stagione: il martedì tra il 20 e il 26 ottobre dell'anno della stagione. */
export function openingDay(seasonYear: number): Day {
  const oct20 = dayOf(seasonYear, 10, 20);
  return oct20 + ((1 - weekday(oct20) + 7) % 7);
}

/**
 * Giorni dall'inizio della stagione al turno: in regular season 2 giorni tra una giornata e l'altra, 3 ogni
 * settima (la giornata 82 cade 173 giorni dopo la prima, a metà aprile); il primo play-in 3 giorni dopo l'ultima
 * giornata, poi un turno ogni 2 giorni (28 turni di playoff arrivano a metà giugno).
 */
export function roundOffset(round: number): number {
  const r = Math.max(0, Math.floor(round));
  if (r < REGULAR_ROUNDS) return 2 * r + Math.floor(r / 7);
  return roundOffset(REGULAR_ROUNDS - 1) + 3 + 2 * (r - REGULAR_ROUNDS);
}

/** Il giorno di un turno. */
export const roundDay = (seasonYear: number, round: number): Day =>
  openingDay(seasonYear) + roundOffset(round);

/** Un giorno del calendario con partite: il turno e le sue partite. */
export interface CalendarDay {
  day: Day;
  round: number;
  kind: GameKind;
  games: SeasonGame[];
}

/** Le partite della stagione divise per giorno (un turno, un giorno). */
export function seasonCalendar(seasonYear: number, games: readonly SeasonGame[]): Map<Day, CalendarDay> {
  const days = new Map<Day, CalendarDay>();
  for (const g of games) {
    const day = roundDay(seasonYear, g.roundNumber);
    const entry = days.get(day);
    if (entry) entry.games.push(g);
    else days.set(day, { day, round: g.roundNumber, kind: g.kind, games: [g] });
  }
  return days;
}

/** Giorni con partite, in ordine. */
export const calendarDays = (cal: ReadonlyMap<Day, CalendarDay>): Day[] =>
  [...cal.keys()].sort((a, b) => a - b);

/**
 * "Oggi" nella lega: il giorno del turno aperto, se ha partite (in offseason no). Le sue partite sono quelle che il
 * prossimo passaggio di turno giocherà.
 */
export function leagueToday(
  cal: ReadonlyMap<Day, CalendarDay>,
  seasonYear: number,
  current: { number: number | null; kind: string | null },
): Day | null {
  if (current.number === null || current.kind === null || current.kind === 'offseason') return null;
  const day = roundDay(seasonYear, current.number);
  return cal.has(day) ? day : null;
}

/** Il giorno da mostrare se l'indirizzo non ne chiede uno: oggi, altrimenti l'ultimo giocato, poi il primo. */
export function defaultDay(cal: ReadonlyMap<Day, CalendarDay>, seasonYear: number, today: Day | null): Day {
  if (today !== null) return today;
  const days = calendarDays(cal);
  const played = days.filter((d) => cal.get(d)?.games.some((g) => g.homeScore !== null));
  return played.at(-1) ?? days[0] ?? openingDay(seasonYear);
}

export type CalendarView = 'mese' | 'settimana';

/** Lunedì della settimana del giorno. */
export const startOfWeek = (day: Day): Day => day - weekday(day);

/** I 7 giorni della settimana del giorno, da lunedì. */
export const weekOf = (day: Day): Day[] => Array.from({ length: 7 }, (_, i) => startOfWeek(day) + i);

/** Primo e ultimo giorno del mese del giorno. */
export function monthRange(day: Day): [Day, Day] {
  const { year, month } = ymd(day);
  const first = dayOf(year, month, 1);
  const next = month === 12 ? dayOf(year + 1, 1, 1) : dayOf(year, month + 1, 1);
  return [first, next - 1];
}

/** Settimane del mese del giorno (da lunedì a domenica); i giorni fuori dal mese sono null. */
export function monthWeeks(day: Day): (Day | null)[][] {
  const [first, last] = monthRange(day);
  const weeks: (Day | null)[][] = [];
  for (let start = startOfWeek(first); start <= last; start += 7)
    weeks.push(
      Array.from({ length: 7 }, (_, i) => (start + i < first || start + i > last ? null : start + i)),
    );
  return weeks;
}

/** Primo e ultimo giorno del periodo (mese o settimana) che contiene il giorno. */
export function periodRange(view: CalendarView, day: Day): [Day, Day] {
  if (view === 'mese') return monthRange(day);
  const start = startOfWeek(day);
  return [start, start + 6];
}

/**
 * Il periodo prima o dopo, se tocca la stagione (dal primo all'ultimo giorno con partite): il giorno da aprire è il
 * primo con partite del periodo, altrimenti il suo primo giorno. Null se il periodo è fuori dalla stagione.
 */
export function shiftPeriod(
  view: CalendarView,
  day: Day,
  dir: -1 | 1,
  cal: ReadonlyMap<Day, CalendarDay>,
): Day | null {
  const days = calendarDays(cal);
  if (days.length === 0) return null;
  const [start, end] = periodRange(view, day);
  const [from, to] = periodRange(view, dir < 0 ? start - 1 : end + 1);
  if (to < (days[0] as Day) || from > (days.at(-1) as Day)) return null;
  return days.find((d) => d >= from && d <= to) ?? from;
}

/** Il primo giorno con partite dopo il giorno, o null. */
export const nextGameDay = (cal: ReadonlyMap<Day, CalendarDay>, day: Day): Day | null =>
  calendarDays(cal).find((d) => d > day) ?? null;

/** La partita di una squadra nel giorno, o null (riposo, eliminata, o nessuna squadra scelta). */
export function teamGame(entry: CalendarDay | undefined, teamId: string | null): SeasonGame | null {
  if (!entry || teamId === null) return null;
  return entry.games.find((g) => g.homeTeamId === teamId || g.awayTeamId === teamId) ?? null;
}

/** La partita vista da una squadra: avversaria, casa o trasferta, esito e punteggi (null se da giocare). */
export interface TeamSide {
  opponentId: string;
  home: boolean;
  result: 'V' | 'S' | null;
  score: string | null;
}

export function teamSide(game: SeasonGame, teamId: string): TeamSide {
  const home = game.homeTeamId === teamId;
  const own = home ? game.homeScore : game.awayScore;
  const other = home ? game.awayScore : game.homeScore;
  const played = own !== null && other !== null;
  return {
    opponentId: home ? game.awayTeamId : game.homeTeamId,
    home,
    result: played ? (own > other ? 'V' : 'S') : null,
    score: played ? `${own}-${other}` : null,
  };
}

/** Nome del turno di un giorno: "Giornata 13", "Play-in", "Playoff · turno 3". */
export function dayRoundLabel(entry: Pick<CalendarDay, 'round' | 'kind'>): string {
  if (entry.kind === 'regular') return `Giornata ${entry.round + 1}`;
  if (entry.kind === 'play-in') return 'Play-in';
  return `Playoff · turno ${entry.round - REGULAR_ROUNDS - 1}`;
}

const MONTHS = [
  'gennaio',
  'febbraio',
  'marzo',
  'aprile',
  'maggio',
  'giugno',
  'luglio',
  'agosto',
  'settembre',
  'ottobre',
  'novembre',
  'dicembre',
] as const;
const WEEKDAYS = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica'] as const;

/** Intestazioni delle colonne: Lun ... Dom, e il nome intero per i lettori di schermo. */
export const WEEKDAY_HEADERS = WEEKDAYS.map((name) => ({
  short: name.charAt(0).toUpperCase() + name.slice(1, 3),
  name,
}));

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const monthName = (month: number): string => MONTHS[month - 1] ?? '';
const weekdayName = (day: Day): string => WEEKDAYS[weekday(day)] ?? '';

/** "sabato 14 novembre 2026". */
export function longDate(day: Day): string {
  const { year, month, date } = ymd(day);
  return `${weekdayName(day)} ${date} ${monthName(month)} ${year}`;
}

/** "sab 14 nov". */
export function shortDate(day: Day): string {
  const { month, date } = ymd(day);
  return `${weekdayName(day).slice(0, 3)} ${date} ${monthName(month).slice(0, 3)}`;
}

/** Titolo del periodo: "Novembre 2026", oppure la settimana "9 – 15 novembre 2026" (anche a cavallo di mese o anno). */
export function periodTitle(view: CalendarView, day: Day): string {
  const [from, to] = periodRange(view, day);
  const a = ymd(from);
  const b = ymd(to);
  if (view === 'mese') return `${capital(monthName(a.month))} ${a.year}`;
  if (a.year !== b.year)
    return `${a.date} ${monthName(a.month)} ${a.year} – ${b.date} ${monthName(b.month)} ${b.year}`;
  if (a.month !== b.month)
    return `${a.date} ${monthName(a.month)} – ${b.date} ${monthName(b.month)} ${b.year}`;
  return `${a.date} – ${b.date} ${monthName(b.month)} ${b.year}`;
}

/** Valori dell'indirizzo: ?vista=settimana&giorno=2026-11-14&squadra=BOS (squadra=tutte per nessuna). */
export const ALL_TEAMS = 'tutte';

export const readView = (v: string | null): CalendarView => (v === 'settimana' ? 'settimana' : 'mese');

/**
 * Cosa dice un giorno ai lettori di schermo: "sabato 14 novembre 2026, Giornata 13, BOS in casa contro NYK, vinta
 * 110-100, oggi". Senza spoiler una partita giocata è solo "giocata"; senza squadra in evidenza (o se non gioca) il
 * numero delle partite.
 */
export function dayAriaLabel(
  entry: CalendarDay,
  featuredId: string | null,
  code: (teamId: string) => string,
  opts: { spoilerFree: boolean; today: boolean },
): string {
  const parts = [longDate(entry.day), dayRoundLabel(entry)];
  const game = teamGame(entry, featuredId);
  if (game && featuredId !== null) {
    const side = teamSide(game, featuredId);
    parts.push(
      `${code(featuredId)} ${side.home ? 'in casa contro' : 'in trasferta a'} ${code(side.opponentId)}`,
    );
    if (side.result === null) parts.push('da giocare');
    else if (opts.spoilerFree) parts.push('giocata');
    else parts.push(`${side.result === 'V' ? 'vinta' : 'persa'} ${side.score}`);
  } else parts.push(entry.games.length === 1 ? '1 partita' : `${entry.games.length} partite`);
  if (opts.today) parts.push('oggi');
  return parts.join(', ');
}
