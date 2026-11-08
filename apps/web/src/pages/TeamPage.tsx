// Pagina di una squadra della lega (anche delle altre), nello stile Edicola: record e conti in un tabellino,
// allenatore (idea di gioco, carattere, qualità, contratto, esonerati da pagare), proprietà dei bot (obiettivo,
// carattere del GM, vittorie attese), giocatori sul mercato, rosa con il voto in un quadratino, ruoli e contratti,
// scelte al draft possedute con protezioni e swap. Il bilancio resta riservato. Da qui si propone uno scambio con lei.
import { overall, OWNER_GOAL_LABEL, OWNER_GOAL_TEXT } from '@nbbgm/engine';
import { Link, useParams } from 'react-router';
import {
  GHOST_LINK,
  GroupTitle,
  linkButton,
  META,
  NOTE,
  OvrBox,
  RULE,
  Strip,
} from '../components/inkParts.tsx';
import { CoachCard } from '../components/CoachCard.tsx';
import { ErrorText, Kicker, Leader, SectionTitle, Spinner, Tag, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { ownerTraitsText, teamStaff } from '../lib/coaches.ts';
import { leagueDetail, type LeagueTeam } from '../lib/leagues.ts';
import {
  contractFirstYear,
  effectiveConfig,
  leaguePicks,
  millions,
  seasonConfig,
  type PickInfo,
} from '../lib/market.ts';
import { pickName } from '../lib/marketView.ts';
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

async function load(leagueId: string, code: string) {
  const league = await leagueDetail(leagueId);
  const team = league?.teams.find((t) => t.code === code.toUpperCase());
  if (!league || !team) return null;
  const [roster, extra, picks, swaps, config, standings, block, staff] = await Promise.all([
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
    // Allenatore ed esonerati da pagare (nessuno nelle leghe create prima)
    teamStaff(team.id),
  ]);
  const line = standings?.[team.conference].find((l) => l.teamId === team.id) ?? null;
  const onBlock = block
    ? roster.filter((p) => block.get(team.id)?.has(p.id))
    : botTradeBlock(roster, extra.strategy);
  return { league, team, roster, extra, picks, swaps, config, line, onBlock, staff };
}

export function TeamPage() {
  const { id = '', code = '' } = useParams();
  const userId = useUserId();
  const { data, error, loading, reload } = useAsync(() => load(id, code), [id, code]);
  useRoundChange(id, reload);

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Squadra non trovata in questa lega.</ErrorText>;
  const { league, team, roster, extra, config, line, staff } = data;
  const owner = !team.ownerId ? extra.owner : null;
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
  const conference = team.conference === 'East' ? 'Eastern Conference' : 'Western Conference';

  return (
    <div className="space-y-6">
      <header>
        <Kicker>
          {conference} · {team.division}
        </Kicker>
        <h1 className="flex items-center gap-2 text-3xl leading-tight font-bold">
          <TeamCode code={team.code} strong={mine} />
          <span className="min-w-0">{team.fullName}</span>
        </h1>
        <p className="mt-1 text-sm text-stampa-600 italic dark:text-stampa-300">
          {team.ownerId
            ? mine
              ? 'La tua squadra'
              : `Manager: ${team.ownerName ?? 'manager'}`
            : owner
              ? `Bot · ${OWNER_GOAL_LABEL[owner.goal]} · ${STRATEGY_LABEL[extra.strategy]}`
              : `Bot ${STRATEGY_LABEL[extra.strategy]}`}
        </p>
      </header>

      <div className="space-y-3">
        <Strip
          items={[
            {
              label: 'Record',
              value: line ? `${line.w}-${line.l}` : '–',
              note: line && line.w + line.l > 0 ? `${line.confRank}ª in conference` : undefined,
            },
            { label: 'Rosa', value: `${roster.length - twoWay} + ${twoWay}`, note: 'standard + two-way' },
            { label: 'Monte stipendi', value: millions(payroll) },
            ...(config
              ? [
                  {
                    label: payroll < config.salaryCap ? 'Spazio sotto il cap' : 'Rispetto alla tassa',
                    value:
                      payroll < config.salaryCap
                        ? millions(config.salaryCap - payroll)
                        : payroll > config.luxuryTax
                          ? `${millions(payroll - config.luxuryTax)} sopra`
                          : `${millions(config.luxuryTax - payroll)} sotto`,
                    bad: payroll > config.luxuryTax,
                  },
                ]
              : []),
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {mine ? (
            <Link to={`/lega/${league.id}/squadra`} className={linkButton('accent')}>
              Gestisci la squadra
            </Link>
          ) : (
            haveTeam && (
              <Link
                to={`/lega/${league.id}/mercato?tab=scambi&con=${team.id}`}
                className={linkButton('accent')}
              >
                Proponi uno scambio
              </Link>
            )
          )}
          <Link to={`/lega/${league.id}/cronaca?squadra=${team.code}`} className={linkButton('secondary')}>
            Cronaca della squadra
          </Link>
        </div>
      </div>

      {staff.coach && (
        <section className="space-y-2">
          <SectionTitle>Allenatore</SectionTitle>
          <CoachCard coach={staff.coach} contract={{ label: 'Contratto', salaries: staff.coach.salaries }}>
            {staff.buyouts.length > 0 && (
              <div className="pt-1">
                <GroupTitle>Esonerati ancora da pagare</GroupTitle>
                <div className="text-sm">
                  {staff.buyouts.map((b, i) => (
                    <Leader
                      key={i}
                      label={b.coachName}
                      value={
                        <>
                          <b>{millions(b.salaries[0] ?? 0)}</b>{' '}
                          <i className="text-stampa-600 dark:text-stampa-300">
                            · {b.salaries.length === 1 ? '1 stagione' : `${b.salaries.length} stagioni`}
                          </i>
                        </>
                      }
                    />
                  ))}
                </div>
              </div>
            )}
            <p className={NOTE}>
              {team.ownerId
                ? 'Mette in campo la squadra quando il manager preme Auto o gliela affida, con la sua idea di gioco.'
                : 'Mette in campo la squadra a ogni partita, con la sua idea di gioco.'}{' '}
              La Tattica vale in partita, lo Sviluppo nella crescita dei giovani, la Gestione del gruppo nel
              morale.
            </p>
            {mine && (
              <Link to={`/lega/${league.id}/mercato?tab=allenatori`} className={GHOST_LINK}>
                Cambia allenatore nel mercato
              </Link>
            )}
          </CoachCard>
        </section>
      )}

      {owner && (
        <section className="space-y-2">
          <SectionTitle
            aside={extra.expectedWins !== null ? `attese: ${extra.expectedWins} vittorie` : undefined}
          >
            Proprietà
          </SectionTitle>
          <div>
            <p className="text-sm">
              Obiettivo: <b>{OWNER_GOAL_LABEL[owner.goal]}</b>
            </p>
            <p className={NOTE}>{OWNER_GOAL_TEXT[owner.goal]}</p>
          </div>
          {ownerTraitsText(owner).length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Carattere del GM">
              {ownerTraitsText(owner).map((t) => (
                <li key={t}>
                  <Tag tone="outline">{t}</Tag>
                </li>
              ))}
            </ul>
          )}
          <p className={NOTE}>
            Oggi la squadra è {STRATEGY_LABEL[extra.strategy]}.
            {extra.expectedWins !== null
              ? ` Il proprietario si aspetta ${extra.expectedWins} vittorie: se l’allenatore resta molto sotto, lo cambia.`
              : ''}
          </p>
        </section>
      )}

      <section className="space-y-1">
        <SectionTitle aside={data.onBlock.length ? `${data.onBlock.length}` : undefined}>
          Sul mercato
        </SectionTitle>
        <p className={NOTE}>
          {team.ownerId
            ? mine
              ? 'I giocatori che hai messo sul mercato: li vede tutta la lega.'
              : 'I giocatori che il manager ha messo sul mercato. È un’indicazione: lo scambio va proposto.'
            : `Secondo la strategia del bot (${STRATEGY_LABEL[extra.strategy]}): è indicativo, decide la sua valutazione.`}
        </p>
        {data.onBlock.length === 0 ? (
          <p className="py-1 text-sm">Nessun giocatore.</p>
        ) : (
          <ul>
            {data.onBlock.map((p) => (
              <li key={p.id} className={`flex items-center gap-3 py-1.5 ${RULE}`}>
                <OvrBox value={overall(p)} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/lega/${league.id}/giocatore/${p.id}`}
                    className="block truncate font-bold hover:underline"
                  >
                    {p.firstName} {p.lastName}
                  </Link>
                  <p className={META}>
                    {p.role} · {p.age} anni · {contractSummary(p, millions)}
                  </p>
                </div>
                {!mine && haveTeam && (
                  <Link
                    to={`/lega/${league.id}/mercato?tab=scambi&con=${team.id}&prendi=${p.id}`}
                    className={linkButton('secondary', 'shrink-0 px-3')}
                    aria-label={`Proponi uno scambio per ${p.firstName} ${p.lastName}`}
                  >
                    Proponi
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
        {mine && (
          <Link to={`/lega/${league.id}/mercato?tab=sul-mercato`} className={GHOST_LINK}>
            Cambia la lista nel mercato
          </Link>
        )}
      </section>

      <section className="space-y-1">
        <SectionTitle
          aside={
            firstYear !== null
              ? `stipendi dal ${firstYear}-${String((firstYear + 1) % 100).padStart(2, '0')}`
              : undefined
          }
        >
          Rosa
        </SectionTitle>
        <ul>
          {sorted.map((p) => (
            <li key={p.id} className={`flex items-center gap-3 py-2 ${RULE}`}>
              <OvrBox value={overall(p)} />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/lega/${league.id}/giocatore/${p.id}`}
                  className="block truncate font-bold hover:underline"
                >
                  {p.firstName} {p.lastName}
                </Link>
                <p className={META}>
                  {p.role}
                  {p.secondaryRole ? `/${p.secondaryRole}` : ''} · {p.age} anni
                  <span className="sm:hidden"> · {contractSummary(p, millions)}</span>
                  {p.injury && (
                    <span className="ml-1.5 not-italic">
                      <Tag tone="red">Infortunato · {p.injury.gamesRemaining}</Tag>
                    </span>
                  )}
                </p>
              </div>
              <span className={`hidden shrink-0 text-right sm:block ${META}`}>
                {contractSummary(p, millions)}
              </span>
            </li>
          ))}
        </ul>
        {extra.deadMoney.length > 0 && (
          <div className="pt-3">
            <GroupTitle>Stipendi residui dei tagliati</GroupTitle>
            <div className="text-sm">
              {extra.deadMoney.map((d, i) => (
                <Leader
                  key={i}
                  label={d.playerName}
                  value={
                    <>
                      <b>{millions(d.salaries[0] ?? 0)}</b>{' '}
                      <i className="text-stampa-600 dark:text-stampa-300">
                        · {d.salaries.length === 1 ? '1 stagione' : `${d.salaries.length} stagioni`}
                      </i>
                    </>
                  }
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="space-y-3">
        <SectionTitle>Scelte al draft</SectionTitle>
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
            <GroupTitle>Swap</GroupTitle>
            <ul className="text-sm">
              {[...swaps.held, ...swaps.given].map((w) => (
                <li key={w.id} className={`py-1.5 ${RULE}`}>
                  {swapText(w, teams, team.id)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

/** Da dove viene e dove va una scelta: "propria", "di BOS → NYK", con la protezione. */
function pickDetail(k: PickInfo, teams: Map<string, LeagueTeam>, teamId: string): string {
  const from = k.originalTeamId === teamId ? 'propria' : `di ${teams.get(k.originalTeamId)?.code ?? '?'}`;
  const to = k.ownerTeamId === teamId ? '' : ` → ${teams.get(k.ownerTeamId)?.code ?? '?'}`;
  return `${from}${to}${k.protection ? `, protetta top ${k.protection}` : ''}`;
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
      <GroupTitle>{title}</GroupTitle>
      {picks.length === 0 && <p className="py-1 text-sm">{empty}</p>}
      <ul className="text-sm">
        {picks.map((k) => (
          <li key={k.id} className={`flex flex-wrap items-baseline gap-x-2 py-1.5 ${RULE}`}>
            <span className="font-semibold">{pickName(k)}</span>
            <span className={META}>{pickDetail(k, teams, teamId)}</span>
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
