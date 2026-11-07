// Bisogni della squadra, nel mercato: i ruoli scoperti rispetto a 3 PG, 3 SG, 3 SF, 2 PF e 2 C (come roleNeed dei
// bot) e i punti deboli della rotazione rispetto alla media della lega (public.league_skill_profile). Ogni bisogno
// porta ai filtri degli svincolati già pronti.
import { INITIAL_DRAFT_ROLE_TARGET, type Ratings, type Role } from '@nbbgm/engine';
import type { FreeAgentQuery } from './market.ts';
import { rotationProfile, SKILL_GROUPS, type SkillKey, type SkillProfile } from './skills.ts';
import { supabase } from './supabase.ts';

export interface Need {
  kind: 'role' | 'skill';
  title: string;
  /** Testo breve per il pulsante del bisogno: "C scoperto · 1 su 2", "Rimbalzi −3". */
  short: string;
  detail: string;
  /** Filtri degli svincolati per questo bisogno. */
  query: Partial<FreeAgentQuery>;
}

/** Sotto la media della lega di almeno questi punti un gruppo è un punto debole. */
export const WEAK_GAP = 2;
/** Punti deboli mostrati al massimo. */
export const MAX_WEAK = 3;

const ROLES: Role[] = ['PG', 'SG', 'SF', 'PF', 'C'];

/** Media della lega delle rotazioni, gruppo per gruppo; null se il database non ha ancora la funzione. */
export async function leagueSkillProfile(leagueId: string): Promise<SkillProfile | null> {
  const { data, error } = await supabase.rpc('league_skill_profile', { p_league: leagueId });
  if (error?.code === 'PGRST202') return null;
  if (error) throw error;
  const row = data as (Record<SkillKey, number | string> & { teams: number }) | null;
  if (!row || !row.teams) return null;
  const out = {} as SkillProfile;
  for (const g of SKILL_GROUPS) out[g.key] = Number(row[g.key] ?? 0);
  return out;
}

/** Bisogni della squadra: prima i ruoli scoperti, poi i punti deboli della rotazione dal più grave. */
export function teamNeeds(
  roster: readonly { id: string; role: Role; contractType: string | null; ratings: Ratings }[],
  league: SkillProfile | null,
): Need[] {
  const standard = roster.filter((p) => p.contractType !== 'two-way');
  const needs: Need[] = [];
  for (const role of ROLES) {
    const have = standard.filter((p) => p.role === role).length;
    const want = INITIAL_DRAFT_ROLE_TARGET[role];
    if (have < want)
      needs.push({
        kind: 'role',
        title: `Serve un ${role}`,
        short: `${role} scoperto · ${have} su ${want}`,
        detail: `Ne hai ${have} su ${want} come ruolo principale.`,
        query: { role, sort: 'overall' },
      });
  }
  if (league) {
    const mine = rotationProfile(standard);
    SKILL_GROUPS.map((g) => ({ g, gap: mine[g.key] - league[g.key] }))
      .filter((x) => x.gap <= -WEAK_GAP)
      .sort((a, b) => a.gap - b.gap)
      .slice(0, MAX_WEAK)
      .forEach(({ g, gap }) =>
        needs.push({
          kind: 'skill',
          title: g.label,
          short: `${g.label} −${Math.round(-gap)}`,
          detail: `La tua rotazione ha ${Math.round(mine[g.key])}, la media della lega ${Math.round(league[g.key])}.`,
          query: { sort: `skill:${g.key}` },
        }),
      );
  }
  return needs;
}
