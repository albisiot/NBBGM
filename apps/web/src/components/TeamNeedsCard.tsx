// Bisogni della squadra, sopra gli svincolati del mercato: ruoli scoperti e punti deboli della rotazione rispetto
// alla media della lega. Ogni bisogno è un pulsante a filo che applica i filtri degli svincolati (ruolo, ordinamento
// per l'abilità); quello acceso è pieno d'inchiostro e un secondo tocco lo spegne.
import type { Ratings, Role } from '@nbbgm/engine';
import { useId } from 'react';
import type { FreeAgentQuery } from '../lib/market.ts';
import { needActive } from '../lib/marketView.ts';
import { leagueSkillProfile, teamNeeds } from '../lib/teamNeeds.ts';
import { useAsync } from '../lib/useAsync.ts';
import { BOX, NOTE, PressButton } from './inkParts.tsx';

export function TeamNeedsCard({
  leagueId,
  roundId,
  roster,
  query,
  onPick,
}: {
  leagueId: string;
  /** La media della lega cambia solo con il turno (firme, scambi, crescita). */
  roundId: string | null;
  roster: readonly { id: string; role: Role; contractType: string | null; ratings: Ratings }[];
  /** Filtri attuali degli svincolati: dicono quale bisogno è acceso. */
  query: FreeAgentQuery;
  /** Filtri del bisogno toccato, o null per spegnerlo (tornano i filtri di base). */
  onPick: (q: Partial<FreeAgentQuery> | null) => void;
}) {
  const titleId = useId();
  const { data: league, loading } = useAsync(() => leagueSkillProfile(leagueId), [leagueId, roundId]);
  if (loading && !league) return null;
  const needs = teamNeeds(roster, league);
  const active = needs.find((n) => needActive(query, n));
  return (
    <section aria-labelledby={titleId} className={`${BOX} space-y-2 px-3 py-2.5`}>
      <h2 id={titleId} className="text-sm font-semibold tracking-wider">
        I bisogni della squadra
      </h2>
      {needs.length === 0 ? (
        <p className="text-sm">Ruoli coperti e nessun punto debole netto rispetto alla media della lega.</p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-1.5">
            {needs.map((n) => {
              const on = n === active;
              return (
                <li key={n.title}>
                  <PressButton pressed={on} onClick={() => onPick(on ? null : n.query)}>
                    {n.short}
                  </PressButton>
                </li>
              );
            })}
          </ul>
          <p className="text-sm" aria-live="polite">
            {active
              ? `${active.title}: ${active.detail.charAt(0).toLowerCase()}${active.detail.slice(1)}`
              : 'Tocca un bisogno per filtrare o ordinare gli svincolati; toccalo di nuovo per tornare all’elenco intero.'}
          </p>
        </>
      )}
      <p className={NOTE}>
        Ruoli: 3 PG, 3 SG, 3 SF, 2 PF e 2 C come ruolo principale. Punti deboli: gli 8 della tua rotazione
        contro la media delle rotazioni della lega, per gruppi di abilità.
      </p>
    </section>
  );
}
