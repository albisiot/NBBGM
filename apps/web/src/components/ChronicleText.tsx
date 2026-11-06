// Testo di una riga della cronaca con le sigle delle squadre che portano alla loro pagina, e il riquadro delle
// ultime notizie nella pagina della lega.
import { Link } from 'react-router';
import { chroniclePage, NEWS_TYPES, splitTeams, TYPE_LABEL } from '../lib/chronicle.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Card } from './ui.tsx';

/** Testo di una riga con le sigle delle squadre che portano alla loro pagina. */
export function ChronicleText({
  leagueId,
  text,
  codes,
}: {
  leagueId: string;
  text: string;
  codes: string[];
}) {
  return (
    <span>
      {splitTeams(text, codes).map((part, i) =>
        'code' in part ? (
          <Link
            key={i}
            to={`/lega/${leagueId}/squadre/${part.code}`}
            className="font-semibold text-orange-700 hover:underline dark:text-orange-300"
          >
            {part.code}
          </Link>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

/** Ultime notizie della lega (senza draft e opzioni), con il link alla cronaca completa. */
export function LatestNews({ leagueId, codes }: { leagueId: string; codes: string[] }) {
  const { data } = useAsync(
    () => chroniclePage(leagueId, { types: NEWS_TYPES, team: null }, 0, 5),
    [leagueId],
  );
  if (!data || data.entries.length === 0) return null;
  return (
    <Card className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">Ultime notizie</h2>
        <Link
          to={`/lega/${leagueId}/cronaca`}
          className="inline-flex min-h-11 items-center text-sm font-semibold text-orange-700 hover:underline dark:text-orange-300"
        >
          Tutta la cronaca
        </Link>
      </div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-700">
        {data.entries.map((e) => (
          <li key={e.id} className="py-1.5 text-sm">
            <span className="mr-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
              {TYPE_LABEL[e.type] ?? e.type}
            </span>
            <ChronicleText
              leagueId={leagueId}
              text={e.text}
              codes={e.teamCodes.length ? e.teamCodes : codes}
            />
          </li>
        ))}
      </ul>
    </Card>
  );
}
