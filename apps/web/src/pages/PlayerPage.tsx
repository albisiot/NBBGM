// Scheda giocatore nello stile Edicola: nome e voto grande, energia, morale e stato in un tabellino, le stime dello
// staff sui valori nascosti (più precise per i giocatori della propria squadra; i numeri non arrivano mai al client),
// la scheda fisica, il contratto stagione per stagione, le statistiche, le abilità "a pagella" per gruppi e le
// tendenze. Per i propri giocatori anche taglio e rinnovo, che si eseguono alla chiusura del turno.
import {
  BODY_PART_LABEL,
  overall,
  RATING_FIELDS,
  seasonLabel,
  TENDENCY_FIELDS,
  type BodyPart,
} from '@nbbgm/engine';
import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  BAD,
  Bar,
  BOX,
  GradeRow,
  GroupTitle,
  linkButton,
  META,
  NOTE,
  Strip,
} from '../components/inkParts.tsx';
import {
  Button,
  ConfirmButton,
  ErrorText,
  Kicker,
  Leader,
  SectionTitle,
  Spinner,
  Tag,
} from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { compareWith } from '../lib/compare.ts';
import { friendlyError } from '../lib/errors.ts';
import { leagueDetail } from '../lib/leagues.ts';
import {
  contractFirstYear,
  marketAction,
  millions,
  myRequests,
  renewalAsk,
  seasonConfig,
  type RosterRequest,
} from '../lib/market.ts';
import { contractEnd, gradeTone, LOW_ENERGY, LOW_MORALE, mln1 } from '../lib/marketView.ts';
import { playerCard, playerScouting, type RosterPlayer } from '../lib/roster.ts';
import { useAsync } from '../lib/useAsync.ts';

const CONTRACT_LABEL: Record<string, string> = {
  standard: 'standard',
  rookie: 'da rookie',
  'two-way': 'two-way',
  'ten-day': 'di 10 giorni',
  minimum: 'al minimo',
  unknown: 'non noto',
};

export function PlayerPage() {
  const { id = '', pid = '' } = useParams();
  const userId = useUserId();
  const { data, error, loading, reload } = useAsync(async () => {
    const [player, scouting, league] = await Promise.all([
      playerCard(pid),
      playerScouting(pid),
      leagueDetail(id),
    ]);
    const mine = league?.teams.find((t) => t.ownerId === userId);
    const own = mine !== undefined && player?.teamId === mine.id;
    const [config, requests] =
      own && league?.seasonId
        ? await Promise.all([seasonConfig(league.seasonId), myRequests(mine.id)])
        : [null, [] as RosterRequest[]];
    return { player, scouting, league, config, requests, own };
  }, [id, pid, userId]);

  if (loading) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data?.player) return <ErrorText>Giocatore non trovato.</ErrorText>;
  const { player: p, scouting: s, league } = data;
  const team = league?.teams.find((t) => t.id === p.teamId);
  // Dopo il draft dell'offseason i contratti sono già scalati: il primo stipendio è della stagione che arriva
  const year = contractFirstYear(
    league?.seasonYear ?? 2026,
    league?.roundKind ?? null,
    league?.roundStage ?? null,
  );
  const games = p.stats.g ?? 0;
  const perGame = (k: string) => (games > 0 ? ((p.stats[k] ?? 0) / games).toFixed(1).replace('.', ',') : '—');
  const groups = [...new Set(RATING_FIELDS.map((f) => f.group))];
  const tendencyGroups = [...new Set(TENDENCY_FIELDS.map((f) => f.group))];
  const ovr = Math.round(overall(p));
  const lowEnergy = p.energy < LOW_ENERGY;
  const lowMorale = p.morale < LOW_MORALE;
  const roles = `${p.role}${p.secondaryRole ? `/${p.secondaryRole}` : ''}`;
  const compare = (
    <Link to={compareWith(id, p.id)} className={linkButton('secondary', 'flex-1')}>
      Confronta
    </Link>
  );

  return (
    <div className="space-y-5">
      {team ? (
        <Link
          to={`/lega/${id}/squadre/${team.code}`}
          className="-mt-2 inline-flex min-h-11 items-center text-sm font-semibold italic underline-offset-4 hover:underline"
        >
          ‹ {team.fullName}
        </Link>
      ) : (
        <Link
          to={`/lega/${id}/mercato?tab=svincolati`}
          className="-mt-2 inline-flex min-h-11 items-center text-sm font-semibold italic underline-offset-4 hover:underline"
        >
          ‹ Svincolati
        </Link>
      )}

      <header className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <Kicker>
            {roles} · {team?.fullName ?? 'Svincolato'}
          </Kicker>
          <h1 className="text-4xl leading-none font-bold break-words">
            {p.firstName} {p.lastName}
          </h1>
          <p className="mt-1 text-sm text-stampa-600 italic dark:text-stampa-300">
            {p.age} anni · {p.heightCm} cm · {p.hand === 'L' ? 'mancino' : 'destro'} · {p.archetype}
          </p>
        </div>
        <div className="flex size-16 shrink-0 flex-col items-center justify-center bg-stampa-900 text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900">
          <span className="font-titolo text-3xl leading-none font-bold">{ovr}</span>
          <span className="font-titolo text-[0.625rem] font-medium tracking-[0.14em] uppercase">Overall</span>
        </div>
      </header>

      <Strip
        cols="sm:grid-cols-3"
        items={[
          {
            label: 'Energia',
            value: (
              <>
                {Math.round(p.energy)}
                <Bar value={p.energy} bad={lowEnergy} />
              </>
            ),
            bad: lowEnergy,
            note: lowEnergy ? 'stanco: rende meno' : undefined,
          },
          {
            label: 'Morale',
            value: (
              <>
                {Math.round(p.morale)}
                <Bar value={p.morale} bad={lowMorale} />
              </>
            ),
            bad: lowMorale,
            note: lowMorale ? 'basso: non rinnova' : undefined,
          },
          {
            label: 'Stato',
            value: p.injury ? 'Infortunato' : 'Sano',
            bad: p.injury !== null,
            note: p.injury
              ? `${BODY_PART_LABEL[p.injury.bodyPart as BodyPart]}, ancora ${p.injury.gamesRemaining} ${
                  p.injury.gamesRemaining === 1 ? 'partita' : 'partite'
                }`
              : undefined,
            wide: true,
          },
        ]}
      />

      {data.own && data.config && league ? (
        <OwnPlayerMarket
          leagueId={league.id}
          player={p}
          renewal={renewalAsk(data.config, p)}
          requests={data.requests.filter((r) => r.playerId === p.id)}
          marketOpen={league.roundKind === 'regular' || league.roundKind === 'offseason'}
          renewOpen={league.roundKind === 'regular'}
          onDone={reload}
          compare={compare}
        />
      ) : (
        <div className="flex sm:max-w-md">{compare}</div>
      )}

      <section aria-labelledby="stime" className={`${BOX} space-y-1 px-3 py-2.5`}>
        <h2
          id="stime"
          className="flex items-baseline justify-between gap-2 text-sm font-semibold tracking-wider"
        >
          Le stime dello staff
          {s.own && (
            <span className="font-serif text-[0.8125rem] font-normal tracking-normal normal-case italic">
              della tua squadra: più precise
            </span>
          )}
        </h2>
        <div className="grid gap-x-5 text-sm sm:grid-cols-2">
          <Leader label={<Muted>Potenziale</Muted>} value={<b>{s.potential}</b>} />
          <Leader label={<Muted>Etica del lavoro</Muted>} value={<b>{s.work_ethic ?? '—'}</b>} />
          <Leader
            label={<Muted>Costanza in attacco</Muted>}
            value={<b>{s.offensive_consistency ?? '—'}</b>}
          />
          <Leader label={<Muted>Costanza in difesa</Muted>} value={<b>{s.defensive_consistency ?? '—'}</b>} />
        </div>
        <p className={s.risks.length ? `text-[0.8125rem] italic ${BAD}` : NOTE}>
          {s.risks.length ? `Da tenere d’occhio: ${s.risks.join(', ')}.` : 'Nessun punto debole noto.'}
        </p>
      </section>

      <section className="space-y-1">
        <SectionTitle>La scheda</SectionTitle>
        <div className="grid gap-x-5 text-sm sm:grid-cols-2">
          <Leader label={<Muted>Altezza</Muted>} value={`${p.heightCm} cm`} />
          <Leader label={<Muted>Apertura alare</Muted>} value={`${p.wingspanCm} cm`} />
          <Leader label={<Muted>Peso</Muted>} value={`${p.weightKg} kg`} />
          <Leader label={<Muted>Mano</Muted>} value={p.hand === 'L' ? 'sinistra' : 'destra'} />
          <Leader label={<Muted>Nazionalità</Muted>} value={p.nationality || '—'} />
          <Leader label={<Muted>Anni nella lega</Muted>} value={p.yearsInLeague ?? '—'} />
        </div>
      </section>

      <section className="space-y-1">
        <SectionTitle
          aside={p.salaries.length > 0 ? `fino al ${contractEnd(year, p.salaries.length)}` : undefined}
        >
          Contratto {p.contractType ? CONTRACT_LABEL[p.contractType] : ''}
        </SectionTitle>
        {p.salaries.length === 0 ? (
          <p className="py-1 text-sm">
            {p.contractType === 'two-way'
              ? 'Stipendio fisso da two-way.'
              : p.contractType
                ? 'In scadenza: la squadra può rinnovarlo nel turno dei rinnovi, altrimenti diventa svincolato.'
                : 'Nessun contratto.'}
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-y-2 pt-1 text-center">
              {p.salaries.map((sal, i) => (
                <div key={i}>
                  <dt className="font-titolo text-xs font-medium text-stampa-600 dark:text-stampa-300">
                    {seasonLabel(year + i)}
                  </dt>
                  <dd className="font-titolo text-lg font-bold">{mln1(sal)}</dd>
                  {p.options[i] && (
                    <dd className="text-[0.8125rem] italic">
                      opzione {p.options[i] === 'player' ? 'giocatore' : 'squadra'}
                    </dd>
                  )}
                </div>
              ))}
            </dl>
            <p className={`text-right ${NOTE}`}>milioni di dollari</p>
          </>
        )}
      </section>

      <section className="space-y-1">
        <SectionTitle aside={games ? `${games} ${games === 1 ? 'partita' : 'partite'}` : undefined}>
          {league?.seasonYear ? `Stagione ${seasonLabel(league.seasonYear)}` : 'La stagione'}
        </SectionTitle>
        {games === 0 ? (
          <p className="py-1 text-sm">Nessuna partita giocata.</p>
        ) : (
          <dl className="grid grid-cols-5 pt-1 text-center">
            <Stat
              label="Min"
              title="Minuti"
              value={((p.stats.seconds ?? 0) / 60 / games).toFixed(1).replace('.', ',')}
            />
            <Stat label="Pt" title="Punti" value={perGame('pts')} />
            <Stat
              label="Rim"
              title="Rimbalzi"
              value={(((p.stats.orb ?? 0) + (p.stats.drb ?? 0)) / games).toFixed(1).replace('.', ',')}
            />
            <Stat label="Ast" title="Assist" value={perGame('ast')} />
            <Stat label="Rub" title="Rubate" value={perGame('stl')} />
          </dl>
        )}
        {games > 0 && <p className={`text-right ${NOTE}`}>a partita</p>}
      </section>

      <section className="space-y-2">
        <SectionTitle aside={`${RATING_FIELDS.length} voci`}>Le pagelle</SectionTitle>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {groups.map((g) => (
            <div key={g}>
              <GroupTitle>{g}</GroupTitle>
              {RATING_FIELDS.filter((f) => f.group === g).map((f) => {
                const v = Math.round(p.ratings[f.key]);
                return <GradeRow key={f.key} label={f.label} value={v} tone={gradeTone(v)} />;
              })}
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <SectionTitle>Le tendenze</SectionTitle>
        <p className={NOTE}>Quanto spesso sceglie una giocata, da 0 a 100: non dicono quanto è bravo.</p>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
          {tendencyGroups.map((g) => (
            <div key={g}>
              <GroupTitle>{g}</GroupTitle>
              {TENDENCY_FIELDS.filter((f) => f.group === g).map((f) => (
                <GradeRow key={f.key} label={f.label} value={Math.round(p.tendencies[f.key])} />
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function Muted({ children }: { children: ReactNode }) {
  return <span className="text-stampa-600 dark:text-stampa-300">{children}</span>;
}

function Stat({ label, title, value }: { label: string; title: string; value: string }) {
  return (
    <div>
      <dt className="font-titolo text-xs font-medium tracking-wider text-stampa-600 uppercase dark:text-stampa-300">
        <abbr title={title} className="no-underline">
          {label}
        </abbr>
        <span className="sr-only"> ({title})</span>
      </dt>
      <dd className="font-titolo text-xl font-bold">{value}</dd>
    </div>
  );
}

/**
 * Taglio e rinnovo di un giocatore della propria squadra, accanto a Confronta: si eseguono alla chiusura del turno.
 */
function OwnPlayerMarket({
  leagueId,
  player: p,
  renewal,
  requests,
  marketOpen,
  renewOpen,
  onDone,
  compare,
}: {
  leagueId: string;
  player: RosterPlayer;
  renewal: number[];
  requests: RosterRequest[];
  marketOpen: boolean;
  /** Rinnovo all'ultimo anno: in regular season (in offseason si rinnovano i giocatori in scadenza). */
  renewOpen: boolean;
  onDone: () => void;
  /** Il link Confronta, nella stessa fila del taglio. */
  compare: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const residual = p.contractType === 'two-way' ? 0 : p.salaries.reduce((a, b) => a + b, 0);
  const lastYear = p.contractType !== 'two-way' && p.salaries.length === 1;
  const release = requests.find((r) => r.kind === 'release');
  const renew = requests.find((r) => r.kind === 'renew');

  async function run(action: Parameters<typeof marketAction>[1]) {
    setBusy(true);
    setMessage(null);
    try {
      await marketAction(leagueId, action);
      onDone();
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Contratto e rosa" className="space-y-2">
      <div className="flex gap-2 sm:max-w-md">
        {compare}
        {!release && marketOpen && (
          <ConfirmButton
            variant="secondary"
            className="flex-1"
            disabled={busy}
            confirmLabel="Confermi il taglio?"
            onConfirm={() => void run({ kind: 'release', player_id: p.id })}
          >
            Taglia
          </ConfirmButton>
        )}
      </div>
      {!marketOpen && <p className={NOTE}>Durante play-in e playoff non si taglia e non si rinnova.</p>}
      {release ? (
        <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${BOX}`}>
          <span>
            <Tag tone="red">Taglio chiesto</Tag>{' '}
            <span className={META}>si esegue alla chiusura del turno.</span>
          </span>
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => void run({ kind: 'withdraw_request', request_id: release.id })}
          >
            Annulla
          </Button>
        </div>
      ) : (
        marketOpen && (
          <p className={NOTE}>
            {residual
              ? `Se lo tagli, lo stipendio residuo (${millions(residual)} in tutto) resta a tuo carico, sul cap e sul bilancio, fino alla scadenza.`
              : 'Se lo tagli, non restano stipendi residui.'}
          </p>
        )
      )}
      {lastYear &&
        (renew ? (
          <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${BOX}`}>
            <span>
              <Tag tone="ink">Rinnovo accettato</Tag>{' '}
              <span className={META}>
                {renew.salaries.length} anni, {millions(renew.salaries[0] ?? 0)} il primo, dalla prossima
                stagione. Si firma alla chiusura del turno.
              </span>
            </span>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void run({ kind: 'withdraw_request', request_id: renew.id })}
            >
              Annulla
            </Button>
          </div>
        ) : (
          renewOpen && (
            <div className={`space-y-2 px-3 py-2.5 text-sm ${BOX}`}>
              <p>
                <b>Ultimo anno di contratto.</b>{' '}
                {p.morale < LOW_MORALE ? (
                  <span className={BAD}>Con il morale così basso non vuole rinnovare.</span>
                ) : (
                  `Per rinnovare chiede ${renewal.length} anni, ${millions(renewal[0] ?? 0)} il primo (+5% l'anno), dalla prossima stagione.`
                )}
              </p>
              {p.morale >= LOW_MORALE && (
                <Button disabled={busy} onClick={() => void run({ kind: 'renew', player_id: p.id })}>
                  Accetta il rinnovo
                </Button>
              )}
            </div>
          )
        ))}
      {message && <ErrorText>{message}</ErrorText>}
    </section>
  );
}
