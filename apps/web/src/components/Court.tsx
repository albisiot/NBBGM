// Formazione sul campo della pagina Squadra (stile Edicola): il quintetto disposto su mezzo campo, il riquadro del
// giocatore scelto con i minuti e la panchina. Le regole (posti, nomi lunghi, problemi) stanno in lib/court.ts.
import { BODY_PART_LABEL, SLOT_ROLES, TWO_WAY_GAME_LIMIT, type BodyPart, type Role } from '@nbbgm/engine';
import type { CSSProperties } from 'react';
import { Link } from 'react-router';
import {
  benchLabel,
  benchNote,
  boxRole,
  COURT_SPOTS,
  courtLabel,
  courtName,
  courtNote,
  gamesText,
  isTired,
  ROLE_NAME,
  rolesText,
  slotPenalty,
  TIRED_BELOW,
  twoWayGames,
  type CourtNoteKind,
  type CourtPlayer,
} from '../lib/court.ts';
import { SectionTitle } from './ui.tsx';

/** Righe rosa sottili sul fondo dei riquadri degli infortunati, come un ritaglio barrato. */
const STRIPES =
  'bg-[repeating-linear-gradient(135deg,var(--color-stampa-25)_0_6px,var(--color-rosso-100)_6px_8px)] dark:bg-[repeating-linear-gradient(135deg,var(--color-stampa-900)_0_6px,var(--color-rosso-950)_6px_8px)]';

/** Bordo del riquadro: il rosso solo per i problemi (pieno l'infortunio, tratteggiato il fuori ruolo). */
function boxBorder(kind: CourtNoteKind | null, selected: boolean): string {
  if (kind === 'injured') return 'border-2 border-rosso-600 dark:border-rosso-300';
  if (kind === 'role') return 'border-2 border-dashed border-rosso-600 dark:border-rosso-300';
  if (kind === 'tired') return 'border border-rosso-600 dark:border-rosso-300';
  return selected
    ? 'border border-stampa-900 dark:border-stampa-50'
    : 'border border-stampa-900 dark:border-stampa-400';
}

/** Il quintetto sul mezzo campo: cinque pulsanti al loro posto, sopra le linee disegnate. */
export function Court({
  starters,
  ovrOf,
  minutes,
  selectedId,
  onSelect,
  onEmpty,
  className = '',
}: {
  /** I titolari negli slot PG, SG, SF, PF, C (null se lo slot è vuoto). */
  starters: readonly (CourtPlayer | null)[];
  ovrOf: (id: string) => number;
  minutes: Readonly<Record<string, number>>;
  selectedId: string | null;
  onSelect: (playerId: string) => void;
  /** Uno slot senza titolare: si apre il cambio. */
  onEmpty: (slot: number) => void;
  className?: string;
}) {
  return (
    <section
      aria-label="Quintetto sul campo"
      className={`relative h-[18.5rem] overflow-hidden border border-stampa-900 bg-stampa-25 dark:border-stampa-600 dark:bg-stampa-800 ${className}`}
    >
      {/* Linee del campo, solo decorazione: area, lunetta, arco da tre, tabellone e ferro in alto */}
      <svg
        aria-hidden="true"
        viewBox="0 0 356 224"
        className="absolute inset-x-0 top-0 h-auto w-full text-stampa-400 dark:text-stampa-600"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        {/* Lo spessore resta 1,5 px anche quando il campo si allarga o si stringe */}
        <path d="M131 0 V130 H227 V0" vectorEffect="non-scaling-stroke" />
        <path d="M131 130 A48 48 0 0 0 227 130" vectorEffect="non-scaling-stroke" />
        <path d="M131 130 A48 48 0 0 1 227 130" strokeDasharray="5 6" vectorEffect="non-scaling-stroke" />
        <path d="M24 0 V56 A157 157 0 0 0 334 56 V0" vectorEffect="non-scaling-stroke" />
        <path d="M159 18 H199" vectorEffect="non-scaling-stroke" />
        <circle cx="179" cy="28" r="7" vectorEffect="non-scaling-stroke" />
      </svg>
      {/* Cerchio di metà campo, in fondo */}
      <svg
        aria-hidden="true"
        viewBox="0 0 72 36"
        className="absolute bottom-0 left-1/2 h-9 w-[4.5rem] -translate-x-1/2 text-stampa-400 dark:text-stampa-600"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
      >
        <path d="M1 36 A35 35 0 0 1 71 36" />
      </svg>
      {SLOT_ROLES.map((slot, i) => {
        const p = starters[i] ?? null;
        const spot = COURT_SPOTS[i] ?? {};
        if (!p)
          return (
            <button
              key={slot}
              type="button"
              aria-label={courtLabel(slot, null, 0, 0)}
              aria-haspopup="dialog"
              onClick={() => onEmpty(i)}
              style={spot}
              className="absolute flex min-h-11 w-[6.5rem] flex-col gap-[3px] border-2 border-dashed border-rosso-600 bg-stampa-50 px-1.5 py-[5px] text-left text-stampa-900 dark:border-rosso-300 dark:bg-stampa-900 dark:text-stampa-50"
            >
              <span className="font-titolo text-sm leading-[1.1] font-semibold uppercase">Manca</span>
              <span className="text-[0.8125rem] text-rosso-700 italic dark:text-rosso-300">
                {slot} · scegli
              </span>
            </button>
          );
        return (
          <CourtBox
            key={slot}
            slot={slot}
            player={p}
            ovr={ovrOf(p.id)}
            minutes={minutes[p.id] ?? 0}
            selected={p.id === selectedId}
            style={spot}
            onClick={() => onSelect(p.id)}
          />
        );
      })}
    </section>
  );
}

function CourtBox({
  slot,
  player: p,
  ovr,
  minutes,
  selected,
  style,
  onClick,
}: {
  slot: Role;
  player: CourtPlayer;
  ovr: number;
  minutes: number;
  selected: boolean;
  style: CSSProperties;
  onClick: () => void;
}) {
  const name = courtName(p.lastName);
  const note = courtNote(p, slot);
  const kind = note?.kind ?? null;
  const injured = kind === 'injured';
  const surface = selected
    ? 'bg-stampa-900 text-stampa-25 ring-1 ring-stampa-900 ring-offset-3 ring-offset-stampa-25 dark:bg-stampa-50 dark:text-stampa-900 dark:ring-stampa-50 dark:ring-offset-stampa-800'
    : injured
      ? `${STRIPES} text-stampa-900 dark:text-stampa-50`
      : 'bg-stampa-50 text-stampa-900 dark:bg-stampa-900 dark:text-stampa-50';
  const chip = selected
    ? 'bg-stampa-25 text-stampa-900 dark:bg-stampa-900 dark:text-stampa-50'
    : injured
      ? 'bg-stampa-500 text-stampa-25 dark:bg-stampa-400 dark:text-stampa-900'
      : 'bg-stampa-900 text-stampa-25 dark:bg-stampa-50 dark:text-stampa-900';
  const soft = selected ? 'text-stampa-200 dark:text-stampa-600' : 'text-stampa-600 dark:text-stampa-400';
  const red = selected ? 'text-rosso-300 dark:text-rosso-700' : 'text-rosso-700 dark:text-rosso-300';
  const nameSize = name.size === 14 ? 'text-sm' : name.size === 13 ? 'text-[0.8125rem]' : 'text-xs';
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={courtLabel(slot, p, ovr, minutes)}
      onClick={onClick}
      style={style}
      className={`absolute flex min-h-11 w-[6.5rem] flex-col gap-[3px] px-1.5 py-[5px] text-left ${boxBorder(kind, selected)} ${surface}`}
    >
      <span className="flex items-start justify-between gap-1">
        <span
          className={`min-w-0 font-titolo leading-[1.15] font-semibold break-words uppercase ${nameSize} ${injured ? 'line-through' : ''}`}
        >
          {name.lines.map((line, i) => (
            <span key={i} className="block">
              {line}
            </span>
          ))}
        </span>
        {p.contractType === 'two-way' && (
          <span className="shrink-0 border border-current px-[3px] font-titolo text-[0.6875rem] leading-tight font-semibold">
            2W
          </span>
        )}
      </span>
      <span className="flex items-center gap-[5px]">
        <span
          className={`h-5 w-6 shrink-0 text-center font-titolo text-[0.8125rem] leading-5 font-bold ${chip}`}
        >
          {ovr}
        </span>
        <span className={`text-[0.8125rem] italic ${soft}`}>{`${boxRole(p, slot)} · ${minutes}′`}</span>
      </span>
      {note &&
        (note.kind === 'injured' || note.kind === 'role' ? (
          <span className={`font-titolo text-xs leading-tight font-semibold tracking-wide uppercase ${red}`}>
            {note.text}
          </span>
        ) : (
          <span className={`text-[0.8125rem] leading-tight italic ${note.kind === 'tired' ? red : soft}`}>
            {note.text}
          </span>
        ))}
    </button>
  );
}

/** Barra dell'energia: d'inchiostro, rossa sotto 75. Il numero sta accanto, la barra è solo un disegno. */
export function EnergyBar({ value }: { value: number }) {
  const tired = value < TIRED_BELOW;
  return (
    <span
      aria-hidden="true"
      className="inline-block h-1.5 w-12 bg-stampa-200 align-middle dark:bg-stampa-700"
    >
      <span
        className={`block h-full ${tired ? 'bg-rosso-600 dark:bg-rosso-300' : 'bg-stampa-900 dark:bg-stampa-100'}`}
        style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
      />
    </span>
  );
}

/** Il riquadro sotto il campo: il giocatore scelto, i suoi minuti con − e +, il cambio e la scheda. */
export function PlayerPanel({
  player: p,
  ovr,
  minutes,
  slot,
  playerHref,
  onMinutes,
  onChange,
  className = '',
}: {
  player: CourtPlayer;
  ovr: number;
  minutes: number;
  /** Lo slot se è titolare, o null se è in panchina. */
  slot: Role | null;
  playerHref: string;
  onMinutes: (m: number) => void;
  /** Apre il cambio del titolare (solo per chi è in campo). */
  onChange: () => void;
  className?: string;
}) {
  const tired = isTired(p);
  const penalty = slot ? slotPenalty(p, slot) : 0;
  const games = twoWayGames(p);
  const fullName = `${p.firstName} ${p.lastName}`;
  const red = 'text-rosso-700 dark:text-rosso-300';
  const link =
    'flex min-h-11 flex-1 items-center justify-center px-2 text-sm font-semibold italic underline underline-offset-4 hover:bg-stampa-100 dark:hover:bg-stampa-700';
  return (
    <section
      aria-label="Giocatore scelto"
      className={`border-2 border-stampa-900 bg-stampa-25 dark:border-stampa-50 dark:bg-stampa-800 ${className}`}
    >
      <div className="flex items-center gap-2 py-1.5 pr-1.5 pl-3">
        <div className="min-w-0 flex-1">
          <p className="font-titolo text-base leading-tight font-bold break-words uppercase">{fullName}</p>
          <p className="text-[0.8125rem] text-stampa-600 italic dark:text-stampa-400">
            {rolesText(p)} · {ovr} · <span className={tired ? red : ''}>energia {Math.round(p.energy)}</span>{' '}
            <EnergyBar value={p.energy} />
          </p>
          {slot && (
            <p
              className={`text-[0.8125rem] italic ${penalty > 0 ? red : 'text-stampa-600 dark:text-stampa-400'}`}
            >
              {penalty > 0
                ? `Gioca da ${ROLE_NAME[slot]}: fuori ruolo, −${penalty}%`
                : `Titolare da ${ROLE_NAME[slot]}`}
            </p>
          )}
          {p.injury && (
            <p className={`text-[0.8125rem] italic ${red}`}>
              Infortunato ({BODY_PART_LABEL[p.injury.bodyPart as BodyPart] ?? p.injury.bodyPart}), fuori{' '}
              {gamesText(p.injury.gamesRemaining)}
            </p>
          )}
          {p.contractType === 'two-way' && (
            <p className="text-[0.8125rem] text-stampa-600 italic dark:text-stampa-400">
              Two-way{games !== null ? `: ${games} partite su ${TWO_WAY_GAME_LIMIT}` : ''}
            </p>
          )}
        </div>
        <button
          type="button"
          aria-label={`Meno minuti a ${p.lastName}`}
          disabled={minutes <= 0}
          onClick={() => onMinutes(minutes - 1)}
          className="inline-flex size-11 shrink-0 items-center justify-center border border-stampa-900 font-titolo text-xl font-semibold hover:bg-stampa-100 disabled:opacity-40 dark:border-stampa-50 dark:hover:bg-stampa-700"
        >
          −
        </button>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          max={48}
          aria-label={`Minuti di ${fullName}`}
          value={minutes}
          onChange={(e) => onMinutes(Number(e.target.value))}
          // 22 px anche su telefono: sopra i 16 px Safari non ingrandisce la pagina (regola dei campi in index.css)
          style={{ fontSize: '1.375rem' }}
          className="h-11 w-12 shrink-0 border-b border-stampa-300 bg-transparent text-center font-titolo font-bold [appearance:textfield] dark:border-stampa-600 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
        />
        <button
          type="button"
          aria-label={`Più minuti a ${p.lastName}`}
          disabled={minutes >= 48}
          onClick={() => onMinutes(minutes + 1)}
          className="inline-flex size-11 shrink-0 items-center justify-center bg-stampa-900 font-titolo text-xl font-semibold text-stampa-25 hover:bg-stampa-700 disabled:opacity-40 dark:bg-stampa-50 dark:text-stampa-900 dark:hover:bg-stampa-100"
        >
          +
        </button>
      </div>
      <div className="flex border-t border-stampa-300 dark:border-stampa-600">
        {slot && (
          <button type="button" aria-haspopup="dialog" onClick={onChange} className={link}>
            Cambia giocatore
          </button>
        )}
        <Link
          to={playerHref}
          className={`${link} ${slot ? 'border-l border-stampa-300 dark:border-stampa-600' : ''}`}
        >
          Scheda
        </Link>
      </div>
    </section>
  );
}

/** La panchina: pulsanti a filo, toccandone uno diventa il giocatore scelto (per cambiargli i minuti). */
export function Bench({
  players,
  minutes,
  selectedId,
  onSelect,
  className = '',
}: {
  players: readonly CourtPlayer[];
  minutes: Readonly<Record<string, number>>;
  selectedId: string | null;
  onSelect: (playerId: string) => void;
  className?: string;
}) {
  return (
    <section aria-label="A disposizione" className={className}>
      <SectionTitle aside="tocca per i minuti">A disposizione</SectionTitle>
      {players.length === 0 ? (
        <p className="mt-2 text-sm text-stampa-600 italic dark:text-stampa-300">Nessuno in panchina.</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {players.map((p) => {
            const m = minutes[p.id] ?? 0;
            const note = benchNote(p);
            const selected = p.id === selectedId;
            const border = selected
              ? 'border-stampa-900 bg-stampa-900 text-stampa-25 dark:border-stampa-50 dark:bg-stampa-50 dark:text-stampa-900'
              : note?.alert
                ? 'border-rosso-600 hover:bg-stampa-100 dark:border-rosso-300 dark:hover:bg-stampa-800'
                : 'border-stampa-900 hover:bg-stampa-100 dark:border-stampa-400 dark:hover:bg-stampa-800';
            const red = selected
              ? 'text-rosso-300 dark:text-rosso-700'
              : 'text-rosso-700 dark:text-rosso-300';
            return (
              <li key={p.id}>
                <button
                  type="button"
                  aria-pressed={selected}
                  aria-label={benchLabel(p, m)}
                  onClick={() => onSelect(p.id)}
                  className={`inline-flex min-h-11 items-center gap-1.5 border px-2.5 ${border}`}
                >
                  <span
                    className={`font-titolo text-sm font-semibold uppercase ${p.injury ? 'line-through' : ''}`}
                  >
                    {p.lastName}
                  </span>
                  <span className={`text-[0.8125rem] italic ${note?.alert ? red : ''}`}>
                    {`${m}′${note ? ` · ${note.text}` : ''}`}
                  </span>
                  {p.contractType === 'two-way' && (
                    <span className="border border-current px-[3px] font-titolo text-[0.6875rem] leading-tight font-semibold">
                      2W
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
