// Mercato degli scambi: anteprima della proposta (prima e dopo per le due squadre), i propri giocatori sul mercato
// (scritti dal client a turno aperto) e quelli che i manager della lega hanno messo sul mercato.
import { overall } from '@nbbgm/engine';
import { useState } from 'react';
import { Link } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import type { LeagueTeam } from '../lib/leagues.ts';
import { millions } from '../lib/market.ts';
import { playersLite, type PlayerLite, type RosterPlayer } from '../lib/roster.ts';
import { setOnBlock } from '../lib/tradeBlock.ts';
import type { SideNumbers, SidePreview, TradePreview } from '../lib/tradePreview.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Card, TeamCode, type ToastMessage } from './ui.tsx';

const signed = (x: number) => `${x < 0 ? '−' : '+'}${millions(Math.abs(x))}`;

/** "12,35 mln sotto il cap" / "4,10 mln sopra la tassa" */
function room(n: SideNumbers): string {
  if (n.capSpace >= 0) return `${millions(n.capSpace)} sotto il cap`;
  if (n.taxRoom >= 0) return `${millions(n.taxRoom)} dalla tassa`;
  return `${millions(-n.taxRoom)} sopra la tassa`;
}

function Row({
  label,
  before,
  after,
  bad = false,
}: {
  label: string;
  before: string;
  after: string;
  bad?: boolean;
}) {
  return (
    // Su telefono il valore va a capo sotto l'etichetta quando non ci sta accanto
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 py-1">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd
        className={`ml-auto text-right text-xs ${bad ? 'font-semibold text-red-700 dark:text-red-300' : ''}`}
      >
        {!before || before === after ? after : `${before} → ${after}`}
      </dd>
    </div>
  );
}

function SideCard({ side, offseason }: { side: SidePreview; offseason: boolean }) {
  const { before: b, after: a } = side;
  const rosterText = (n: SideNumbers) =>
    offseason ? `${n.total}/21 · two-way ${n.twoWay}/3` : `${n.standard}/15 · two-way ${n.twoWay}/3`;
  return (
    <div className="rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <h4 className="mb-1 flex items-center gap-2 text-sm font-semibold">
        <TeamCode code={side.code} />
        {a.payroll === b.payroll ? 'Monte stipendi invariato' : `Monte ${signed(a.payroll - b.payroll)}`}
      </h4>
      <dl className="divide-y divide-slate-100 dark:divide-slate-700">
        <Row label="Monte stipendi" before={millions(b.payroll)} after={millions(a.payroll)} />
        <Row label="Spazio" before={room(b)} after={room(a)} />
        <Row
          label={side.taxEstimated ? 'Luxury tax stimata (aliquote normali)' : 'Luxury tax stimata'}
          before={b.tax ? millions(b.tax) : 'nessuna'}
          after={a.tax ? millions(a.tax) : 'nessuna'}
          bad={a.tax > b.tax}
        />
        <Row
          label={offseason ? 'Rosa (offseason)' : 'Rosa standard'}
          before={rosterText(b)}
          after={rosterText(a)}
          bad={!side.rosterOk}
        />
        <Row
          label="Regola Stepien"
          before="ok"
          after={
            side.stepienGaps.length ? `senza prima scelta dal draft ${side.stepienGaps.join(', ')}` : 'ok'
          }
          bad={side.stepienGaps.length > 0}
        />
        <Row
          label="Saldo in rosso"
          before=""
          after={
            side.balance === 'unknown'
              ? 'riservato: lo controlla il server'
              : side.balance === 'blocked'
                ? 'non può aumentare il monte stipendi'
                : 'ok'
          }
          bad={side.balance === 'blocked'}
        />
      </dl>
    </div>
  );
}

/** Anteprima della proposta: prima e dopo per le due squadre, più i motivi per cui il server la rifiuterebbe. */
export function PreviewCard({ preview, offseason }: { preview: TradePreview; offseason: boolean }) {
  return (
    <section aria-label="Anteprima dello scambio" className="space-y-2">
      <h3 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
        Anteprima
      </h3>
      <div className="grid gap-2 md:grid-cols-2">
        {preview.sides.map((s) => (
          <SideCard key={s.teamId} side={s} offseason={offseason} />
        ))}
      </div>
      {preview.problems.length > 0 ? (
        <div
          role="status"
          className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-100"
        >
          <p className="font-semibold">Così il server la rifiuterebbe:</p>
          <ul className="list-disc pl-5">
            {preview.problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Per le regole che l’app conosce la proposta è valida. Decide il server, quando la mandi e alla
          chiusura del turno: il saldo dell’altra squadra è riservato e lo controlla solo lui.
        </p>
      )}
    </section>
  );
}

/** I propri giocatori sul mercato: si segnano e si tolgono a turno aperto; le vede tutta la lega. */
export function MyBlock({
  leagueId,
  teamId,
  roster,
  block,
  onChange,
  notify,
}: {
  leagueId: string;
  teamId: string;
  roster: readonly RosterPlayer[];
  block: Map<string, Set<string>> | null;
  onChange: () => void;
  notify: (m: ToastMessage) => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const mine = block?.get(teamId) ?? new Set<string>();
  const sorted = [...roster].sort((a, b) => overall(b) - overall(a));
  async function toggle(p: RosterPlayer, on: boolean) {
    setBusy(p.id);
    try {
      await setOnBlock(leagueId, teamId, p.id, on);
      notify({
        ok: true,
        text: on
          ? `${p.firstName} ${p.lastName} è sul mercato: lo vede tutta la lega.`
          : `${p.firstName} ${p.lastName} non è più sul mercato.`,
      });
    } catch (e) {
      notify({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(null);
      onChange();
    }
  }
  return (
    <Card className="space-y-2 !p-4">
      <h2 className="font-semibold">I tuoi giocatori sul mercato</h2>
      <p className="text-xs text-slate-500 dark:text-slate-400">
        Chi segni qui lo vedono gli altri manager nella pagina della tua squadra e nel mercato. È solo
        un’indicazione: gli scambi passano sempre da una proposta. Si cambia a turno aperto.
      </p>
      <ul className="max-h-72 space-y-1 overflow-y-auto text-sm">
        {sorted.map((p) => (
          <li key={p.id}>
            <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-1 hover:bg-slate-50 dark:hover:bg-slate-900">
              <input
                type="checkbox"
                className="size-4 accent-orange-600"
                checked={mine.has(p.id)}
                disabled={busy !== null || block === null}
                onChange={(e) => void toggle(p, e.target.checked)}
              />
              <span className="w-7 text-center font-mono text-xs">{overall(p)}</span>
              <span className="min-w-0 flex-1 truncate">
                {p.firstName} {p.lastName}
                <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                  {p.role} · {p.age}
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/**
 * Giocatori che i manager della lega hanno messo sul mercato, per squadra, con "Proponi" (apre la nuova proposta con
 * quella squadra e quel giocatore). Le liste dei bot, ricavate dalla strategia, si vedono nella pagina di ogni
 * squadra e scegliendo il bot qui sotto: per tutte servirebbero le rose intere dei 30.
 */
export function LeagueBlock({
  leagueId,
  myTeamId,
  teams,
  block,
}: {
  leagueId: string;
  myTeamId: string;
  teams: readonly LeagueTeam[];
  block: Map<string, Set<string>> | null;
}) {
  const others = teams.filter((t) => t.id !== myTeamId && (block?.get(t.id)?.size ?? 0) > 0);
  const ids = others.flatMap((t) => [...(block?.get(t.id) ?? [])]).sort();
  const players = useAsync(
    () => (ids.length ? playersLite(ids) : Promise.resolve(new Map<string, PlayerLite>())),
    [ids.join(',')],
  );
  return (
    <Card className="space-y-2 !p-4">
      <h2 className="font-semibold">Sul mercato nella lega</h2>
      {others.length === 0 ? (
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Nessun manager ha messo giocatori sul mercato. Quelli dei bot, secondo la loro strategia, si vedono
          scegliendo la squadra nella nuova proposta e nella pagina di ogni squadra.
        </p>
      ) : (
        <ul className="space-y-2 text-sm">
          {others.map((t) => (
            <li key={t.id}>
              <p className="flex items-center gap-2 font-medium">
                <TeamCode code={t.code} />
                <Link to={`/lega/${leagueId}/squadre/${t.code}`} className="truncate hover:underline">
                  {t.fullName}
                </Link>
              </p>
              <ul className="mt-1 space-y-1">
                {[...(block?.get(t.id) ?? [])].map((pid) => {
                  const p = players.data?.get(pid);
                  return (
                    <li key={pid} className="flex min-h-11 items-center gap-2 pl-1">
                      <span className="w-7 text-center font-mono text-xs">{p?.overall ?? ''}</span>
                      <span className="min-w-0 flex-1 truncate">
                        {p ? (
                          <Link to={`/lega/${leagueId}/giocatore/${pid}`} className="hover:underline">
                            {p.name}
                          </Link>
                        ) : (
                          '…'
                        )}
                        {p && (
                          <span className="ml-1 text-xs text-slate-500 dark:text-slate-400">
                            {p.role} · {p.age}
                          </span>
                        )}
                      </span>
                      <Link
                        to={`/lega/${leagueId}/mercato?tab=scambi&con=${t.id}&prendi=${pid}`}
                        className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-semibold text-orange-700 hover:bg-orange-50 dark:text-orange-300 dark:hover:bg-orange-950"
                      >
                        Proponi
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
