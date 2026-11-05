// Rosa della propria squadra: giocatori, contratti, infortuni, impostazioni salvate e allenatore.
import {
  DEFAULT_TACTICS,
  validTactics,
  type Hidden,
  type InjurySeverity,
  type Player,
  type Ratings,
  type Role,
  type Tactics,
  type Tendencies,
} from '@nbbgm/engine';
import { supabase } from './supabase.ts';

export interface RosterPlayer extends Player {
  teamId: string | null;
  scoutedPotential: number;
  contractType: string | null;
  salaries: number[];
  options: (string | null)[];
  stats: Record<string, number>;
}

export interface SavedTeamSettings {
  starters: string[];
  minutes: Record<string, number>;
  tactics: Tactics;
}

export interface CoachDelegation {
  active: boolean;
  untilRound: number | null;
  untilAt: string | null;
  untilPhaseEnd: boolean;
}

const PLAYER_COLUMNS =
  'id, team_id, first_name, last_name, nationality, role, secondary_role, hand, archetype, age, height_cm, wingspan_cm, weight_kg, years_in_league, ratings, tendencies, energy, morale, scouted_potential, season_stats';

type PlayerRow = {
  id: string;
  team_id: string | null;
  first_name: string;
  last_name: string;
  nationality: string;
  role: Role;
  secondary_role: Role | null;
  hand: 'R' | 'L';
  archetype: string;
  age: number;
  height_cm: number | string;
  wingspan_cm: number | string;
  weight_kg: number | string;
  years_in_league: number | null;
  ratings: Ratings;
  tendencies: Tendencies;
  energy: number | string;
  morale: number | string;
  scouted_potential: number;
  season_stats: Record<string, number>;
};

async function withContractsAndInjuries(rows: PlayerRow[]): Promise<RosterPlayer[]> {
  const ids = rows.map((r) => r.id);
  if (ids.length === 0) return [];
  const [contracts, injuries] = await Promise.all([
    supabase.from('contracts').select('player_id, type, salaries, options').in('player_id', ids),
    supabase.from('injuries').select('player_id, body_part, severity, games_remaining').in('player_id', ids),
  ]);
  if (contracts.error) throw contracts.error;
  if (injuries.error) throw injuries.error;
  const contractOf = new Map(contracts.data.map((c) => [c.player_id, c]));
  const injuryOf = new Map(injuries.data.map((i) => [i.player_id, i]));
  return rows.map((r) => {
    const c = contractOf.get(r.id);
    const i = injuryOf.get(r.id);
    return {
      id: r.id,
      teamId: r.team_id,
      firstName: r.first_name,
      lastName: r.last_name,
      nationality: r.nationality,
      role: r.role,
      secondaryRole: r.secondary_role,
      hand: r.hand,
      archetype: r.archetype,
      age: r.age,
      heightCm: Number(r.height_cm),
      wingspanCm: Number(r.wingspan_cm),
      weightKg: Number(r.weight_kg),
      yearsInLeague: r.years_in_league,
      ratings: r.ratings,
      tendencies: r.tendencies,
      // I valori nascosti non arrivano al client: il motore qui serve solo per overall e Auto
      hidden: {} as Hidden,
      energy: Number(r.energy),
      morale: Number(r.morale),
      injury: i
        ? { bodyPart: i.body_part, severity: i.severity as InjurySeverity, gamesRemaining: i.games_remaining }
        : null,
      scoutedPotential: r.scouted_potential,
      contractType: c?.type ?? null,
      salaries: (c?.salaries ?? []).map(Number),
      options: c?.options ?? [],
      stats: r.season_stats ?? {},
    };
  });
}

export async function teamRoster(teamId: string): Promise<RosterPlayer[]> {
  const { data, error } = await supabase.from('players').select(PLAYER_COLUMNS).eq('team_id', teamId);
  if (error) throw error;
  return withContractsAndInjuries((data ?? []) as unknown as PlayerRow[]);
}

export async function playerCard(playerId: string): Promise<RosterPlayer | null> {
  const { data, error } = await supabase
    .from('players')
    .select(PLAYER_COLUMNS)
    .eq('id', playerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return (await withContractsAndInjuries([data as unknown as PlayerRow]))[0] ?? null;
}

export async function teamSettings(teamId: string): Promise<SavedTeamSettings | null> {
  const { data, error } = await supabase
    .from('team_settings')
    .select('starters, minutes, tactics')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return { starters: data.starters, minutes: data.minutes, tactics: validTactics(data.tactics) };
}

export async function saveTeamSettings(
  teamId: string,
  leagueId: string,
  s: SavedTeamSettings,
): Promise<void> {
  const minutes = Object.fromEntries(Object.entries(s.minutes).filter(([, m]) => m > 0));
  const { error } = await supabase
    .from('team_settings')
    .upsert({ team_id: teamId, league_id: leagueId, starters: s.starters, minutes, tactics: s.tactics });
  if (error) throw error;
}

export async function coachDelegation(teamId: string): Promise<CoachDelegation | null> {
  const { data, error } = await supabase
    .from('coach_delegations')
    .select('active, until_round, until_at, until_phase_end')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    active: data.active,
    untilRound: data.until_round,
    untilAt: data.until_at,
    untilPhaseEnd: data.until_phase_end,
  };
}

export async function setCoachDelegation(
  teamId: string,
  leagueId: string,
  d: CoachDelegation,
): Promise<void> {
  const { error } = await supabase.from('coach_delegations').upsert({
    team_id: teamId,
    league_id: leagueId,
    active: d.active,
    until_round: d.untilRound,
    until_at: d.untilAt,
    until_phase_end: d.untilPhaseEnd,
  });
  if (error) throw error;
}

export interface Scouting {
  own: boolean;
  potential: number;
  offensive_consistency: string | null;
  defensive_consistency: string | null;
  work_ethic: string | null;
  risks: string[];
}

export async function playerScouting(playerId: string): Promise<Scouting> {
  const { data, error } = await supabase.rpc('player_scouting', { p_player: playerId });
  if (error) throw error;
  return data as Scouting;
}

export const TACTIC_OPTIONS: {
  key: keyof Tactics;
  label: string;
  options: { label: string; value: string }[];
}[] = [
  {
    key: 'pace',
    label: 'Ritmo',
    options: [
      { label: 'Lento', value: 'slow' },
      { label: 'Normale', value: 'normal' },
      { label: 'Veloce', value: 'fast' },
    ],
  },
  {
    key: 'focus',
    label: 'Focus offensivo',
    options: [
      { label: 'Perimetro', value: 'perimeter' },
      { label: 'Equilibrato', value: 'balanced' },
      { label: 'Interno', value: 'inside' },
    ],
  },
  {
    key: 'defense',
    label: 'Difesa',
    options: [
      { label: 'A uomo', value: 'man' },
      { label: 'A zona', value: 'zone' },
    ],
  },
  {
    key: 'intensity',
    label: 'Intensità difensiva',
    options: [
      { label: 'Bassa', value: 'low' },
      { label: 'Media', value: 'medium' },
      { label: 'Alta', value: 'high' },
    ],
  },
];

export { DEFAULT_TACTICS };

/** Controlli dell'app, gli stessi del database: 5 titolari diversi, minuti da 0 a 48 con la somma a 240. */
export function settingsProblems(s: SavedTeamSettings, rosterIds: readonly string[]): string[] {
  const problems: string[] = [];
  if (s.starters.length !== 5 || new Set(s.starters).size !== 5) problems.push('Servono 5 titolari diversi.');
  if (s.starters.some((id) => !rosterIds.includes(id))) problems.push('Un titolare non è più in squadra.');
  const total = Object.values(s.minutes).reduce((a, b) => a + b, 0);
  if (total !== 240) problems.push(`La somma dei minuti deve fare 240 (ora ${total}).`);
  if (Object.values(s.minutes).some((m) => m < 0 || m > 48)) problems.push('I minuti vanno da 0 a 48.');
  if (Object.values(s.minutes).filter((m) => m > 0).length > 13)
    problems.push('Al massimo 13 giocatori a referto: togli i minuti a qualcuno.');
  return problems;
}
