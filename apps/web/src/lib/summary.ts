// Riepilogo del turno da condividere (per esempio nel gruppo WhatsApp della lega): risultato della propria partita,
// posto in classifica, infortuni, svincolati firmati con le offerte e prossimo avversario, con il link alla pagina
// della lega. Solo dati che i membri della lega vedono già (punteggi, classifica, infortuni, calendario) più le
// proprie offerte vinte: nessun valore nascosto. I dati si leggono solo quando il manager tocca "Condividi".
import { BODY_PART_LABEL, type BodyPart, type Conference } from '@nbbgm/engine';
import type { LeagueDetail, LeagueTeam } from './leagues.ts';
import { millions } from './market.ts';
import { GAME_COLUMNS, type GameKind } from './results.ts';
import { dateText } from './roundDate.ts';
import { appLink } from './share.ts';
import { supabase } from './supabase.ts';
import type { LastGame } from './turnStatus.ts';
import { currentStandings } from './useSeason.ts';

export interface TurnSummary {
  leagueName: string;
  teamName: string;
  teamCode: string;
  lastGame: {
    roundNumber: number;
    kind: GameKind;
    day: number | null;
    seasonYear: number | null;
    homeCode: string;
    awayCode: string;
    homeScore: number;
    awayScore: number;
    overtimes: number;
    home: boolean;
  } | null;
  standing: { conference: Conference; rank: number; w: number; l: number } | null;
  injuries: { name: string; bodyPart: string; games: number }[];
  signings: { name: string; salary: number; years: number }[];
  nextGame: {
    roundNumber: number;
    kind: GameKind;
    day: number | null;
    seasonYear: number | null;
    opponentCode: string;
    home: boolean;
  } | null;
  link: string;
}

const CONFERENCE_NAME: Record<Conference, string> = {
  East: 'Eastern Conference',
  West: 'Western Conference',
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "mercoledì 21 ottobre" in regular season, "playoff, domenica 18 aprile" dopo. */
function gameWhen(g: { kind: GameKind; day: number | null; seasonYear: number | null }): string {
  const date = dateText(g.day, g.seasonYear);
  const phase = g.kind === 'play-in' ? 'play-in' : g.kind === 'playoffs' ? 'playoff' : null;
  if (phase) return date ? `${phase}, ${date}` : phase;
  return date ?? 'regular season';
}

/** Testo del riepilogo, una riga per argomento; le righe senza dati non ci sono. */
export function summaryText(s: TurnSummary): string {
  const lines = [`🏀 ${s.leagueName} · ${s.teamName}`];
  const g = s.lastGame;
  if (g) {
    const mine = g.home ? g.homeScore : g.awayScore;
    const theirs = g.home ? g.awayScore : g.homeScore;
    const ot = g.overtimes
      ? `, ${g.overtimes > 1 ? `${g.overtimes} supplementari` : 'dopo un supplementare'}`
      : '';
    lines.push(
      `Ultima partita (${gameWhen(g)}): ${g.awayCode} ${g.awayScore} – ${g.homeScore} ${g.homeCode}, ${mine > theirs ? 'vinta' : 'persa'}${ot}`,
    );
  }
  if (s.standing)
    lines.push(
      `Classifica: ${s.standing.rank}ª nella ${CONFERENCE_NAME[s.standing.conference]} (${s.standing.w}-${s.standing.l})`,
    );
  lines.push(
    s.injuries.length
      ? `Infortuni: ${s.injuries.map((i) => `${i.name} (${i.bodyPart}, ${plural(i.games, 'partita', 'partite')})`).join('; ')}`
      : 'Infortuni: nessuno',
  );
  if (s.signings.length)
    lines.push(
      `Firmati: ${s.signings.map((x) => `${x.name} (${millions(x.salary)} per ${plural(x.years, 'anno', 'anni')})`).join('; ')}`,
    );
  if (s.nextGame)
    lines.push(
      `Prossima partita (${gameWhen(s.nextGame)}): ${s.nextGame.home ? 'in casa contro' : 'in trasferta contro'} ${s.nextGame.opponentCode}`,
    );
  lines.push(s.link);
  return lines.join('\n');
}

type Named = { first_name: string; last_name: string } | null;
const nameOf = (p: Named) => (p ? `${p.first_name} ${p.last_name}` : 'Giocatore');

/** Legge i dati del riepilogo: poche righe, solo quando il manager vuole condividere. */
export async function loadTurnSummary(
  league: LeagueDetail,
  me: LeagueTeam,
  lastGame: LastGame | null,
): Promise<TurnSummary> {
  const code = (id: string) => league.teams.find((t) => t.id === id)?.code ?? '?';
  const seasonId = league.seasonId;
  const [standings, injuries, lastRound, next] = await Promise.all([
    seasonId ? currentStandings({ ...league, seasonId }) : Promise.resolve(null),
    // Gli infortunati della lega sono poche decine (anche gli svincolati): si tengono quelli della squadra
    supabase
      .from('injuries')
      .select('games_remaining, body_part, player:players(first_name, last_name, team_id)')
      .eq('league_id', league.id),
    supabase
      .from('rounds')
      .select('id')
      .eq('league_id', league.id)
      .eq('state', 'done')
      .order('simulated_at', { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle(),
    seasonId
      ? supabase
          .from('games')
          .select(GAME_COLUMNS)
          .eq('season_id', seasonId)
          .is('home_score', null)
          .or(`home_team_id.eq.${me.id},away_team_id.eq.${me.id}`)
          .order('round_number')
          .limit(1)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  for (const r of [injuries, lastRound, next]) if (r.error) throw r.error;
  // Offerte agli svincolati vinte nel turno appena chiuso
  const roundId = (lastRound.data as { id: string } | null)?.id;
  let signings: TurnSummary['signings'] = [];
  if (roundId) {
    const bids = await supabase
      .from('free_agent_bids')
      .select('salaries, player:players(first_name, last_name)')
      .eq('team_id', me.id)
      .eq('round_id', roundId)
      .eq('status', 'won');
    if (bids.error) throw bids.error;
    signings = ((bids.data ?? []) as unknown as { salaries: (number | string)[]; player: Named }[]).map(
      (b) => ({
        name: nameOf(b.player),
        salary: Number(b.salaries[0] ?? 0),
        years: b.salaries.length,
      }),
    );
  }
  const line = standings ? [...standings.East, ...standings.West].find((l) => l.teamId === me.id) : undefined;
  const n = next.data as {
    round_number: number;
    kind: GameKind;
    day: number | null;
    home_team_id: string;
    away_team_id: string;
  } | null;
  return {
    leagueName: league.name,
    teamName: me.fullName,
    teamCode: me.code,
    lastGame: lastGame && {
      roundNumber: lastGame.roundNumber,
      kind: lastGame.kind,
      day: lastGame.day,
      seasonYear: lastGame.seasonYear,
      homeCode: code(lastGame.homeTeamId),
      awayCode: code(lastGame.awayTeamId),
      homeScore: lastGame.homeScore,
      awayScore: lastGame.awayScore,
      overtimes: lastGame.overtimes,
      home: lastGame.homeTeamId === me.id,
    },
    // Prima della prima partita la classifica non dice nulla
    standing:
      line && line.w + line.l > 0
        ? { conference: line.conference, rank: line.confRank, w: line.w, l: line.l }
        : null,
    injuries: (
      (injuries.data ?? []) as unknown as {
        games_remaining: number;
        body_part: string;
        player: (Named & { team_id: string | null }) | null;
      }[]
    )
      .filter((i) => i.player?.team_id === me.id && i.games_remaining > 0)
      .sort((a, b) => b.games_remaining - a.games_remaining)
      .map((i) => ({
        name: nameOf(i.player),
        bodyPart: BODY_PART_LABEL[i.body_part as BodyPart] ?? i.body_part,
        games: i.games_remaining,
      })),
    signings,
    nextGame: n && {
      roundNumber: n.round_number,
      kind: n.kind,
      day: n.day ?? null,
      seasonYear: league.seasonYear,
      opponentCode: code(n.home_team_id === me.id ? n.away_team_id : n.home_team_id),
      home: n.home_team_id === me.id,
    },
    link: appLink(`/lega/${league.id}`),
  };
}
