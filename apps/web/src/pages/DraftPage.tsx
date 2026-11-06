// Draft iniziale: giocatori in palio, lista dei preferiti, scelte fatte e rose. Dal vivo si sceglie quando
// tocca a te, con il tempo che scorre; allo scadere sceglie il server dalla tua lista.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import {
  draftAction,
  draftAnnouncement,
  draftPicks,
  draftPool,
  draftState,
  formatSalary,
  myDraftList,
  pickLabel,
  saveDraftList,
  secondsLeft,
  type DraftPickRow,
  type DraftPlayer,
  type DraftState,
} from '../lib/draft.ts';
import { friendlyError } from '../lib/errors.ts';
import { latestSaver } from '../lib/latestSaver.ts';
import { leagueDetail, type LeagueDetail } from '../lib/leagues.ts';

type Tab = 'players' | 'list' | 'picks' | 'rosters';
const ROLES = ['PG', 'SG', 'SF', 'PF', 'C'] as const;
const POLL_MS = 2000;

export function DraftPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [pool, setPool] = useState<DraftPlayer[]>([]);
  const [picks, setPicks] = useState<DraftPickRow[]>([]);
  const [list, setList] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>('players');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const lastTick = useRef(-1);
  const picksRef = useRef<DraftPickRow[]>([]);
  picksRef.current = picks;

  const myTeam = league?.teams.find((t) => t.ownerId === userId) ?? null;
  const isCommissioner = league?.commissionerId === userId;

  // Primo caricamento: lega, stato, giocatori, scelte e la mia lista
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [l, d, p, k] = await Promise.all([
          leagueDetail(id),
          draftState(id),
          draftPool(id),
          draftPicks(id),
        ]);
        if (!alive) return;
        setLeague(l);
        setDraft(d);
        setPool(p);
        setPicks(k);
        const mine = l?.teams.find((t) => t.ownerId === userId);
        if (mine) setList(await myDraftList(mine.id));
      } catch (e) {
        if (alive) setError(friendlyError(e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, userId]);

  const refresh = useCallback(async () => {
    const [d, k] = await Promise.all([draftState(id), draftPicks(id, picksRef.current.length)]);
    setDraft(d);
    if (k.length) setPicks((old) => [...old, ...k.filter((x) => x.pick >= old.length)]);
  }, [id]);

  // Aggiornamenti mentre il draft è aperto, e allo scadere del tempo si chiede al server di scegliere
  useEffect(() => {
    if (!draft || draft.state === 'done') return;
    const t = setInterval(() => {
      setNow(Date.now());
      void refresh().catch(() => {});
    }, POLL_MS);
    return () => clearInterval(t);
  }, [draft, refresh]);

  useEffect(() => {
    if (!draft || draft.state !== 'running' || draft.mode !== 'live') return;
    const left = secondsLeft(draft.deadline, now);
    if (left === 0 && lastTick.current !== draft.next) {
      lastTick.current = draft.next;
      void draftAction(id, 'tick')
        .then(refresh)
        .catch(() => {});
    }
  }, [draft, now, id, refresh]);

  const taken = useMemo(() => new Set(picks.map((p) => p.playerId)), [picks]);
  const byId = useMemo(() => new Map(pool.map((p) => [p.id, p])), [pool]);
  const teamById = useMemo(() => new Map((league?.teams ?? []).map((t) => [t.id, t])), [league]);
  // La lista si riscrive intera a ogni tocco: un salvataggio alla volta, l'ultimo vince
  const myTeamId = myTeam?.id;
  const saver = useMemo(
    () =>
      myTeamId
        ? latestSaver(
            (ids: string[]) => saveDraftList(myTeamId, id, ids),
            (e) => setError(friendlyError(e)),
          )
        : null,
    [myTeamId, id],
  );

  async function run(action: 'start' | 'to-list' | 'pick', playerId?: string) {
    setBusy(true);
    setError(null);
    try {
      await draftAction(id, action, playerId);
      await refresh();
    } catch (e) {
      setError(friendlyError(e));
      await refresh().catch(() => {});
    }
    setBusy(false);
  }

  function updateList(next: string[]) {
    if (!saver) return;
    setList(next);
    void saver.save(next);
  }

  if (loading) return <Spinner />;
  if (!league || !draft)
    return <ErrorText>{error ?? 'Questa lega non ha un draft iniziale, oppure non ne fai parte.'}</ErrorText>;

  const onClockTeam = draft.state === 'running' ? teamById.get(draft.order[draft.next] ?? '') : undefined;
  const myTurn = draft.mode === 'live' && onClockTeam !== undefined && onClockTeam.ownerId === userId;
  const left = secondsLeft(draft.deadline, now);
  const canEditList = draft.state !== 'done' && myTeam !== null;

  return (
    <div className="space-y-4">
      <PageTitle
        sub={
          <Link to={`/lega/${league.id}`} className="underline">
            {league.name}
          </Link>
        }
      >
        Draft iniziale
      </PageTitle>

      <Card className="space-y-3">
        {draft.state === 'waiting' && (
          <>
            <p className="text-sm">
              {draft.mode === 'list'
                ? 'Modalità lista: quando il commissario avvia il draft, il server fa tutte le scelte di fila dalle liste dei manager.'
                : `Dal vivo: ${draft.pickSeconds} secondi per scelta; allo scadere sceglie il server dalla tua lista.`}{' '}
              13 giri a serpentina, ordine sorteggiato. Intanto prepara la tua lista.
            </p>
            {isCommissioner ? (
              <Button disabled={busy} onClick={() => void run('start')}>
                Avvia il draft
              </Button>
            ) : (
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Aspetta che il commissario lo avvii.
              </p>
            )}
          </>
        )}
        {draft.state === 'running' && (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm text-slate-500 dark:text-slate-400">
                Chiamata {draft.next + 1} di {draft.order.length} · {pickLabel(draft.next)}
              </p>
              <p className={`text-lg font-semibold ${myTurn ? 'text-orange-600' : ''}`}>
                {myTurn ? 'Tocca a te!' : `Tocca a ${onClockTeam?.fullName ?? '…'}`}
                {!myTurn && onClockTeam && (
                  <span className="ml-2 text-sm font-normal text-slate-500 dark:text-slate-400">
                    {onClockTeam.ownerName ?? 'Bot'}
                  </span>
                )}
              </p>
            </div>
            {left !== null && (
              <p className={`font-mono text-3xl font-bold ${left <= 10 ? 'text-red-600' : ''}`}>
                {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
              </p>
            )}
            {isCommissioner && draft.mode === 'live' && (
              <Button variant="secondary" disabled={busy} onClick={() => void run('to-list')}>
                Chiudi con le liste
              </Button>
            )}
          </div>
        )}
        {draft.state === 'done' && (
          <p className="text-sm">
            Draft concluso: ogni squadra ha 13 giocatori. Chi non è stato scelto è svincolato.
          </p>
        )}
        {/* Il conto alla rovescia cambia ogni 2 secondi: ai lettori di schermo si annunciano solo i momenti
            importanti. La regione resta sempre nella pagina perché i cambi vengano letti. */}
        <p className="sr-only" aria-live="polite">
          {draftAnnouncement(myTurn, draft.state === 'running' ? left : null, draft.pickSeconds)}
        </p>
        <ErrorText>{error}</ErrorText>
      </Card>

      <div className="flex gap-1 overflow-x-auto" role="tablist">
        {(
          [
            ['players', 'Giocatori'],
            ['list', `La mia lista (${list.filter((p) => !taken.has(p)).length})`],
            ['picks', `Scelte (${picks.length})`],
            ['rosters', 'Rose'],
          ] as [Tab, string][]
        ).map(([t, label]) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={`min-h-11 shrink-0 rounded-lg px-3 text-sm font-medium ${
              tab === t
                ? 'bg-orange-600 text-white'
                : 'bg-white text-slate-700 dark:bg-slate-800 dark:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'players' && (
        <PlayersTab
          pool={pool}
          taken={taken}
          list={list}
          canEditList={canEditList}
          myTurn={myTurn && !busy}
          onAdd={(pid) => updateList([...list, pid])}
          onPick={(pid) => void run('pick', pid)}
        />
      )}
      {tab === 'list' && (
        <ListTab
          list={list}
          byId={byId}
          taken={taken}
          canEdit={canEditList}
          myTurn={myTurn && !busy}
          onChange={updateList}
          onPick={(pid) => void run('pick', pid)}
        />
      )}
      {tab === 'picks' && (
        <Card>
          <ol className="divide-y divide-slate-100 text-sm dark:divide-slate-700">
            {[...picks].reverse().map((k) => {
              const p = byId.get(k.playerId);
              const team = teamById.get(k.teamId);
              return (
                <li key={k.pick} className="flex items-center justify-between gap-2 py-1.5">
                  <span className="min-w-0 truncate">
                    <span className="mr-2 font-mono text-xs text-slate-500 dark:text-slate-400">
                      #{k.pick + 1}
                    </span>
                    <strong>{team?.code}</strong> {p?.name}{' '}
                    <span className="text-slate-500 dark:text-slate-400">
                      {p?.role} · {p ? Math.round(p.overall) : ''}
                    </span>
                  </span>
                  {k.auto && (
                    <span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">auto</span>
                  )}
                </li>
              );
            })}
            {picks.length === 0 && (
              <li className="py-2 text-slate-500 dark:text-slate-400">Nessuna scelta ancora.</li>
            )}
          </ol>
        </Card>
      )}
      {tab === 'rosters' && (
        <RostersTab league={league} picks={picks} byId={byId} myTeamId={myTeam?.id ?? null} />
      )}
    </div>
  );
}

function PlayerRow({
  p,
  children,
  className = '',
}: {
  p: DraftPlayer;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <li className={`flex items-center justify-between gap-2 py-2 ${className}`}>
      <span className="min-w-0">
        <span className="block truncate font-medium">{p.name}</span>
        <span className="text-xs text-slate-500 dark:text-slate-400">
          {p.role}
          {p.secondaryRole ? `/${p.secondaryRole}` : ''} · {p.age} anni · {formatSalary(p.salary)}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2">
        <span className="w-8 text-right font-mono text-sm font-semibold">{Math.round(p.overall)}</span>
        {children}
      </span>
    </li>
  );
}

function PlayersTab(props: {
  pool: DraftPlayer[];
  taken: Set<string>;
  list: string[];
  canEditList: boolean;
  myTurn: boolean;
  onAdd: (id: string) => void;
  onPick: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<string>('');
  const q = query.trim().toLowerCase();
  const shown = props.pool
    .filter((p) => !props.taken.has(p.id))
    .filter((p) => !role || p.role === role || p.secondaryRole === role)
    .filter((p) => !q || p.name.toLowerCase().includes(q))
    .slice(0, 100);
  return (
    <Card>
      <div className="mb-2 flex gap-2">
        <input
          type="search"
          aria-label="Cerca un giocatore"
          placeholder="Cerca per nome"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 text-base dark:border-slate-600 dark:bg-slate-900"
        />
        <select
          aria-label="Ruolo"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 text-sm dark:border-slate-600 dark:bg-slate-900"
        >
          <option value="">Tutti</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </div>
      <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
        Disponibili in ordine di overall (al massimo 100 alla volta).
      </p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {shown.map((p) => (
          <PlayerRow key={p.id} p={p}>
            {props.myTurn && (
              <Button className="px-3" onClick={() => props.onPick(p.id)}>
                Scegli
              </Button>
            )}
            {props.canEditList && !props.list.includes(p.id) && (
              <Button variant="secondary" className="px-3" onClick={() => props.onAdd(p.id)}>
                + Lista
              </Button>
            )}
            {props.list.includes(p.id) && <span className="text-xs text-orange-600">in lista</span>}
          </PlayerRow>
        ))}
      </ul>
    </Card>
  );
}

function ListTab(props: {
  list: string[];
  byId: Map<string, DraftPlayer>;
  taken: Set<string>;
  canEdit: boolean;
  myTurn: boolean;
  onChange: (next: string[]) => void;
  onPick: (id: string) => void;
}) {
  const move = (i: number, d: number) => {
    const next = [...props.list];
    const j = i + d;
    if (j < 0 || j >= next.length) return;
    [next[i], next[j]] = [next[j] as string, next[i] as string];
    props.onChange(next);
  };
  return (
    <Card>
      <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
        In modalità lista, o allo scadere del tempo, il server prende il primo disponibile di questa lista.
        Senza lista sceglie il migliore per il ruolo più scoperto.
      </p>
      {props.list.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          La lista è vuota: aggiungi giocatori dalla scheda Giocatori.
        </p>
      )}
      <ol className="divide-y divide-slate-100 dark:divide-slate-700">
        {props.list.map((pid, i) => {
          const p = props.byId.get(pid);
          if (!p) return null;
          const gone = props.taken.has(pid);
          return (
            <PlayerRow key={pid} p={p} className={gone ? 'opacity-40' : ''}>
              {gone && <span className="text-xs">già scelto</span>}
              {!gone && props.myTurn && (
                <Button className="px-3" onClick={() => props.onPick(pid)}>
                  Scegli
                </Button>
              )}
              {props.canEdit && (
                <>
                  <Button
                    variant="ghost"
                    className="min-w-11 px-2"
                    aria-label="Su"
                    onClick={() => move(i, -1)}
                  >
                    ↑
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-w-11 px-2"
                    aria-label="Giù"
                    onClick={() => move(i, 1)}
                  >
                    ↓
                  </Button>
                  <Button
                    variant="ghost"
                    className="min-w-11 px-2"
                    aria-label="Togli dalla lista"
                    onClick={() => props.onChange(props.list.filter((x) => x !== pid))}
                  >
                    ✕
                  </Button>
                </>
              )}
            </PlayerRow>
          );
        })}
      </ol>
    </Card>
  );
}

function RostersTab(props: {
  league: LeagueDetail;
  picks: DraftPickRow[];
  byId: Map<string, DraftPlayer>;
  myTeamId: string | null;
}) {
  const [teamId, setTeamId] = useState(props.myTeamId ?? props.league.teams[0]?.id ?? '');
  const players = props.picks
    .filter((k) => k.teamId === teamId)
    .map((k) => props.byId.get(k.playerId))
    .filter((p): p is DraftPlayer => p !== undefined);
  const payroll = players.reduce((a, p) => a + p.salary, 0);
  return (
    <Card>
      <select
        aria-label="Squadra"
        value={teamId}
        onChange={(e) => setTeamId(e.target.value)}
        className="mb-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm sm:w-auto dark:border-slate-600 dark:bg-slate-900"
      >
        {props.league.teams.map((t) => (
          <option key={t.id} value={t.id}>
            {t.fullName} · {t.ownerName ?? 'Bot'}
          </option>
        ))}
      </select>
      <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
        {players.length} di 13 giocatori · monte stipendi {formatSalary(payroll)}
      </p>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {players.map((p) => (
          <PlayerRow key={p.id} p={p} />
        ))}
      </ul>
    </Card>
  );
}
