// MVP delle Finali, con una formula fissa come gli altri premi (awards.ts), dai box score delle partite della serie
// finale. Nessun caso: a parità vince chi ha giocato più partite, poi chi ha segnato di più, poi l'id più piccolo.
//
// Formula: tra i giocatori della squadra campione entrati in campo in almeno metà delle partite della finale, la
// valutazione (VAL) a partita più alta, calcolata sulla somma delle partite della finale:
//   (PT + RIM + AS + RUB + STP − tiri sbagliati − liberi sbagliati − PP) / partite giocate
import { efficiency } from './awards.ts';
import { emptyStats, type SeasonStats } from './state.ts';

/** Una riga di box score di una partita della finale. */
export interface FinalsBoxLine {
  gameId: string;
  playerId: string;
  teamId: string;
  seconds: number;
  pts: number;
  fgm: number;
  fga: number;
  tpm: number;
  tpa: number;
  ftm: number;
  fta: number;
  orb: number;
  drb: number;
  ast: number;
  stl: number;
  blk: number;
  tov: number;
  pf: number;
}

export interface FinalsMvp {
  playerId: string;
  teamId: string;
  /** Partite giocate nella finale. */
  games: number;
  /** Valutazione a partita, arrotondata a un decimale. */
  score: number;
  perGame: { pts: number; reb: number; ast: number };
}

export const FINALS_MVP_FORMULA =
  'Valutazione a partita più alta nella finale tra i giocatori della squadra campione, con almeno metà delle partite della serie';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** MVP delle Finali dai box score della serie finale; null se la squadra campione non ha nessuno in campo. */
export function finalsMvp(lines: readonly FinalsBoxLine[], championId: string): FinalsMvp | null {
  const games = new Set(lines.map((l) => l.gameId)).size;
  const minGames = Math.ceil(games / 2);
  const totals = new Map<string, SeasonStats>();
  for (const l of lines) {
    if (l.teamId !== championId || l.seconds <= 0) continue;
    const s = totals.get(l.playerId) ?? emptyStats();
    s.g += 1;
    s.seconds += l.seconds;
    s.pts += l.pts;
    s.fgm += l.fgm;
    s.fga += l.fga;
    s.tpm += l.tpm;
    s.tpa += l.tpa;
    s.ftm += l.ftm;
    s.fta += l.fta;
    s.orb += l.orb;
    s.drb += l.drb;
    s.ast += l.ast;
    s.stl += l.stl;
    s.blk += l.blk;
    s.tov += l.tov;
    s.pf += l.pf;
    totals.set(l.playerId, s);
  }
  const ranked = [...totals]
    .filter(([, s]) => s.g >= minGames)
    .map(([id, s]) => ({ id, s, score: efficiency(s) }))
    .sort(
      (a, b) =>
        b.score - a.score || b.s.g - a.s.g || b.s.pts - a.s.pts || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
  const best = ranked[0];
  if (!best) return null;
  return {
    playerId: best.id,
    teamId: championId,
    games: best.s.g,
    score: round1(best.score),
    perGame: {
      pts: round1(best.s.pts / best.s.g),
      reb: round1((best.s.orb + best.s.drb) / best.s.g),
      ast: round1(best.s.ast / best.s.g),
    },
  };
}
