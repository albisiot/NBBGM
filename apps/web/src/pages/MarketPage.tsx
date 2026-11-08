// Mercato della propria squadra, nello stile Edicola: sezioni a filetto (svincolati, scambi, giocatori sul mercato,
// opzioni e rinnovi nei loro turni dell'offseason, allenatori, bilancio). Svincolati con offerte a busta chiusa, scambi (proposte ricevute e inviate, nuova
// proposta con giocatori, scelte protette, swap e l'anteprima prima → dopo), giocatori sul mercato e bilancio. Tutto
// si esegue alla chiusura del turno.
import { coachAsk, MAX_PROTECTION, overall, type SeasonConfig } from '@nbbgm/engine';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  Button,
  ConfirmButton,
  ErrorText,
  Kicker,
  Leader,
  SectionTitle,
  Spinner,
  Tag,
  TeamCode,
  TextInput,
  Toast,
  type ToastMessage,
} from '../components/ui.tsx';
import { CoachCard, CoachLine } from '../components/CoachCard.tsx';
import { RenewalTalk } from '../components/RenewalTalk.tsx';
import { useUserId } from '../lib/auth.tsx';
import {
  coachContractText,
  coachFullName,
  contractTotal,
  freeCoachesByRating,
  hireProblem,
  leagueCoaches,
  myCoachRequest,
  teamStaff,
  type Buyout,
  type CoachInfo,
  type CoachRequest,
} from '../lib/coaches.ts';
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
  lastSalaries,
  marketActionWithReply,
  pendingOption,
  qualifyingOffer,
  renewalTalks,
  restrictedState,
  rfaEligible,
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
  type OfferSheetInfo,
  type PickInfo,
  type RenewalAnswer,
  type RenewalTalkInfo,
  type RestrictedInfo,
  type TradeOffer,
} from '../lib/market.ts';
import { FA_OFFERS_ONLY, FA_ROUNDS } from '../lib/turns.ts';
import { bidTone, mln1, pickName, sameQuery, selectedSalary } from '../lib/marketView.ts';
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
import {
  BAD,
  BOX,
  FIELD,
  FIELD_LABEL,
  FilterSelect,
  GHOST_LINK,
  GroupTitle,
  META,
  NOTE,
  OvrBox,
  RULE,
  Strip,
  SubTitle,
} from '../components/inkParts.tsx';
import { compareWith } from '../lib/compare.ts';
import { SKILL_LABEL, skillOf, type SkillKey } from '../lib/skills.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';

type Tab = 'svincolati' | 'scambi' | 'sul-mercato' | 'opzioni' | 'rinnovi' | 'allenatori' | 'bilancio';

/** Nome delle sezioni: nel menu a filetto e come titolo della pagina. */
const TAB_LABEL: Record<Tab, string> = {
  svincolati: 'Svincolati',
  scambi: 'Scambi',
  'sul-mercato': 'Sul mercato',
  opzioni: 'Opzioni',
  rinnovi: 'Rinnovi',
  allenatori: 'Allenatori',
  bilancio: 'Bilancio',
};

/** Dati del turno: rosa, svincolati, scelte, bilancio cambiano solo alla chiusura del turno. */
interface MarketBase {
  league: LeagueDetail;
  me: LeagueTeam;
  config: SeasonConfig;
  finance: Finance;
  roster: RosterPlayer[];
  freeAgents: FreeAgent[];
  picks: PickInfo[];
  /** Turno di free agency dell'offseason (0-14), o null. */
  faRound: number | null;
  /** RFA della lega (diritti e qualifica) e offerte in attesa di pareggio. */
  rights: Map<string, RestrictedInfo>;
  sheets: Map<string, OfferSheetInfo>;
  /** Turno dei rinnovi: ultimo stipendio dei propri giocatori in scadenza (per la qualifica). */
  lastSalary: Map<string, number>;
  /** Allenatori della lega, in panchina e liberi (nessuno nelle leghe create prima). */
  coaches: CoachInfo[];
  /** Esonerati che la propria squadra paga ancora. */
  buyouts: Buyout[];
}

/** Quello che cambia con le azioni del manager nel turno, con i giocatori che vi compaiono. */
interface MarketLive {
  bids: Bid[];
  offers: TradeOffer[];
  requests: RosterRequest[];
  players: Map<string, PlayerLite>;
  /** Scelte citate dalle proposte, oltre a quelle della propria squadra (anche già usate). */
  offerPicks: Map<string, PickInfo>;
  /** Cambio di allenatore chiesto nel turno. */
  coachRequest: CoachRequest | null;
  /** Trattative dei rinnovi della stagione. */
  talks: Map<string, RenewalTalkInfo>;
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
  const [bids, offers, requests, coachRequest, talks] = await Promise.all([
    myBids(me.id),
    tradeOffers(league.id),
    myRequests(me.id),
    myCoachRequest(me.id),
    league.seasonId ? renewalTalks(me.id, league.seasonId) : new Map<string, RenewalTalkInfo>(),
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
  return { bids, offers, requests, players, offerPicks, coachRequest, talks };
}

export function MarketPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [search] = useSearchParams();
  const {
    data: loaded,
    error,
    loading,
    reload,
  } = useAsync(async (): Promise<MarketData | null> => {
    const league = await leagueDetail(id);
    const me = league?.teams.find((t) => t.ownerId === userId);
    if (!league || !me || !league.seasonId) return null;
    const [config, finance, roster, freeAgents, picks, coaches, staff, restricted] = await Promise.all([
      seasonConfig(league.seasonId).then((c) => effectiveConfig(c, league.roundKind, league.roundStage)),
      teamFinance(me.id),
      teamRoster(me.id),
      freeAgentPlayers(league.id),
      // Solo le scelte della propria squadra: quelle dell'altra parte si leggono scegliendola
      leaguePicks(league.id, me.id),
      leagueCoaches(league.id),
      teamStaff(me.id),
      restrictedState(league.id),
    ]);
    const lastSalary =
      league.roundStage === 'renewals'
        ? await lastSalaries(
            roster.filter((p) => p.contractType !== 'two-way' && p.salaries.length === 0).map((p) => p.id),
          )
        : new Map<string, number>();
    const known = new Map([...roster, ...freeAgents].map((p) => [p.id, liteOf(p)]));
    const live = await loadLive(league, me, known, new Map(picks.map((k) => [k.id, k])));
    const faRound = league.roundKind === 'offseason' ? faRoundOf(league.roundStage) : null;
    return {
      league,
      me,
      config,
      finance,
      roster,
      freeAgents,
      picks,
      faRound,
      rights: restricted.rights,
      sheets: restricted.sheets,
      lastSalary,
      coaches,
      buyouts: staff.buyouts,
      ...live,
    };
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

  /** Un'offerta di rinnovo: come run, ma restituisce la risposta del giocatore. */
  async function offerRenewal(action: MarketAction): Promise<RenewalAnswer | null> {
    setBusy(true);
    setMessage(null);
    let reply: RenewalAnswer | null;
    try {
      reply = (await marketActionWithReply(id, action)).reply ?? null;
    } catch (e) {
      setMessage({ ok: false, text: friendlyError(e) });
      setBusy(false);
      return null;
    }
    // Un'offerta offensiva toglie morale: si rilegge anche la rosa, che lo mostra
    if (reply && reply.kind !== 'accept' && reply.lowball) {
      reload();
      setBusy(false);
      return reply;
    }
    if (loaded && data) {
      try {
        setLive({ of: loaded, value: await loadLive(data.league, data.me, data.players, data.offerPicks) });
      } catch {
        reload();
      }
    }
    setBusy(false);
    return reply;
  }

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Non hai una squadra in questa lega.</ErrorText>;
  const regular = data.league.roundKind === 'regular';
  const offseason = data.league.roundKind === 'offseason';
  const renewals = offseason && data.league.roundStage === 'renewals';
  const options = offseason && data.league.roundStage === 'options';
  const preparation = offseason && data.league.roundStage === 'preparation';
  const signing = regular || data.faRound !== null || preparation;
  const tabs: Tab[] = [
    'svincolati',
    'scambi',
    'sul-mercato',
    ...(options ? ['opzioni' as Tab] : []),
    ...(renewals ? ['rinnovi' as Tab] : []),
    ...(data.coaches.length ? ['allenatori' as Tab] : []),
    'bilancio',
  ];
  const asked = search.get('tab') as Tab | null;
  const tab: Tab = asked && tabs.includes(asked) ? asked : 'svincolati';
  // Proposte ricevute da decidere: il numero accanto a Scambi
  const toDecide = data.offers.filter((o) => o.toTeamId === data.me.id && o.status === 'pending').length;

  return (
    <div className="space-y-5">
      <header>
        <Kicker>Il mercato</Kicker>
        <h1 className="text-3xl leading-tight font-bold">{TAB_LABEL[tab]}</h1>
        <p className="mt-1 text-sm text-stampa-600 italic dark:text-stampa-300">
          Offerte, scambi, tagli, opzioni e rinnovi si eseguono alla chiusura del turno.
        </p>
      </header>
      <MarketTabs leagueId={data.league.id} tabs={tabs} current={tab} toDecide={toDecide} />
      <FinanceSummary data={data} />
      {!regular && !offseason && tab !== 'bilancio' && tab !== 'allenatori' && (
        <p className="text-sm text-stampa-600 italic dark:text-stampa-300">
          Durante play-in e playoff il mercato è chiuso (gli scambi si fermano alla trade deadline, il primo
          giovedì di febbraio, e riaprono nell’offseason).
        </p>
      )}
      {tab === 'svincolati' && !signing && (
        <p className="text-sm text-stampa-600 italic dark:text-stampa-300">
          Gli svincolati si firmano in regular season, nei {FA_ROUNDS} turni di free agency dell’offseason e
          in preparazione.
        </p>
      )}
      {data.faRound !== null && tab === 'svincolati' && (
        <p className="text-sm text-stampa-600 italic dark:text-stampa-300">
          Free agency, turno {data.faRound + 1} di {FA_ROUNDS}:{' '}
          {data.faRound < FA_OFFERS_ONLY
            ? `nei primi ${FA_OFFERS_ONLY} turni si fanno solo offerte e nessuno firma; a ogni chiusura il giocatore ti dice come sta la tua. Le richieste restano piene fino al ${FA_OFFERS_ONLY + 1}° turno.`
            : 'alla chiusura ogni svincolato sceglie l’offerta migliore tra quelle sopra la sua richiesta, che scende di turno in turno fino all’ultimo.'}{' '}
          Le offerte restano sul tavolo finché non le ritiri: una sotto la richiesta firma quando la richiesta
          scende, se nessuno offre di più. Anche i bot fanno le loro offerte. Fino a 21 giocatori in rosa
          nell’offseason; contratti e cap sono già quelli della prossima stagione.
        </p>
      )}
      {preparation && tab === 'svincolati' && (
        <p className="text-sm text-stampa-600 italic dark:text-stampa-300">
          Preparazione: la rosa va portata a 13-15 contratti standard e al massimo 3 two-way. Puoi tagliare e
          fare offerte agli svincolati (alla loro richiesta, valgono per questo turno): il Pronto aspetta che
          la rosa sia a posto.
        </p>
      )}
      {tab === 'opzioni' && <Options data={data} busy={busy} run={run} />}
      {tab === 'rinnovi' && <Renewals data={data} busy={busy} run={run} offer={offerRenewal} />}
      {tab === 'svincolati' && <FreeAgents data={data} busy={busy} run={run} />}
      {tab === 'scambi' && <Trades data={data} busy={busy} run={run} />}
      {tab === 'sul-mercato' && <OnTheBlock data={data} notify={setMessage} />}
      {tab === 'allenatori' && <Coaches data={data} busy={busy} run={run} />}
      {tab === 'bilancio' && <Ledger data={data} />}
      <Toast message={message} onClose={closeMessage} />
    </div>
  );
}

/** Le sezioni del mercato come un menu a filetto: quella aperta con il filetto pieno sotto. */
function MarketTabs({
  leagueId,
  tabs,
  current,
  toDecide,
}: {
  leagueId: string;
  tabs: Tab[];
  current: Tab;
  toDecide: number;
}) {
  return (
    // Su telefono stretto (con i Rinnovi) il menu scorre in orizzontale, non la pagina
    <nav aria-label="Sezioni del mercato" className="relative overflow-x-auto">
      <ul className="flex min-w-max gap-4 border-b border-stampa-900 sm:gap-5 dark:border-stampa-100">
        {tabs.map((t) => (
          <li key={t}>
            <Link
              to={`/lega/${leagueId}/mercato?tab=${t}`}
              replace
              aria-current={t === current ? 'page' : undefined}
              className={`-mb-px flex min-h-11 items-center gap-1.5 border-b-[3px] font-titolo text-[0.8125rem] tracking-wide uppercase sm:text-sm sm:tracking-wider ${
                t === current
                  ? 'border-stampa-900 font-semibold text-stampa-900 dark:border-stampa-100 dark:text-stampa-50'
                  : 'border-transparent font-medium text-stampa-700 hover:text-stampa-900 dark:text-stampa-300 dark:hover:text-stampa-50'
              }`}
            >
              {TAB_LABEL[t]}
              {t === 'scambi' && toDecide > 0 && (
                <span className="bg-rosso-600 px-1.5 text-xs text-white dark:bg-rosso-500">
                  {toDecide}
                  <span className="sr-only"> da decidere</span>
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}

function FinanceSummary({ data }: { data: MarketData }) {
  const { config, finance, roster } = data;
  const twoWay = roster.filter((p) => p.contractType === 'two-way').length;
  const standard = roster.length - twoWay;
  const tax = projectedTax(config, finance);
  return (
    <div className="space-y-2">
      <Strip
        cols="sm:grid-cols-5"
        items={[
          { label: 'Saldo', value: millions(finance.balance), bad: finance.balance < 0 },
          { label: 'Monte stipendi', value: millions(finance.payroll) },
          {
            label: 'Spazio sotto il cap',
            value:
              finance.payroll < config.salaryCap ? millions(config.salaryCap - finance.payroll) : 'nessuno',
            note: finance.payroll < config.salaryCap ? undefined : 'si firma fino alla tassa',
          },
          {
            label: tax > 0 ? 'Luxury tax stimata' : 'Margine dalla tassa',
            value: tax > 0 ? millions(tax) : millions(config.luxuryTax - finance.payroll),
            bad: tax > 0,
          },
          {
            label: 'Rosa',
            value: `${standard}/15 · two-way ${twoWay}/3`,
            bad: standard < 13,
            wide: true,
          },
        ]}
      />
      {finance.balance < 0 && (
        <p className={`text-[0.8125rem] italic ${BAD}`}>
          Con il saldo negativo si firmano svincolati solo fino al monte stipendi minimo (oltre, solo al
          minimo per restare a 13) e non si fanno scambi che aumentano il monte stipendi.
        </p>
      )}
    </div>
  );
}

type Run = (action: MarketAction, ok: string) => Promise<boolean>;

// ---------------------------------------------------------------- svincolati

const ROLES = ['PG', 'SG', 'SF', 'PF', 'C'];

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
  // Si firma finché il monte stipendi resta sotto la soglia della tassa
  const space = Math.max(0, config.luxuryTax - finance.payroll);
  const code = (teamId: string) => data.league.teams.find((t) => t.id === teamId)?.code ?? '?';
  const filtered = useMemo(() => filterFreeAgents(rows, query, space), [rows, query, space]);
  const list = filtered.slice(0, shown);
  const change = (q: Partial<FreeAgentQuery>) => {
    setQuery((x) => ({ ...x, ...q }));
    setShown(FA_PAGE);
  };
  const filtersOn = !sameQuery(query, DEFAULT_FA_QUERY);
  const pending = data.bids.filter((b) => b.status === 'pending');
  const recent = data.bids.filter((b) => b.status !== 'pending' && b.status !== 'withdrawn').slice(0, 8);
  const offered = new Set(pending.map((b) => b.playerId));
  const name = (pid: string) => data.players.get(pid)?.name ?? 'Giocatore';

  const skill = query.sort.startsWith('skill:') ? (query.sort.slice(6) as SkillKey) : null;

  return (
    <div className="space-y-5">
      {(pending.length > 0 || recent.length > 0) && (
        <section className="space-y-1">
          <SectionTitle aside={pending.length ? `${pending.length} in corso` : undefined}>
            Le tue offerte
          </SectionTitle>
          <ul>
            {[...pending, ...recent].map((b) => {
              const tone = bidTone(b.status);
              return (
                <li
                  key={b.id}
                  className={`flex flex-wrap items-center justify-between gap-x-2 py-1.5 ${RULE}`}
                >
                  <span className="min-w-0">
                    <span className="font-bold">{name(b.playerId)}</span>{' '}
                    <span className={META}>
                      · {b.salaries.length} {b.salaries.length === 1 ? 'anno' : 'anni'},{' '}
                      {millions(b.salaries[0] ?? 0)} il primo
                    </span>
                    <span
                      className={`block text-[0.8125rem] italic ${
                        tone === 'red'
                          ? BAD
                          : tone === 'ink'
                            ? 'font-semibold'
                            : 'text-stampa-600 dark:text-stampa-300'
                      }`}
                    >
                      {BID_STATUS[b.status]}
                    </span>
                  </span>
                  {b.status === 'pending' && (
                    <Button
                      variant="ghost"
                      disabled={busy}
                      aria-label={`Ritira l’offerta per ${name(b.playerId)}`}
                      onClick={() => void run({ kind: 'withdraw_bid', bid_id: b.id }, 'Offerta ritirata.')}
                    >
                      Ritira
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <MyRestricted data={data} busy={busy} run={run} />

      <TeamNeedsCard
        leagueId={data.league.id}
        roundId={data.league.roundId}
        roster={data.roster}
        query={query}
        onPick={(q) => change(q ? { ...DEFAULT_FA_QUERY, ...q } : DEFAULT_FA_QUERY)}
      />

      <div className="space-y-2">
        <TextInput
          label="Cerca per nome"
          type="search"
          placeholder="Nome o cognome"
          value={query.name}
          onChange={(e) => change({ name: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          <FilterSelect
            label="Ruolo"
            active={query.role !== 'all'}
            value={query.role}
            onChange={(e) => change({ role: e.target.value })}
          >
            <option value="all">Ruolo: tutti</option>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                Ruolo: {r}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Età"
            active={query.age !== 'all'}
            value={query.age}
            onChange={(e) => change({ age: e.target.value as AgeBand })}
          >
            {AGE_BANDS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'all' ? 'Età: tutte' : `Età: ${o.label.toLowerCase()}`}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            label="Richiesta"
            active={query.ask !== 'all'}
            value={query.ask}
            onChange={(e) => change({ ask: e.target.value as AskBand })}
          >
            {ASK_BANDS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.value === 'all' ? 'Richiesta: qualsiasi' : o.label}
              </option>
            ))}
          </FilterSelect>
          <FilterSelect
            ghost
            label="Ordina per"
            className="sm:ml-auto"
            value={query.sort}
            onChange={(e) => change({ sort: e.target.value as FreeAgentSort })}
          >
            {FA_SORTS.map((o) => (
              <option key={o.value} value={o.value}>
                Ordina: {o.label.toLowerCase()}
              </option>
            ))}
          </FilterSelect>
          {filtersOn && (
            <Button variant="ghost" onClick={() => change(DEFAULT_FA_QUERY)}>
              Togli i filtri
            </Button>
          )}
        </div>
      </div>

      <section className="space-y-1">
        <SectionTitle
          aside={
            filtered.length === rows.length
              ? `${rows.length} in tutto`
              : `${filtered.length} su ${rows.length}`
          }
        >
          Disponibili
        </SectionTitle>
        <p className={NOTE}>
          Offerte a busta chiusa: alla chiusura del turno ogni svincolato sceglie, tra le offerte sopra la sua
          richiesta, quella con il punteggio migliore (soldi, minuti attesi, forza della squadra). Si firma
          finché il monte stipendi resta sotto la soglia della tassa; oltre, solo al minimo. Gli RFA hanno i
          diritti di una squadra: se scelgono un’altra offerta, la loro squadra può pareggiarla.
        </p>
        {list.length === 0 && (
          <p className="py-2 text-sm">
            {rows.length === 0 ? 'Nessuno svincolato.' : 'Nessuno svincolato con questi filtri.'}
          </p>
        )}
        <ul>
          {list.map(({ p, ovr, ask }) => {
            const rights = data.rights.get(p.id);
            const sheet = data.sheets.get(p.id);
            return (
              <li key={p.id} className={`py-2 ${RULE}`}>
                <div className="flex items-center gap-3">
                  <OvrBox value={ovr} />
                  <div className="min-w-0 flex-1">
                    <Link
                      to={`/lega/${data.league.id}/giocatore/${p.id}`}
                      className="block truncate text-base font-bold hover:underline"
                    >
                      {p.firstName} {p.lastName}
                    </Link>
                    <p className={META}>
                      {p.role}
                      {p.secondaryRole ? `/${p.secondaryRole}` : ''} · {p.age} anni · pot.{' '}
                      {p.scoutedPotential}
                      {skill &&
                        ` · ${SKILL_LABEL[skill].toLowerCase()} ${Math.round(skillOf(p.ratings, skill))}`}
                    </p>
                    <p className={META}>
                      chiede {millions(ask)}
                      {offered.has(p.id) && (
                        <span className="ml-2 not-italic">
                          <Tag tone="outline">Offerta fatta</Tag>
                        </span>
                      )}
                    </p>
                    {rights && (
                      <p className={META}>
                        <span className="not-italic">
                          <Tag tone="outline">RFA · {code(rights.teamId)}</Tag>
                        </span>{' '}
                        {sheet
                          ? `ha scelto l’offerta di ${code(sheet.teamId)}: ${code(rights.teamId)} decide se pareggiarla`
                          : `qualifica di ${millions(rights.qualifyingOffer)}: ${code(rights.teamId)} può pareggiare le offerte`}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link
                      to={compareWith(data.league.id, p.id)}
                      className={GHOST_LINK}
                      aria-label={`Confronta ${p.firstName} ${p.lastName}`}
                    >
                      Confronta
                    </Link>
                    <Button
                      variant="secondary"
                      className="px-3"
                      disabled={busy || sheet !== undefined}
                      aria-expanded={open === p.id}
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                    >
                      {open === p.id ? 'Chiudi' : offered.has(p.id) ? 'Rilancia' : 'Offri'}
                    </Button>
                  </div>
                </div>
                {open === p.id && (
                  <OfferForm
                    ask={ask}
                    belowAsk={faRound !== null}
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
            );
          })}
        </ul>
        {filtered.length > shown && (
          <Button variant="ghost" className="w-full" onClick={() => setShown((n) => n + FA_PAGE)}>
            Mostra altri {filtered.length - shown}
          </Button>
        )}
      </section>
    </div>
  );
}

function OfferForm({
  ask,
  belowAsk,
  busy,
  onSubmit,
}: {
  ask: number;
  /** Free agency dell'offseason: un'offerta sotto la richiesta resta sul tavolo. */
  belowAsk: boolean;
  busy: boolean;
  onSubmit: (salary: number, years: number) => void;
}) {
  const [years, setYears] = useState(1);
  const [salary, setSalary] = useState(offerInput(ask));
  const first = offerSalary(salary, ask);
  const run = first !== null ? salaryRunOf(first, years) : [];
  return (
    <form
      className={`mt-2 flex flex-wrap items-end gap-3 p-3 ${BOX}`}
      onSubmit={(e) => {
        e.preventDefault();
        if (first !== null) onSubmit(first, years);
      }}
    >
      <label className="block">
        <span className={FIELD_LABEL}>Primo anno (milioni)</span>
        <input
          inputMode="decimal"
          className={`mt-1 block w-32 ${FIELD}`}
          value={salary}
          onChange={(e) => setSalary(e.target.value)}
        />
      </label>
      <label className="block">
        <span className={FIELD_LABEL}>Anni</span>
        <select
          className={`mt-1 block ${FIELD}`}
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
      <p
        className={`min-w-40 flex-1 text-[0.8125rem] italic ${run.length ? 'text-stampa-600 dark:text-stampa-300' : BAD}`}
      >
        {run.length
          ? `Totale ${millions(run.reduce((a, b) => a + b, 0))}, +5% l'anno.${
              first !== null && first < ask
                ? belowAsk
                  ? ' Sotto la richiesta: resta sul tavolo e firma quando la richiesta scende, se nessuno offre di più.'
                  : ' Sotto la richiesta: la rifiuta.'
                : ''
            }`
          : 'Cifra non valida.'}
      </p>
      <Button type="submit" disabled={busy || !run.length}>
        Fai l’offerta
      </Button>
    </form>
  );
}

// ---------------------------------------------------------------- scambi

function Trades({ data, busy, run }: { data: MarketData; busy: boolean; run: Run }) {
  const me = data.me.id;
  // Giocatori sul mercato della lega (poche righe): segnano la rosa dell'altra squadra nella nuova proposta
  const block = useAsync(() => tradeBlock(data.league.id), [data.league.id, data.league.roundId]);
  const [search] = useSearchParams();
  const received = data.offers.filter((o) => o.toTeamId === me && o.status === 'pending');
  const sent = data.offers.filter(
    (o) => o.fromTeamId === me && (o.status === 'pending' || o.status === 'accepted'),
  );
  const accepted = data.offers.filter((o) => o.toTeamId === me && o.status === 'accepted');
  const history = data.offers.filter((o) => !['pending', 'accepted'].includes(o.status)).slice(0, 15);
  return (
    <div className="space-y-6">
      <OfferList
        title="Proposte ricevute"
        aside={received.length ? `${received.length} da decidere` : undefined}
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
      {/* Arrivando da "Proponi" (?con=squadra&prendi=giocatore) la proposta riparte con quella scelta */}
      <NewTrade
        key={`${search.get('con') ?? ''}:${search.get('prendi') ?? ''}`}
        data={data}
        busy={busy}
        run={run}
        block={block.data}
      />
      {history.length > 0 && (
        <OfferList title="Storico" empty="" offers={history} data={data} actions={() => null} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- sul mercato

/** Chi i manager della lega hanno messo sul mercato e la propria lista. */
function OnTheBlock({ data, notify }: { data: MarketData; notify: (m: ToastMessage) => void }) {
  // Poche righe: si rileggono dopo ogni modifica della propria lista
  const block = useAsync(() => tradeBlock(data.league.id), [data.league.id, data.league.roundId]);
  return (
    <div className="space-y-6">
      <LeagueBlock
        leagueId={data.league.id}
        myTeamId={data.me.id}
        teams={data.league.teams}
        block={block.data}
      />
      <MyBlock
        leagueId={data.league.id}
        teamId={data.me.id}
        roster={data.roster}
        block={block.data}
        onChange={block.reload}
        notify={notify}
      />
    </div>
  );
}

interface OfferItem {
  title: string;
  meta: string;
}

function pickItem(k: PickInfo | undefined, teams: Map<string, LeagueTeam>, protection?: number): OfferItem {
  if (!k) return { title: 'Scelta', meta: '' };
  const n = protection ?? k.protection;
  return {
    title: pickName(k),
    meta: `di ${teams.get(k.originalTeamId)?.code ?? '?'}${n ? ` · protetta top ${n}` : ''}`,
  };
}

function OfferList({
  title,
  aside,
  empty,
  offers,
  data,
  actions,
}: {
  title: string;
  aside?: string;
  empty: string;
  offers: TradeOffer[];
  data: MarketData;
  actions: (o: TradeOffer) => ReactNode;
}) {
  const teams = new Map(data.league.teams.map((t) => [t.id, t]));
  const picks = data.offerPicks;
  const me = data.me.id;
  const player = (id: string): OfferItem => {
    const p = data.players.get(id);
    return p ? { title: p.name, meta: `${p.role} · ${p.overall}` } : { title: 'Giocatore', meta: '' };
  };
  const pick = (o: TradeOffer) => (k: string) => pickItem(picks.get(k), teams, o.protections[k]);
  return (
    <section className="space-y-3">
      <SectionTitle aside={aside}>{title}</SectionTitle>
      {offers.length === 0 && <p className="text-sm">{empty}</p>}
      {offers.map((o) => {
        const mineFrom = o.fromTeamId === me;
        const other = teams.get(mineFrom ? o.toTeamId : o.fromTeamId);
        const fromItems = [...o.playersFrom.map(player), ...o.picksFrom.map(pick(o))];
        const toItems = [...o.playersTo.map(player), ...o.picksTo.map(pick(o))];
        const give = mineFrom ? fromItems : toItems;
        const get = mineFrom ? toItems : fromItems;
        return (
          <article key={o.id} className={`space-y-2 p-3 ${BOX}`}>
            <h3 className="flex items-center gap-2 text-sm font-semibold tracking-wider uppercase">
              <TeamCode code={other?.code ?? '?'} />
              <span className="min-w-0">
                {mineFrom ? `Proposta a ${other?.fullName}` : `Proposta da ${other?.fullName}`}
              </span>
            </h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <OfferSide label="Cedi" items={give} />
              <OfferSide label="Ricevi" items={get} />
            </div>
            {o.swaps.length > 0 && (
              <p className={META}>
                Swap:{' '}
                {o.swaps
                  .map(
                    (w) =>
                      `${teams.get(w.holder_team_id)?.code} può scambiare la sua ${w.round === 1 ? 'prima' : 'seconda'} scelta ${w.draft_year} con quella di ${teams.get(w.other_team_id)?.code}`,
                  )
                  .join('; ')}
              </p>
            )}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-stampa-300 pt-2 dark:border-stampa-700">
              <span className={META}>{TRADE_STATUS[o.status] ?? o.status}</span>
              <span className="flex flex-wrap gap-2">{actions(o)}</span>
            </div>
          </article>
        );
      })}
    </section>
  );
}

function OfferSide({ label, items }: { label: string; items: OfferItem[] }) {
  return (
    <div>
      <p className={FIELD_LABEL}>{label}</p>
      {items.length === 0 ? (
        <p className={`py-1 ${META}`}>niente</p>
      ) : (
        <ul className="text-sm">
          {items.map((x, i) => (
            <li key={i} className={`py-1 ${RULE} last:border-b-0`}>
              <span className="font-semibold">{x.title}</span>
              {x.meta && <span className={`ml-1.5 ${META}`}>{x.meta}</span>}
            </li>
          ))}
        </ul>
      )}
    </div>
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
  const card = useRef<HTMLElement>(null);
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
          roundDay: data.league.roundDay,
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
    <section ref={card} className="scroll-mt-[calc(var(--spazio-alto)+7rem)] space-y-4">
      <SectionTitle>Nuova proposta</SectionTitle>
      <label className="block">
        <span className={FIELD_LABEL}>Con</span>
        <select
          className={`mt-1 block w-full font-semibold sm:w-auto ${FIELD}`}
          value={partner}
          onChange={(e) => {
            setPartner(e.target.value);
            reset();
          }}
        >
          <option value="">Scegli la squadra…</option>
          {others.map((t) => (
            <option key={t.id} value={t.id}>
              {t.code} · {t.fullName}, {t.ownerId ? `di ${t.ownerName ?? 'un manager'}` : 'bot'}
            </option>
          ))}
        </select>
      </label>
      {partner && (
        <>
          <label className="flex flex-wrap items-center gap-2">
            <span className={FIELD_LABEL}>Ordina le rose per</span>
            <select className={FIELD} value={sort} onChange={(e) => setSort(e.target.value as RosterSort)}>
              <option value="overall">Overall</option>
              <option value="salary">Stipendio</option>
              <option value="age">Età</option>
            </select>
          </label>
          <div className="grid gap-5 md:grid-cols-2">
            <Side
              sort={sort}
              title={`Dai · ${data.me.code}`}
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
              title={`Ricevi · ${teams.get(partner)?.code ?? ''}`}
              roster={theirRoster ?? []}
              onBlock={partnerBlock}
              blockNote={
                partnerTeam?.ownerId
                  ? 'In cima chi il manager ha messo sul mercato.'
                  : 'In cima chi è sul mercato per la strategia del bot: è indicativo.'
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
            <SubTitle>Swap</SubTitle>
            <p className={NOTE}>
              Il diritto di scambiare, dopo la lottery, la propria scelta con quella dell’altra squadra.
            </p>
            {swaps.map((w, i) => (
              <div key={i} className={`flex flex-wrap items-center gap-2 pb-2 ${RULE}`}>
                <select
                  aria-label="Chi ha il diritto"
                  className={FIELD}
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
                  className={FIELD}
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
                  className={FIELD}
                  value={w.round}
                  onChange={(e) =>
                    setSwaps((s) => s.map((x, j) => (j === i ? { ...x, round: Number(e.target.value) } : x)))
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
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="accent"
              className="min-h-12 flex-1 text-base"
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
              {partnerTeam?.ownerId
                ? `Invia la proposta a ${partnerTeam.ownerName ?? 'il manager'}`
                : 'Invia la proposta al bot'}
            </Button>
            {!empty && (
              <Button variant="ghost" disabled={busy} onClick={reset}>
                Ricomincia
              </Button>
            )}
          </div>
        </>
      )}
    </section>
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
  const total = selectedSalary(roster, selected);
  return (
    <div className="min-w-0 space-y-1">
      <SubTitle aside={total > 0 ? `${mln1(total)} mln` : undefined}>{title}</SubTitle>
      {blockNote && (onBlock?.size ?? 0) > 0 && <p className={NOTE}>{blockNote}</p>}
      <ul className="max-h-80 overflow-y-auto">
        {sorted.map((p) => {
          const on = selected.has(p.id);
          return (
            <li key={p.id} className={RULE}>
              <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1">
                <input
                  type="checkbox"
                  className="size-5 shrink-0 accent-stampa-900 dark:accent-stampa-100"
                  checked={on}
                  onChange={() => onPlayer(p.id)}
                />
                <OvrBox value={overall(p)} small />
                <span className="min-w-0 flex-1">
                  <span className={`block truncate ${on ? 'font-bold' : ''}`}>
                    {p.firstName} {p.lastName}
                  </span>
                  <span className={META}>
                    {p.role} · {p.age} anni
                    {onBlock?.has(p.id) && (
                      <span className="ml-1.5 not-italic">
                        <Tag tone="outline">sul mercato</Tag>
                      </span>
                    )}
                  </span>
                </span>
                <span className={`shrink-0 text-right ${META}`}>
                  {p.contractType === 'two-way'
                    ? 'two-way'
                    : p.salaries[0]
                      ? `${millions(p.salaries[0])} · ${p.salaries.length}a`
                      : ''}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
      {picks.length > 0 && (
        <>
          <p className={`pt-2 ${FIELD_LABEL}`}>Scelte al draft</p>
          <ul className="max-h-60 overflow-y-auto">
            {picks.map((k) => {
              const canProtect =
                onProtection && k.round === 1 && k.originalTeamId === ownTeamId && k.protection === null;
              const on = selectedPicks.has(k.id);
              return (
                <li key={k.id} className={`flex min-h-12 items-center gap-2 ${RULE}`}>
                  <label className="flex min-h-11 flex-1 cursor-pointer items-center gap-3">
                    <input
                      type="checkbox"
                      className="size-5 shrink-0 accent-stampa-900 dark:accent-stampa-100"
                      checked={on}
                      onChange={() => onPick(k.id)}
                    />
                    <span className="min-w-0">
                      <span className={on ? 'font-bold' : ''}>{pickName(k)}</span>{' '}
                      <span className={META}>
                        di {teams.get(k.originalTeamId)?.code ?? '?'}
                        {k.protection ? ` · protetta top ${k.protection}` : ''}
                      </span>
                    </span>
                  </label>
                  {canProtect && on && (
                    <select
                      aria-label={`Protezione della ${pickName(k).toLowerCase()}`}
                      className={FIELD}
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
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- bilancio

function Ledger({ data }: { data: MarketData }) {
  const { finance, config } = data;
  return (
    <div className="space-y-6">
      <section className="space-y-1">
        <SectionTitle>La stagione</SectionTitle>
        <div className="text-sm">
          <Leader label="Ricavi della stagione" value={<b>{millions(config.revenue)}</b>} />
          {data.coaches.length > 0 && (
            <Leader
              label="Allenatore ed esonerati"
              value={
                <b>
                  {millions(
                    (data.coaches.find((c) => c.teamId === data.me.id)?.salaries[0] ?? 0) +
                      data.buyouts.reduce((a, b) => a + (b.salaries[0] ?? 0), 0),
                  )}
                </b>
              }
            />
          )}
          <Leader label="Salary cap" value={<b>{millions(config.salaryCap)}</b>} />
          <Leader label="Soglia della luxury tax" value={<b>{millions(config.luxuryTax)}</b>} />
          <Leader label="Monte stipendi minimo" value={<b>{millions(config.minimumTeamSalary)}</b>} />
        </div>
        <p className={NOTE}>
          Ricavi uguali per tutti, accreditati partita per partita, come gli stipendi
          {data.coaches.length > 0 ? ' e l’allenatore' : ''}. Tassa e monte minimo si pagano a fine regular
          season, sul monte stipendi di quel momento
          {finance.repeater ? '; paghi le aliquote maggiorate (tassa in 3 delle ultime 4 stagioni)' : ''}.
        </p>
      </section>
      {finance.deadMoney.length > 0 && (
        <section className="space-y-1">
          <SectionTitle>Stipendi residui dei tagliati</SectionTitle>
          <div className="text-sm">
            {finance.deadMoney.map((d, i) => (
              <Leader
                key={i}
                label={d.playerName}
                value={
                  <>
                    <b>{millions(d.salaries[0] ?? 0)}</b>{' '}
                    <i className="text-stampa-600 dark:text-stampa-300">
                      · {d.salaries.length} {d.salaries.length === 1 ? 'stagione' : 'stagioni'}
                    </i>
                  </>
                }
              />
            ))}
          </div>
        </section>
      )}
      <section className="space-y-1">
        <SectionTitle aside={finance.ledger.length ? `${finance.ledger.length} voci` : undefined}>
          Movimenti
        </SectionTitle>
        {finance.ledger.length === 0 && <p className="py-1 text-sm">Nessun movimento ancora.</p>}
        <ul className="text-sm">
          {finance.ledger.map((l, i) => (
            <li key={i} className={`flex items-baseline justify-between gap-2 py-1.5 ${RULE}`}>
              <span className="min-w-0">
                {LEDGER_LABEL[l.kind] ?? l.kind}
                {l.note && <span className={`ml-1.5 ${META}`}>{l.note}</span>}
              </span>
              <span className={`shrink-0 font-titolo ${l.amount < 0 ? BAD : 'font-semibold'}`}>
                {l.amount > 0 ? '+' : ''}
                {millions(l.amount)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------- allenatori

/**
 * Il proprio allenatore, gli esonerati da pagare, il cambio chiesto e gli allenatori liberi con la loro richiesta. Il
 * cambio si chiede in qualsiasi turno e si fa alla chiusura: il nuovo arriva alla sua richiesta e quello di adesso
 * resta da pagare fino alla scadenza.
 */
function Coaches({ data, busy, run }: { data: MarketData; busy: boolean; run: Run }) {
  const current = data.coaches.find((c) => c.teamId === data.me.id) ?? null;
  const request = data.coachRequest;
  const requested = request ? data.coaches.find((c) => c.id === request.coachId) : undefined;
  const free = freeCoachesByRating(data.coaches);
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <SectionTitle>Il tuo allenatore</SectionTitle>
        {current ? (
          <CoachCard coach={current} contract={{ label: 'Contratto', salaries: current.salaries }} />
        ) : (
          <p className="text-sm">Nessuno: alla chiusura del turno ne arriva uno.</p>
        )}
        {data.buyouts.length > 0 && (
          <div className="pt-1">
            <GroupTitle>Esonerati ancora da pagare</GroupTitle>
            <div className="text-sm">
              {data.buyouts.map((b, i) => (
                <Leader
                  key={i}
                  label={b.coachName}
                  value={
                    <>
                      <b>{millions(b.salaries[0] ?? 0)}</b>{' '}
                      <i className="text-stampa-600 dark:text-stampa-300">
                        · {b.salaries.length} {b.salaries.length === 1 ? 'stagione' : 'stagioni'}
                      </i>
                    </>
                  }
                />
              ))}
            </div>
          </div>
        )}
        <p className={NOTE}>
          Se lo cambi resta da pagare fino alla scadenza
          {current && current.salaries.length
            ? ` (${millions(contractTotal(current.salaries))} in tutto, in stagione partita per partita)`
            : ''}
          , fuori dal cap; se un’altra squadra lo prende, gli devi solo la differenza. Il nuovo arriva alla
          chiusura del turno, alla sua richiesta.
        </p>
      </section>

      {request && (
        <section className="space-y-2">
          <SectionTitle>Cambio chiesto</SectionTitle>
          <div className={`flex flex-wrap items-center gap-3 p-3 ${BOX}`}>
            <p className="min-w-0 flex-1 text-sm">
              {requested ? (
                <>
                  <b>{coachFullName(requested)}</b> arriva alla chiusura del turno (
                  {coachContractText(coachAsk(data.config, requested), millions)}).
                </>
              ) : (
                'Hai chiesto un allenatore che non è più libero: alla chiusura non arriva.'
              )}
            </p>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void run({ kind: 'withdraw_coach', request_id: request.id }, 'Cambio di allenatore ritirato.')
              }
            >
              Ritira
            </Button>
          </div>
        </section>
      )}

      <section className="space-y-1">
        <SectionTitle aside={`${free.length}`}>Allenatori liberi</SectionTitle>
        <p className={NOTE}>
          Dal migliore. La richiesta è a stagione, per gli anni che chiede; uno solo per turno: chiederne un
          altro sostituisce la richiesta.
        </p>
        {free.length === 0 && <p className="py-1 text-sm">Nessun allenatore libero.</p>}
        <ul>
          {free.map((c) => (
            <FreeCoach
              key={c.id}
              coach={c}
              data={data}
              current={current}
              chosen={request?.coachId === c.id}
              busy={busy}
              run={run}
            />
          ))}
        </ul>
      </section>
    </div>
  );
}

function FreeCoach({
  coach,
  data,
  current,
  chosen,
  busy,
  run,
}: {
  coach: CoachInfo;
  data: MarketData;
  current: CoachInfo | null;
  chosen: boolean;
  busy: boolean;
  run: Run;
}) {
  const ask = coachAsk(data.config, coach);
  const problem = hireProblem(data.config, coach, current, data.finance.balance);
  return (
    <li className={`space-y-1 py-2 ${RULE}`}>
      <div className="flex items-start gap-3">
        <CoachLine
          coach={coach}
          aside={<p className={`text-sm ${problem ? BAD : ''}`}>{coachContractText(ask, millions)}</p>}
        />
        {chosen ? (
          <Tag tone="ink">Chiesto</Tag>
        ) : (
          <ConfirmButton
            variant="secondary"
            className="shrink-0 px-3"
            disabled={busy || problem !== null}
            confirmLabel="Confermi?"
            aria-label={`Prendi ${coachFullName(coach)}`}
            onConfirm={() =>
              void run(
                { kind: 'hire_coach', coach_id: coach.id },
                `${coachFullName(coach)}: arriva alla chiusura del turno.`,
              )
            }
          >
            Prendi
          </ConfirmButton>
        )}
      </div>
      {problem && <p className={`text-[0.8125rem] italic ${BAD}`}>{problem}</p>}
      <details className="text-sm">
        <summary className={`min-h-11 cursor-pointer py-2 ${GHOST_LINK}`}>Scheda e carattere</summary>
        <div className="pb-2">
          <CoachCard coach={coach} contract={{ label: 'Richiesta', salaries: ask }} />
        </div>
      </details>
    </li>
  );
}

// ---------------------------------------------------------------- rinnovi dell'offseason

/** Turno dei rinnovi: i giocatori in scadenza con la loro richiesta; chi non rinnovi diventa svincolato. */
// ---------------------------------------------------------------- offseason: RFA, opzioni, rinnovi

/**
 * I propri RFA in free agency: con la qualifica aperta; quando uno sceglie l'offerta di un'altra squadra, qui si
 * decide se pareggiarla (alla chiusura del turno; senza risposta va all'altra squadra).
 */
function MyRestricted({ data, busy, run }: { data: MarketData; busy: boolean; run: Run }) {
  const mine = [...data.rights.values()].filter((r) => r.teamId === data.me.id);
  if (mine.length === 0) return null;
  const code = (teamId: string) => data.league.teams.find((t) => t.id === teamId)?.code ?? '?';
  const name = (pid: string) => {
    const p = data.freeAgents.find((x) => x.id === pid);
    return p ? `${p.firstName} ${p.lastName}` : (data.players.get(pid)?.name ?? 'Giocatore');
  };
  return (
    <section className="space-y-1">
      <SectionTitle aside={`${mine.length}`}>I tuoi RFA</SectionTitle>
      <p className={NOTE}>
        Hanno la tua offerta di qualifica: se nessuno li prende, a fine free agency la firmano (un anno). Se
        uno sceglie l’offerta di un’altra squadra, puoi pareggiarla e tenerlo alle stesse cifre.
      </p>
      <ul>
        {mine.map((r) => {
          const sheet = data.sheets.get(r.playerId);
          const decision = data.requests.find((q) => q.kind === 'match' && q.playerId === r.playerId);
          return (
            <li key={r.playerId} className={`space-y-1.5 py-2 ${RULE}`}>
              <p>
                <Link
                  to={`/lega/${data.league.id}/giocatore/${r.playerId}`}
                  className="font-bold hover:underline"
                >
                  {name(r.playerId)}
                </Link>{' '}
                <span className={META}>· qualifica {millions(r.qualifyingOffer)}</span>
              </p>
              {sheet ? (
                <>
                  <p className={`text-[0.8125rem] italic ${BAD}`}>
                    Ha scelto l’offerta di {code(sheet.teamId)}: {sheet.salaries.length}{' '}
                    {sheet.salaries.length === 1 ? 'anno' : 'anni'}, {millions(sheet.salaries[0] ?? 0)} il
                    primo.
                    {decision
                      ? decision.match
                        ? ' Hai deciso di pareggiarla.'
                        : ' Hai deciso di lasciarlo andare.'
                      : ' Senza risposta va a loro.'}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      disabled={busy || decision?.match === true}
                      onClick={() =>
                        void run(
                          { kind: 'match', player_id: r.playerId, match: true },
                          `Pareggi l’offerta per ${name(r.playerId)}: resta con te alla chiusura del turno.`,
                        )
                      }
                    >
                      Pareggia
                    </Button>
                    <Button
                      variant="secondary"
                      disabled={busy || decision?.match === false}
                      onClick={() =>
                        void run(
                          { kind: 'match', player_id: r.playerId, match: false },
                          `${name(r.playerId)} va a ${code(sheet.teamId)} alla chiusura del turno.`,
                        )
                      }
                    >
                      Lascialo andare
                    </Button>
                  </div>
                </>
              ) : (
                <p className={META}>Nessuna offerta scelta per ora.</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Turno delle opzioni: le opzioni della squadra sulla prossima stagione, da esercitare o declinare. */
function Options({ data, busy, run }: { data: MarketData; busy: boolean; run: Run }) {
  const pending = data.roster.filter(pendingOption);
  return (
    <section className="space-y-1">
      <SectionTitle aside={pending.length ? `${pending.length} da decidere` : undefined}>
        Opzioni della squadra
      </SectionTitle>
      <p className={NOTE}>
        Sulla prossima stagione. Esercitata: il contratto resta com’è. Declinata, o senza risposta: il
        giocatore va in scadenza e puoi provare a rinnovarlo nel turno dei rinnovi, altrimenti diventa
        svincolato.
      </p>
      {pending.length === 0 && <p className="py-1 text-sm">Nessuna opzione da decidere.</p>}
      <ul>
        {pending.map((p) => {
          const decision = data.requests.find((q) => q.kind === 'option' && q.playerId === p.id);
          const name = `${p.firstName} ${p.lastName}`;
          return (
            <li key={p.id} className={`flex flex-wrap items-center gap-3 py-2 ${RULE}`}>
              <OvrBox value={overall(p)} />
              <div className="min-w-0 flex-1">
                <Link
                  to={`/lega/${data.league.id}/giocatore/${p.id}`}
                  className="block truncate text-base font-bold hover:underline"
                >
                  {name}
                </Link>
                <p className={META}>
                  {p.role} · {p.age} anni · {millions(p.salaries[0] ?? 0)} nella prossima stagione
                  {p.salaries.length > 2
                    ? `, poi altri ${p.salaries.length - 1} anni di contratto`
                    : p.salaries.length === 2
                      ? ', poi un altro anno di contratto'
                      : ''}
                </p>
                <p className={META}>
                  {decision ? (
                    <span className="not-italic">
                      <Tag tone={decision.exercise ? 'ink' : 'red'}>
                        {decision.exercise ? 'Esercitata' : 'Declinata'}
                      </Tag>
                    </span>
                  ) : (
                    'Senza risposta decade.'
                  )}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  disabled={busy || decision?.exercise === true}
                  onClick={() =>
                    void run(
                      { kind: 'option', player_id: p.id, exercise: true },
                      `Opzione su ${name} esercitata: vale alla chiusura del turno.`,
                    )
                  }
                >
                  Esercita
                </Button>
                <Button
                  variant="secondary"
                  disabled={busy || decision?.exercise === false}
                  onClick={() =>
                    void run(
                      { kind: 'option', player_id: p.id, exercise: false },
                      `Opzione su ${name} declinata: va in scadenza alla chiusura del turno.`,
                    )
                  }
                >
                  Declina
                </Button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Renewals({
  data,
  busy,
  run,
  offer,
}: {
  data: MarketData;
  busy: boolean;
  run: Run;
  offer: (action: MarketAction) => Promise<RenewalAnswer | null>;
}) {
  const expiring = data.roster.filter((p) => p.contractType !== 'two-way' && p.salaries.length === 0);
  return (
    <section className="space-y-1">
      <SectionTitle aside={expiring.length ? `${expiring.length} in scadenza` : undefined}>
        Giocatori in scadenza
      </SectionTitle>
      <p className={NOTE}>
        Le richieste sono ai prezzi della prossima stagione e dipendono da valore, età e morale. Tratta: offri
        stipendio, anni e un’eventuale opzione, il giocatore risponde subito; dopo 3 rifiuti resta solo la sua
        ultima controproposta, e un’offerta troppo bassa lo offende. Con il morale sotto 30 non rinnova. Alla
        chiusura del turno chi non hai rinnovato diventa svincolato: gli RFA con l’offerta di qualifica
        restano legati a te.
      </p>
      {expiring.length === 0 && <p className="py-1 text-sm">Nessun giocatore in scadenza.</p>}
      <ul>
        {expiring.map((p) => {
          const ask = expiringAskOf(data.config, p);
          const request = data.requests.find((r) => r.playerId === p.id && r.kind === 'renew') ?? null;
          const rfa = rfaEligible(p);
          const qualify = data.requests.find((r) => r.playerId === p.id && r.kind === 'qualify');
          const qo = qualifyingOffer(data.config, p, data.lastSalary.get(p.id));
          const name = `${p.firstName} ${p.lastName}`;
          return (
            <li key={p.id} className={`space-y-2 py-3 ${RULE}`}>
              <div className="flex items-center gap-3">
                <OvrBox value={overall(p)} />
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/lega/${data.league.id}/giocatore/${p.id}`}
                    className="block truncate text-base font-bold hover:underline"
                  >
                    {name}
                  </Link>
                  <p className={META}>
                    {p.role} · {p.age} anni · morale {Math.round(p.morale)}
                    {rfa && (
                      <span className="ml-2 not-italic">
                        <Tag tone="outline">RFA</Tag>
                      </span>
                    )}
                  </p>
                </div>
              </div>
              {ask ? (
                <RenewalTalk
                  player={p}
                  ask={ask}
                  talk={data.talks.get(p.id) ?? null}
                  request={request}
                  busy={busy}
                  offer={offer}
                  run={run}
                />
              ) : (
                <p className={`text-[0.8125rem] italic ${BAD}`}>
                  Con il morale sotto 30 non vuole rinnovare.
                </p>
              )}
              {rfa && !request && (
                <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm ${BOX}`}>
                  <span className={META}>
                    Offerta di qualifica: un anno a {millions(qo)}. Se non rinnova resta RFA: in free agency
                    puoi pareggiare le offerte delle altre squadre, e se nessuno lo prende firma la qualifica.
                  </span>
                  {qualify?.qualify ? (
                    <span className="flex items-center gap-1">
                      <Tag tone="ink">Qualifica fatta</Tag>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        aria-label={`Ritira l’offerta di qualifica a ${name}`}
                        onClick={() =>
                          void run(
                            { kind: 'withdraw_request', request_id: qualify.id },
                            'Qualifica ritirata.',
                          )
                        }
                      >
                        Ritira
                      </Button>
                    </span>
                  ) : (
                    <Button
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          { kind: 'qualify', player_id: p.id, qualify: true },
                          `Offerta di qualifica a ${name}: se non rinnova resta RFA.`,
                        )
                      }
                    >
                      Fai la qualifica
                    </Button>
                  )}
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
