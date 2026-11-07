// Classifica di regular season come un tabellino: una conference alla volta (1-6 ai playoff, 7-10 al play-in) o le
// sue division. Filetto pieno dopo il 6° posto e a puntini dopo il 10°, la propria squadra evidenziata. È la stessa
// classifica, spareggi compresi, che il server usa per il tabellone. Titolo e schede in ChampionshipLayout.
import type { StandingsLine } from '@nbbgm/engine';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, ErrorText, SectionTitle, Segmented, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import type { LeagueTeam } from '../lib/leagues.ts';
import { seasonStandings } from '../lib/results.ts';
import {
  HEAD_ROW,
  HIGHLIGHT,
  INK_LINK,
  NOTE,
  PAPER,
  rowRule,
  seedZone,
  standingsRule,
  STICKY,
  TABLE,
} from '../lib/tabellino.ts';
import { useSeason } from '../lib/useSeason.ts';

type Conference = 'East' | 'West';

const DIVISIONS: Record<Conference, string[]> = {
  East: ['Atlantic', 'Central', 'Southeast'],
  West: ['Northwest', 'Pacific', 'Southwest'],
};

const CONFERENCE_NAME: Record<Conference, string> = {
  East: 'Eastern Conference',
  West: 'Western Conference',
};

export function StandingsPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [view, setView] = useState<'conference' | 'division'>('conference');
  // Senza una scelta si apre la conference della propria squadra
  const [chosen, setChosen] = useState<Conference | null>(null);
  const { data, error, loading } = useSeason(id);
  // La classifica si ricalcola solo con partite nuove, non a ogni cambio di vista
  const table = useMemo(() => (data ? seasonStandings(data.league, data.games) : null), [data]);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data || !table) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, games } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const mineTeam = league.teams.find((t) => t.ownerId === userId);
  const mine = mineTeam?.id;
  const conf = chosen ?? mineTeam?.conference ?? 'East';
  const played = games.filter((g) => g.kind === 'regular' && g.homeScore !== null).length;

  return (
    <div className="space-y-4">
      <p className={NOTE}>Regular season · {played} partite giocate su 1230</p>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Segmented
          label="Conference"
          value={conf}
          onChange={setChosen}
          options={[
            { label: 'Est', value: 'East' },
            { label: 'Ovest', value: 'West' },
          ]}
        />
        <Button
          variant="ghost"
          className="px-1"
          onClick={() => setView((v) => (v === 'conference' ? 'division' : 'conference'))}
        >
          {view === 'conference' ? 'Vedi per division' : 'Vedi per conference'}
        </Button>
      </div>

      {view === 'conference' ? (
        <section aria-labelledby="classifica-conference" className="space-y-2">
          <h2 id="classifica-conference" className="sr-only">
            {CONFERENCE_NAME[conf]}
          </h2>
          <StandingsTable leagueId={league.id} lines={table[conf]} team={team} mine={mine} seeds />
          <p className={NOTE}>
            Sopra la riga piena: playoff · fino alla riga a puntini: play-in. A parità: scontri diretti,
            differenza punti, poi sorteggio.
          </p>
        </section>
      ) : (
        DIVISIONS[conf].map((div) => (
          <section key={div} className="space-y-2">
            <SectionTitle>{div}</SectionTitle>
            <StandingsTable
              leagueId={league.id}
              lines={table[conf].filter((l) => l.division === div).sort((a, b) => a.divRank - b.divRank)}
              team={team}
              mine={mine}
            />
          </section>
        ))
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
  const th = 'px-1.5 pt-2 pb-1 text-right';
  const td = 'px-1.5 py-1.5 text-right';
  const leader = lines[0];
  return (
    <div className="relative overflow-x-auto">
      <table className={`${TABLE} min-w-[36rem]`}>
        <thead>
          <tr className={HEAD_ROW}>
            <th scope="col" className={`${STICKY} ${PAPER} pt-2 pr-2 pb-1 pl-1 text-left`}>
              <span className="inline-block w-6">#</span>Squadra
            </th>
            <th scope="col" className={th}>
              V
            </th>
            <th scope="col" className={th}>
              P
            </th>
            <th scope="col" className={th}>
              %
            </th>
            <th scope="col" className={th} title="Distacco dalla prima">
              Dist.
            </th>
            <th scope="col" className={th}>
              Casa
            </th>
            <th scope="col" className={th} title="In trasferta">
              Trasf.
            </th>
            <th scope="col" className={th} title="Ultime 10 partite">
              Ult. 10
            </th>
            <th scope="col" className={th}>
              Serie
            </th>
            <th scope="col" className={th} title="Differenza punti">
              Diff.
            </th>
          </tr>
        </thead>
        <tbody>
          {lines.map((l, i) => {
            const rank = seeds ? l.confRank : i + 1;
            const t = team.get(l.teamId);
            const own = l.teamId === mine;
            const zone = seeds ? seedZone(rank) : null;
            const gb = leader ? (leader.w - l.w + (l.l - leader.l)) / 2 : 0;
            return (
              <tr
                key={l.teamId}
                className={`${rowRule(seeds ? standingsRule(rank) : 'thin')} ${own ? `${HIGHLIGHT} font-bold` : ''} ${
                  seeds && zone === null && !own ? 'text-stampa-600 dark:text-stampa-400' : ''
                }`}
              >
                <th
                  scope="row"
                  className={`${STICKY} ${own ? HIGHLIGHT : PAPER} py-1.5 pr-2 pl-1 text-left ${
                    own ? 'font-bold' : 'font-normal'
                  }`}
                >
                  <span className="flex max-w-[12rem] min-w-0 items-center gap-1.5 sm:max-w-64">
                    <span
                      className={`w-6 shrink-0 font-titolo ${own ? 'text-rosso-700 dark:text-rosso-300' : ''}`}
                    >
                      {rank}
                    </span>
                    <b className="shrink-0 font-titolo font-semibold">{t?.code ?? '?'}</b>
                    <Link
                      to={`/lega/${leagueId}/squadre/${t?.code ?? ''}`}
                      className={`truncate ${INK_LINK}`}
                    >
                      {t?.fullName}
                    </Link>
                    {/* I filetti si vedono soltanto: ai lettori di schermo il posto si dice a parole */}
                    {zone && <span className="sr-only">, zona {zone}</span>}
                  </span>
                </th>
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
