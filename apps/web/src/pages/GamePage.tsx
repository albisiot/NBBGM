// Una partita: punteggio per quarto, box score delle due squadre e cronaca azione per azione.
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Card, ErrorText, PageTitle, Segmented, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { leagueDetail, type LeagueTeam } from '../lib/leagues.ts';
import { clock, gameDetail, periodLabel, roundLabel, type BoxLine, type GameDetail } from '../lib/results.ts';
import { useAsync } from '../lib/useAsync.ts';
import { overtimeText } from './ResultsPage.tsx';

export function GamePage() {
  const { id = '', gid = '' } = useParams();
  const userId = useUserId();
  const [view, setView] = useState<'box' | 'plays'>('box');
  const { data, error, loading } = useAsync(async () => {
    const [league, game] = await Promise.all([leagueDetail(id), gameDetail(gid)]);
    return { league, game };
  }, [id, gid]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data?.league || !data.game) return <ErrorText>Partita non trovata.</ErrorText>;
  const { league, game } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const home = team.get(game.homeTeamId);
  const away = team.get(game.awayTeamId);
  const mine = league.teams.find((t) => t.ownerId === userId)?.id;
  if (game.homeScore === null || !home || !away)
    return (
      <div className="space-y-4">
        <PageTitle>
          {away?.fullName} – {home?.fullName}
        </PageTitle>
        <p className="text-sm text-slate-500 dark:text-slate-400">La partita non è ancora stata giocata.</p>
      </div>
    );

  return (
    <div className="space-y-4">
      <PageTitle
        sub={`${roundLabel(game.roundNumber, game.kind)} · ${game.overtimes ? overtimeText(game.overtimes) : 'Finale'}`}
      >
        {away.code} {game.awayScore} – {game.homeScore} {home.code}
      </PageTitle>

      <Card className="overflow-x-auto !p-4">
        <Quarters game={game} away={away} home={home} mine={mine} />
      </Card>

      <Segmented
        label="Vista"
        value={view}
        onChange={setView}
        options={[
          { label: 'Box score', value: 'box' },
          { label: 'Cronaca', value: 'plays' },
        ]}
      />

      {view === 'box' ? (
        [away, home].map((t) => (
          <Card key={t.id} className="!p-4">
            <h2 className="mb-2 flex items-center gap-2 font-semibold">
              <TeamCode code={t.code} strong={t.id === mine} /> {t.fullName}
            </h2>
            <BoxTable leagueId={league.id} lines={game.box.filter((l) => l.teamId === t.id)} />
          </Card>
        ))
      ) : (
        <Plays game={game} away={away} home={home} />
      )}
    </div>
  );
}

function Quarters({
  game,
  away,
  home,
  mine,
}: {
  game: GameDetail;
  away: LeagueTeam;
  home: LeagueTeam;
  mine: string | undefined;
}) {
  const q = game.quarters ?? { home: [], away: [] };
  const periods = Math.max(q.home.length, q.away.length);
  const head = Array.from({ length: periods }, (_, i) => (i < 4 ? `${i + 1}°` : `S${i - 3}`));
  return (
    <table className="w-full min-w-72 text-sm">
      <thead>
        <tr className="text-xs text-slate-500 dark:text-slate-400">
          <th className="text-left font-medium">Squadra</th>
          {head.map((h) => (
            <th key={h} className="w-10 text-right font-medium">
              {h}
            </th>
          ))}
          <th className="w-12 text-right font-medium">Tot</th>
        </tr>
      </thead>
      <tbody>
        {[
          { t: away, pts: q.away, score: game.awayScore },
          { t: home, pts: q.home, score: game.homeScore },
        ].map(({ t, pts, score }) => (
          <tr key={t.id}>
            <td className="py-1">
              <TeamCode code={t.code} strong={t.id === mine} />
            </td>
            {head.map((h, i) => (
              <td key={h} className="text-right font-mono">
                {pts[i] ?? ''}
              </td>
            ))}
            <td className="text-right font-mono font-semibold">{score}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const shot = (m: number, a: number) => `${m}-${a}`;

// Colonna del nome fissa a sinistra quando la tabella scorre (su telefono): fondo della scheda sotto
const STICKY = 'sticky left-0 bg-white pl-1 dark:bg-slate-800';

function BoxTable({ leagueId, lines }: { leagueId: string; lines: BoxLine[] }) {
  const total = lines.reduce(
    (a, l) => ({
      pts: a.pts + l.pts,
      fgm: a.fgm + l.fgm,
      fga: a.fga + l.fga,
      tpm: a.tpm + l.tpm,
      tpa: a.tpa + l.tpa,
      ftm: a.ftm + l.ftm,
      fta: a.fta + l.fta,
      reb: a.reb + l.orb + l.drb,
      ast: a.ast + l.ast,
      stl: a.stl + l.stl,
      blk: a.blk + l.blk,
      tov: a.tov + l.tov,
      pf: a.pf + l.pf,
    }),
    { pts: 0, fgm: 0, fga: 0, tpm: 0, tpa: 0, ftm: 0, fta: 0, reb: 0, ast: 0, stl: 0, blk: 0, tov: 0, pf: 0 },
  );
  const th = 'px-1.5 py-1 text-right font-medium';
  const td = 'px-1.5 py-1 text-right font-mono';
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[42rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <th className={`${STICKY} py-1 pr-2 text-left font-medium`}>Giocatore</th>
            <th className={th}>MIN</th>
            <th className={th}>PT</th>
            <th className={th}>RIM</th>
            <th className={th}>AS</th>
            <th className={th}>RUB</th>
            <th className={th}>STP</th>
            <th className={th}>PP</th>
            <th className={th}>TIRI</th>
            <th className={th}>DA 3</th>
            <th className={th}>TL</th>
            <th className={th}>F</th>
            <th className={th}>+/-</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr
              key={l.playerId}
              className={`border-b border-slate-100 dark:border-slate-700/60 ${l.seconds === 0 ? 'text-slate-500 dark:text-slate-400' : ''}`}
            >
              <td className={`${STICKY} max-w-[10rem] truncate py-1 pr-2 sm:max-w-52`}>
                <Link to={`/lega/${leagueId}/giocatore/${l.playerId}`} className="hover:underline">
                  {l.name}
                </Link>
                <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                  {l.role}
                  {l.starter ? ' · Q' : ''}
                </span>
              </td>
              {l.seconds === 0 ? (
                <td colSpan={12} className="px-1.5 py-1 text-xs">
                  Non entrato
                </td>
              ) : (
                <>
                  <td className={td}>{Math.round(l.seconds / 60)}</td>
                  <td className={`${td} font-semibold`}>{l.pts}</td>
                  <td className={td}>{l.orb + l.drb}</td>
                  <td className={td}>{l.ast}</td>
                  <td className={td}>{l.stl}</td>
                  <td className={td}>{l.blk}</td>
                  <td className={td}>{l.tov}</td>
                  <td className={td}>{shot(l.fgm, l.fga)}</td>
                  <td className={td}>{shot(l.tpm, l.tpa)}</td>
                  <td className={td}>{shot(l.ftm, l.fta)}</td>
                  <td className={td}>{l.pf}</td>
                  <td className={td}>{l.plusMinus > 0 ? `+${l.plusMinus}` : l.plusMinus}</td>
                </>
              )}
            </tr>
          ))}
          <tr className="font-semibold">
            <td className={`${STICKY} py-1`}>Totale</td>
            <td className={td} />
            <td className={td}>{total.pts}</td>
            <td className={td}>{total.reb}</td>
            <td className={td}>{total.ast}</td>
            <td className={td}>{total.stl}</td>
            <td className={td}>{total.blk}</td>
            <td className={td}>{total.tov}</td>
            <td className={td}>{shot(total.fgm, total.fga)}</td>
            <td className={td}>{shot(total.tpm, total.tpa)}</td>
            <td className={td}>{shot(total.ftm, total.fta)}</td>
            <td className={td}>{total.pf}</td>
            <td className={td} />
          </tr>
        </tbody>
      </table>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
        Q = in quintetto. TIRI, DA 3 e TL: segnati-tentati.
      </p>
    </div>
  );
}

function Plays({ game, away, home }: { game: GameDetail; away: LeagueTeam; home: LeagueTeam }) {
  const periods = [...new Set(game.plays.map((p) => p[0]))].sort((a, b) => a - b);
  const [period, setPeriod] = useState(periods[0] ?? 1);
  if (!game.plays.length)
    return (
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Cronaca non disponibile: si conserva per la stagione in corso e per quella prima. Punteggi e box score
        restano.
      </p>
    );
  return (
    <Card className="space-y-3 !p-4">
      <Segmented
        label="Periodo"
        value={period}
        onChange={setPeriod}
        options={periods.map((p) => ({ label: p <= 4 ? `${p}° q` : `S${p - 4}`, value: p }))}
      />
      <h2 className="font-semibold">{periodLabel(period)}</h2>
      <ol className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
        {game.plays
          .filter((p) => p[0] === period)
          .map((p, i) => (
            <li key={i} className="flex items-start gap-2 py-1.5">
              <span className="w-10 shrink-0 font-mono text-xs text-slate-500 dark:text-slate-400">
                {clock(p[1])}
              </span>
              <span className="w-11 shrink-0">
                {p[2] && <TeamCode code={p[2] === 'h' ? home.code : away.code} />}
              </span>
              <span className="min-w-0 flex-1">{p[3]}</span>
              <span className="shrink-0 font-mono text-xs text-slate-600 dark:text-slate-300">
                {p[5]}-{p[4]}
              </span>
            </li>
          ))}
      </ol>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Punteggio: {away.code}-{home.code}.
      </p>
    </Card>
  );
}
