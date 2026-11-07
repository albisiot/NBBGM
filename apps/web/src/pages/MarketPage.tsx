// Mercato della propria squadra: svincolati (offerte a busta chiusa), scambi (proposte ricevute e inviate, nuova
// proposta con giocatori, scelte protette e swap) e bilancio. Tutto si esegue alla chiusura del turno.
import { MAX_PROTECTION, overall, TRADE_DEADLINE_TURN, type SeasonConfig } from '@nbbgm/engine';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  Button,
  Card,
  ConfirmButton,
  ErrorText,
  PageTitle,
  Segmented,
  Spinner,
  TeamCode,
  Toast,
  type ToastMessage,
} from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { friendlyError } from '../lib/errors.ts';
import { leagueDetail, type LeagueDetail, type LeagueTeam } from '../lib/leagues.ts';
import {
  AGE_BANDS,
  ASK_BANDS,
  BID_STATUS,
  DEFAULT_FA_QUERY,
  effectiveConfig,
  FA_PAGE,
  FA_SORTS,
  filterFreeAgents,
  minimumOf,
  expiringAskOf,
  faRoundOf,
  freeAgentAsk,
  myRequests,
  type RosterRequest,
  leaguePicks,
  mergePicks,
  missingPickIds,
  LEDGER_LABEL,
  marketAction,
  millions,
  missingPlayerIds,
  picksByIds,
  myBids,
  offerInput,
  offerSalary,
  projectedTax,
  salaryRunOf,
  seasonConfig,
  teamFinance,
  TRADE_STATUS,
  tradeOffers,
  type AgeBand,
  type AskBand,
  type Bid,
  type Finance,
  type FreeAgentQuery,
  type FreeAgentSort,
  type MarketAction,
  type PickInfo,
  type TradeOffer,
} from '../lib/market.ts';
import {
  freeAgentPlayers,
  liteOf,
  playersLite,
  teamRoster,
  type FreeAgent,
  type PlayerLite,
  type RosterPlayer,
} from '../lib/roster.ts';
import { openSwaps, teamExtra } from '../lib/teams.ts';
import { botTradeBlock, tradeBlock } from '../lib/tradeBlock.ts';
import { tradePreview, type TradePreview } from '../lib/tradePreview.ts';
import { LeagueBlock, MyBlock, PreviewCard } from '../components/TradeBlock.tsx';
import { TeamNeedsCard } from '../components/TeamNeedsCard.tsx';
import { compareWith } from '../lib/compare.ts';
import { SKILL_LABEL, skillOf, type SkillKey } from '../lib/skills.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';

type Tab = 'svincolati' | 'scambi' | 'rinnovi' | 'bilancio';

const SELECT =
  'min-h-11 min-w-0 rounded-lg border border-stampa-300 bg-stampa-25 px-2 text-sm dark:border-stampa-600 dark:bg-stampa-800';

/** Dati del turno: rosa, svincolati, scelte, bilancio cambiano solo alla chiusura del turno. */
interface MarketBase {
  league: LeagueDetail;
  me: LeagueTeam;
  config: SeasonConfig;
  finance: Finance;
  roster: RosterPlayer[];
  freeAgents: FreeAgent[];
  picks: PickInfo[];
  /** Turno di free agency dell'offseason (0-3), o null. */
  faRound: number | null;
}

/** Quello che cambia con le azioni del manager nel turno, con i giocatori che vi compaiono. */
interface MarketLive {
  bids: Bid[];
  offers: TradeOffer[];
  requests: RosterRequest[];
  players: Map<string, PlayerLite>;
  /** Scelte citate dalle proposte, oltre a quelle della propria squadra (anche già usate). */
  offerPicks: Map<string, PickInfo>;
}

type MarketData = MarketBase & MarketLive;

/**
 * Offerte, proposte di scambio e richieste; dei giocatori e delle scelte citati si scaricano solo quelli che la
 * pagina non conosce già (known: rosa, svincolati e quelli letti prima; knownPicks: le scelte della propria squadra e
 * quelle lette prima).
 */
async function loadLive(
  league: LeagueDetail,
  me: LeagueTeam,
  known: ReadonlyMap<string, PlayerLite>,
  knownPicks: ReadonlyMap<string, PickInfo>,
): Promise<MarketLive> {
  const [bids, offers, requests] = await Promise.all([
    myBids(me.id),
    tradeOffers(league.id),
    myRequests(me.id),
  ]);
  const players = new Map(known);
  const missing = missingPlayerIds(offers, bids, known);
  const offerPicks = new Map(knownPicks);
  const missingPicks = missingPickIds(offers, knownPicks);
  const [lite, picks] = await Promise.all([
    missing.length > 0 ? playersLite(missing) : new Map<string, PlayerLite>(),
    missingPicks.length > 0 ? picksByIds(missingPicks) : [],
  ]);
  for (const [pid, p] of lite) players.set(pid, p);
  for (const k of picks) offerPicks.set(k.id, k);
  return { bids, offers, requests, players, offerPicks };
}

export function MarketPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [search, setSearch] = useSearchParams();
  const tab = (search.get('tab') as Tab | null) ?? 'svincolati';
  const {
    data: loaded,
    error,
    loading,
    reload,
  } = useAsync(async (): Promise<MarketData | null> => {
    const league = await leagueDetail(id);
    const me = league?.teams.find((t) => t.ownerId === userId);
    if (!league || !me || !league.seasonId) return null;
    const [config, finance, roster, freeAgents, picks] = await Promise.all([
      seasonConfig(league.seasonId).then((c) => effectiveConfig(c, league.roundKind, league.roundStage)),
      teamFinance(me.id),
      teamRoster(me.id),
      freeAgentPlayers(league.id),
      // Solo le scelte della propria squadra: quelle dell'altra parte si leggono scegliendola
      leaguePicks(league.id, me.id),
    ]);
    const known = new Map([...roster, ...freeAgents].map((p) => [p.id, liteOf(p)]));
    const live = await loadLive(league, me, known, new Map(picks.map((k) => [k.id, k])));
    const faRound = league.roundKind === 'offseason' ? faRoundOf(league.roundStage) : null;
    return { league, me, config, finance, roster, freeAgents, picks, faRound, ...live };
  }, [id, userId]);
  // Turno nuovo: si rilegge tutto (rosa, svincolati, bilancio, offerte e scambi cambiano)
  useRoundChange(id, reload);
  // Dopo un'azione si rileggono solo offerte, scambi e richieste: valgono per i dati del turno con cui sono letti
  const [live, setLive] = useState<{ of: MarketData; value: MarketLive } | null>(null);
  const data = useMemo(
    () => (loaded && live?.of === loaded ? { ...loaded, ...live.value } : loaded),
    [loaded, live],
  );
  const [busy, setBusy] = useState(false);
  // L'esito delle azioni compare in basso, vicino a dove si è toccato anche in fondo a una lista lunga
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const closeMessage = useCallback(() => setMessage(null), []);

  async function run(action: MarketAction, ok: string): Promise<boolean> {
    setBusy(true);
    setMessage(null);
    try {
      await marketAction(id, action);
    } catch (e) {
      setMessage({ ok: false, text: friendlyError(e) });
      setBusy(false);
      return false;
    }
    setMessage({ ok: true, text: ok });
    if (loaded && data) {
      try {
        setLive({
          of: loaded,
          value: await loadLive(data.league, data.me, data.players, data.offerPicks),
        });
      } catch {
        // Rilettura breve non riuscita: si rilegge tutto
        reload();
      }
    }
    setBusy(false);
    return true;
  }

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Non hai una squadra in questa lega.</ErrorText>;
  const regular = data.league.roundKind === 'regular';
  const offseason = data.league.roundKind === 'offseason';
  const renewals = offseason && data.league.roundStage === 'renewals';
  const signing = regular || data.faRound !== null;

  return (
    <div className="space-y-4">
      <PageTitle sub="Offerte, scambi, tagli e rinnovi si eseguono alla chiusura del turno.">
        Mercato
      </PageTitle>
      <FinanceSummary data={data} />
      <Segmented
        label="Sezione"
        value={tab}
        onChange={(t) => setSearch({ tab: t }, { replace: true })}
        options={[
          { label: 'Svincolati', value: 'svincolati' },
          { label: 'Scambi', value: 'scambi' },
          ...(renewals ? [{ label: 'Rinnovi', value: 'rinnovi' as Tab }] : []),
          { label: 'Bilancio', value: 'bilancio' },
        ]}
      />
      {!regular && !offseason && tab !== 'bilancio' && (
        <p className="text-sm text-stampa-600 dark:text-stampa-300">
          Durante play-in e playoff il mercato è chiuso (gli scambi si fermano dopo la giornata{' '}
          {TRADE_DEADLINE_TURN + 1} e riaprono nell’offseason).
        </p>
      )}
      {tab === 'svincolati' && !signing && (
        <p className="text-sm text-stampa-600 dark:text-stampa-300">
          Gli svincolati si firmano in regular season e nei quattro turni di free agency dell’offseason.
        </p>
      )}
      {data.faRound !== null && (
        <p className="text-sm text-stampa-600 dark:text-stampa-300">
          Free agency, turno {data.faRound + 1} di 4: anche i bot fanno le loro offerte, e le richieste
          scendono di turno in turno. Fino a 21 giocatori in rosa nell’offseason; contratti e cap sono già
          quelli della prossima stagione.
        </p>
      )}
      {tab === 'rinnovi' && renewals && <Renewals data={data} busy={busy} run={run} />}
      {tab === 'svincolati' && <FreeAgents data={data} busy={busy} run={run} />}
      {tab === 'scambi' && <Trades data={data} busy={busy} run={run} notify={setMessage} />}
      {tab === 'bilancio' && <Ledger data={data} />}
      <Toast message={message} onClose={closeMessage} />
    </div>
  );
}

function FinanceSummary({ data }: { data: MarketData }) {
  const { config, finance, roster } = data;
  const twoWay = roster.filter((p) => p.contractType === 'two-way').length;
  const standard = roster.length - twoWay;
  const tax = projectedTax(config, finance);
  const items: { label: string; value: string; warn?: boolean }[] = [
    { label: 'Saldo', value: millions(finance.balance), warn: finance.balance < 0 },
    { label: 'Monte stipendi', value: millions(finance.payroll) },
    {
      label: 'Spazio sotto il cap',
      value: finance.payroll < config.salaryCap ? millions(config.salaryCap - finance.payroll) : 'nessuno',
    },
    {
      label: tax > 0 ? 'Luxury tax stimata' : 'Margine dalla tassa',
      value: tax > 0 ? millions(tax) : millions(config.luxuryTax - finance.payroll),
      warn: tax > 0,
    },
    { label: 'Rosa', value: `${standard}/15 · two-way ${twoWay}/3`, warn: standard < 13 },
  ];
  return (
    <Card className="!p-4">
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
        {items.map((i) => (
          <div key={i.label}>
            <dt className="text-xs text-stampa-500 dark:text-stampa-400">{i.label}</dt>
            <dd className={`font-semibold ${i.warn ? 'text-red-600 dark:text-red-400' : ''}`}>{i.value}</dd>
          </div>
        ))}
      </dl>
      {finance.balance < 0 && (
        <p className="mt-2 text-xs text-red-600 dark:text-red-400">
          Con il saldo negativo si firmano svincolati solo fino al monte stipendi minimo (oltre, solo al
          minimo per restare a 13) e non si fanno scambi che aumentano il monte stipendi.
        </p>
      )}
    </Card>
  );
}

type Run = (action: MarketAction, ok: string) => Promise<boolean>;

// ---------------------------------------------------------------- svincolati

function FreeAgents({ data, busy, run }: { data: MarketData; busy: boolean; run: Run }) {
  const [query, setQuery] = useState<FreeAgentQuery>(DEFAULT_FA_QUERY);
  const [shown, setShown] = useState(FA_PAGE);
  const [open, setOpen] = useState<string | null>(null);
  const { freeAgents, config, faRound, finance } = data;
  const rows = useMemo(
    () =>
      freeAgents.map((p) => ({
        p,
        ovr: overall(p),
        ask: freeAgentAsk(config, p, faRound),
        minimum: minimumOf(config, p),
      })),
    [freeAgents, config, faRound],
  );
  const space = Math.max(0, config.salaryCap - finance.payroll);
  const filtered = useMemo(() => filterFreeAgents(rows, query, space), [rows, query, space]);
  const list = filtered.slice(0, shown);
  const change = (q: Partial<FreeAgentQuery>) => {
    setQuery((x) => ({ ...x, ...q }));
    setShown(FA_PAGE);
  };
  const filtersOn = JSON.stringify(query) !== JSON.stringify(DEFAULT_FA_QUERY);
  const pending = data.bids.filter((b) => b.status === 'pending');
  const recent = data.bids.filter((b) => b.status !== 'pending' && b.status !== 'withdrawn').slice(0, 8);
  const name = (pid: string) => data.players.get(pid)?.name ?? 'Giocatore';

  const skill = query.sort.startsWith('skill:') ? (query.sort.slice(6) as SkillKey) : null;

  return (
    <div className="space-y-4">
      <TeamNeedsCard
        leagueId={data.league.id}
        roundId={data.league.roundId}
        roster={data.roster}
        onPick={(q) => change({ ...DEFAULT_FA_QUERY, ...q })}
      />
      {(pending.length > 0 || recent.length > 0) && (
        <Card className="space-y-2 !p-4">
          <h2 className="font-semibold">Le tue offerte</h2>
          <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
            {[...pending, ...recent].map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  <span className="font-medium">{name(b.playerId)}</span> · {b.salaries.length}{' '}
                  {b.salaries.length === 1 ? 'anno' : 'anni'}, {millions(b.salaries[0] ?? 0)} il primo
                  <span className="block text-xs text-stampa-500 dark:text-stampa-400">
                    {BID_STATUS[b.status]}
                  </span>
                </span>
                {b.status === 'pending' && (
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => void run({ kind: 'withdraw_bid', bid_id: b.id }, 'Offerta ritirata.')}
                  >
                    Ritira
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="space-y-3 !p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Svincolati</h2>
          <span className="text-xs text-stampa-500 dark:text-stampa-400">
            {filtered.length === rows.length
              ? `${rows.length} in tutto`
              : `${filtered.length} su ${rows.length}`}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          <input
            type="search"
            aria-label="Cerca per nome"
            placeholder="Cerca per nome"
            className="col-span-2 min-h-11 rounded-lg border border-stampa-300 bg-stampa-25 px-3 text-base sm:col-span-3 sm:text-sm dark:border-stampa-600 dark:bg-stampa-800"
            value={query.name}
            onChange={(e) => change({ name: e.target.value })}
          />
          <select
            aria-label="Ruolo"
            className={SELECT}
            value={query.role}
            onChange={(e) => change({ role: e.target.value })}
          >
            <option value="all">Tutti i ruoli</option>
            {['PG', 'SG', 'SF', 'PF', 'C'].map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <select
            aria-label="Età"
            className={SELECT}
            value={query.age}
            onChange={(e) => change({ age: e.target.value as AgeBand })}
          >
            {AGE_BANDS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Richiesta"
            className={SELECT}
            value={query.ask}
            onChange={(e) => change({ ask: e.target.value as AskBand })}
          >
            {ASK_BANDS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            aria-label="Ordina per"
            className={SELECT}
            value={query.sort}
            onChange={(e) => change({ sort: e.target.value as FreeAgentSort })}
          >
            {FA_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                Ordina: {o.label}
              </option>
            ))}
          </select>
          {filtersOn && (
            <Button
              variant="ghost"
              className="col-span-2 sm:col-span-1"
              onClick={() => change(DEFAULT_FA_QUERY)}
            >
              Togli i filtri
            </Button>
          )}
        </div>
        <p className="text-xs text-stampa-500 dark:text-stampa-400">
          Offerte a busta chiusa: alla chiusura del turno ogni svincolato sceglie, tra le offerte sopra la sua
          richiesta, quella con il punteggio migliore (soldi, minuti attesi, forza della squadra). Sopra il
          cap si firma solo al minimo.
        </p>
        {list.length === 0 && (
          <p className="text-sm text-stampa-500 dark:text-stampa-400">
            {rows.length === 0 ? 'Nessuno svincolato.' : 'Nessuno svincolato con questi filtri.'}
          </p>
        )}
        <ul className="divide-y divide-stampa-100 dark:divide-stampa-700">
          {list.map(({ p, ovr, ask }) => (
            <li key={p.id} className="py-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="w-8 text-center font-mono font-semibold">{ovr}</span>
                <Link
                  to={`/lega/${data.league.id}/giocatore/${p.id}`}
                  className="min-w-0 flex-1 truncate hover:underline"
                >
                  {p.firstName} {p.lastName}
                  <span className="ml-1 text-xs text-stampa-500 dark:text-stampa-400">
                    {p.role}
                    {p.secondaryRole ? `/${p.secondaryRole}` : ''} · {p.age} anni · pot. {p.scoutedPotential}
                    {skill &&
                      ` · ${SKILL_LABEL[skill].toLowerCase()} ${Math.round(skillOf(p.ratings, skill))}`}
                  </span>
                </Link>
                <Link
                  to={compareWith(data.league.id, p.id)}
                  className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-rosso-700 hover:bg-rosso-50 dark:text-rosso-300 dark:hover:bg-rosso-950"
                >
                  Confronta
                </Link>
                <span className="text-xs text-stampa-600 dark:text-stampa-300">chiede {millions(ask)}</span>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => setOpen(open === p.id ? null : p.id)}
                >
                  {open === p.id ? 'Chiudi' : 'Offri'}
                </Button>
              </div>
              {open === p.id && (
                <OfferForm
                  ask={ask}
                  busy={busy}
                  onSubmit={(salary, years) =>
                    run(
                      { kind: 'bid', player_id: p.id, salary, years },
                      `Offerta per ${p.firstName} ${p.lastName} registrata: si decide alla chiusura del turno.`,
                    ).then((ok) => ok && setOpen(null))
                  }
                />
              )}
            </li>
          ))}
        </ul>
        {filtered.length > shown && (
          <Button variant="secondary" className="w-full" onClick={() => setShown((n) => n + FA_PAGE)}>
            Mostra altri ({filtered.length - shown})
          </Button>
        )}
      </Card>
    </div>
  );
}

function OfferForm({
  ask,
  busy,
  onSubmit,
}: {
  ask: number;
  busy: boolean;
  onSubmit: (salary: number, years: number) => void;
}) {
  const [years, setYears] = useState(1);
  const [salary, setSalary] = useState(offerInput(ask));
  const first = offerSalary(salary, ask);
  const run = first !== null ? salaryRunOf(first, years) : [];
  return (
    <form
      className="mt-2 flex flex-wrap items-end gap-3 rounded-lg bg-stampa-50 p-3 dark:bg-stampa-900"
      onSubmit={(e) => {
        e.preventDefault();
        if (first !== null) onSubmit(first, years);
      }}
    >
      <label className="text-xs">
        Primo anno (milioni)
        <input
          inputMode="decimal"
          className="mt-1 block min-h-11 w-28 rounded-lg border border-stampa-300 bg-stampa-25 px-2 text-sm dark:border-stampa-600 dark:bg-stampa-800"
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
        />
      </label>
      <label className="text-xs">
        Anni
        <select
          className="mt-1 block min-h-11 rounded-lg border border-stampa-300 bg-stampa-25 px-2 text-sm dark:border-stampa-600 dark:bg-stampa-800"
          value={years}
          onChange={(e) => setYears(Number(e.target.value))}
        >
          {[1, 2, 3, 4, 5].map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </label>
      <p className="min-w-40 flex-1 text-xs text-stampa-500 dark:text-stampa-400">
        {run.length ? `Totale ${millions(run.reduce((a, b) => a + b, 0))}, +5% l'anno.` : 'Cifra non valida.'}
      </p>
      <Button type="submit" disabled={busy || !run.length}>
        Fai l’offerta
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- scambi

function Trades({
  data,
  busy,
  run,
  notify,
}: {
  data: MarketData;
  busy: boolean;
  run: Run;
  notify: (m: ToastMessage) => void;
}) {
  const me = data.me.id;
  // Giocatori sul mercato della lega (poche righe): si rileggono dopo ogni modifica della propria lista
  const block = useAsync(() => tradeBlock(data.league.id), [data.league.id, data.league.roundId]);
  const [search] = useSearchParams();
  const received = data.offers.filter((o) => o.toTeamId === me && o.status === 'pending');
  const sent = data.offers.filter(
    (o) => o.fromTeamId === me && (o.status === 'pending' || o.status === 'accepted'),
  );
  const accepted = data.offers.filter((o) => o.toTeamId === me && o.status === 'accepted');
  const history = data.offers.filter((o) => !['pending', 'accepted'].includes(o.status)).slice(0, 15);
  return (
    <div className="space-y-4">
      <OfferList
        title="Proposte ricevute"
        empty="Nessuna proposta da decidere."
        offers={received}
        data={data}
        actions={(o) => (
          <>
            <ConfirmButton
              disabled={busy}
              confirmLabel="Confermi lo scambio?"
              onConfirm={() =>
                void run(
                  { kind: 'respond_trade', offer_id: o.id, accept: true },
                  'Scambio accettato: si esegue alla chiusura del turno.',
                )
              }
            >
              Accetta
            </ConfirmButton>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run({ kind: 'respond_trade', offer_id: o.id, accept: false }, 'Proposta rifiutata.')
              }
            >
              Rifiuta
            </Button>
          </>
        )}
      />
      {(sent.length > 0 || accepted.length > 0) && (
        <OfferList
          title="In attesa della chiusura del turno"
          empty=""
          offers={[...sent, ...accepted]}
          data={data}
          actions={(o) =>
            o.fromTeamId === me ? (
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => void run({ kind: 'withdraw_trade', offer_id: o.id }, 'Proposta ritirata.')}
              >
                Ritira
              </Button>
            ) : null
          }
        />
      )}
      <LeagueBlock leagueId={data.league.id} myTeamId={me} teams={data.league.teams} block={block.data} />
      {/* Arrivando da "Proponi" (?con=squadra&prendi=giocatore) la proposta riparte con quella scelta */}
      <NewTrade
        key={`${search.get('con') ?? ''}:${search.get('prendi') ?? ''}`}
        data={data}
        busy={busy}
        run={run}
        block={block.data}
      />
      <MyBlock
        leagueId={data.league.id}
        teamId={me}
        roster={data.roster}
        block={block.data}
        onChange={block.reload}
        notify={notify}
      />
      {history.length > 0 && (
        <OfferList title="Storico" empty="" offers={history} data={data} actions={() => null} />
      )}
    </div>
  );
}

function pickLabel(k: PickInfo | undefined, teams: Map<string, LeagueTeam>, protection?: number): string {
  if (!k) return 'Scelta';
  const n = protection ?? k.protection;
  return `${k.round === 1 ? '1°' : '2°'} giro ${k.draftYear} (${teams.get(k.originalTeamId)?.code ?? '?'})${n ? ` top ${n}` : ''}`;
}

function OfferList({
  title,
  empty,
  offers,
  data,
  actions,
}: {
  title: string;
  empty: string;
  offers: TradeOffer[];
  data: MarketData;
  actions: (o: TradeOffer) => ReactNode;
}) {
  const teams = new Map(data.league.teams.map((t) => [t.id, t]));
  const picks = data.offerPicks;
  const me = data.me.id;
  const player = (id: string) => {
    const p = data.players.get(id);
    return p ? `${p.name} (${p.role}, ${p.overall})` : 'Giocatore';
  };
  return (
    <Card className="space-y-3 !p-4">
      <h2 className="font-semibold">{title}</h2>
      {offers.length === 0 && <p className="text-sm text-stampa-500 dark:text-stampa-400">{empty}</p>}
      {offers.map((o) => {
        const mineFrom = o.fromTeamId === me;
        const other = teams.get(mineFrom ? o.toTeamId : o.fromTeamId);
        const give = mineFrom
          ? [
              ...o.playersFrom.map(player),
              ...o.picksFrom.map((k) => pickLabel(picks.get(k), teams, o.protections[k])),
            ]
          : [
              ...o.playersTo.map(player),
              ...o.picksTo.map((k) => pickLabel(picks.get(k), teams, o.protections[k])),
            ];
        const get = mineFrom
          ? [
              ...o.playersTo.map(player),
              ...o.picksTo.map((k) => pickLabel(picks.get(k), teams, o.protections[k])),
            ]
          : [
              ...o.playersFrom.map(player),
              ...o.picksFrom.map((k) => pickLabel(picks.get(k), teams, o.protections[k])),
            ];
        return (
          <div key={o.id} className="rounded-lg border border-stampa-200 p-3 text-sm dark:border-stampa-700">
            <p className="flex items-center gap-2 font-medium">
              <TeamCode code={other?.code ?? '?'} />
              {mineFrom ? `Proposta a ${other?.fullName}` : `Proposta da ${other?.fullName}`}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="text-xs text-stampa-500 dark:text-stampa-400">Cedi</p>
                <p>{give.join(', ') || 'niente'}</p>
              </div>
              <div>
                <p className="text-xs text-stampa-500 dark:text-stampa-400">Ricevi</p>
                <p>{get.join(', ') || 'niente'}</p>
              </div>
            </div>
            {o.swaps.length > 0 && (
              <p className="mt-1 text-xs">
                Swap:{' '}
                {o.swaps
                  .map(
                    (w) =>
                      `${teams.get(w.holder_team_id)?.code} può scambiare la sua ${w.round === 1 ? 'prima' : 'seconda'} scelta ${w.draft_year} con quella di ${teams.get(w.other_team_id)?.code}`,
                  )
                  .join('; ')}
              </p>
            )}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs text-stampa-500 dark:text-stampa-400">
                {TRADE_STATUS[o.status] ?? o.status}
              </span>
              <span className="flex gap-2">{actions(o)}</span>
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function NewTrade({
  data,
  busy,
  run,
  block,
}: {
  data: MarketData;
  busy: boolean;
  run: Run;
  block: Map<string, Set<string>> | null;
}) {
  const others = data.league.teams
    .filter((t) => t.id !== data.me.id)
    .sort((a, b) => a.fullName.localeCompare(b.fullName, 'it'));
  // Dalla pagina di una squadra ("Proponi uno scambio") arriva già scelta: ?con=<id della squadra>
  const [search] = useSearchParams();
  const [partner, setPartner] = useState(() => {
    const con = search.get('con') ?? '';
    return others.some((t) => t.id === con) ? con : '';
  });
  // Arrivando con la squadra già scelta la proposta nuova si porta in vista (sopra ci sono quelle ricevute)
  const card = useRef<HTMLDivElement>(null);
  const preselected = useRef(partner !== '');
  useEffect(() => {
    if (preselected.current) card.current?.scrollIntoView({ block: 'start' });
  }, []);
  const [give, setGive] = useState<Set<string>>(new Set());
  const [get, setGet] = useState<Set<string>>(() => {
    const prendi = search.get('prendi');
    return new Set(prendi && partner ? [prendi] : []);
  });
  const [givePicks, setGivePicks] = useState<Set<string>>(new Set());
  const [getPicks, setGetPicks] = useState<Set<string>>(new Set());
  const [protections, setProtections] = useState<Record<string, number>>({});
  const [swaps, setSwaps] = useState<{ draft_year: number; round: number; holder: 'from' | 'to' }[]>([]);
  const [sort, setSort] = useState<RosterSort>('overall');
  // Dell'altra squadra: rosa, residui dei tagliati, strategia (per l'anteprima e la lista dei bot) e scelte, più gli
  // swap aperti delle due squadre (una scelta non entra in due swap, e finché lo swap è aperto non si cede)
  const { data: other } = useAsync(
    () =>
      partner
        ? Promise.all([
            teamRoster(partner),
            teamExtra(partner),
            leaguePicks(data.league.id, partner),
            openSwaps(data.league.id, [data.me.id, partner]),
          ]).then(([roster, extra, picks, swaps]) => ({ roster, extra, picks, swaps }))
        : Promise.resolve(null),
    [partner],
  );
  const theirRoster = other?.roster;
  // Un giocatore arrivato con "Proponi" che nel frattempo ha cambiato squadra non resta tra quelli scelti
  useEffect(() => {
    if (!theirRoster) return;
    setGet((s) => {
      const kept = [...s].filter((id) => theirRoster.some((p) => p.id === id));
      return kept.length === s.size ? s : new Set(kept);
    });
  }, [theirRoster]);
  // Chi l'altra squadra ha messo sul mercato: per un manager la sua lista, per un bot quella della strategia
  const partnerTeam = data.league.teams.find((t) => t.id === partner);
  const partnerBlock = useMemo(() => {
    if (!partnerTeam || !other) return new Set<string>();
    if (partnerTeam.ownerId) return block?.get(partnerTeam.id) ?? new Set<string>();
    return new Set(botTradeBlock(other.roster, other.extra.strategy).map((p) => p.id));
  }, [partnerTeam, other, block]);
  const teams = new Map(data.league.teams.map((t) => [t.id, t]));
  const year = data.config.year;

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };
  const reset = () => {
    setGive(new Set());
    setGet(new Set());
    setGivePicks(new Set());
    setGetPicks(new Set());
    setProtections({});
    setSwaps([]);
  };
  const myPicks = data.picks.filter((k) => k.ownerTeamId === data.me.id);
  const theirPicks = (other?.picks ?? []).filter((k) => k.ownerTeamId === partner);
  const empty = give.size + get.size + givePicks.size + getPicks.size === 0 && swaps.length === 0;
  // Anteprima con le regole del motore sui dati già letti: il server ricontrolla tutto
  const preview: TradePreview | null =
    !empty && other && partnerTeam
      ? tradePreview({
          config: data.config,
          roundKind: data.league.roundKind,
          roundNumber: data.league.roundNumber,
          me: {
            id: data.me.id,
            code: data.me.code,
            roster: data.roster,
            deadMoney: data.finance.deadMoney,
            balance: data.finance.balance,
            repeater: data.finance.repeater,
          },
          partner: {
            id: partnerTeam.id,
            code: partnerTeam.code,
            roster: other.roster,
            deadMoney: other.extra.deadMoney,
            balance: null,
            repeater: null,
          },
          picks: mergePicks(data.picks, other.picks),
          swaps: other.swaps,
          sel: {
            give: [...give],
            get: [...get],
            givePicks: [...givePicks],
            getPicks: [...getPicks],
            protections,
            swaps,
          },
        })
      : null;

  return (
    <div ref={card} className="scroll-mt-[calc(var(--spazio-alto)+7rem)]">
      <Card className="space-y-3 !p-4">
        <h2 className="font-semibold">Nuova proposta</h2>
        <select
          aria-label="Squadra"
          className="min-h-11 w-full rounded-lg border border-stampa-300 bg-stampa-25 px-2 text-sm sm:w-auto dark:border-stampa-600 dark:bg-stampa-800"
          value={partner}
          onChange={(e) => {
            setPartner(e.target.value);
            reset();
          }}
        >
          <option value="">Scegli la squadra…</option>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.fullName} {t.ownerId ? `(${t.ownerName ?? 'manager'})` : '(bot)'}
            </option>
          ))}
        </select>
        {partner && (
          <>
            <label className="flex items-center gap-2 text-xs text-stampa-500 dark:text-stampa-400">
              Ordina le rose per
              <select className={SELECT} value={sort} onChange={(e) => setSort(e.target.value as RosterSort)}>
                <option value="overall">Overall</option>
                <option value="salary">Stipendio</option>
                <option value="age">Età</option>
              </select>
            </label>
            <div className="grid gap-4 md:grid-cols-2">
              <Side
                sort={sort}
                title={`Cedi (${data.me.code})`}
                roster={data.roster}
                picks={myPicks}
                teams={teams}
                selected={give}
                selectedPicks={givePicks}
                onPlayer={(id) => toggle(give, setGive, id)}
                onPick={(id) => toggle(givePicks, setGivePicks, id)}
                protections={protections}
                onProtection={(id, n) => setProtections((p) => ({ ...p, [id]: n }))}
                ownTeamId={data.me.id}
              />
              <Side
                sort={sort}
                title={`Ricevi (${teams.get(partner)?.code})`}
                roster={theirRoster ?? []}
                onBlock={partnerBlock}
                blockNote={
                  partnerTeam?.ownerId ? 'sul mercato' : 'sul mercato per la strategia del bot (indicativo)'
                }
                picks={theirPicks}
                teams={teams}
                selected={get}
                selectedPicks={getPicks}
                onPlayer={(id) => toggle(get, setGet, id)}
                onPick={(id) => toggle(getPicks, setGetPicks, id)}
              />
            </div>
            <div className="space-y-2">
              <p className="text-xs text-stampa-500 dark:text-stampa-400">
                Swap: il diritto di scambiare, dopo la lottery, la propria scelta con quella dell’altra
                squadra.
              </p>
              {swaps.map((w, i) => (
                <div key={i} className="flex flex-wrap items-center gap-2 text-sm">
                  <select
                    aria-label="Chi ha il diritto"
                    className="min-h-11 rounded-lg border border-stampa-300 bg-stampa-25 px-2 dark:border-stampa-600 dark:bg-stampa-800"
                    value={w.holder}
                    onChange={(e) =>
                      setSwaps((s) =>
                        s.map((x, j) => (j === i ? { ...x, holder: e.target.value as 'from' | 'to' } : x)),
                      )
                    }
                  >
                    <option value="from">Tu hai il diritto</option>
                    <option value="to">Loro hanno il diritto</option>
                  </select>
                  <select
                    aria-label="Draft"
                    className="min-h-11 rounded-lg border border-stampa-300 bg-stampa-25 px-2 dark:border-stampa-600 dark:bg-stampa-800"
                    value={w.draft_year}
                    onChange={(e) =>
                      setSwaps((s) =>
                        s.map((x, j) => (j === i ? { ...x, draft_year: Number(e.target.value) } : x)),
                      )
                    }
                  >
                    {Array.from({ length: 7 }, (_, k) => year + 1 + k).map((y) => (
                      <option key={y} value={y}>
                        Draft {y}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Giro"
                    className="min-h-11 rounded-lg border border-stampa-300 bg-stampa-25 px-2 dark:border-stampa-600 dark:bg-stampa-800"
                    value={w.round}
                    onChange={(e) =>
                      setSwaps((s) =>
                        s.map((x, j) => (j === i ? { ...x, round: Number(e.target.value) } : x)),
                      )
                    }
                  >
                    <option value={1}>1° giro</option>
                    <option value={2}>2° giro</option>
                  </select>
                  <Button variant="ghost" onClick={() => setSwaps((s) => s.filter((_, j) => j !== i))}>
                    Togli
                  </Button>
                </div>
              ))}
              <Button
                variant="ghost"
                onClick={() => setSwaps((s) => [...s, { draft_year: year + 1, round: 1, holder: 'from' }])}
              >
                Aggiungi uno swap
              </Button>
            </div>
            {preview && <PreviewCard preview={preview} offseason={data.league.roundKind === 'offseason'} />}
            <Button
              disabled={busy || empty}
              onClick={() =>
                void run(
                  {
                    kind: 'propose_trade',
                    to_team_id: partner,
                    players_from: [...give],
                    players_to: [...get],
                    picks_from: [...givePicks],
                    picks_to: [...getPicks],
                    protections: Object.fromEntries(
                      Object.entries(protections).filter(([k, n]) => givePicks.has(k) && n > 0),
                    ),
                    swaps,
                  },
                  teams.get(partner)?.ownerId
                    ? 'Proposta inviata: il manager deve rispondere prima della chiusura del turno.'
                    : 'Proposta inviata: il bot decide alla chiusura del turno.',
                ).then((ok) => ok && reset())
              }
            >
              Proponi lo scambio
            </Button>
          </>
        )}
      </Card>
    </div>
  );
}

type RosterSort = 'overall' | 'salary' | 'age';

/** Rosa ordinata per la scelta dei giocatori di uno scambio: overall, stipendio (dal più alto) o età. */
function sortRoster(roster: readonly RosterPlayer[], sort: RosterSort): RosterPlayer[] {
  const key: Record<RosterSort, (p: RosterPlayer) => number> = {
    overall: (p) => -overall(p),
    salary: (p) => -(p.salaries[0] ?? 0),
    age: (p) => p.age,
  };
  return [...roster].sort((a, b) => key[sort](a) - key[sort](b) || overall(b) - overall(a));
}

function Side({
  sort,
  title,
  roster,
  picks,
  teams,
  selected,
  selectedPicks,
  onPlayer,
  onPick,
  protections,
  onProtection,
  ownTeamId,
  onBlock,
  blockNote,
}: {
  sort: RosterSort;
  title: string;
  roster: RosterPlayer[];
  picks: PickInfo[];
  teams: Map<string, LeagueTeam>;
  selected: Set<string>;
  selectedPicks: Set<string>;
  onPlayer: (id: string) => void;
  onPick: (id: string) => void;
  protections?: Record<string, number>;
  onProtection?: (id: string, n: number) => void;
  ownTeamId?: string;
  /** Giocatori dell'altra squadra sul mercato, segnati nell'elenco. */
  onBlock?: ReadonlySet<string>;
  blockNote?: string;
}) {
  // Prima chi è sul mercato, poi gli altri nell'ordine scelto
  const sorted = sortRoster(roster, sort).sort(
    (a, b) => Number(onBlock?.has(b.id) ?? false) - Number(onBlock?.has(a.id) ?? false),
  );
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-stampa-500 uppercase dark:text-stampa-400">
        {title}
      </h3>
      <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
        {sorted.map((p) => (
          <li key={p.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 hover:bg-stampa-50 dark:hover:bg-stampa-900">
              <input
                type="checkbox"
                className="size-4 accent-rosso-600"
                checked={selected.has(p.id)}
                onChange={() => onPlayer(p.id)}
              />
              <span className="w-7 text-center font-mono text-xs">{overall(p)}</span>
              <span className="min-w-0 flex-1 truncate">
                {p.firstName} {p.lastName}
                <span className="ml-1 text-xs text-stampa-500 dark:text-stampa-400">
                  {p.role} · {p.age}
                </span>
                {onBlock?.has(p.id) && (
                  <span
                    className="ml-1 rounded bg-amber-100 px-1 text-xs font-semibold text-amber-900 dark:bg-amber-900 dark:text-amber-100"
                    title={blockNote}
                  >
                    sul mercato
                  </span>
                )}
              </span>
              <span className="shrink-0 text-xs text-stampa-500 dark:text-stampa-400">
                {p.contractType === 'two-way'
                  ? 'two-way'
                  : p.salaries[0]
                    ? `${millions(p.salaries[0])} · ${p.salaries.length}a`
                    : ''}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <ul className="max-h-48 space-y-1 overflow-y-auto text-sm">
        {picks.map((k) => {
          const canProtect =
            onProtection && k.round === 1 && k.originalTeamId === ownTeamId && k.protection === null;
          return (
            <li key={k.id} className="flex min-h-11 items-center gap-2 px-1">
              <label className="flex flex-1 cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="size-4 accent-rosso-600"
                  checked={selectedPicks.has(k.id)}
                  onChange={() => onPick(k.id)}
                />
                <span>{pickLabel(k, teams)}</span>
              </label>
              {canProtect && selectedPicks.has(k.id) && (
                <select
                  aria-label="Protezione"
                  className="min-h-11 rounded border border-stampa-300 bg-stampa-25 px-1 text-xs dark:border-stampa-600 dark:bg-stampa-800"
                  value={protections?.[k.id] ?? 0}
                  onChange={(e) => onProtection(k.id, Number(e.target.value))}
                >
                  <option value={0}>Libera</option>
                  {Array.from({ length: MAX_PROTECTION }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>
                      Top {n}
                    </option>
                  ))}
                </select>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------- bilancio

function Ledger({ data }: { data: MarketData }) {
  const { finance, config } = data;
  return (
    <div className="space-y-4">
      <Card className="space-y-2 !p-4 text-sm">
        <h2 className="font-semibold">Stagione</h2>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-[auto_1fr]">
          <dt className="text-stampa-500 dark:text-stampa-400">Ricavi della stagione</dt>
          <dd>{millions(config.revenue)} (uguali per tutti, giornata per giornata)</dd>
          <dt className="text-stampa-500 dark:text-stampa-400">Salary cap</dt>
          <dd>{millions(config.salaryCap)}</dd>
          <dt className="text-stampa-500 dark:text-stampa-400">Soglia della luxury tax</dt>
          <dd>{millions(config.luxuryTax)}</dd>
          <dt className="text-stampa-500 dark:text-stampa-400">Monte stipendi minimo</dt>
          <dd>{millions(config.minimumTeamSalary)}</dd>
        </dl>
        <p className="text-xs text-stampa-500 dark:text-stampa-400">
          Tassa e monte minimo si pagano a fine regular season, sul monte stipendi di quel momento
          {finance.repeater ? '; paghi le aliquote maggiorate (tassa in 3 delle ultime 4 stagioni)' : ''}.
        </p>
      </Card>
      {finance.deadMoney.length > 0 && (
        <Card className="space-y-2 !p-4">
          <h2 className="font-semibold">Stipendi residui dei tagliati</h2>
          <ul className="text-sm">
            {finance.deadMoney.map((d, i) => (
              <li key={i} className="flex justify-between py-0.5">
                <span>{d.playerName}</span>
                <span className="font-mono">
                  {millions(d.salaries[0] ?? 0)} · {d.salaries.length}{' '}
                  {d.salaries.length === 1 ? 'stagione' : 'stagioni'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card className="space-y-2 !p-4">
        <h2 className="font-semibold">Movimenti</h2>
        {finance.ledger.length === 0 && (
          <p className="text-sm text-stampa-500 dark:text-stampa-400">Nessun movimento ancora.</p>
        )}
        <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
          {finance.ledger.map((l, i) => (
            <li key={i} className="flex justify-between gap-2 py-1">
              <span>
                {LEDGER_LABEL[l.kind] ?? l.kind}
                {l.note && (
                  <span className="ml-1 text-xs text-stampa-500 dark:text-stampa-400">{l.note}</span>
                )}
              </span>
              <span
                className={`font-mono ${l.amount < 0 ? 'text-red-600 dark:text-red-400' : 'text-green-700 dark:text-green-400'}`}
              >
                {l.amount > 0 ? '+' : ''}
                {millions(l.amount)}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------- rinnovi dell'offseason

/** Turno dei rinnovi: i giocatori in scadenza con la loro richiesta; chi non rinnovi diventa svincolato. */
function Renewals({ data, busy, run }: { data: MarketData; busy: boolean; run: Run }) {
  const expiring = data.roster.filter((p) => p.contractType !== 'two-way' && p.salaries.length === 0);
  return (
    <Card className="space-y-3 !p-4">
      <h2 className="font-semibold">Giocatori in scadenza</h2>
      <p className="text-xs text-stampa-500 dark:text-stampa-400">
        Le richieste sono ai prezzi della prossima stagione e dipendono da valore, età e morale. Con il morale
        sotto 30 il giocatore non rinnova. Alla chiusura del turno chi non hai rinnovato diventa svincolato.
      </p>
      {expiring.length === 0 && (
        <p className="text-sm text-stampa-500 dark:text-stampa-400">Nessun giocatore in scadenza.</p>
      )}
      <ul className="divide-y divide-stampa-100 text-sm dark:divide-stampa-700">
        {expiring.map((p) => {
          const ask = expiringAskOf(data.config, p);
          const request = data.requests.find((r) => r.playerId === p.id && r.kind === 'renew');
          return (
            <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="w-8 text-center font-mono font-semibold">{overall(p)}</span>
              <Link
                to={`/lega/${data.league.id}/giocatore/${p.id}`}
                className="min-w-0 flex-1 truncate hover:underline"
              >
                {p.firstName} {p.lastName}
                <span className="ml-1 text-xs text-stampa-500 dark:text-stampa-400">
                  {p.role} · {p.age} anni · morale {Math.round(p.morale)}
                </span>
              </Link>
              <span className="text-xs text-stampa-600 dark:text-stampa-300">
                {ask ? `${ask.length} anni, ${millions(ask[0] ?? 0)} il primo` : 'non vuole rinnovare'}
              </span>
              {request ? (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() =>
                    void run({ kind: 'withdraw_request', request_id: request.id }, 'Rinnovo annullato.')
                  }
                >
                  Annulla il rinnovo
                </Button>
              ) : (
                ask && (
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void run(
                        { kind: 'renew', player_id: p.id },
                        `Rinnovo di ${p.firstName} ${p.lastName} accettato: si firma alla chiusura del turno.`,
                      )
                    }
                  >
                    Rinnova
                  </Button>
                )
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}
