// Cronaca della lega: lo storico di scambi, firme, tagli, rinnovi, infortuni, ritiri e draft, dal più recente.
// Filtri per tipo e per squadra nell'indirizzo (?tipi=trade,signing&squadra=BOS), così si possono linkare.
import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { ChronicleText } from '../components/ChronicleText.tsx';
import { Button, Card, ErrorText, PageTitle, Spinner } from '../components/ui.tsx';
import {
  CHRONICLE_TYPES,
  chroniclePage,
  groupChronicle,
  TYPE_LABEL,
  type ChronicleEntry,
} from '../lib/chronicle.ts';
import { friendlyError } from '../lib/errors.ts';
import { leagueDetail } from '../lib/leagues.ts';
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
  // Pagine in più chieste con "Mostra altri", per gli stessi filtri
  const [extra, setExtra] = useState<{ of: unknown; entries: ChronicleEntry[]; more: boolean } | null>(null);
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

  const entries = [...(data?.entries ?? []), ...(extra?.of === data ? extra.entries : [])];
  const more = extra?.of === data ? extra.more : (data?.more ?? false);

  async function loadMore() {
    setBusy(true);
    setMoreError(null);
    try {
      const page = await chroniclePage(id, { types, team }, entries.length);
      setExtra({
        of: data,
        entries: [...(extra?.of === data ? extra.entries : []), ...page.entries],
        more: page.more,
      });
    } catch (e) {
      setMoreError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  const teams = [...(league?.teams ?? [])].sort((a, b) => a.code.localeCompare(b.code));
  const codes = teams.map((t) => t.code);

  return (
    <div className="space-y-4">
      <PageTitle sub="Scambi, firme, tagli, rinnovi, infortuni (da 4 partite in su), ritiri e draft della lega.">
        Cronaca
      </PageTitle>
      <Card className="space-y-3 !p-4">
        <div role="group" aria-label="Tipi" className="flex flex-wrap gap-1">
          {CHRONICLE_TYPES.map((t) => {
            const on = types.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                aria-pressed={on}
                onClick={() => toggleType(t.value)}
                className={`min-h-11 rounded-full border px-3 text-sm ${
                  on
                    ? 'border-orange-500 bg-orange-50 font-semibold text-orange-800 dark:bg-orange-950 dark:text-orange-200'
                    : 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-300'
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Squadra"
            className="min-h-11 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2 text-sm sm:flex-none dark:border-slate-600 dark:bg-slate-800"
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
          {(types.length > 0 || team) && (
            <Button variant="ghost" onClick={() => setSearch(new URLSearchParams(), { replace: true })}>
              Togli i filtri
            </Button>
          )}
        </div>
      </Card>

      {loading && !data && <Spinner />}
      <ErrorText>{error}</ErrorText>
      {data && entries.length === 0 && (
        <p className="text-sm text-slate-500 dark:text-slate-400">Nessun movimento con questi filtri.</p>
      )}
      {groupChronicle(entries).map((g, i) => (
        <section key={`${g.when}:${i}`} className="space-y-1">
          <h2 className="text-xs font-semibold tracking-wide text-slate-500 uppercase dark:text-slate-400">
            {g.when}
          </h2>
          <Card className="!p-0">
            <ul className="divide-y divide-slate-100 dark:divide-slate-700">
              {g.entries.map((e) => (
                <li key={e.id} className="px-4 py-2 text-sm">
                  <span className="mr-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
                    {TYPE_LABEL[e.type] ?? e.type}
                  </span>
                  <ChronicleText
                    leagueId={id}
                    text={e.text}
                    codes={e.teamCodes.length ? e.teamCodes : codes}
                  />
                </li>
              ))}
            </ul>
          </Card>
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
