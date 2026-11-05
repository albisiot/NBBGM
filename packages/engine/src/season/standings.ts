import { Rng } from '../rng.ts';
import type { Conference, Team } from '../types.ts';
import type { GameRecord } from './state.ts';

export interface StandingRow {
  teamId: string;
  conference: Conference;
  division: string;
  w: number;
  l: number;
  pct: number;
  pointDiff: number;
}

/** Record e differenza punti di ogni squadra nelle partite date (di solito la regular season). */
export function records(teams: readonly Team[], games: readonly GameRecord[]): Map<string, StandingRow> {
  const rows = new Map<string, StandingRow>(
    teams.map((t) => [
      t.id,
      { teamId: t.id, conference: t.conference, division: t.division, w: 0, l: 0, pct: 0, pointDiff: 0 },
    ]),
  );
  for (const g of games) {
    const h = rows.get(g.homeId);
    const a = rows.get(g.awayId);
    if (!h || !a) continue;
    const homeWon = g.homeScore > g.awayScore;
    h.w += homeWon ? 1 : 0;
    h.l += homeWon ? 0 : 1;
    a.w += homeWon ? 0 : 1;
    a.l += homeWon ? 1 : 0;
    h.pointDiff += g.homeScore - g.awayScore;
    a.pointDiff += g.awayScore - g.homeScore;
  }
  for (const r of rows.values()) r.pct = r.w + r.l ? r.w / (r.w + r.l) : 0;
  return rows;
}

/**
 * Ordina le squadre: percentuale di vittorie, poi scontri diretti tra le squadre a pari merito, poi
 * differenza punti, poi un sorteggio con seed.
 */
export function rankTeams(
  teamIds: readonly string[],
  rows: Map<string, StandingRow>,
  games: readonly GameRecord[],
  seed: string,
): string[] {
  const rng = new Rng(`${seed}:spareggi`);
  const draw = new Map(teamIds.map((id) => [id, rng.next()]));
  const byPct = [...teamIds].sort(
    (a, b) => (rows.get(b) as StandingRow).pct - (rows.get(a) as StandingRow).pct,
  );
  const out: string[] = [];
  for (let i = 0; i < byPct.length;) {
    let j = i;
    const pct = (rows.get(byPct[i] as string) as StandingRow).pct;
    while (j < byPct.length && (rows.get(byPct[j] as string) as StandingRow).pct === pct) j++;
    const tied = byPct.slice(i, j);
    if (tied.length === 1) out.push(tied[0] as string);
    else {
      const set = new Set(tied);
      const h2h = new Map(tied.map((id) => [id, { w: 0, g: 0 }]));
      for (const g of games) {
        if (!set.has(g.homeId) || !set.has(g.awayId)) continue;
        const winner = g.homeScore > g.awayScore ? g.homeId : g.awayId;
        for (const id of [g.homeId, g.awayId]) {
          const x = h2h.get(id) as { w: number; g: number };
          x.g++;
          if (id === winner) x.w++;
        }
      }
      const h2hPct = (id: string) => {
        const x = h2h.get(id) as { w: number; g: number };
        return x.g ? x.w / x.g : 0.5;
      };
      tied.sort(
        (a, b) =>
          h2hPct(b) - h2hPct(a) ||
          (rows.get(b) as StandingRow).pointDiff - (rows.get(a) as StandingRow).pointDiff ||
          (draw.get(a) as number) - (draw.get(b) as number),
      );
      out.push(...tied);
    }
    i = j;
  }
  return out;
}

/** Classifica di una conference, dalla prima all'ultima. */
export function conferenceStandings(
  teams: readonly Team[],
  games: readonly GameRecord[],
  conference: Conference,
  seed: string,
): string[] {
  const rows = records(teams, games);
  return rankTeams(
    teams.filter((t) => t.conference === conference).map((t) => t.id),
    rows,
    games,
    `${seed}:${conference}`,
  );
}

/** Classifica di tutta la lega, dalla migliore alla peggiore. */
export function leagueStandings(
  teams: readonly Team[],
  games: readonly GameRecord[],
  seed: string,
): string[] {
  return rankTeams(
    teams.map((t) => t.id),
    records(teams, games),
    games,
    `${seed}:lega`,
  );
}

export interface StandingsLine extends StandingRow {
  /** Posto nella conference (1-15), come conferenceStandings. */
  confRank: number;
  /** Posto nella division (1-5). */
  divRank: number;
  /** Partite di distacco dalla prima della conference. */
  gamesBehind: number;
  home: { w: number; l: number };
  away: { w: number; l: number };
  last10: { w: number; l: number };
  /** Serie in corso: +3 tre vittorie di fila, -2 due sconfitte, 0 nessuna partita. */
  streak: number;
}

/**
 * Classifica completa di ogni conference, nell'ordine di conferenceStandings (lo stesso che decide play-in e
 * playoff), con distacco, record in casa e in trasferta, ultime 10 e serie. games: le partite di regular season.
 */
export function standingsTable(
  teams: readonly Team[],
  games: readonly GameRecord[],
  seed: string,
): Record<Conference, StandingsLine[]> {
  const rows = records(teams, games);
  const ordered = [...games].sort((a, b) => a.turn - b.turn);
  const extra = new Map(
    teams.map((t) => [t.id, { home: { w: 0, l: 0 }, away: { w: 0, l: 0 }, results: [] as boolean[] }]),
  );
  for (const g of ordered) {
    const homeWon = g.homeScore > g.awayScore;
    const h = extra.get(g.homeId);
    const a = extra.get(g.awayId);
    if (!h || !a) continue;
    h.home[homeWon ? 'w' : 'l']++;
    a.away[homeWon ? 'l' : 'w']++;
    h.results.push(homeWon);
    a.results.push(!homeWon);
  }
  const divRank = new Map<string, number>();
  for (const division of new Set(teams.map((t) => t.division))) {
    const ids = teams.filter((t) => t.division === division).map((t) => t.id);
    rankTeams(ids, rows, games, `${seed}:${division}`).forEach((id, i) => divRank.set(id, i + 1));
  }
  const out = {} as Record<Conference, StandingsLine[]>;
  for (const conference of ['East', 'West'] as Conference[]) {
    const order = conferenceStandings(teams, games, conference, seed);
    const leader = rows.get(order[0] as string) as StandingRow;
    out[conference] = order.map((id, i) => {
      const r = rows.get(id) as StandingRow;
      const x = extra.get(id) as {
        home: { w: number; l: number };
        away: { w: number; l: number };
        results: boolean[];
      };
      const last = x.results.slice(-10);
      let streak = 0;
      for (let k = x.results.length - 1; k >= 0; k--) {
        const won = x.results[k] as boolean;
        if (streak === 0) streak = won ? 1 : -1;
        else if (won === streak > 0) streak += won ? 1 : -1;
        else break;
      }
      return {
        ...r,
        confRank: i + 1,
        divRank: divRank.get(id) as number,
        gamesBehind: (leader.w - r.w + (r.l - leader.l)) / 2,
        home: x.home,
        away: x.away,
        last10: { w: last.filter(Boolean).length, l: last.filter((w) => !w).length },
        streak,
      };
    });
  }
  return out;
}
