// Cronaca della lega: lo storico di scambi, firme, tagli, rinnovi, infortuni, ritiri e draft, dal più recente, come
// le brevi del giornale raccolte per giornata. Filtri per tipo e per squadra nell'indirizzo
// (?tipi=trade,signing&squadra=BOS), così si possono linkare.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ChronicleLine } from '../components/ChronicleText.tsx';
import { Button, ErrorText, PageTitle, SectionTitle, Spinner } from '../components/ui.tsx';
import {
  appendEntries,
  CHRONICLE_TYPES,
  chroniclePage,
  groupChronicle,
  TYPE_LABEL,
  type ChronicleCursor,
  type ChronicleEntry,
} from '../lib/chronicle.ts';
import { friendlyError } from '../lib/errors.ts';
import { leagueDetail } from '../lib/leagues.ts';
import { FIELD, NOTE } from '../lib/tabellino.ts';
import { useAsync } from '../lib/useAsync.ts';
import { useRoundChange } from '../lib/useRoundChange.ts';

export function ChroniclePage() {
  const { id = '' } = useParams();
  const [search, setSearch] = useSearchParams();
  const types = (search.get('tipi') ?? '').split(',').filter((t) => TYPE_LABEL[t] !== undefined);
  const team = search.get('squadra');
  const typesKey = types.join(',');
  const { data: league } = useAsync(() => leagueDetail(id), [id]);
  const { data, error, loading, reload } = useAsync(
    () => chroniclePage(id, { types: typesKey ? typesKey.split(',') : [], team }),
    [id, typesKey, team],
  );
  useRoundChange(id, reload);
  // Pagine in più chieste con "Mostra altri", per gli stessi filtri: ognuna riparte dall'ultima riga letta
  const [extra, setExtra] = useState<{
    of: unknown;
    entries: ChronicleEntry[];
    more: boolean;
    cursor: ChronicleCursor | null;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  useEffect(() => setExtra(null), [data]);

  const set = (key: string, value: string | null) => {
    const next = new URLSearchParams(search);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearch(next, { replace: true });
  };
  const toggleType = (t: string) =>
    set('tipi', (types.includes(t) ? types.filter((x) => x !== t) : [...types, t]).join(','));

  const mine = extra?.of === data ? extra : null;
  const entries = appendEntries(data?.entries ?? [], mine?.entries ?? []);
  const more = mine ? mine.more : (data?.more ?? false);
  const cursor = mine ? mine.cursor : (data?.cursor ?? null);

  async function loadMore() {
    if (!cursor) return;
    setBusy(true);
    setMoreError(null);
    try {
      const page = await chroniclePage(id, { types, team }, cursor);
      setExtra({
        of: data,
        entries: appendEntries(mine?.entries ?? [], page.entries),
        more: page.more,
        cursor: page.cursor ?? cursor,
      });
    } catch (e) {
      setMoreError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const teams = [...(league?.teams ?? [])].sort((a, b) => a.code.localeCompare(b.code));
  const codes = teams.map((t) => t.code);
  const label = 'font-titolo text-xs font-semibold tracking-widest uppercase';

  return (
    <div className="space-y-4">
      <PageTitle sub="Scambi, firme, tagli, rinnovi, infortuni (da 4 partite in su), ritiri e draft della lega.">
        Cronaca
      </PageTitle>
      <div className="space-y-3 border-y border-stampa-900 py-3 dark:border-stampa-100">
        <div role="group" aria-labelledby="cronaca-tipi" className="space-y-1">
          <p id="cronaca-tipi" className={label}>
            Tipi
          </p>
          <div className="flex flex-wrap gap-1.5">
            {CHRONICLE_TYPES.map((t) => {
              const on = types.includes(t.value);
              return (
                <button
                  key={t.value}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleType(t.value)}
                  className={`min-h-11 border px-3 font-titolo text-sm font-semibold tracking-wider uppercase ${
                    on
                      ? 'border-stampa-900 bg-stampa-900 text-stampa-25 dark:border-stampa-100 dark:bg-stampa-100 dark:text-stampa-900'
                      : 'border-stampa-900 text-stampa-900 hover:bg-stampa-100 dark:border-stampa-300 dark:text-stampa-100 dark:hover:bg-stampa-800'
                  }`}
                >
                  {t.label}
                </button>
              );
            })}
          </div>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-0 flex-1 flex-col gap-1 sm:flex-none">
            <span className={label}>Squadra</span>
            <select
              className={FIELD}
              value={team ?? ''}
              onChange={(e) => set('squadra', e.target.value || null)}
            >
              <option value="">Tutte le squadre</option>
              {teams.map((t) => (
                <option key={t.id} value={t.code}>
                  {t.code} · {t.fullName}
                </option>
              ))}
            </select>
          </label>
          {(types.length > 0 || team) && (
            <Button variant="ghost" onClick={() => setSearch(new URLSearchParams(), { replace: true })}>
              Togli i filtri
            </Button>
          )}
        </div>
      </div>

      {loading && !data && <Spinner />}
      <ErrorText>{error}</ErrorText>
      {data && entries.length === 0 && <p className={NOTE}>Nessun movimento con questi filtri.</p>}
      {groupChronicle(entries).map((g, i) => (
        <section key={`${g.when}:${i}`} className="space-y-1">
          <SectionTitle>{g.when}</SectionTitle>
          <ul>
            {g.entries.map((e) => (
              <li
                key={e.id}
                className="border-b border-stampa-200 py-2 text-sm leading-snug last:border-b-0 dark:border-stampa-700"
              >
                <ChronicleLine
                  leagueId={id}
                  type={e.type}
                  text={e.text}
                  codes={e.teamCodes.length ? e.teamCodes : codes}
                />
              </li>
            ))}
          </ul>
        </section>
      ))}
      {more && (
        <Button variant="secondary" className="w-full" disabled={busy} onClick={() => void loadMore()}>
          {busy ? 'Caricamento…' : 'Mostra altri'}
        </Button>
      )}
      <ErrorText>{moreError}</ErrorText>
    </div>
  );
}
