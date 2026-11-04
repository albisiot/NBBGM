import { HIDDEN_KEYS, RATING_KEYS, TENDENCY_KEYS } from './fields.ts';
import { ROLES, type LeagueData } from './types.ts';

export interface Issue {
  level: 'error' | 'warning';
  message: string;
}

export const ROSTER_LIMITS = { minStandard: 13, maxStandard: 15, maxTwoWay: 3 } as const;

/**
 * Controlla una lega. Gli errori la rendono inutilizzabile (valori fuori scala, riferimenti rotti);
 * gli avvisi segnalano situazioni da sistemare prima della prima giornata (rose fuori misura).
 */
export function validateLeague(data: LeagueData): Issue[] {
  const issues: Issue[] = [];
  const error = (message: string) => issues.push({ level: 'error', message });
  const warning = (message: string) => issues.push({ level: 'warning', message });
  const teamIds = new Set(data.teams.map((t) => t.id));
  const seen = new Set<string>();

  for (const p of data.players) {
    const who = `${p.firstName} ${p.lastName} (${p.id})`;
    if (seen.has(p.id)) error(`${who}: id duplicato`);
    seen.add(p.id);
    if (!ROLES.includes(p.role)) error(`${who}: ruolo principale "${p.role}" non valido`);
    if (p.secondaryRole !== null && !ROLES.includes(p.secondaryRole)) {
      error(`${who}: ruolo secondario "${p.secondaryRole}" non valido`);
    }
    if (p.teamId !== null && !teamIds.has(p.teamId)) error(`${who}: squadra "${p.teamId}" inesistente`);
    const groups = [
      ['abilità', p.ratings, RATING_KEYS],
      ['tendenza', p.tendencies, TENDENCY_KEYS],
      ['valore nascosto', p.hidden, HIDDEN_KEYS],
    ] as const;
    for (const [label, values, keys] of groups) {
      for (const key of keys) {
        const v = (values as Record<string, number>)[key];
        if (typeof v !== 'number' || !Number.isFinite(v)) error(`${who}: ${label} ${key} mancante`);
        else if (v < 0 || v > 100) error(`${who}: ${label} ${key} = ${v}, fuori da 0-100`);
      }
    }
    if (!(p.heightCm > 150 && p.heightCm < 245)) error(`${who}: altezza ${p.heightCm} cm non plausibile`);
    if (!(p.age >= 17 && p.age <= 45)) error(`${who}: età ${p.age} non plausibile`);
  }

  const playerIds = new Set(data.players.map((p) => p.id));
  const contractByPlayer = new Map<string, LeagueData['contracts'][number]>();
  for (const c of data.contracts) {
    if (!playerIds.has(c.playerId)) error(`Contratto di un giocatore inesistente: ${c.playerId}`);
    if (!teamIds.has(c.teamId)) error(`Contratto di ${c.playerId} con squadra inesistente: ${c.teamId}`);
    if (c.salaries.some((s) => !(s >= 0))) error(`Contratto di ${c.playerId}: stipendio non valido`);
    if (contractByPlayer.has(c.playerId)) error(`${c.playerId}: più di un contratto`);
    contractByPlayer.set(c.playerId, c);
  }

  for (const team of data.teams) {
    const roster = data.players.filter((p) => p.teamId === team.id);
    const twoWay = roster.filter((p) => contractByPlayer.get(p.id)?.type === 'two-way').length;
    const standard = roster.length - twoWay;
    if (standard > ROSTER_LIMITS.maxStandard) {
      warning(
        `${team.fullName}: ${standard} contratti standard, oltre il massimo di ${ROSTER_LIMITS.maxStandard}`,
      );
    }
    if (standard < ROSTER_LIMITS.minStandard) {
      warning(
        `${team.fullName}: ${standard} contratti standard, sotto il minimo di ${ROSTER_LIMITS.minStandard}`,
      );
    }
    if (twoWay > ROSTER_LIMITS.maxTwoWay)
      warning(`${team.fullName}: ${twoWay} two-way, oltre il massimo di 3`);
    for (const role of ROLES) {
      if (!roster.some((p) => p.role === role || p.secondaryRole === role)) {
        warning(`${team.fullName}: nessun giocatore per il ruolo ${role}`);
      }
    }
  }
  return issues;
}
