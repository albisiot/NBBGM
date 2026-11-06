// Draft annuale dell'offseason: ordine delle 60 chiamate (dopo lottery, protezioni e swap), prospetti con le
// stime, la propria lista dei preferiti (si salva a ogni modifica) e, finito il draft, chi ha scelto chi. Le
// scelte le fa il server alla chiusura del turno: per le squadre umane il primo disponibile della lista, senza
// lista il migliore per i ruoli scoperti.
import { overall } from '@nbbgm/engine';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { Button, Card, ErrorText, PageTitle, Spinner, TeamCode } from '../components/ui.tsx';
import { useUserId } from '../lib/auth.tsx';
import { friendlyError } from '../lib/errors.ts';
import { latestSaver } from '../lib/latestSaver.ts';
import { leagueDetail } from '../lib/leagues.ts';
import { draftProspects, liteOf, playersLite } from '../lib/roster.ts';
import { supabase } from '../lib/supabase.ts';
import { useAsync } from '../lib/useAsync.ts';

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
  const { data, error, loading } = useAsync(async () => {
    const league = await leagueDetail(id);
    if (!league?.seasonYear) return null;
    const draftYear = league.seasonYear + 1;
    const mine = league.teams.find((t) => t.ownerId === userId) ?? null;
    const [order, prospects, list] = await Promise.all([
      draftOrder(id, draftYear),
      draftProspects(id, draftYear),
      mine ? myDraftList(mine.id) : Promise.resolve([] as string[]),
    ]);
    // Chi è già stato scelto: dai prospetti, oppure (non più prospetto) solo quei giocatori, non tutta la lega
    const players = new Map(prospects.map((p) => [p.id, liteOf(p)]));
    const picked = order.flatMap((s) => (s.playerId && !players.has(s.playerId) ? [s.playerId] : []));
    if (picked.length > 0) for (const [pid, p] of await playersLite(picked)) players.set(pid, p);
    return { league, draftYear, mine, order, prospects, players, list };
  }, [id, userId]);
  const [list, setList] = useState<string[] | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
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
  const { league, draftYear, mine, order, players } = data;
  const team = new Map(league.teams.map((t) => [t.id, t]));
  const done = order.length > 0 && order.every((s) => s.playerId !== null);
  const editable =
    league.roundKind === 'offseason' && league.roundStage === 'draft' && league.roundState === 'open';
  const byId = new Map(prospects.map((p) => [p.id, p]));

  function update(next: string[]) {
    if (!saver) return;
    setList(next);
    setSaveError(null);
    void saver.save(next);
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
        <p className="text-sm text-slate-600 dark:text-slate-300">
          L’ordine del draft si decide alla fine della stagione, dopo la finale: lottery per le 14 squadre
          fuori dai playoff, poi l’ordine inverso di classifica.
        </p>
      </div>
    );

  return (
    <div className="space-y-4">
      <PageTitle
        sub={
          done
            ? 'Draft concluso: i rookie hanno firmato con chi li ha scelti.'
            : '2 giri, 60 scelte. Alla chiusura del turno sceglie il server, dal primo disponibile della tua lista.'
        }
      >
        Draft {draftYear}
      </PageTitle>

      {!done && mine && (
        <Card className="space-y-2 !p-4">
          <h2 className="font-semibold">La tua lista</h2>
          {current.length === 0 && (
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Vuota: sceglierà il server il migliore per i ruoli scoperti. Aggiungi i prospetti dall’elenco
              qui sotto.
            </p>
          )}
          <ol className="space-y-1 text-sm">
            {current.map((pid, i) => {
              const p = byId.get(pid);
              return (
                <li key={pid} className="flex items-center gap-2">
                  <span className="w-6 text-right text-xs text-slate-500 dark:text-slate-400">{i + 1}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {p ? `${p.firstName} ${p.lastName}` : 'Non più disponibile'}
                    {p && (
                      <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                        {p.role} · {p.age} anni · pot. {p.scoutedPotential}
                      </span>
                    )}
                  </span>
                  {editable && (
                    <>
                      <Button variant="ghost" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Su">
                        ↑
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={i === current.length - 1}
                        onClick={() => move(i, 1)}
                        aria-label="Giù"
                      >
                        ↓
                      </Button>
                      <Button variant="ghost" onClick={() => void update(current.filter((x) => x !== pid))}>
                        Togli
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ol>
          {saveError && <ErrorText>{saveError}</ErrorText>}
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="!p-4">
          <h2 className="mb-2 font-semibold">Ordine delle scelte</h2>
          <ol className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-700">
            {order.map((s) => {
              const owner = team.get(s.teamId);
              const picked = s.playerId ? players.get(s.playerId) : null;
              return (
                <li
                  key={s.pickNo}
                  className={`flex items-center gap-2 py-1 ${s.teamId === mine?.id ? 'font-semibold' : ''}`}
                >
                  <span className="w-10 text-right font-mono text-xs text-slate-500 dark:text-slate-400">
                    {s.round}.{String(s.number).padStart(2, '0')}
                  </span>
                  <TeamCode code={owner?.code ?? '?'} strong={s.teamId === mine?.id} />
                  <span className="min-w-0 flex-1 truncate">
                    {picked ? (
                      <Link to={`/lega/${league.id}/giocatore/${s.playerId}`} className="hover:underline">
                        {picked.name}{' '}
                        <span className="text-xs text-slate-500 dark:text-slate-400">{picked.role}</span>
                      </Link>
                    ) : (
                      <span className="text-slate-500 dark:text-slate-400">da scegliere</span>
                    )}
                  </span>
                  {s.originalTeamId !== s.teamId && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      da {team.get(s.originalTeamId)?.code}
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </Card>

        {!done && (
          <Card className="!p-4">
            <h2 className="mb-2 font-semibold">Prospetti</h2>
            <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
              Il potenziale è una stima, come la vedono anche i bot.
            </p>
            <ul className="max-h-[32rem] divide-y divide-slate-100 overflow-y-auto text-sm dark:divide-slate-700">
              {prospects.map((p) => {
                const inList = current.includes(p.id);
                return (
                  <li key={p.id} className="flex items-center gap-2 py-1.5">
                    <span className="w-8 text-center font-mono text-xs">{overall(p)}</span>
                    <Link
                      to={`/lega/${league.id}/giocatore/${p.id}`}
                      className="min-w-0 flex-1 truncate hover:underline"
                    >
                      {p.firstName} {p.lastName}
                      <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                        {p.role} · {p.age} anni · pot. {p.scoutedPotential} · {p.archetype}
                      </span>
                    </Link>
                    {editable && mine && (
                      <Button
                        variant={inList ? 'ghost' : 'secondary'}
                        onClick={() =>
                          void update(inList ? current.filter((x) => x !== p.id) : [...current, p.id])
                        }
                      >
                        {inList ? 'Togli' : 'Aggiungi'}
                      </Button>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </div>
  );
}
