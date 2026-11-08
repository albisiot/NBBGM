// Pannelli dal basso della pagina Squadra (stile Edicola): il cambio di un titolare e le tattiche con l'allenatore.
// Le regole sono quelle di sempre: chi è già in campo si scambia di posto, gli infortunati non si scelgono, la
// delega all'allenatore si salva subito come prima.
import { PHILOSOPHY_LABEL, SLOT_ROLES, type Role, type Tactics } from '@nbbgm/engine';
import { coachFullName, type CoachInfo } from '../lib/coaches.ts';
import { useState } from 'react';
import {
  candidateNote,
  coachUntilText,
  courtNote,
  ROLE_NAME,
  rolesText,
  slotPenalty,
  TACTIC_LEGEND,
  TACTIC_NOTES,
  type CourtPlayer,
  type SlotCandidate,
} from '../lib/court.ts';
import { TACTIC_OPTIONS, type CoachDelegation } from '../lib/roster.ts';
import { Button, Sheet } from './ui.tsx';

/** Voto in un quadratino: d'inchiostro, grigio per chi non si può scegliere. */
function Rating({ value, muted = false }: { value: number; muted?: boolean }) {
  return (
    <span
      className={`size-8 shrink-0 text-center font-titolo text-[0.95rem] leading-8 font-bold ${
        muted
          ? 'bg-stampa-300 text-stampa-900 dark:bg-stampa-600 dark:text-stampa-50'
          : 'bg-stampa-900 text-stampa-25 dark:bg-stampa-50 dark:text-stampa-900'
      }`}
    >
      {value}
    </span>
  );
}

function TwoWayTag() {
  return (
    <span className="ml-1 border border-current px-[3px] align-[2px] font-titolo text-[0.6875rem] font-semibold">
      2W
    </span>
  );
}

/** Chi gioca nello slot: prima chi è nel ruolo, poi gli altri con la penalità del fuori ruolo. */
export function StarterSheet<P extends CourtPlayer>({
  slot,
  current,
  candidates,
  ovrOf,
  onPick,
  onClose,
}: {
  slot: number;
  current: P | null;
  candidates: readonly SlotCandidate<P>[];
  ovrOf: (id: string) => number;
  onPick: (playerId: string) => void;
  onClose: () => void;
}) {
  const role = SLOT_ROLES[slot] as Role;
  const row =
    'flex min-h-[3.625rem] w-full items-center gap-2.5 border-b border-stampa-200 dark:border-stampa-700';
  const currentNote = current ? courtNote(current, role) : null;
  return (
    <Sheet kicker="Cambia il titolare" title={`Chi gioca da ${ROLE_NAME[role]}?`} onClose={onClose}>
      <p className="text-sm text-stampa-600 italic dark:text-stampa-300">
        Prima chi è nel ruolo, poi gli altri. Chi è già in campo si scambia di posto; gli infortunati non si
        scelgono.
      </p>
      <ul className="border-t-2 border-stampa-900 dark:border-stampa-100">
        {current && (
          <li className={`${row} text-stampa-600 dark:text-stampa-300`}>
            <Rating value={ovrOf(current.id)} muted />
            <span className="min-w-0 flex-1">
              <span className={`block font-bold ${current.injury ? 'line-through' : ''}`}>
                {current.firstName} {current.lastName}
                {current.contractType === 'two-way' && <TwoWayTag />}
              </span>
              <span
                className={`text-[0.8125rem] italic ${
                  currentNote?.kind === 'injured' || currentNote?.kind === 'role'
                    ? 'text-rosso-700 dark:text-rosso-300'
                    : ''
                }`}
              >
                {rolesText(current)} ·{' '}
                {currentNote?.kind === 'injured'
                  ? currentNote.voice
                  : slotPenalty(current, role) > 0
                    ? `fuori ruolo, −${slotPenalty(current, role)}%`
                    : 'nel ruolo'}
              </span>
            </span>
            <span className="font-titolo text-xs font-semibold tracking-widest uppercase">Adesso</span>
          </li>
        )}
        {candidates.map((c) => {
          const note = candidateNote(c);
          const p = c.player;
          return (
            <li key={p.id}>
              <button
                type="button"
                onClick={() => onPick(p.id)}
                className={`${row} text-left hover:bg-stampa-100 dark:hover:bg-stampa-700`}
              >
                <Rating value={ovrOf(p.id)} />
                <span className="min-w-0 flex-1">
                  <span className="block font-bold">
                    {p.firstName} {p.lastName}
                    {p.contractType === 'two-way' && <TwoWayTag />}
                  </span>
                  <span
                    className={`text-[0.8125rem] italic ${
                      note.alert
                        ? 'text-rosso-700 dark:text-rosso-300'
                        : 'text-stampa-600 dark:text-stampa-300'
                    }`}
                  >
                    {note.text}
                  </span>
                </span>
                <span aria-hidden="true" className="pr-1 font-titolo text-xl">
                  ›
                </span>
              </button>
            </li>
          );
        })}
      </ul>
      {candidates.length === 0 && (
        <p className="text-sm italic">Nessun altro disponibile: gli altri sono infortunati.</p>
      )}
      <Button variant="secondary" className="w-full" onClick={onClose}>
        Annulla
      </Button>
    </Sheet>
  );
}

type CoachUntil = 'round' | 'phase' | 'date' | 'forever';

/** Ritmo, attacco, difesa e intensità come scelte affiancate, con l'effetto sotto; poi l'allenatore. */
export function TacticsSheet({
  tactics,
  onTactics,
  coach,
  headCoach,
  roundNumber,
  onCoach,
  onClose,
}: {
  tactics: Tactics;
  onTactics: (t: Tactics) => void;
  coach: CoachDelegation | null;
  /** Il capo allenatore della squadra, null nelle leghe senza allenatori. */
  headCoach: CoachInfo | null;
  roundNumber: number | null;
  onCoach: (c: CoachDelegation) => Promise<void>;
  onClose: () => void;
}) {
  return (
    <Sheet kicker="La formazione" title="Tattiche" onClose={onClose}>
      {TACTIC_OPTIONS.map((t) => {
        const value = tactics[t.key];
        return (
          <fieldset key={t.key} className="space-y-1">
            <legend className="pb-1 font-titolo text-[0.8125rem] font-semibold tracking-widest uppercase">
              {TACTIC_LEGEND[t.key]}
            </legend>
            <div
              className={`grid border border-stampa-900 dark:border-stampa-100 ${
                t.options.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
              }`}
            >
              {t.options.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  aria-pressed={value === o.value}
                  onClick={() => onTactics({ ...tactics, [t.key]: o.value } as Tactics)}
                  className={`min-h-11 px-1 font-titolo text-sm font-semibold tracking-wider uppercase ${
                    i > 0 ? 'border-l border-stampa-900 dark:border-stampa-100' : ''
                  } ${
                    value === o.value
                      ? 'bg-stampa-900 text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900'
                      : 'hover:bg-stampa-100 dark:hover:bg-stampa-700'
                  }`}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <p className="text-[0.8125rem] text-stampa-600 italic dark:text-stampa-300">
              {(TACTIC_NOTES[t.key] as Record<string, string>)[value]}
            </p>
          </fieldset>
        );
      })}
      <CoachSection coach={coach} headCoach={headCoach} roundNumber={roundNumber} onChange={onCoach} />
      <Button className="w-full" onClick={onClose}>
        Fatto
      </Button>
    </Sheet>
  );
}

/** Affida all'allenatore con la durata, o riprendi la squadra: si salva subito, come prima. */
function CoachSection({
  coach,
  headCoach,
  roundNumber,
  onChange,
}: {
  coach: CoachDelegation | null;
  headCoach: CoachInfo | null;
  roundNumber: number | null;
  onChange: (c: CoachDelegation) => Promise<void>;
}) {
  const [until, setUntil] = useState<CoachUntil>('forever');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);
  const active = coach?.active ?? false;

  async function run(c: CoachDelegation) {
    setBusy(true);
    await onChange(c);
    setBusy(false);
  }

  const field =
    'min-h-11 border border-stampa-900 bg-stampa-25 px-2 text-sm font-semibold dark:border-stampa-100 dark:bg-stampa-800';
  return (
    <section
      aria-labelledby="allenatore-titolo"
      className="space-y-2 border-t-2 border-stampa-900 pt-2 dark:border-stampa-100"
    >
      <h3
        id="allenatore-titolo"
        className="font-titolo text-[0.95rem] font-semibold tracking-wider uppercase"
      >
        Allenatore
      </h3>
      {active && coach ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold">Squadra affidata all'allenatore {coachUntilText(coach)}.</p>
          <Button variant="secondary" disabled={busy} onClick={() => void run({ ...coach, active: false })}>
            Riprendi la squadra
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center gap-2.5 text-sm">
            <span className="flex-1 text-stampa-600 dark:text-stampa-300">Durata</span>
            <select value={until} onChange={(e) => setUntil(e.target.value as CoachUntil)} className={field}>
              <option value="forever">Finché non la riprendo</option>
              <option value="round">Solo per questo turno</option>
              <option value="phase">Fino alla fine della fase</option>
              <option value="date">Fino a una data</option>
            </select>
          </label>
          {until === 'date' && (
            <label className="flex items-center gap-2.5 text-sm">
              <span className="flex-1 text-stampa-600 dark:text-stampa-300">Fino al</span>
              <input
                type="datetime-local"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className={field}
              />
            </label>
          )}
          <Button
            variant="secondary"
            className="w-full"
            disabled={busy || (until === 'date' && !date)}
            onClick={() =>
              void run({
                active: true,
                untilRound: until === 'round' ? (roundNumber ?? 0) : null,
                untilAt: until === 'date' && date ? new Date(date).toISOString() : null,
                untilPhaseEnd: until === 'phase',
              })
            }
          >
            Affida all'allenatore
          </Button>
        </div>
      )}
      <p className="text-[0.8125rem] leading-snug text-stampa-600 italic dark:text-stampa-300">
        {headCoach
          ? `${coachFullName(headCoach)} fa quintetto, minuti e tattiche come Auto, con la sua idea di gioco (${PHILOSOPHY_LABEL[headCoach.philosophy]}): le tattiche qui sopra non contano finché la squadra è sua. `
          : 'Fa quintetto e minuti come Auto, con queste tattiche. '}
        La squadra risulta pronta da sola a ogni turno. Non fa mercato e si ferma quando c'è una decisione da
        prendere.
      </p>
    </section>
  );
}
