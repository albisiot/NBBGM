// Valori economici NBA 2026-27 (comunicato NBA del 30/06/2026).

export const SEASON_2026_27 = {
  salaryCap: 164_961_000,
  luxuryTax: 200_428_000,
  firstApron: 209_015_000,
  secondApron: 221_686_000,
  minimumTeamSalary: 148_465_000,
} as const;

/** Stipendio massimo per anni nella lega: 25% (0-6), 30% (7-9), 35% (10+) del cap. */
export function maxSalary(cap: number, yearsInLeague: number): number {
  const share = yearsInLeague >= 10 ? 0.35 : yearsInLeague >= 7 ? 0.3 : 0.25;
  return Math.round(cap * share);
}

/**
 * Stipendio minimo indicativo usato dal generatore. La tabella ufficiale dei minimi per anzianità
 * va caricata nella configurazione della stagione (Fase 4).
 */
export const INDICATIVE_MIN_SALARY = 1_300_000;
