// Calendario della stagione, una scheda di Campionato: il mese o la settimana con i giorni delle partite (un turno è
// un giorno, lib/calendar.ts). In ogni giorno la partita della squadra in evidenza (la propria, un'altra o nessuna)
// con l'esito, o il riposo; i giorni senza partite della NBA (pausa per l'All-Star, Thanksgiving...) lo dicono.
// Toccando un giorno sotto compaiono tutte le sue partite, con il punteggio e il link al box score se sono state
// giocate, "da giocare" se no. Vista, giorno e squadra stanno nell'indirizzo
// (?vista=settimana&giorno=2026-11-14&squadra=BOS), così il ritorno da una partita riapre lo stesso giorno. Usa le
// partite della stagione già in memoria per Risultati e Classifica (useSeason): nessuna lettura in più. Senza
// spoiler gli esiti restano nascosti, come in Risultati.
import { useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ErrorText, Segmented, SectionTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import {
  ALL_TEAMS,
  calendarDays,
  dayAriaLabel,
  dayKey,
  dayRoundLabel,
  defaultDay,
  leagueToday,
  longDate,
  monthRange,
  monthWeeks,
  nextGameDay,
  parseDayKey,
  periodTitle,
  readView,
  seasonBreaks,
  seasonCalendar,
  shiftPeriod,
  shortDate,
  teamGame,
  teamSide,
  WEEKDAY_HEADERS,
  weekday,
  weekOf,
  ymd,
  type CalendarDay,
  type CalendarView,
  type Day,
} from '../lib/calendar.ts';
import { FIELD_LABEL, ROW_LINK } from '../lib/linkStyles.ts';
import { readSpoilerFree, writeSpoilerFree } from '../lib/replay.ts';
import { FIELD, NOTE } from '../lib/tabellino.ts';
import { useSeason } from '../lib/useSeason.ts';
import { GameList, isMine, ScoreLine, SpoilerSwitch } from './ResultsPage.tsx';

const PANEL_ID = 'giorno-scelto';

export function CalendarPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const { data, error, loading } = useSeason(id);
  const [search, setSearch] = useSearchParams();
  const [spoilerFree, setSpoilerFree] = useState(readSpoilerFree);
  const panel = useRef<HTMLElement>(null);
  const year = data?.league.seasonYear ?? null;
  const games = data?.games;
  const cal = useMemo(
    () => (games && year !== null ? seasonCalendar(year, games) : new Map<Day, CalendarDay>()),
    [games, year],
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data || year === null) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, series } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const code = (tid: string) => team.get(tid)?.code ?? '?';
  const mine = league.teams.find((t) => t.ownerId === userId) ?? null;

  const view = readView(search.get('vista'));
  const today = leagueToday(cal, year, { kind: league.roundKind, day: league.roundDay });
  const breaks = seasonBreaks(year);
  const days = calendarDays(cal);
  // Un giorno dell'indirizzo vale solo nei mesi della stagione: altrimenti si apre quello di default
  const asked = parseDayKey(search.get('giorno'));
  const inSeason =
    asked !== null &&
    days.length > 0 &&
    asked >= monthRange(days[0] as Day)[0] &&
    asked <= monthRange(days.at(-1) as Day)[1];
  const selected = inSeason ? asked : defaultDay(cal, year, today);
  const teamParam = search.get('squadra');
  const featured = teamParam === ALL_TEAMS ? null : (league.teams.find((t) => t.code === teamParam) ?? mine);
  const featuredId = featured?.id ?? null;

  /** Cambia vista, giorno o squadra nell'indirizzo, senza riempire la cronologia. */
  const update = (changes: Record<string, string>) =>
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(changes)) next.set(k, v);
        return next;
      },
      { replace: true },
    );

  /** Apre un giorno; su telefono, se le partite restano sotto lo schermo, le porta in vista. */
  const select = (day: Day) => {
    update({ giorno: dayKey(day) });
    requestAnimationFrame(() => {
      const el = panel.current;
      if (!el || el.getBoundingClientRect().top < window.innerHeight * 0.7) return;
      const still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
      el.scrollIntoView({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    });
  };

  const prev = shiftPeriod(view, selected, -1, cal);
  const next = shiftPeriod(view, selected, 1, cal);
  const entry = cal.get(selected);
  const cell = { cal, breaks, selected, today, featuredId, code, spoilerFree, onSelect: select };

  return (
    <div className="space-y-4">
      {/* Su telefono vista e Senza spoiler su una riga, la squadra sotto: il calendario resta in vista; da sm in
          su una riga sola, con l'interruttore in fondo */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <div className="flex w-full items-center justify-between gap-3 sm:contents">
          <Segmented<CalendarView>
            label="Vista del calendario"
            options={[
              { label: 'Mese', value: 'mese' },
              { label: 'Settimana', value: 'settimana' },
            ]}
            value={view}
            onChange={(v) => update({ vista: v })}
          />
          <div className="sm:order-last">
            <SpoilerSwitch
              on={spoilerFree}
              onChange={(v) => {
                setSpoilerFree(v);
                writeSpoilerFree(v);
              }}
            />
          </div>
        </div>
        <label className="flex min-w-0 flex-col gap-1">
          <span className={FIELD_LABEL}>In evidenza</span>
          <select
            className={FIELD}
            value={featured?.code ?? ALL_TEAMS}
            onChange={(e) => update({ squadra: e.target.value })}
          >
            <option value={ALL_TEAMS}>Nessuna squadra</option>
            {[...league.teams]
              .sort((a, b) => a.fullName.localeCompare(b.fullName, 'it'))
              .map((t) => (
                <option key={t.id} value={t.code}>
                  {t.fullName}
                  {t.id === mine?.id ? ' (la tua)' : ''}
                </option>
              ))}
          </select>
        </label>
      </div>

      <div className="flex items-center justify-between gap-2">
        <PeriodButton
          day={prev}
          label={view === 'mese' ? 'Mese precedente' : 'Settimana precedente'}
          arrow="‹"
          onGo={update}
        />
        <p
          className="text-center font-titolo text-lg font-semibold tracking-wider uppercase"
          aria-live="polite"
        >
          {periodTitle(view, selected)}
        </p>
        <div className="flex items-center">
          {today !== null && today !== selected && (
            <button
              type="button"
              onClick={() => select(today)}
              className="min-h-11 px-2 font-titolo text-sm font-semibold tracking-wider text-rosso-700 uppercase hover:underline dark:text-rosso-300"
            >
              Oggi
            </button>
          )}
          <PeriodButton
            day={next}
            label={view === 'mese' ? 'Mese successivo' : 'Settimana successiva'}
            arrow="›"
            onGo={update}
          />
        </div>
      </div>

      {view === 'mese' ? <MonthGrid {...cell} /> : <WeekList {...cell} />}
      <p className={NOTE}>
        Un turno è un giorno, come nel calendario NBA: ogni squadra gioca circa una sera su due.
        {today !== null && ' In rosso oggi, il giorno che si gioca al prossimo passaggio di turno.'}
      </p>

      <section
        ref={panel}
        id={PANEL_ID}
        aria-labelledby={`${PANEL_ID}-titolo`}
        className="scroll-mt-[calc(var(--spazio-alto)+7rem)] space-y-3"
      >
        <SectionTitle aside={entry ? dayRoundLabel(entry) : undefined}>
          <span id={`${PANEL_ID}-titolo`}>{longDate(selected)}</span>
        </SectionTitle>
        {entry ? (
          <>
            {spoilerFree && <p className={NOTE}>Punteggi nascosti: ogni partita si guarda dal vivo.</p>}
            <GameList
              leagueId={id}
              label={`Partite di ${longDate(selected)}`}
              list={[...entry.games].sort(
                (a, b) => Number(isMine(b, featuredId)) - Number(isMine(a, featuredId)),
              )}
              games={data.games}
              series={series}
              code={code}
              mine={mine?.id ?? null}
              highlight={featuredId}
              spoilerFree={spoilerFree}
            />
            {featuredId !== null && !teamGame(entry, featuredId) && entry.kind === 'regular' && (
              <p className={NOTE}>{code(featuredId)} quel giorno riposa.</p>
            )}
            <p className={NOTE}>Prima la squadra in trasferta, poi quella di casa.</p>
            <Link to={`/lega/${id}/risultati/${entry.round}`} className={ROW_LINK}>
              Il giorno in Risultati ›
            </Link>
          </>
        ) : (
          <NoGames
            reason={breaks.get(selected) ?? null}
            next={nextGameDay(cal, selected)}
            onSelect={select}
          />
        )}
      </section>
    </div>
  );
}

interface CellProps {
  cal: ReadonlyMap<Day, CalendarDay>;
  /** Giorni di regular season senza partite, con il motivo. */
  breaks: ReadonlyMap<Day, string>;
  selected: Day;
  today: Day | null;
  featuredId: string | null;
  code: (teamId: string) => string;
  spoilerFree: boolean;
  onSelect: (day: Day) => void;
}

/** Il mese: sette colonne da lunedì, un riquadro per giorno; i giorni con partite si toccano. */
function MonthGrid(props: CellProps) {
  const { cal, breaks, selected, today } = props;
  return (
    <table className="w-full table-fixed border-separate border-spacing-0">
      <caption className="sr-only">Calendario di {periodTitle('mese', selected)}</caption>
      <thead>
        <tr>
          {WEEKDAY_HEADERS.map((h) => (
            <th
              key={h.name}
              scope="col"
              abbr={h.name}
              className="border-b-2 border-stampa-900 pb-1 font-titolo text-xs font-semibold tracking-wider text-stampa-700 uppercase dark:border-stampa-100 dark:text-stampa-200"
            >
              {h.short}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {monthWeeks(selected).map((week) => (
          <tr key={week.find((d) => d !== null)}>
            {week.map((day, i) => (
              <td
                key={day ?? `vuoto-${i}`}
                className="h-16 border-b border-stampa-200 p-0 align-top not-first:border-l sm:h-20 dark:border-stampa-700"
              >
                {day === null ? null : cal.has(day) ? (
                  <GameDayCell {...props} day={day} entry={cal.get(day) as CalendarDay} />
                ) : (
                  <span
                    className={`flex h-full p-1 font-titolo text-sm tabular-nums sm:p-1.5 ${
                      day === selected
                        ? 'bg-stampa-100 text-stampa-700 dark:bg-stampa-800 dark:text-stampa-200'
                        : 'text-stampa-500 dark:text-stampa-400'
                    }`}
                  >
                    <span className="flex min-w-0 flex-col gap-px">
                      {ymd(day).date}
                      {/* Pausa per l'All-Star, Thanksgiving...: il motivo, da sm in su */}
                      {breaks.has(day) && (
                        <span className="hidden truncate font-serif text-[0.6875rem] italic sm:block">
                          {breaks.get(day)}
                        </span>
                      )}
                    </span>
                    {breaks.has(day) && <span className="sr-only">, {breaks.get(day)}</span>}
                    {today === day && <span className="sr-only">, oggi</span>}
                  </span>
                )}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** Un giorno con partite nel mese: numero, avversaria della squadra in evidenza ed esito (o quante partite). */
function GameDayCell({
  day,
  entry,
  selected,
  today,
  featuredId,
  code,
  spoilerFree,
  onSelect,
}: CellProps & { day: Day; entry: CalendarDay }) {
  const on = day === selected;
  const isToday = day === today;
  const game = teamGame(entry, featuredId);
  const side = game && featuredId !== null ? teamSide(game, featuredId) : null;
  return (
    <button
      type="button"
      onClick={() => onSelect(day)}
      aria-pressed={on}
      aria-current={isToday ? 'date' : undefined}
      aria-controls={PANEL_ID}
      aria-label={dayAriaLabel(entry, featuredId, code, { spoilerFree, today: isToday })}
      className={`flex h-full w-full flex-col items-stretch gap-px p-1 text-left font-titolo leading-tight sm:p-1.5 ${
        on
          ? 'bg-stampa-900 text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900'
          : 'text-stampa-900 hover:bg-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-800'
      } ${isToday ? 'outline-2 -outline-offset-2 outline-rosso-600 dark:outline-rosso-400' : ''}`}
    >
      <span className="flex items-baseline justify-between gap-1">
        <span className="text-sm font-semibold tabular-nums">{ymd(day).date}</span>
        {isToday && (
          <span
            className={`text-[0.625rem] font-semibold tracking-wider uppercase ${
              on ? 'text-rosso-300 dark:text-rosso-700' : 'text-rosso-700 dark:text-rosso-300'
            }`}
          >
            oggi
          </span>
        )}
      </span>
      {side ? (
        <>
          <span className="truncate text-[0.6875rem] font-medium sm:text-xs">
            {side.home ? 'vs' : '@'} {code(side.opponentId)}
          </span>
          {side.result !== null &&
            (spoilerFree ? (
              <span className="text-[0.6875rem] sm:text-xs">✓</span>
            ) : (
              <span className="truncate text-[0.6875rem] tabular-nums sm:text-xs">
                <span className={side.result === 'V' ? 'font-bold' : 'font-normal'}>{side.result}</span>
                <span className="hidden sm:inline"> {side.score}</span>
              </span>
            ))}
        </>
      ) : featuredId !== null && entry.kind === 'regular' ? (
        <span
          className={`font-serif text-[0.6875rem] italic sm:text-xs ${on ? '' : 'text-stampa-600 dark:text-stampa-300'}`}
        >
          riposo
        </span>
      ) : (
        <span className={`text-[0.6875rem] sm:text-xs ${on ? '' : 'text-stampa-600 dark:text-stampa-300'}`}>
          {entry.games.length}
          <span className="hidden sm:inline"> partite</span>
        </span>
      )}
    </button>
  );
}

/** La settimana: una riga per giorno con la partita della squadra in evidenza, o quante partite ci sono. */
function WeekList(props: CellProps) {
  const { cal, breaks, selected, today, featuredId, code, spoilerFree, onSelect } = props;
  return (
    <ul
      aria-label={`Settimana: ${periodTitle('settimana', selected)}`}
      className="border-t-2 border-stampa-900 dark:border-stampa-100"
    >
      {weekOf(selected).map((day) => {
        const entry = cal.get(day);
        const on = day === selected;
        const isToday = day === today;
        const game = teamGame(entry, featuredId);
        const date = (
          <span className="flex w-12 shrink-0 flex-col items-center font-titolo leading-none">
            <span className="text-xs font-semibold tracking-wider uppercase">
              {WEEKDAY_HEADERS[weekday(day)]?.short}
            </span>
            <span className="text-2xl font-semibold tabular-nums">{ymd(day).date}</span>
          </span>
        );
        const row = `flex min-h-16 w-full items-center gap-3 border-b px-2 py-2 text-left ${
          on
            ? 'border-l-4 border-b-stampa-900 border-l-stampa-900 bg-stampa-25 dark:border-b-stampa-100 dark:border-l-stampa-100 dark:bg-stampa-800'
            : 'border-stampa-200 dark:border-stampa-700'
        }`;
        if (!entry)
          return (
            <li key={day} className={`${row} text-stampa-500 dark:text-stampa-400`}>
              {date}
              <span className="font-serif text-sm italic">
                {breaks.get(day) ?? 'nessuna partita'}
                {isToday && <span className="sr-only">, oggi</span>}
              </span>
            </li>
          );
        return (
          <li key={day}>
            <button
              type="button"
              onClick={() => onSelect(day)}
              aria-pressed={on}
              aria-current={isToday ? 'date' : undefined}
              aria-controls={PANEL_ID}
              aria-label={dayAriaLabel(entry, featuredId, code, { spoilerFree, today: isToday })}
              className={`${row} text-stampa-900 hover:bg-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-800`}
            >
              {date}
              <span className="min-w-0 flex-1">
                {game ? (
                  <ScoreLine game={game} code={code} hide={spoilerFree && game.homeScore !== null} />
                ) : featuredId !== null && entry.kind === 'regular' ? (
                  <span className="font-serif text-lg italic">{code(featuredId)} riposa</span>
                ) : (
                  <span className="font-titolo text-lg font-semibold">{entry.games.length} partite</span>
                )}
                <span className={`block ${NOTE}`}>
                  {dayRoundLabel(entry)}
                  {game || featuredId !== null ? ` · ${entry.games.length} partite` : ''}
                </span>
              </span>
              {isToday && (
                <span className="shrink-0 bg-rosso-600 px-1.5 py-px font-titolo text-xs font-semibold tracking-wider text-white uppercase dark:bg-rosso-500">
                  oggi
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Freccia per il mese o la settimana prima o dopo; fuori dalla stagione un segnaposto chiaro. */
function PeriodButton({
  day,
  label,
  arrow,
  onGo,
}: {
  day: Day | null;
  label: string;
  arrow: string;
  onGo: (changes: Record<string, string>) => void;
}) {
  const box = 'inline-flex size-11 shrink-0 items-center justify-center font-titolo text-2xl';
  if (day === null)
    return (
      <span aria-hidden="true" className={`${box} text-stampa-300 dark:text-stampa-600`}>
        {arrow}
      </span>
    );
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => onGo({ giorno: dayKey(day) })}
      className={`${box} text-stampa-900 hover:bg-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-800`}
    >
      {arrow}
    </button>
  );
}

/** Giorno senza partite: lo dice (con il motivo, se è una pausa della NBA) e porta al prossimo giorno con partite. */
function NoGames({
  reason,
  next,
  onSelect,
}: {
  reason: string | null;
  next: Day | null;
  onSelect: (day: Day) => void;
}) {
  return (
    <div className="space-y-1">
      <p className={NOTE}>{reason ? `${reason}: nessuna partita.` : 'Nessuna partita in questo giorno.'}</p>
      {next !== null && (
        <button type="button" onClick={() => onSelect(next)} className={ROW_LINK}>
          Prossime partite: {shortDate(next)} ›
        </button>
      )}
    </div>
  );
}
