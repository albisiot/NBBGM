// Pagina di una squadra della lega (anche delle altre): record, giocatori sul mercato, rosa con overall, ruoli e
// contratti, scelte al draft possedute con protezioni e swap. Il bilancio resta riservato. Da qui si propone uno
// scambio con lei.
import { overall } from '@nbbgm/engine';
import { Link, useParams } from 'react-router';
import { Card, ErrorText, PageTitle, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { leagueDetail, type LeagueTeam } from '../lib/leagues.ts';
import {
  contractFirstYear,
  effectiveConfig,
  leaguePicks,
  millions,
  seasonConfig,
  type PickInfo,
} from '../lib/market.ts';
import { teamRoster } from '../lib/roster.ts';
import {
  contractSummary,
  openSwaps,
  STRATEGY_LABEL,
  teamExtra,
  teamPayroll,
  teamPicks,
  teamSwaps,
  type SwapInfo,
} from '../lib/teams.ts';
import { botTradeBlock, tradeBlock } from '../lib/tradeBlock.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';
import { currentStandings } from '../lib/useSeason.ts';

const LINK = 'inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold';

async function load(leagueId: string, code: string) {
  const league = await leagueDetail(leagueId);
  const team = league?.teams.find((t) => t.code === code.toUpperCase());
  if (!league || !team) return null;
  const [roster, extra, picks, swaps, config, standings, block] = await Promise.all([
    teamRoster(team.id),
    teamExtra(team.id),
    leaguePicks(league.id, team.id),
    openSwaps(league.id, team.id),
    league.seasonId
      ? seasonConfig(league.seasonId).then((c) => effectiveConfig(c, league.roundKind, league.roundStage))
      : Promise.resolve(null),
    // Record e posto in conference: dalla classifica, senza scaricare tutte le partite se non servono
    league.seasonId ? currentStandings({ ...league, seasonId: league.seasonId }) : Promise.resolve(null),
    // Giocatori sul mercato: i bot non ne scrivono (la lista si ricava dalla strategia)
    team.ownerId ? tradeBlock(league.id, team.id) : Promise.resolve(null),
  ]);
  const line = standings?.[team.conference].find((l) => l.teamId === team.id) ?? null;
  const onBlock = block
    ? roster.filter((p) => block.get(team.id)?.has(p.id))
    : botTradeBlock(roster, extra.strategy);
  return { league, team, roster, extra, picks, swaps, config, line, onBlock };
}

export function TeamPage() {
  const { id = '', code = '' } = useParams();
  const userId = useUserId();
  const { data, error, loading, reload } = useAsync(() => load(id, code), [id, code]);
  useRoundChange(id, reload);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Squadra non trovata in questa lega.</ErrorText>;
  const { league, team, roster, extra, config, line } = data;
  const mine = team.ownerId === userId;
  const haveTeam = league.teams.some((t) => t.ownerId === userId);
  const teams = new Map(league.teams.map((t) => [t.id, t]));
  const sorted = [...roster].sort((a, b) => overall(b) - overall(a));
  const twoWay = roster.filter((p) => p.contractType === 'two-way').length;
  const payroll = teamPayroll(roster, extra.deadMoney);
  const picks = teamPicks(data.picks, team.id);
  const swaps = teamSwaps(data.swaps, team.id);
  const firstYear = league.seasonYear
    ? contractFirstYear(league.seasonYear, league.roundKind, league.roundStage)
    : null;

  return (
    <div className="space-y-4">
      <PageTitle
        sub={
          team.ownerId
            ? `${mine ? 'La tua squadra' : `Manager: ${team.ownerName ?? 'manager'}`} · ${team.conference === 'East' ? 'Eastern' : 'Western'} Conference, ${team.division}`
            : `Bot ${STRATEGY_LABEL[extra.strategy]} · ${team.conference === 'East' ? 'Eastern' : 'Western'} Conference, ${team.division}`
        }
      >
        <span className="flex items-center gap-2">
          <TeamCode code={team.code} strong={mine} />
          <span className="min-w-0">{team.fullName}</span>
        </span>
      </PageTitle>

      <Card className="space-y-3 !p-4">
        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-xs text-stampa-500 dark:text-stampa-400">Record</dt>
            <dd className="font-semibold">
              {line ? `${line.w}-${line.l}` : '–'}
              {line && line.w + line.l > 0 && (
                <span className="ml-1 font-normal text-stampa-500 dark:text-stampa-400">
                  {line.confRank}ª in conference
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stampa-500 dark:text-stampa-400">Rosa</dt>
            <dd className="font-semibold">
              {roster.length - twoWay} + {twoWay} two-way
            </dd>
          </div>
          <div>
            <dt className="text-xs text-stampa-500 dark:text-stampa-400">Monte stipendi</dt>
            <dd className="font-semibold">{millions(payroll)}</dd>
          </div>
          {config && (
            <div>
              <dt className="text-xs text-stampa-500 dark:text-stampa-400">
                {payroll < config.salaryCap ? 'Spazio sotto il cap' : 'Rispetto alla tassa'}
              </dt>
              <dd
                className={`font-semibold ${payroll > config.luxuryTax ? 'text-red-600 dark:text-red-400' : ''}`}
              >
                {payroll < config.salaryCap
                  ? millions(config.salaryCap - payroll)
                  : payroll > config.luxuryTax
                    ? `${millions(payroll - config.luxuryTax)} sopra`
                    : `${millions(config.luxuryTax - payroll)} sotto`}
              </dd>
            </div>
          )}
        </dl>
        <div className="flex flex-wrap gap-2">
          {mine ? (
            <Link
              to={`/lega/${league.id}/squadra`}
              className={`${LINK} bg-rosso-600 text-white hover:bg-rosso-700`}
            >
              Gestisci la squadra
            </Link>
          ) : (
            haveTeam && (
              <Link
                to={`/lega/${league.id}/mercato?tab=scambi&con=${team.id}`}
                className={`${LINK} bg-rosso-600 text-white hover:bg-rosso-700`}
              >
                Proponi uno scambio
              </Link>
            )
          )}
          <Link
            to={`/lega/${league.id}/cronaca?squadra=${team.code}`}
            className={`${LINK} border border-stampa-300 hover:bg-stampa-50 dark:border-stampa-600 dark:hover:bg-stampa-800`}
          >
            Cronaca della squadra
          </Link>
        </div>
      </Card>

      <Card className="space-y-2 !p-4">
        <h2 className="font-semibold">Sul mercato</h2>
        <p className="text-xs text-stampa-500 dark:text-stampa-400">
          {team.ownerId
            ? mine
              ? 'I giocatori che hai messo sul mercato: li vede tutta la lega.'
              : 'I giocatori che il manager ha messo sul mercato. È un’indicazione: lo scambio va proposto.'
            : `Secondo la strategia del bot (${STRATEGY_LABEL[extra.strategy]}): è indicativo, decide la sua valutazione.`}
        </p>
        {data.onBlock.length === 0 ? (
          <p className="text-sm text-stampa-500 dark:text-stampa-400">Nessun giocatore.</p>
        ) : (
          <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
            {data.onBlock.map((p) => (
              <li key={p.id} className="flex items-center gap-2 py-1">
                <span className="w-8 shrink-0 text-center font-mono font-semibold">{overall(p)}</span>
                <Link
                  to={`/lega/${league.id}/giocatore/${p.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {p.firstName} {p.lastName}
                  <span className="ml-1 text-xs text-stampa-500 dark:text-stampa-400">
                    {p.role} · {p.age} anni · {contractSummary(p, millions)}
                  </span>
                </Link>
                {!mine && haveTeam && (
                  <Link
                    to={`/lega/${league.id}/mercato?tab=scambi&con=${team.id}&prendi=${p.id}`}
                    className="inline-flex min-h-11 shrink-0 items-center rounded-lg px-2 text-xs font-semibold text-rosso-700 hover:bg-rosso-50 dark:text-rosso-300 dark:hover:bg-rosso-950"
                  >
                    Proponi
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {mine && (
          <Link
            to={`/lega/${league.id}/mercato?tab=scambi`}
            className="inline-flex min-h-11 items-center text-sm font-semibold text-rosso-700 hover:underline dark:text-rosso-300"
          >
            Cambia la lista nel mercato
          </Link>
        )}
      </Card>

      <Card className="space-y-2 !p-4">
        <h2 className="font-semibold">Rosa</h2>
        {firstYear !== null && (
          <p className="text-xs text-stampa-500 dark:text-stampa-400">
            Stipendi dalla stagione {firstYear}-{String((firstYear + 1) % 100).padStart(2, '0')}.
          </p>
        )}
        <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
          {sorted.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-2">
              <span className="w-8 shrink-0 text-center font-mono font-semibold">{overall(p)}</span>
              <Link
                to={`/lega/${league.id}/giocatore/${p.id}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {p.firstName} {p.lastName}
                <span className="ml-1 text-xs text-stampa-500 dark:text-stampa-400">
                  {p.role}
                  {p.secondaryRole ? `/${p.secondaryRole}` : ''} · {p.age} anni
                  {p.injury ? ` · infortunato (${p.injury.gamesRemaining})` : ''}
                </span>
              </Link>
              <span className="ml-10 w-full text-xs text-stampa-600 sm:ml-0 sm:w-auto dark:text-stampa-300">
                {contractSummary(p, millions)}
              </span>
            </li>
          ))}
        </ul>
        {extra.deadMoney.length > 0 && (
          <div className="pt-2 text-xs text-stampa-600 dark:text-stampa-300">
            <p className="font-semibold">Stipendi residui dei tagliati</p>
            <ul>
              {extra.deadMoney.map((d, i) => (
                <li key={i}>
                  {d.playerName}: {millions(d.salaries[0] ?? 0)} ·{' '}
                  {d.salaries.length === 1 ? '1 stagione' : `${d.salaries.length} stagioni`}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      <Card className="space-y-3 !p-4">
        <h2 className="font-semibold">Scelte al draft</h2>
        <PickList
          title="Possedute"
          picks={picks.owned}
          teams={teams}
          teamId={team.id}
          empty="Nessuna scelta."
        />
        {picks.traded.length > 0 && (
          <PickList title="Cedute" picks={picks.traded} teams={teams} teamId={team.id} empty="" />
        )}
        {(swaps.held.length > 0 || swaps.given.length > 0) && (
          <div>
            <h3 className="text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
              Swap
            </h3>
            <ul className="text-sm">
              {[...swaps.held, ...swaps.given].map((w) => (
                <li key={w.id} className="py-0.5">
                  {swapText(w, teams, team.id)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}

function pickText(k: PickInfo, teams: Map<string, LeagueTeam>, teamId: string): string {
  const round = k.round === 1 ? '1° giro' : '2° giro';
  const from = k.originalTeamId === teamId ? 'propria' : `di ${teams.get(k.originalTeamId)?.code ?? '?'}`;
  const to = k.ownerTeamId === teamId ? '' : ` → ${teams.get(k.ownerTeamId)?.code ?? '?'}`;
  return `${k.draftYear}, ${round} (${from})${to}${k.protection ? `, protetta top ${k.protection}` : ''}`;
}

function PickList({
  title,
  picks,
  teams,
  teamId,
  empty,
}: {
  title: string;
  picks: PickInfo[];
  teams: Map<string, LeagueTeam>;
  teamId: string;
  empty: string;
}) {
  return (
    <div>
      <h3 className="text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
        {title}
      </h3>
      {picks.length === 0 && <p className="text-sm text-stampa-500 dark:text-stampa-400">{empty}</p>}
      <ul className="text-sm">
        {picks.map((k) => (
          <li key={k.id} className="py-0.5">
            {pickText(k, teams, teamId)}
          </li>
        ))}
      </ul>
    </div>
  );
}

function swapText(w: SwapInfo, teams: Map<string, LeagueTeam>, teamId: string): string {
  const round = w.round === 1 ? 'prima' : 'seconda';
  const other = teams.get(w.holderTeamId === teamId ? w.otherTeamId : w.holderTeamId)?.code ?? '?';
  return w.holderTeamId === teamId
    ? `Può scambiare la sua ${round} scelta ${w.draftYear} con quella di ${other}`
    : `${other} può scambiare la sua ${round} scelta ${w.draftYear} con quella di questa squadra`;
}
