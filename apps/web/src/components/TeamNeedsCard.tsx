// Bisogni della squadra, sopra gli svincolati del mercato: ruoli scoperti e punti deboli della rotazione rispetto
// alla media della lega. Ogni bisogno applica i filtri degli svincolati (ruolo, ordinamento per l'abilità).
import type { Ratings, Role } from '@nbbgm/engine';
import type { FreeAgentQuery } from '../lib/market.ts';
import { leagueSkillProfile, teamNeeds } from '../lib/teamNeeds.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Card } from './ui.tsx';

export function TeamNeedsCard({
  leagueId,
  roundId,
  roster,
  onPick,
}: {
  leagueId: string;
  /** La media della lega cambia solo con il turno (firme, scambi, crescita). */
  roundId: string | null;
  roster: readonly { id: string; role: Role; contractType: string | null; ratings: Ratings }[];
  onPick: (q: Partial<FreeAgentQuery>) => void;
}) {
  const { data: league, loading } = useAsync(() => leagueSkillProfile(leagueId), [leagueId, roundId]);
  if (loading && !league) return null;
  const needs = teamNeeds(roster, league);
  return (
    <Card className="space-y-2 !p-4">
      <h2 className="font-semibold">Bisogni della squadra</h2>
      {needs.length === 0 ? (
        <p className="text-sm text-stampa-500 dark:text-stampa-400">
          Ruoli coperti e nessun punto debole netto rispetto alla media della lega.
        </p>
      ) : (
        <ul className="grid gap-2 sm:grid-cols-2">
          {needs.map((n) => (
            <li key={n.title}>
              <button
                type="button"
                onClick={() => onPick(n.query)}
                className="flex min-h-11 w-full flex-col items-start rounded-lg border border-stampa-200 px-3 py-2 text-left hover:border-rosso-400 dark:border-stampa-700"
              >
                <span className="text-sm font-semibold">
                  {n.kind === 'role' ? n.title : `Punto debole: ${n.title.toLowerCase()}`}
                </span>
                <span className="text-xs text-stampa-600 dark:text-stampa-300">{n.detail}</span>
                <span className="text-xs font-semibold text-rosso-700 dark:text-rosso-300">
                  Cerca tra gli svincolati →
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-stampa-500 dark:text-stampa-400">
        Ruoli: 3 PG, 3 SG, 3 SF, 2 PF e 2 C come ruolo principale. Punti deboli: gli 8 della tua rotazione
        contro la media delle rotazioni della lega, per gruppi di abilità.
      </p>
    </Card>
  );
}
