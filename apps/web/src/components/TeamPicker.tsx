// Scelta della squadra: le 30 squadre divise per conference e division, quelle già prese non si scelgono. La scelta
// ha il bordo d'inchiostro doppio e la sigla piena, come la propria squadra nelle altre pagine.
import { TEAMS } from '@nbbgm/engine';
import { TeamCode } from './ui.tsx';

const CONFERENCES = [
  { id: 'East', label: 'Eastern Conference', divisions: ['Atlantic', 'Central', 'Southeast'] },
  { id: 'West', label: 'Western Conference', divisions: ['Northwest', 'Pacific', 'Southwest'] },
] as const;

export function TeamPicker({
  value,
  onChange,
  taken = [],
}: {
  value: string | null;
  onChange: (code: string) => void;
  taken?: readonly string[];
}) {
  return (
    <div className="grid gap-5 md:grid-cols-2">
      {CONFERENCES.map((conf) => (
        <div key={conf.id}>
          <h3 className="border-b border-stampa-900 pb-0.5 font-titolo text-sm font-semibold tracking-wider uppercase dark:border-stampa-100">
            {conf.label}
          </h3>
          {conf.divisions.map((division) => (
            <div key={division} className="mt-2">
              <p className="font-titolo text-xs font-semibold tracking-wider text-stampa-600 uppercase dark:text-stampa-300">
                {division}
              </p>
              <div className="mt-1 grid grid-cols-1 gap-1 sm:grid-cols-2">
                {TEAMS.filter((t) => t.division === division).map((t) => {
                  const isTaken = taken.includes(t.id);
                  const selected = value === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      disabled={isTaken}
                      onClick={() => onChange(t.id)}
                      aria-pressed={selected}
                      className={`flex min-h-11 items-center gap-2 rounded-sm border px-2 py-1.5 text-left text-[0.95rem] ${
                        selected
                          ? 'border-stampa-900 bg-stampa-25 font-semibold ring-1 ring-stampa-900 dark:border-stampa-100 dark:bg-stampa-800 dark:ring-stampa-100'
                          : 'border-stampa-300 hover:border-stampa-900 dark:border-stampa-600 dark:hover:border-stampa-300'
                      } ${isTaken ? 'cursor-not-allowed opacity-50' : ''}`}
                    >
                      <TeamCode code={t.id} strong={selected} />
                      <span className="min-w-0 truncate">
                        {t.fullName}
                        {isTaken && <span className="block text-[0.8125rem] italic">già presa</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
