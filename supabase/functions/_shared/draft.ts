// Draft iniziale: dallo stato salvato (draft_snapshot) al motore, e dal piano del motore agli argomenti di
// apply_draft_picks. Comune alla Edge Function draft (Deno) e ai test (Node).
import type { DraftPlan, DraftSnapshot, Role } from '../../../packages/engine/src/index.ts';

/** Risultato di public.draft_snapshot(league). */
export interface DraftSnapshotRow {
  mode: 'list' | 'live';
  state: 'waiting' | 'running' | 'done';
  order: string[];
  next: number;
  deadline: string | null;
  pick_seconds: number;
  commissioner_id: string;
  owners: Record<string, string | null>;
  pool: { id: string; role: string; secondary_role: string | null; overall: number | string }[];
  made: { pick: number; team_id: string; player_id: string }[];
  lists: Record<string, string[]>;
}

export function snapshotFromRow(r: DraftSnapshotRow): DraftSnapshot {
  return {
    mode: r.mode,
    state: r.state,
    order: r.order,
    next: r.next,
    deadline: r.deadline,
    pickSeconds: r.pick_seconds,
    commissionerId: r.commissioner_id,
    owners: r.owners,
    pool: r.pool.map((p) => ({
      id: p.id,
      role: p.role as Role,
      secondaryRole: p.secondary_role as Role | null,
      overall: Number(p.overall),
    })),
    made: r.made.map((m) => ({ pick: m.pick, teamId: m.team_id, playerId: m.player_id })),
    lists: r.lists,
  };
}

/** Argomenti di public.apply_draft_picks per un piano del motore; null se non c'è niente da scrivere. */
export function applyArgs(
  leagueId: string,
  s: DraftSnapshot,
  plan: DraftPlan,
): Record<string, unknown> | null {
  if (!plan.begin && plan.mode === null && plan.picks.length === 0) return null;
  return {
    p_league: leagueId,
    p_from: s.next,
    p_picks: plan.picks.map((p) => ({
      pick: p.pick,
      team_id: p.teamId,
      player_id: p.playerId,
      auto: p.auto,
    })),
    p_deadline: plan.deadline,
    p_begin: plan.begin,
    p_mode: plan.mode,
  };
}
