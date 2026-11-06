// Scelta della squadra: le 30 squadre divise per conference e division, quelle già prese non si scelgono.
import { TEAMS } from '@nbbgm/engine';

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
    <div className="grid gap-4 md:grid-cols-2">
      {CONFERENCES.map((conf) => (
        <div key={conf.id}>
          <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            {conf.label}
          </h3>
          {conf.divisions.map((division) => (
            <div key={division} className="mt-2">
              <p className="text-xs text-slate-500 dark:text-slate-500">{division}</p>
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
                      className={`flex min-h-11 items-center gap-2 rounded-lg border px-2 py-1.5 text-left text-sm ${
                        selected
                          ? 'border-orange-500 bg-orange-50 font-semibold dark:bg-orange-950'
                          : 'border-slate-200 hover:border-slate-400 dark:border-slate-700'
                      } ${isTaken ? 'cursor-not-allowed opacity-40' : ''}`}
                    >
                      <span className="w-10 shrink-0 rounded bg-slate-100 px-1 text-center text-xs font-bold text-slate-700 dark:bg-slate-700 dark:text-slate-200">
                        {t.id}
                      </span>
                      <span className="truncate">
                        {t.fullName}
                        {isTaken && <span className="block text-xs font-normal">già presa</span>}
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
