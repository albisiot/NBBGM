// Pagina di una squadra qualsiasi della lega: rosa con overall, ruoli e contratti (pubblici), scelte al draft
// possedute con protezioni e swap, record. Il bilancio resta riservato (team_balance): qui non si legge.
import { involving, type PickInfo } from './market.ts';
import { supabase } from './supabase.ts';

export interface SwapInfo {
  id: string;
  draftYear: number;
  round: 1 | 2;
  holderTeamId: string;
  otherTeamId: string;
}

/**
 * Swap ancora da decidere (dopo la lottery dell'anno si sa chi ha preso cosa); con teamId solo quelli in cui c'è la
 * squadra (o una delle squadre: la proposta di scambio vuole quelli delle due parti, perché una scelta non entra in
 * due swap).
 */
export async function openSwaps(leagueId: string, teamId?: string | readonly string[]): Promise<SwapInfo[]> {
  let query = supabase
    .from('draft_swaps')
    .select('id, draft_year, round, holder_team_id, other_team_id')
    .eq('league_id', leagueId)
    .is('result', null);
  const teams = teamId === undefined ? [] : typeof teamId === 'string' ? [teamId] : teamId;
  if (teams.length)
    query = query.or(teams.map((t) => involving(t, ['holder_team_id', 'other_team_id'])).join(','));
  const { data, error } = await query.order('draft_year').order('round');
  if (error) throw error;
  return (
    (data ?? []) as {
      id: string;
      draft_year: number;
      round: 1 | 2;
      holder_team_id: string;
      other_team_id: string;
    }[]
  ).map((w) => ({
    id: w.id,
    draftYear: w.draft_year,
    round: w.round,
    holderTeamId: w.holder_team_id,
    otherTeamId: w.other_team_id,
  }));
}

export interface TeamExtra {
  strategy: 'contend' | 'middle' | 'rebuild';
  deadMoney: { playerName: string; salaries: number[] }[];
}

/** Strategia del bot e stipendi residui dei tagliati (sul cap di tutti, quindi pubblici). */
export async function teamExtra(teamId: string): Promise<TeamExtra> {
  const [team, dead] = await Promise.all([
    supabase.from('teams').select('strategy').eq('id', teamId).maybeSingle(),
    supabase.from('dead_money').select('player_name, salaries').eq('team_id', teamId),
  ]);
  if (team.error) throw team.error;
  if (dead.error) throw dead.error;
  return {
    strategy: ((team.data as { strategy: TeamExtra['strategy'] } | null)?.strategy ??
      'middle') as TeamExtra['strategy'],
    deadMoney: ((dead.data ?? []) as { player_name: string; salaries: (number | string)[] }[]).map((d) => ({
      playerName: d.player_name,
      salaries: d.salaries.map(Number),
    })),
  };
}

export const STRATEGY_LABEL: Record<TeamExtra['strategy'], string> = {
  contend: 'in corsa per il titolo',
  middle: 'a metà strada',
  rebuild: 'in ricostruzione',
};

/**
 * Scelte al draft di una squadra: quelle che possiede (sue o avute da altri) e le sue cedute ad altri, in ordine
 * di draft e di giro.
 */
export function teamPicks(
  picks: readonly PickInfo[],
  teamId: string,
): { owned: PickInfo[]; traded: PickInfo[] } {
  const order = (a: PickInfo, b: PickInfo) => a.draftYear - b.draftYear || a.round - b.round;
  return {
    owned: picks.filter((k) => k.ownerTeamId === teamId).sort(order),
    traded: picks.filter((k) => k.originalTeamId === teamId && k.ownerTeamId !== teamId).sort(order),
  };
}

/** Swap che riguardano la squadra: quelli che ha il diritto di fare e quelli che ha concesso. */
export function teamSwaps(
  swaps: readonly SwapInfo[],
  teamId: string,
): { held: SwapInfo[]; given: SwapInfo[] } {
  return {
    held: swaps.filter((w) => w.holderTeamId === teamId),
    given: swaps.filter((w) => w.otherTeamId === teamId),
  };
}

/** Monte stipendi della stagione: contratti standard (non two-way) più residui dei tagliati. */
export function teamPayroll(
  roster: readonly { contractType: string | null; salaries: readonly number[] }[],
  deadMoney: readonly { salaries: readonly number[] }[],
): number {
  return (
    roster.filter((p) => p.contractType !== 'two-way').reduce((a, p) => a + (p.salaries[0] ?? 0), 0) +
    deadMoney.reduce((a, d) => a + (d.salaries[0] ?? 0), 0)
  );
}

/** Contratto in breve: "12,35 mln · 3 anni", "two-way", "in scadenza", con l'opzione sull'ultimo anno. */
export function contractSummary(
  p: { contractType: string | null; salaries: readonly number[]; options: readonly (string | null)[] },
  millions: (x: number) => string,
): string {
  if (p.contractType === 'two-way') return 'two-way';
  if (p.salaries.length === 0) return p.contractType ? 'in scadenza' : 'senza contratto';
  const years = p.salaries.length === 1 ? '1 anno' : `${p.salaries.length} anni`;
  const last = p.options[p.salaries.length - 1];
  const option = last === 'player' ? ', opz. giocatore' : last === 'team' ? ', opz. squadra' : '';
  return `${millions(p.salaries[0] ?? 0)} · ${years}${option}`;
}
