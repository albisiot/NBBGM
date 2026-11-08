// Allenatori e proprietari nell'app: letture (allenatori della lega, quello di una squadra, gli esonerati da pagare, il
// cambio chiesto nel turno) e testi delle schede. Le regole (idea di gioco, carattere, qualità, richiesta, chi si può
// prendere) sono quelle del motore: qui si mostrano, decide il server alla chiusura del turno.
//
// Le leghe create prima degli allenatori non ne hanno: le letture danno liste vuote e le pagine non ne parlano. Con
// l'app pubblicata prima della migrazione (tabelle e colonne che non ci sono ancora) vale lo stesso.
import {
  coachAsk,
  coachRating,
  coachStars,
  COACH_RATING_LABEL,
  OWNER_TRAIT_LABEL,
  TRAIT_LABEL,
  type Coach,
  type CoachRatings,
  type OwnerProfile,
  type Philosophy,
  type SeasonConfig,
} from '@nbbgm/engine';
import { supabase } from './supabase.ts';

type Num = number | string;

/** Un allenatore della lega, come lo vede l'app (il contratto è pubblico, come quelli dei giocatori). */
export interface CoachInfo extends Coach {
  /** Squadra (uuid) che allena, null se libero. */
  teamId: string | null;
  /** Stipendio di ogni stagione del contratto, dalla corrente (vuoto se libero). */
  salaries: number[];
  /** Stagione in cui la squadra di adesso lo ha assunto. */
  since: number | null;
}

/** Riga della tabella coaches. */
export interface CoachRow {
  id: string;
  team_id: string | null;
  first_name: string;
  last_name: string;
  nationality: string;
  age: number;
  philosophy: string;
  traits: Coach['traits'];
  ratings: CoachRatings;
  salaries: Num[];
  since: number | null;
}

const COACH_COLUMNS =
  'id, team_id, first_name, last_name, nationality, age, philosophy, traits, ratings, salaries, since';

export function coachFromRow(r: CoachRow): CoachInfo {
  return {
    id: r.id,
    teamId: r.team_id,
    firstName: r.first_name,
    lastName: r.last_name,
    nationality: r.nationality,
    age: r.age,
    philosophy: r.philosophy as Philosophy,
    traits: r.traits,
    ratings: r.ratings,
    salaries: r.salaries.map(Number),
    since: r.since,
  };
}

/** Tabella che non c'è ancora (app pubblicata prima della migrazione): come una lega senza allenatori. */
const missingTable = (code: string | undefined) => code === '42P01' || code === 'PGRST205';

/** Tutti gli allenatori della lega, in panchina e liberi; nessuno nelle leghe create prima. */
export async function leagueCoaches(leagueId: string): Promise<CoachInfo[]> {
  const { data, error } = await supabase.from('coaches').select(COACH_COLUMNS).eq('league_id', leagueId);
  if (missingTable(error?.code)) return [];
  if (error) throw error;
  return ((data ?? []) as CoachRow[]).map(coachFromRow);
}

/** Stipendi di un allenatore esonerato ancora a carico della squadra. */
export interface Buyout {
  coachName: string;
  salaries: number[];
}

/** L'allenatore di una squadra e gli esonerati che paga ancora (null e [] nelle leghe senza allenatori). */
export async function teamStaff(teamId: string): Promise<{ coach: CoachInfo | null; buyouts: Buyout[] }> {
  const [coach, buyouts] = await Promise.all([
    supabase.from('coaches').select(COACH_COLUMNS).eq('team_id', teamId).maybeSingle(),
    supabase.from('coach_buyouts').select('coach_name, salaries').eq('team_id', teamId).order('id'),
  ]);
  if (missingTable(coach.error?.code) || missingTable(buyouts.error?.code))
    return { coach: null, buyouts: [] };
  if (coach.error) throw coach.error;
  if (buyouts.error) throw buyouts.error;
  return {
    coach: coach.data ? coachFromRow(coach.data as CoachRow) : null,
    buyouts: ((buyouts.data ?? []) as { coach_name: string; salaries: Num[] }[]).map((b) => ({
      coachName: b.coach_name,
      salaries: b.salaries.map(Number),
    })),
  };
}

/** Cambio di allenatore chiesto dalla propria squadra nel turno, in attesa della chiusura. */
export interface CoachRequest {
  id: string;
  coachId: string;
}

export async function myCoachRequest(teamId: string): Promise<CoachRequest | null> {
  const { data, error } = await supabase
    .from('coach_requests')
    .select('id, coach_id')
    .eq('team_id', teamId)
    .eq('status', 'pending')
    .maybeSingle();
  if (missingTable(error?.code)) return null;
  if (error) throw error;
  const r = data as { id: string; coach_id: string } | null;
  return r ? { id: r.id, coachId: r.coach_id } : null;
}

// ---------------------------------------------------------------- testi

export const coachFullName = (c: Pick<Coach, 'firstName' | 'lastName'>) => `${c.firstName} ${c.lastName}`;

/** Stelle da 1 a 5 di una qualità o della valutazione: "★★★☆☆". */
export function stars(value: number): string {
  const n = coachStars(value);
  return '★'.repeat(n) + '☆'.repeat(5 - n);
}

/** Le tre qualità con le stelle, nell'ordine della scheda. */
export function coachGrades(
  c: Pick<Coach, 'ratings'>,
): { key: keyof CoachRatings; label: string; stars: number }[] {
  return (['tactics', 'development', 'motivation'] as const).map((key) => ({
    key,
    label: COACH_RATING_LABEL[key],
    stars: coachStars(c.ratings[key]),
  }));
}

/** Valutazione complessiva in stelle (metà Tattica, un quarto le altre due). */
export function coachOverallStars(c: Pick<Coach, 'ratings'>): number {
  return coachStars(coachRating(c));
}

/** Il carattere in parole: "Rotazione corta · Fa giocare i giovani · Fa riposare chi è stanco · Si adatta alla rosa". */
export function traitsText(t: Coach['traits']): string[] {
  return [
    TRAIT_LABEL.rotation[t.rotation],
    TRAIT_LABEL.trust[t.trust],
    TRAIT_LABEL.rest[t.rest],
    TRAIT_LABEL.flexible[t.flexible ? 'true' : 'false'],
  ];
}

/** Il carattere del GM in parole, senza le voci nella media. */
export function ownerTraitsText(o: OwnerProfile): string[] {
  const out: string[] = [];
  if (o.trades !== 'normal') out.push(OWNER_TRAIT_LABEL.trades[o.trades]);
  if (o.loyalty !== 'normal') out.push(OWNER_TRAIT_LABEL.loyalty[o.loyalty]);
  if (o.draft !== 'balanced') out.push(OWNER_TRAIT_LABEL.draft[o.draft]);
  if (o.patience !== 'normal') out.push(OWNER_TRAIT_LABEL.patience[o.patience]);
  return out;
}

/** Contratto in breve: "7,30 mln · 3 anni" (dalla stagione corrente). */
export function coachContractText(salaries: readonly number[], millions: (x: number) => string): string {
  if (!salaries.length) return 'senza contratto';
  return `${millions(salaries[0] ?? 0)} · ${salaries.length === 1 ? '1 anno' : `${salaries.length} anni`}`;
}

/** Quanto resta da pagare di un contratto: la somma delle stagioni. */
export function contractTotal(salaries: readonly number[]): number {
  return salaries.reduce((a, b) => a + b, 0);
}

/**
 * Perché non si può chiedere un allenatore (come checkCoachHire del motore), o null. Con il saldo negativo si prende
 * solo uno che costa al massimo quanto quello di adesso.
 */
export function hireProblem(
  config: SeasonConfig,
  coach: Pick<CoachInfo, 'ratings' | 'age' | 'teamId'>,
  current: Pick<CoachInfo, 'salaries'> | null,
  balance: number,
): string | null {
  if (coach.teamId !== null) return 'Allena già un’altra squadra';
  const ask = coachAsk(config, coach)[0] ?? 0;
  if (balance < 0 && ask > (current?.salaries[0] ?? 0))
    return 'Con il saldo negativo puoi prendere solo un allenatore che costa al massimo quanto quello di adesso';
  return null;
}

/** Allenatori liberi dal migliore (valutazione), a parità per nome. */
export function freeCoachesByRating(coaches: readonly CoachInfo[]): CoachInfo[] {
  return coaches
    .filter((c) => c.teamId === null)
    .map((c) => ({ c, r: coachRating(c) }))
    .sort(
      (a, b) =>
        b.r - a.r ||
        (coachFullName(a.c) < coachFullName(b.c) ? -1 : coachFullName(a.c) > coachFullName(b.c) ? 1 : 0),
    )
    .map((x) => x.c);
}
