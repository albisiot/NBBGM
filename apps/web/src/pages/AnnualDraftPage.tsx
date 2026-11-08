// Draft annuale dell'offseason, dal vivo: ordine delle 60 chiamate (dopo lottery, protezioni e swap), prospetti con
// le stime, la propria lista dei preferiti (si salva a ogni modifica) e chi ha scelto chi. Ogni turno del draft è di
// un manager, quello della chiamata: sceglie il giocatore qui (Scegli) e preme Pronto; alla chiusura il server fa la
// sua scelta e quelle dei bot fino alla chiamata del manager successivo. Senza scelta prende il primo disponibile
// della lista, senza lista il migliore per i ruoli scoperti.
import { overall } from '@nbbgm/engine';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, ErrorText, PageTitle, SectionTitle, Spinner } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { annualListToSave } from '../lib/draft.ts';
import { friendlyError } from '../lib/errors.ts';
import { latestSaver } from '../lib/latestSaver.ts';
import { leagueDetail } from '../lib/leagues.ts';
import { marketAction, myRequests, type RosterRequest } from '../lib/market.ts';
import { draftProspects, liteOf, playersLite } from '../lib/roster.ts';
import { supabase } from '../lib/supabase.ts';
import { INK_LINK, NOTE } from '../lib/tabellino.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';

/** Riga di un elenco del draft: filetto sottile sotto, niente dopo l'ultima. */
const LIST_ROW = 'border-b border-stampa-200 last:border-b-0 dark:border-stampa-700';

interface Slot {
  pickNo: number;
  round: number;
  number: number;
  teamId: string;
  originalTeamId: string;
  playerId: string | null;
}

async function draftOrder(leagueId: string, draftYear: number): Promise<Slot[]> {
  const { data, error } = await supabase
    .from('draft_order')
    .select('pick_no, round, number, team_id, original_team_id, player_id')
    .eq('league_id', leagueId)
    .eq('draft_year', draftYear)
    .order('pick_no');
  if (error) throw error;
  return (
    (data ?? []) as {
      pick_no: number;
      round: number;
      number: number;
      team_id: string;
      original_team_id: string;
      player_id: string | null;
    }[]
  ).map((d) => ({
    pickNo: d.pick_no,
    round: d.round,
    number: d.number,
    teamId: d.team_id,
    originalTeamId: d.original_team_id,
    playerId: d.player_id,
  }));
}

/** Chiamata del turno del draft dal vivo e squadra che sceglie; senza le colonne (app prima della migrazione) null. */
async function draftTurn(roundId: string | null): Promise<{ pick: number; teamId: string } | null> {
  if (!roundId) return null;
  const { data, error } = await supabase
    .from('rounds')
    .select('draft_pick, draft_team_id')
    .eq('id', roundId)
    .maybeSingle();
  if (error || !data) return null;
  const r = data as { draft_pick: number | null; draft_team_id: string | null };
  return r.draft_pick !== null && r.draft_team_id !== null
    ? { pick: r.draft_pick, teamId: r.draft_team_id }
    : null;
}

async function myDraftList(teamId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('draft_lists')
    .select('player_ids')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) throw error;
  return (data as { player_ids: string[] } | null)?.player_ids ?? [];
}

async function saveDraftList(teamId: string, leagueId: string, ids: string[]): Promise<void> {
  const { error } = await supabase
    .from('draft_lists')
    .upsert({ team_id: teamId, league_id: leagueId, player_ids: ids, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export function AnnualDraftPage() {
  const { id = '' } = useParams();
  const userId = useUserId();
  const { data, error, loading, reload } = useAsync(async () => {
    const league = await leagueDetail(id);
    if (!league?.seasonYear) return null;
    const draftYear = league.seasonYear + 1;
    const mine = league.teams.find((t) => t.ownerId === userId) ?? null;
    const live = league.roundKind === 'offseason' && league.roundStage === 'draft';
    const [order, prospects, list, turn, requests] = await Promise.all([
      draftOrder(id, draftYear),
      draftProspects(id, draftYear),
      mine ? myDraftList(mine.id) : Promise.resolve([] as string[]),
      live ? draftTurn(league.roundId) : Promise.resolve(null),
      mine && live ? myRequests(mine.id) : Promise.resolve([] as RosterRequest[]),
    ]);
    const choice = requests.find((r) => r.kind === 'draft_pick') ?? null;
    // Chi è già stato scelto: dai prospetti, oppure (non più prospetto) solo quei giocatori, non tutta la lega
    const players = new Map(prospects.map((p) => [p.id, liteOf(p)]));
    const picked = order.flatMap((s) => (s.playerId && !players.has(s.playerId) ? [s.playerId] : []));
    if (picked.length > 0) for (const [pid, p] of await playersLite(picked)) players.set(pid, p);
    return { league, draftYear, mine, order, prospects, players, list, turn, choice };
  }, [id, userId]);
  // Alla chiusura del turno del draft la lista non si cambia più e arrivano le scelte fatte: si rilegge tutto
  useRoundChange(id, reload);
  const [list, setList] = useState<string[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickError, setPickError] = useState<string | null>(null);
  // Un'altra lega: si riparte dalla lista salvata
  useEffect(() => {
    setList(null);
    setSaveError(null);
  }, [id]);
  // La lista si riscrive intera a ogni tocco: un salvataggio alla volta, l'ultimo vince
  const mineId = data?.mine?.id;
  const saver = useMemo(
    () =>
      mineId
        ? latestSaver(
            (ids: string[]) => saveDraftList(mineId, id, ids),
            (e) => setSaveError(friendlyError(e)),
          )
        : null,
    [mineId, id],
  );

  const current = list ?? data?.list ?? [];
  const prospects = useMemo(
    () =>
      [...(data?.prospects ?? [])].sort(
        (a, b) => b.scoutedPotential - a.scoutedPotential || overall(b) - overall(a),
      ),
    [data],
  );

  if (loading && !data) return <Spinner />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return <ErrorText>Lega non trovata, oppure non ne fai parte.</ErrorText>;
  const { league, draftYear, mine, order, players, turn, choice } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const done = order.length > 0 && order.every((s) => s.playerId !== null);
  const editable =
    league.roundKind === 'offseason' && league.roundStage === 'draft' && league.roundState === 'open';
  const byId = new Map(prospects.map((p) => [p.id, p]));
  const onClock = turn ? order.find((s) => s.pickNo === turn.pick) : undefined;
  const myTurn = editable && turn !== null && turn.teamId === mine?.id;
  const chosen = choice ? byId.get(choice.playerId) : undefined;

  async function act(action: Parameters<typeof marketAction>[1]) {
    setBusy(true);
    setPickError(null);
    try {
      await marketAction(id, action);
      reload();
    } catch (e) {
      setPickError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  function update(next: string[]) {
    if (!saver || !editable) return;
    const kept = annualListToSave(next, new Set(byId.keys()));
    setList(kept);
    setSaveError(null);
    void saver.save(kept);
  }
  const move = (i: number, d: number) => {
    const next = [...current];
    const [x] = next.splice(i, 1);
    next.splice(i + d, 0, x as string);
    void update(next);
  };

  if (order.length === 0)
    return (
      <div className="space-y-4">
        <PageTitle>Draft {draftYear}</PageTitle>
        <p className={NOTE}>
          L’ordine del draft si decide alla fine della stagione, dopo la finale: lottery per le 14 squadre
          fuori dai playoff, poi l’ordine inverso di classifica.
        </p>
      </div>
    );

  return (
    <div className="space-y-6">
      <PageTitle
        sub={
          done
            ? 'Draft concluso: i rookie hanno firmato con chi li ha scelti.'
            : '2 giri, 60 scelte, dal vivo: un turno per ogni scelta di un manager, i bot scelgono nel frattempo.'
        }
      >
        Draft {draftYear}
      </PageTitle>

      {!done && onClock && (
        <section className="space-y-2" aria-live="polite">
          <SectionTitle aside={`${onClock.round}.${String(onClock.number).padStart(2, '0')}`}>
            {myTurn ? `Tocca a te: scelta n. ${onClock.pickNo}` : `Scelta n. ${onClock.pickNo}`}
          </SectionTitle>
          {myTurn ? (
            <>
              <p className="text-[0.95rem] leading-snug">
                {chosen ? (
                  <>
                    Hai scelto <b>{`${chosen.firstName} ${chosen.lastName}`}</b>. Premi Pronto: alla chiusura
                    del turno è tuo, poi scelgono i bot fino al prossimo manager.
                  </>
                ) : (
                  'Scegli il giocatore tra i prospetti qui sotto, poi premi Pronto. Senza scelta prende il primo disponibile della tua lista, senza lista il migliore per i ruoli scoperti.'
                )}
              </p>
              {choice && (
                <Button
                  variant="ghost"
                  disabled={busy}
                  onClick={() => void act({ kind: 'withdraw_request', request_id: choice.id })}
                >
                  Annulla la scelta
                </Button>
              )}
            </>
          ) : (
            <p className={NOTE}>
              Sceglie {team.get(onClock.teamId)?.code ?? '?'}: il turno è suo. Intanto puoi sistemare la tua
              lista.
            </p>
          )}
          {pickError && <ErrorText>{pickError}</ErrorText>}
        </section>
      )}

      {!done && mine && (
        <section className="space-y-2">
          <SectionTitle aside={`${current.length} ${current.length === 1 ? 'prospetto' : 'prospetti'}`}>
            La tua lista
          </SectionTitle>
          {current.length === 0 && (
            <p className={NOTE}>
              Vuota: quando tocca a te e non scegli, sceglie il server il migliore per i ruoli scoperti.
              Aggiungi i prospetti dall’elenco qui sotto.
            </p>
          )}
          <ol className="text-sm">
            {current.map((pid, i) => {
              const p = byId.get(pid);
              return (
                <li key={pid} className={`flex min-h-11 items-center gap-2 ${LIST_ROW}`}>
                  <span className="w-6 text-right font-titolo text-stampa-600 tabular-nums dark:text-stampa-300">
                    {i + 1}
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-semibold">
                      {p ? `${p.firstName} ${p.lastName}` : 'Non più disponibile'}
                    </span>
                    {p && (
                      <i className="ml-1.5 text-[0.8125rem] text-stampa-600 dark:text-stampa-300">
                        {p.role} · {p.age} anni · pot. {p.scoutedPotential}
                      </i>
                    )}
                  </span>
                  {editable && (
                    <>
                      <Button
                        variant="ghost"
                        className="min-w-11 px-2 no-underline disabled:opacity-40"
                        disabled={i === 0}
                        onClick={() => move(i, -1)}
                        aria-label="Su"
                      >
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        className="min-w-11 px-2 no-underline disabled:opacity-40"
                        disabled={i === current.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="Giù"
                      >
                        ↓
                      </Button>
                      <Button
                        variant="ghost"
                        className="px-2"
                        onClick={() => void update(current.filter((x) => x !== pid))}
                      >
                        Togli
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {saveError && <ErrorText>{saveError}</ErrorText>}
        </section>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <section className="space-y-2">
          <SectionTitle>Ordine delle scelte</SectionTitle>
          <ol className="max-h-[32rem] overflow-y-auto text-sm">
            {order.map((s) => {
              const owner = team.get(s.teamId);
              const own = s.teamId === mine?.id;
              const picked = s.playerId ? players.get(s.playerId) : null;
              return (
                <li
                  key={s.pickNo}
                  className={`flex items-center gap-2 py-1.5 ${LIST_ROW} ${own ? 'bg-stampa-25 font-semibold dark:bg-stampa-800' : ''}`}
                >
                  <span className="w-10 text-right font-titolo text-stampa-600 tabular-nums dark:text-stampa-300">
                    {s.round}.{String(s.number).padStart(2, '0')}
                  </span>
                  <b
                    className={`w-9 shrink-0 font-titolo font-semibold ${own ? 'text-rosso-700 dark:text-rosso-300' : ''}`}
                  >
                    {owner?.code ?? '?'}
                  </b>
                  <span className="min-w-0 flex-1 truncate">
                    {picked ? (
                      <Link to={`/lega/${league.id}/giocatore/${s.playerId}`} className={INK_LINK}>
                        {picked.name}{' '}
                        <i className="text-[0.8125rem] text-stampa-600 dark:text-stampa-300">{picked.role}</i>
                      </Link>
                    ) : (
                      <i className="text-[0.8125rem] text-stampa-600 dark:text-stampa-300">da scegliere</i>
                    )}
                  </span>
                  {s.originalTeamId !== s.teamId && (
                    <i className="shrink-0 pr-1 text-[0.8125rem] text-stampa-600 dark:text-stampa-300">
                      da {team.get(s.originalTeamId)?.code}
                    </i>
                  )}
                </li>
              );
            })}
          </ol>
        </section>

        {!done && (
          <section className="space-y-2">
            <SectionTitle>Prospetti</SectionTitle>
            <p className={NOTE}>Il potenziale è una stima, come la vedono anche i bot.</p>
            <ul className="max-h-[32rem] overflow-y-auto text-sm">
              {prospects.map((p) => {
                const inList = current.includes(p.id);
                return (
                  <li key={p.id} className={`flex min-h-11 items-center gap-2 py-1 ${LIST_ROW}`}>
                    <span
                      className="w-8 text-center font-titolo text-base font-semibold tabular-nums"
                      title="Overall"
                    >
                      {overall(p)}
                    </span>
                    <Link
                      to={`/lega/${league.id}/giocatore/${p.id}`}
                      className={`min-w-0 flex-1 truncate ${INK_LINK}`}
                    >
                      <span className="font-semibold">
                        {p.firstName} {p.lastName}
                      </span>
                      <i className="ml-1.5 text-[0.8125rem] text-stampa-600 dark:text-stampa-300">
                        {p.role} · {p.age} anni · pot. {p.scoutedPotential} · {p.archetype}
                      </i>
                    </Link>
                    {myTurn && (
                      <Button
                        className="px-3"
                        disabled={busy || choice?.playerId === p.id}
                        aria-label={`Scegli ${p.firstName} ${p.lastName}`}
                        onClick={() => void act({ kind: 'draft_pick', player_id: p.id })}
                      >
                        {choice?.playerId === p.id ? 'Scelto' : 'Scegli'}
                      </Button>
                    )}
                    {editable && mine && (
                      <Button
                        variant={inList ? 'ghost' : 'secondary'}
                        className="px-3"
                        onClick={() =>
                          void update(inList ? current.filter((x) => x !== p.id) : [...current, p.id])
                        }
                      >
                        {inList ? 'Togli' : 'In lista'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
