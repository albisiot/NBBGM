// Premi di fine regular season, semplici e deterministici, calcolati dalle statistiche di stagione (le stesse che
// si salvano a fine regular season) e dalla percentuale di vittorie della squadra. Nessun caso: a parità vince
// chi ha giocato più partite, poi l'id più piccolo.
//
// Formule (per partita, G = partite giocate):
//   valutazione (VAL)   (PT + RIM + AS + RUB + STP − tiri sbagliati − liberi sbagliati − PP) / G
//   MVP                 VAL × (0,8 + 0,4 × %V della squadra): ×1,1 in una squadra da 75% di vittorie, ×0,9 al 25%
//   Miglior difensore   (2 × RUB + 2 × STP + RIM difensivi) / G × (0,9 + 0,2 × %V della squadra)
//   Rookie dell'anno    VAL più alta tra i giocatori al primo anno nella lega
//   Sesto uomo          VAL più alta tra chi è partito titolare in meno di metà delle partite giocate
//   Migliori marcatori, rimbalzisti e assistmen: i primi 5 per punti, rimbalzi e assist a partita
// Per tutti servono almeno metà delle partite del giocatore più presente (a fine stagione 41 su 82), come nelle
// classifiche delle statistiche.
import type { SeasonStats } from './state.ts';

export interface AwardPlayer {
  id: string;
  teamId: string | null;
  /** Primo anno nella lega; null se non si sa (stagioni salvate prima dei premi). */
  rookie: boolean | null;
  stats: SeasonStats;
}

export type AwardKey = 'mvp' | 'dpoy' | 'roy' | 'sixth';

export interface Award {
  key: AwardKey;
  playerId: string;
  teamId: string | null;
  /** Punteggio della formula, arrotondato a un decimale. */
  score: number;
}

export interface Leader {
  playerId: string;
  teamId: string | null;
  value: number;
}

export interface SeasonAwards {
  awards: Award[];
  /** Le prime 5 di ogni premio, per mostrare chi è arrivato vicino. */
  ballots: Record<AwardKey, Award[]>;
  leaders: { points: Leader[]; rebounds: Leader[]; assists: Leader[] };
  /** Partite minime per entrare nelle classifiche. */
  minGames: number;
}

export const AWARD_LABEL: Record<AwardKey, string> = {
  mvp: 'MVP',
  dpoy: 'Miglior difensore',
  roy: 'Rookie dell’anno',
  sixth: 'Miglior sesto uomo',
};

export const AWARD_FORMULA: Record<AwardKey, string> = {
  mvp: 'Valutazione a partita × (0,8 + 0,4 × percentuale di vittorie della squadra)',
  dpoy: '(2 × rubate + 2 × stoppate + rimbalzi difensivi) a partita × (0,9 + 0,2 × percentuale di vittorie)',
  roy: 'Valutazione a partita più alta tra i giocatori al primo anno',
  sixth: 'Valutazione a partita più alta tra chi è partito titolare in meno di metà delle sue partite',
};

/** Valutazione a partita, come nel basket europeo. */
export function efficiency(s: SeasonStats): number {
  if (s.g <= 0) return 0;
  const missed = s.fga - s.fgm + (s.fta - s.ftm);
  return (s.pts + s.orb + s.drb + s.ast + s.stl + s.blk - missed - s.tov) / s.g;
}

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Ordine deterministico: punteggio, poi più partite, poi id. */
function byScore<T extends { score: number; g: number; id: string }>(a: T, b: T): number {
  return b.score - a.score || b.g - a.g || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
}

/**
 * Premi e migliori della stagione. winPct dà la percentuale di vittorie di una squadra (0-1); per un giocatore
 * senza squadra vale 0,5.
 */
export function seasonAwards(
  players: readonly AwardPlayer[],
  winPct: (teamId: string) => number | undefined,
): SeasonAwards {
  const maxG = Math.max(0, ...players.map((p) => p.stats.g));
  const minGames = Math.ceil(maxG / 2);
  const eligible = players.filter((p) => p.stats.g > 0 && p.stats.g >= minGames);
  const pct = (p: AwardPlayer) => (p.teamId === null ? 0.5 : (winPct(p.teamId) ?? 0.5));

  const ranked = (key: AwardKey, pool: readonly AwardPlayer[], score: (p: AwardPlayer) => number): Award[] =>
    pool
      .map((p) => ({ p, id: p.id, g: p.stats.g, score: score(p) }))
      .sort(byScore)
      .slice(0, 5)
      .map((x) => ({ key, playerId: x.p.id, teamId: x.p.teamId, score: round1(x.score) }));

  const ballots: Record<AwardKey, Award[]> = {
    mvp: ranked('mvp', eligible, (p) => efficiency(p.stats) * (0.8 + 0.4 * pct(p))),
    dpoy: ranked(
      'dpoy',
      eligible,
      (p) => ((2 * p.stats.stl + 2 * p.stats.blk + p.stats.drb) / p.stats.g) * (0.9 + 0.2 * pct(p)),
    ),
    roy: ranked(
      'roy',
      eligible.filter((p) => p.rookie === true),
      (p) => efficiency(p.stats),
    ),
    sixth: ranked(
      'sixth',
      eligible.filter((p) => p.stats.gs * 2 < p.stats.g),
      (p) => efficiency(p.stats),
    ),
  };
  const awards = (['mvp', 'dpoy', 'roy', 'sixth'] as const)
    .map((k) => ballots[k][0])
    .filter((a): a is Award => a !== undefined);

  const top = (value: (s: SeasonStats) => number): Leader[] =>
    eligible
      .map((p) => ({ id: p.id, g: p.stats.g, score: value(p.stats) / p.stats.g, p }))
      .sort(byScore)
      .slice(0, 5)
      .map((x) => ({ playerId: x.p.id, teamId: x.p.teamId, value: round1(x.score) }));

  return {
    awards,
    ballots,
    leaders: {
      points: top((s) => s.pts),
      rebounds: top((s) => s.orb + s.drb),
      assists: top((s) => s.ast),
    },
    minGames,
  };
}
