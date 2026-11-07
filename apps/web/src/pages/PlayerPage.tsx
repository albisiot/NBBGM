// Scheda giocatore: dati, abilità e tendenze, contratto, energia e morale, infortunio, statistiche e le stime
// dei valori nascosti (più precise per i giocatori della propria squadra; i numeri non arrivano mai al client).
import {
  BODY_PART_LABEL,
  overall,
  RATING_FIELDS,
  seasonLabel,
  TENDENCY_FIELDS,
  type BodyPart,
} from '@nbbgm/engine';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, ConfirmButton, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { compareWith } from '../lib/compare.ts';
import { formatSalary } from '../lib/draft.ts';
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
  const perGame = (k: string) => (games > 0 ? ((p.stats[k] ?? 0) / games).toFixed(1) : '—');
  const groups = [...new Set(RATING_FIELDS.map((f) => f.group))];
  const tendencyGroups = [...new Set(TENDENCY_FIELDS.map((f) => f.group))];

  return (
    <div className="space-y-4">
      <PageTitle
        sub={`${team?.fullName ?? 'Svincolato'} · ${p.role}${p.secondaryRole ? `/${p.secondaryRole}` : ''} · ${p.archetype}`}
      >
        {p.firstName} {p.lastName}
      </PageTitle>
      <Link
        to={compareWith(id, p.id)}
        className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-800"
      >
        Confronta con altri giocatori
      </Link>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <div className="flex items-end gap-4">
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Overall</p>
              <p className="text-4xl font-bold">{Math.round(overall(p))}</p>
            </div>
            <div>
              <p className="text-xs text-slate-500 dark:text-slate-400">Potenziale (stima)</p>
              <p className="text-2xl font-semibold">{s.potential}</p>
            </div>
          </div>
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-500 dark:text-slate-400">Età</dt>
            <dd>{p.age} anni</dd>
            <dt className="text-slate-500 dark:text-slate-400">Altezza</dt>
            <dd>{p.heightCm} cm</dd>
            <dt className="text-slate-500 dark:text-slate-400">Apertura alare</dt>
            <dd>{p.wingspanCm} cm</dd>
            <dt className="text-slate-500 dark:text-slate-400">Peso</dt>
            <dd>{p.weightKg} kg</dd>
            <dt className="text-slate-500 dark:text-slate-400">Mano</dt>
            <dd>{p.hand === 'L' ? 'sinistra' : 'destra'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Nazionalità</dt>
            <dd>{p.nationality || '—'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Anni nella lega</dt>
            <dd>{p.yearsInLeague ?? '—'}</dd>
          </dl>
        </Card>

        <Card className="space-y-2 text-sm">
          <Meter label="Energia" value={p.energy} />
          <Meter label="Morale" value={p.morale} />
          {p.injury ? (
            <p className="text-red-600">
              Infortunato: {BODY_PART_LABEL[p.injury.bodyPart as BodyPart]}, ancora {p.injury.gamesRemaining}{' '}
              {p.injury.gamesRemaining === 1 ? 'partita' : 'partite'}.
            </p>
          ) : (
            <p className="text-green-700">In salute.</p>
          )}
          <h3 className="pt-2 font-semibold">Stime {s.own ? '(della tua squadra: più precise)' : ''}</h3>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-slate-500 dark:text-slate-400">Costanza in attacco</dt>
            <dd>{s.offensive_consistency ?? '—'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Costanza in difesa</dt>
            <dd>{s.defensive_consistency ?? '—'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">Etica del lavoro</dt>
            <dd>{s.work_ethic ?? '—'}</dd>
            <dt className="text-slate-500 dark:text-slate-400">A rischio</dt>
            <dd>{s.risks.length ? s.risks.join(', ') : 'nessun punto debole noto'}</dd>
          </dl>
        </Card>
      </div>

      <Card>
        <h2 className="mb-2 font-semibold">
          Contratto {p.contractType ? CONTRACT_LABEL[p.contractType] : ''}
        </h2>
        {p.salaries.length === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">
            {p.contractType === 'two-way'
              ? 'Stipendio fisso da two-way.'
              : p.contractType
                ? 'In scadenza: la squadra può rinnovarlo nel turno dei rinnovi, altrimenti diventa svincolato.'
                : 'Nessun contratto.'}
          </p>
        ) : (
          <ul className="grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
            {p.salaries.map((sal, i) => (
              <li key={i}>
                <span className="text-slate-500 dark:text-slate-400">{seasonLabel(year + i)}</span>{' '}
                {formatSalary(sal)}
                {p.options[i] && (
                  <span className="ml-1 text-xs text-orange-700">
                    opzione {p.options[i] === 'player' ? 'giocatore' : 'squadra'}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {data.own && data.config && league && (
        <OwnPlayerMarket
          leagueId={league.id}
          player={p}
          renewal={renewalAsk(data.config, p)}
          requests={data.requests.filter((r) => r.playerId === p.id)}
          marketOpen={league.roundKind === 'regular' || league.roundKind === 'offseason'}
          renewOpen={league.roundKind === 'regular'}
          onDone={reload}
        />
      )}

      <Card>
        <h2 className="mb-2 font-semibold">Statistiche della stagione</h2>
        {games === 0 ? (
          <p className="text-sm text-slate-500 dark:text-slate-400">Nessuna partita giocata.</p>
        ) : (
          <dl className="grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-6">
            <Stat label="Partite" value={String(games)} />
            <Stat label="Minuti" value={games ? ((p.stats.seconds ?? 0) / 60 / games).toFixed(1) : '—'} />
            <Stat label="Punti" value={perGame('pts')} />
            <Stat
              label="Rimbalzi"
              value={games ? (((p.stats.orb ?? 0) + (p.stats.drb ?? 0)) / games).toFixed(1) : '—'}
            />
            <Stat label="Assist" value={perGame('ast')} />
            <Stat label="Rubate" value={perGame('stl')} />
          </dl>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        {groups.map((g) => (
          <Card key={g}>
            <h2 className="mb-2 font-semibold">{g}</h2>
            {RATING_FIELDS.filter((f) => f.group === g).map((f) => (
              <Rating key={f.key} label={f.label} value={p.ratings[f.key]} />
            ))}
          </Card>
        ))}
        {tendencyGroups.map((g) => (
          <Card key={g}>
            <h2 className="mb-2 font-semibold">{g}</h2>
            {TENDENCY_FIELDS.filter((f) => f.group === g).map((f) => (
              <Rating key={f.key} label={f.label} value={p.tendencies[f.key]} muted />
            ))}
          </Card>
        ))}
      </div>
    </div>
  );
}

function Rating({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  const color = muted
    ? 'bg-slate-400'
    : value >= 80
      ? 'bg-green-500'
      : value >= 60
        ? 'bg-orange-500'
        : 'bg-slate-400';
  return (
    <div className="flex items-center gap-2 py-0.5 text-sm">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded bg-slate-200 dark:bg-slate-700">
        <span className={`block h-full ${color}`} style={{ width: `${value}%` }} />
      </span>
      <span className="w-7 text-right font-mono">{Math.round(value)}</span>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }) {
  return <Rating label={label} value={value} />;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-lg font-semibold">{value}</dd>
    </div>
  );
}

/** Taglio e rinnovo di un giocatore della propria squadra: si eseguono alla chiusura del turno. */
function OwnPlayerMarket({
  leagueId,
  player: p,
  renewal,
  requests,
  marketOpen,
  renewOpen,
  onDone,
}: {
  leagueId: string;
  player: RosterPlayer;
  renewal: number[];
  requests: RosterRequest[];
  marketOpen: boolean;
  /** Rinnovo all'ultimo anno: in regular season (in offseason si rinnovano i giocatori in scadenza). */
  renewOpen: boolean;
  onDone: () => void;
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
    <Card className="space-y-3 text-sm">
      <h2 className="font-semibold">Contratto e rosa</h2>
      {!marketOpen && (
        <p className="text-slate-500 dark:text-slate-400">
          Durante play-in e playoff non si taglia e non si rinnova.
        </p>
      )}
      {release ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-orange-50 p-3 dark:bg-orange-950">
          <span>Taglio chiesto: si esegue alla chiusura del turno.</span>
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
          <div className="space-y-1">
            <ConfirmButton
              variant="secondary"
              disabled={busy}
              confirmLabel="Confermi il taglio?"
              onConfirm={() => void run({ kind: 'release', player_id: p.id })}
            >
              Taglia
            </ConfirmButton>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              {residual
                ? `Lo stipendio residuo (${millions(residual)} in tutto) resta a tuo carico, sul cap e sul bilancio, fino alla scadenza.`
                : 'Senza stipendi residui.'}
            </p>
          </div>
        )
      )}
      {lastYear &&
        (renew ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-green-50 p-3 dark:bg-green-950">
            <span>
              Rinnovo accettato: {renew.salaries.length} anni, {millions(renew.salaries[0] ?? 0)} il primo,
              dalla prossima stagione. Si firma alla chiusura del turno.
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
            <div className="space-y-1">
              <p>
                Ultimo anno di contratto.{' '}
                {p.morale < 30
                  ? 'Con il morale così basso non vuole rinnovare.'
                  : `Per rinnovare chiede ${renewal.length} anni, ${millions(renewal[0] ?? 0)} il primo (+5% l'anno), dalla prossima stagione.`}
              </p>
              {p.morale >= 30 && (
                <Button disabled={busy} onClick={() => void run({ kind: 'renew', player_id: p.id })}>
                  Accetta il rinnovo
                </Button>
              )}
            </div>
          )
        ))}
      {message && <ErrorText>{message}</ErrorText>}
    </Card>
  );
}
