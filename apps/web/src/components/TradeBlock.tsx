// Mercato degli scambi: anteprima della proposta (tabella prima → dopo per le due squadre, con l'esito che darebbe il
// server), i propri giocatori sul mercato (scritti dal client a turno aperto) e quelli che i manager della lega hanno
// messo sul mercato.
import { overall } from '@nbbgm/engine';
import { useState } from 'react';
import { Link } from 'react-router';
import { friendlyError } from '../lib/errors.ts';
import type { LeagueTeam } from '../lib/leagues.ts';
import { mln1, myTaxIncrease, previewRows } from '../lib/marketView.ts';
import { playersLite, type PlayerLite, type RosterPlayer } from '../lib/roster.ts';
import { setOnBlock } from '../lib/tradeBlock.ts';
import type { TradePreview } from '../lib/tradePreview.ts';
import { useAsync } from '../lib/useAsync.ts';
import { BAD, BOX, linkButton, META, NOTE, OvrBox, RULE, SubTitle } from './inkParts.tsx';
import { SectionTitle, TeamCode, type ToastMessage } from './ui.tsx';

/**
 * Anteprima della proposta: per le due squadre prima → dopo (monte stipendi, spazio, tassa, rosa, regola Stepien,
 * saldo), in rosso quello che peggiora o non va; sotto, l'esito che darebbe il server con i motivi di un rifiuto.
 */
export function PreviewCard({ preview, offseason }: { preview: TradePreview; offseason: boolean }) {
  const rows = previewRows(preview, offseason);
  const [me, them] = preview.sides;
  const taxUp = myTaxIncrease(preview);
  const estimated = preview.sides.some((s) => s.taxEstimated);
  return (
    <section aria-label="Anteprima dello scambio" className={`${BOX} space-y-2 px-3 py-2.5`}>
      <SubTitle aside="milioni di $">Anteprima, prima → dopo</SubTitle>
      {/* Su telefono stretto la tabella scorre dentro il riquadro, non la pagina */}
      <div className="relative -mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[19rem] text-[0.8125rem]">
          <thead>
            <tr className="font-titolo text-xs tracking-widest uppercase">
              <th scope="col" className="pb-1 text-left font-semibold">
                <span className="sr-only">Voce</span>
              </th>
              <th scope="col" className="w-[36%] pb-1 text-left font-semibold">
                {me.code}
              </th>
              <th scope="col" className="w-[36%] pb-1 text-left font-semibold">
                {them.code}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label} className={`${RULE} last:border-b-0`}>
                <th
                  scope="row"
                  className="py-1 pr-2 text-left align-top font-normal text-stampa-600 dark:text-stampa-300"
                >
                  {r.label}
                </th>
                {r.cells.map((c, i) => (
                  <td
                    key={i}
                    className={`py-1 pr-1 align-top font-titolo ${c.bad ? `font-semibold ${BAD}` : ''}`}
                  >
                    {c.text}
                    {c.bad && <span className="sr-only"> (problema)</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {estimated && (
        <p className={NOTE}>
          * Stima con le aliquote normali: non si sa se l’altra squadra paga quelle maggiorate.
        </p>
      )}
      <div className="border-t border-stampa-300 pt-2 text-sm leading-snug dark:border-stampa-700">
        {preview.problems.length > 0 ? (
          <div role="status" className={BAD}>
            <p className="font-semibold">Così il server la rifiuterebbe:</p>
            <ul className="list-disc pl-5">
              {preview.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </div>
        ) : (
          <p>
            <b>Per le regole che l’app conosce la proposta è valida.</b>{' '}
            {taxUp > 0 && (
              <span className={BAD}>
                La tua luxury tax stimata sale di {mln1(taxUp)} milioni, da pagare a fine regular season.{' '}
              </span>
            )}
            <i className="text-stampa-600 dark:text-stampa-300">
              Decide il server, quando la mandi e alla chiusura del turno
              {them.balance === 'unknown'
                ? `: il saldo di ${them.code} è riservato e lo controlla solo lui.`
                : '.'}
            </i>
          </p>
        )}
      </div>
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
    <section className="space-y-2">
      <SectionTitle aside={block ? `${mine.size} segnati` : undefined}>
        I tuoi giocatori sul mercato
      </SectionTitle>
      <p className={NOTE}>
        Chi segni qui lo vedono gli altri manager nella pagina della tua squadra e nel mercato. È solo
        un’indicazione: gli scambi passano sempre da una proposta. Si cambia a turno aperto.
      </p>
      <ul>
        {sorted.map((p) => (
          <li key={p.id} className={RULE}>
            <label className="flex min-h-12 cursor-pointer items-center gap-3 py-1">
              <input
                type="checkbox"
                className="size-5 shrink-0 accent-stampa-900 dark:accent-stampa-100"
                checked={mine.has(p.id)}
                disabled={busy !== null || block === null}
                onChange={(e) => void toggle(p, e.target.checked)}
              />
              <OvrBox value={overall(p)} small />
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${mine.has(p.id) ? 'font-bold' : ''}`}>
                  {p.firstName} {p.lastName}
                </span>
                <span className={META}>
                  {p.role} · {p.age} anni
                </span>
              </span>
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Giocatori che i manager della lega hanno messo sul mercato, per squadra, con "Proponi" (apre la nuova proposta con
 * quella squadra e quel giocatore). Le liste dei bot, ricavate dalla strategia, si vedono nella pagina di ogni
 * squadra e scegliendo il bot nella nuova proposta: per tutte servirebbero le rose intere dei 30.
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
    <section className="space-y-2">
      <SectionTitle>Sul mercato nella lega</SectionTitle>
      {others.length === 0 ? (
        <p className="text-sm">
          Nessun manager ha messo giocatori sul mercato.{' '}
          <i className="text-stampa-600 dark:text-stampa-300">
            Quelli dei bot, secondo la loro strategia, si vedono scegliendo la squadra nella nuova proposta e
            nella pagina di ogni squadra.
          </i>
        </p>
      ) : (
        <ul className="space-y-4">
          {others.map((t) => (
            <li key={t.id}>
              <SubTitle>
                <span className="flex items-center gap-2">
                  <TeamCode code={t.code} />
                  <Link
                    to={`/lega/${leagueId}/squadre/${t.code}`}
                    className="inline-flex min-h-11 min-w-0 items-center truncate hover:underline"
                  >
                    {t.fullName}
                  </Link>
                </span>
              </SubTitle>
              <ul>
                {[...(block?.get(t.id) ?? [])].map((pid) => {
                  const p = players.data?.get(pid);
                  return (
                    <li key={pid} className={`flex items-center gap-3 py-1.5 ${RULE}`}>
                      <OvrBox value={p?.overall ?? '–'} />
                      <span className="min-w-0 flex-1">
                        {p ? (
                          <Link
                            to={`/lega/${leagueId}/giocatore/${pid}`}
                            className="block truncate font-bold hover:underline"
                          >
                            {p.name}
                          </Link>
                        ) : (
                          <span className="block">…</span>
                        )}
                        {p && (
                          <span className={META}>
                            {p.role} · {p.age} anni
                          </span>
                        )}
                      </span>
                      <Link
                        to={`/lega/${leagueId}/mercato?tab=scambi&con=${t.id}&prendi=${pid}`}
                        className={linkButton('secondary', 'shrink-0 px-3')}
                        aria-label={p ? `Proponi uno scambio per ${p.name}` : 'Proponi uno scambio'}
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
    </section>
  );
}
