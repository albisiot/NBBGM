// Classifica di regular season per conference (1-6 ai playoff, 7-10 al play-in) o per division. È la stessa
// classifica, spareggi compresi, che il server usa per il tabellone.
import type { StandingsLine } from '@nbbgm/engine';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Card, ErrorText, PageTitle, Segmented, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import type { LeagueTeam } from '../lib/leagues.ts';
import { seasonStandings } from '../lib/results.ts';
import { useSeason } from '../lib/useSeason.ts';

const DIVISIONS: Record<'East' | 'West', string[]> = {
  East: ['Atlantic', 'Central', 'Southeast'],
  West: ['Northwest', 'Pacific', 'Southwest'],
};

export function StandingsPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [view, setView] = useState<'conference' | 'division'>('conference');
  const { data, error, loading } = useSeason(id);
  // La classifica si ricalcola solo con partite nuove, non a ogni cambio di vista
  const table = useMemo(() => (data ? seasonStandings(data.league, data.games) : null), [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data || !table) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, games } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const mine = league.teams.find((t) => t.ownerId === userId)?.id;
  const played = games.filter((g) => g.kind === 'regular' && g.homeScore !== null).length;

  return (
    <div className="space-y-4">
      <PageTitle sub={`Regular season · ${played} partite giocate su 1230`}>Classifica</PageTitle>
      <Segmented
        label="Raggruppa"
        value={view}
        onChange={setView}
        options={[
          { label: 'Conference', value: 'conference' },
          { label: 'Division', value: 'division' },
        ]}
      />
      {(['East', 'West'] as const).map((conf) =>
        view === 'conference' ? (
          <Card key={conf} className="!p-4">
            <h2 className="mb-2 font-semibold">{conf === 'East' ? 'Eastern' : 'Western'} Conference</h2>
            <StandingsTable leagueId={league.id} lines={table[conf]} team={team} mine={mine} seeds />
          </Card>
        ) : (
          DIVISIONS[conf].map((div) => (
            <Card key={div} className="!p-4">
              <h2 className="mb-2 font-semibold">{div}</h2>
              <StandingsTable
                leagueId={league.id}
                lines={table[conf].filter((l) => l.division === div).sort((a, b) => a.divRank - b.divRank)}
                team={team}
                mine={mine}
              />
            </Card>
          ))
        ),
      )}
      {view === 'conference' && (
        <p className="flex flex-wrap gap-4 text-xs text-slate-500 dark:text-slate-400">
          <span>
            <span className="mr-1 inline-block size-2.5 rounded-sm bg-green-500" />
            1-6: playoff
          </span>
          <span>
            <span className="mr-1 inline-block size-2.5 rounded-sm bg-orange-400" />
            7-10: play-in
          </span>
          <span>A parità: scontri diretti, differenza punti, poi sorteggio.</span>
        </p>
      )}
    </div>
  );
}

function StandingsTable({
  leagueId,
  lines,
  team,
  mine,
  seeds = false,
}: {
  leagueId: string;
  lines: StandingsLine[];
  team: Map<string, LeagueTeam>;
  mine: string | undefined;
  seeds?: boolean;
}) {
  const th = 'px-1.5 py-1 text-right font-medium';
  const td = 'px-1.5 py-1 text-right font-mono';
  const leader = lines[0];
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs text-slate-500 dark:border-slate-700 dark:text-slate-400">
            <th className="sticky left-0 bg-white py-1 pr-2 pl-2 text-left font-medium dark:bg-slate-800">
              <span className="inline-block w-6">#</span>Squadra
            </th>
            <th className={th}>V</th>
            <th className={th}>P</th>
            <th className={th}>%</th>
            <th className={th}>Dist.</th>
            <th className={th}>Casa</th>
            <th className={th}>Trasf.</th>
            <th className={th}>Ult. 10</th>
            <th className={th}>Serie</th>
            <th className={th}>Diff.</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const rank = seeds ? l.confRank : i + 1;
            const t = team.get(l.teamId);
            // Segno dei posti playoff e play-in: un'ombra interna, perché il bordo di una cella fissa (sticky)
            // in una tabella con i bordi collassati non la segue quando la tabella scorre
            const mark = !seeds
              ? ''
              : rank <= 6
                ? 'shadow-[inset_4px_0_0_var(--color-green-500)]'
                : rank <= 10
                  ? 'shadow-[inset_4px_0_0_var(--color-orange-400)]'
                  : '';
            const gb = leader ? (leader.w - l.w + (l.l - leader.l)) / 2 : 0;
            return (
              <tr
                key={l.teamId}
                className={`border-b border-slate-100 dark:border-slate-700/60 ${l.teamId === mine ? 'font-semibold' : ''} ${
                  seeds && rank === 6 ? 'border-b-slate-300 dark:border-b-slate-500' : ''
                } ${seeds && rank === 10 ? 'border-b-slate-300 dark:border-b-slate-500' : ''}`}
              >
                <td
                  className={`sticky left-0 max-w-[12rem] truncate bg-white py-1 pr-2 pl-2 sm:max-w-60 dark:bg-slate-800 ${mark}`}
                >
                  <span className="flex items-center gap-2">
                    <span className="w-5 shrink-0 font-normal">{rank}</span>
                    <TeamCode code={t?.code ?? '?'} strong={l.teamId === mine} />
                    <Link
                      to={`/lega/${leagueId}/squadre/${t?.code ?? ''}`}
                      className="truncate hover:underline"
                    >
                      {t?.fullName}
                    </Link>
                  </span>
                </td>
                <td className={td}>{l.w}</td>
                <td className={td}>{l.l}</td>
                <td className={td}>{l.w + l.l ? l.pct.toFixed(3).replace(/^0/, '') : '–'}</td>
                <td className={td}>{gb === 0 ? '–' : gb.toFixed(1)}</td>
                <td className={td}>
                  {l.home.w}-{l.home.l}
                </td>
                <td className={td}>
                  {l.away.w}-{l.away.l}
                </td>
                <td className={td}>
                  {l.last10.w}-{l.last10.l}
                </td>
                <td className={td}>
                  {l.streak === 0 ? '–' : l.streak > 0 ? `V${l.streak}` : `P${-l.streak}`}
                </td>
                <td className={td}>{l.pointDiff > 0 ? `+${l.pointDiff}` : l.pointDiff}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
