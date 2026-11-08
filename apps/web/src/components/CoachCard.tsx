// Scheda di un allenatore nello stile Edicola: idea di gioco con quello che vuole, carattere, le tre qualità in stelle
// e il contratto. La usano la pagina della squadra e il mercato (allenatore di adesso e liberi).
import { PHILOSOPHY_LABEL, PHILOSOPHY_TEXT, coachStars } from '@nbbgm/engine';
import type { ReactNode } from 'react';
import {
  coachContractText,
  coachFullName,
  coachGrades,
  coachOverallStars,
  traitsText,
  type CoachInfo,
} from '../lib/coaches.ts';
import { millions } from '../lib/market.ts';
import { GradeRow, META, NOTE } from './inkParts.tsx';
import { Leader, Tag } from './ui.tsx';

/** Stelle piene e vuote, lette come "3 stelle su 5". */
export function Stars({ n }: { n: number }) {
  return (
    <>
      <span aria-hidden="true" className="tracking-wider">
        {'★'.repeat(n)}
        <span className="text-stampa-300 dark:text-stampa-600">{'☆'.repeat(5 - n)}</span>
      </span>
      <span className="sr-only">
        {n} {n === 1 ? 'stella' : 'stelle'} su 5
      </span>
    </>
  );
}

const toneOf = (n: number): 'top' | 'mid' | 'low' => (n >= 4 ? 'top' : n <= 2 ? 'low' : 'mid');

/**
 * Scheda intera. contract: il contratto da mostrare (quello firmato o la richiesta di un libero), con la sua etichetta;
 * children: azioni o note in fondo.
 */
export function CoachCard({
  coach,
  contract,
  children,
}: {
  coach: CoachInfo;
  contract?: { label: string; salaries: readonly number[] };
  children?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div>
        <p className="font-titolo text-lg leading-tight font-semibold">{coachFullName(coach)}</p>
        <p className={META}>
          {coach.age} anni · {coach.nationality}
          {coach.since !== null && coach.teamId !== null ? ` · in panchina dal ${coach.since}` : ''}
        </p>
      </div>
      <div>
        <p className="text-sm">
          Idea di gioco: <b>{PHILOSOPHY_LABEL[coach.philosophy]}</b>
        </p>
        <p className={NOTE}>{PHILOSOPHY_TEXT[coach.philosophy]}</p>
      </div>
      <ul className="flex flex-wrap gap-1.5" aria-label="Carattere">
        {traitsText(coach.traits).map((t) => (
          <li key={t}>
            <Tag tone="outline">{t}</Tag>
          </li>
        ))}
      </ul>
      <div>
        {coachGrades(coach).map((g) => (
          <GradeRow key={g.key} label={g.label} value={<Stars n={g.stars} />} tone={toneOf(g.stars)} />
        ))}
        <GradeRow
          label={<b>Valutazione</b>}
          value={<Stars n={coachOverallStars(coach)} />}
          tone={toneOf(coachOverallStars(coach))}
        />
      </div>
      {contract && (
        <div className="text-sm">
          <Leader label={contract.label} value={<b>{coachContractText(contract.salaries, millions)}</b>} />
        </div>
      )}
      {children}
    </div>
  );
}

/** Riga compatta di un allenatore per gli elenchi: nome, idea di gioco, età e la valutazione in stelle. */
export function CoachLine({ coach, aside }: { coach: CoachInfo; aside?: ReactNode }) {
  return (
    <div className="min-w-0 flex-1">
      <p className="truncate font-bold">{coachFullName(coach)}</p>
      <p className={META}>
        {PHILOSOPHY_LABEL[coach.philosophy]} · {coach.age} anni · Tattica{' '}
        <Stars n={coachStars(coach.ratings.tactics)} />
      </p>
      {aside}
    </div>
  );
}
