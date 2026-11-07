// Cerimonia di fine stagione: campione, MVP delle Finali e premi, con Condividi. Nella pagina della lega compare
// dopo la finale finché il manager non la chiude (una volta per stagione, memoria del browser); nello Storico si
// riapre per ogni stagione conclusa.
import { AWARD_FORMULA, FINALS_MVP_FORMULA } from '@nbbgm/engine';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { ceremonyLink, ceremonySeen, ceremonyText, loadCeremony, markCeremonySeen } from '../lib/ceremony.ts';
import { useUserId } from '../lib/auth.tsx';
import { seasonLabel, type LeagueSeason } from '../lib/history.ts';
import type { LeagueDetail } from '../lib/leagues.ts';
import { shareMessage } from '../lib/share.ts';
import { useAsync } from '../lib/useAsync.ts';
import { SharePreview } from './ShareTurn.tsx';
import { Button, Card, ErrorText, Spinner, TeamCode, Toast, type ToastMessage } from './ui.tsx';

export function CeremonyCard({
  league,
  season,
  inHistory = false,
  onClose,
}: {
  league: LeagueDetail;
  season: LeagueSeason;
  /** Nello Storico si rivede sempre e non si segna come vista. */
  inHistory?: boolean;
  onClose?: () => void;
}) {
  const [closed, setClosed] = useState(() => !inHistory && ceremonySeen(league.id, season.year));
  const { data, error, loading } = useAsync(
    () => (closed ? Promise.resolve(null) : loadCeremony(league, season)),
    [league.id, season.id, closed],
  );
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const closeMessage = useCallback(() => setMessage(null), []);
  const userId = useUserId();

  if (closed) return null;
  if (loading && !data) return <Spinner label="Preparo la cerimonia…" />;
  if (error) return <ErrorText>{error}</ErrorText>;
  if (!data) return null;
  const close = () => {
    if (!inHistory) markCeremonySeen(league.id, season.year);
    setClosed(true);
    onClose?.();
  };
  const text = ceremonyText(data, league.name, ceremonyLink(league.id, data.year));
  const owner = data.champion.ownerId;

  return (
    <Card className="space-y-4 border-amber-300 bg-gradient-to-b from-amber-50 to-white dark:border-amber-700 dark:from-amber-950 dark:to-slate-800">
      <div className="text-center">
        <p className="text-4xl" aria-hidden="true">
          🏆
        </p>
        <p className="text-sm text-slate-600 dark:text-slate-300">Stagione {seasonLabel(data.year)}</p>
        <h2 className="text-2xl font-bold">{data.champion.fullName} campioni</h2>
        {data.finalist && (
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Finale vinta {data.wins[0]}-{data.wins[1]} su {data.finalist.fullName}
          </p>
        )}
        {owner && (
          <p className="mt-1 text-sm font-semibold text-amber-800 dark:text-amber-200">
            {owner === userId
              ? 'Il titolo è tuo: complimenti!'
              : `Campioni con ${data.champion.ownerName ?? 'il loro manager'}`}
          </p>
        )}
      </div>
      <ul className="grid gap-2 sm:grid-cols-2">
        {data.awards.map((a) => (
          <li
            key={a.key}
            className={`rounded-lg border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-800 ${a.key === 'finals' ? 'sm:col-span-2' : ''}`}
          >
            <p className="text-xs font-semibold tracking-wide text-amber-800 uppercase dark:text-amber-200">
              {a.label}
            </p>
            <p className="flex items-center gap-2 font-semibold">
              <TeamCode code={a.teamCode} />
              <Link to={`/lega/${league.id}/giocatore/${a.playerId}`} className="truncate hover:underline">
                {a.name}
              </Link>
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300">{a.note}</p>
          </li>
        ))}
      </ul>
      <details className="text-xs text-slate-600 dark:text-slate-300">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">Come si calcolano</summary>
        <ul className="list-disc space-y-1 pl-5">
          <li>MVP delle Finali: {FINALS_MVP_FORMULA.toLowerCase()}.</li>
          {data.awards
            .filter((a) => a.key !== 'finals')
            .map((a) => (
              <li key={a.key}>
                {a.label}: {AWARD_FORMULA[a.key as keyof typeof AWARD_FORMULA].toLowerCase()}.
              </li>
            ))}
          <li>Per i premi della stagione servono almeno metà delle partite del giocatore più presente.</li>
        </ul>
      </details>
      {sharing ? (
        <SharePreview
          text={text}
          title={`NBBGM · ${league.name}`}
          onClose={() => setSharing(false)}
          onResult={(r) => setMessage(shareMessage(r))}
        />
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => setSharing(true)}>Condividi</Button>
          {!inHistory && (
            <Link
              to={`/lega/${league.id}/storico?stagione=${data.year}`}
              className="inline-flex min-h-11 items-center rounded-lg border border-slate-300 px-4 text-sm font-semibold hover:bg-slate-50 dark:border-slate-600 dark:hover:bg-slate-700"
            >
              Storico
            </Link>
          )}
          <Button variant="ghost" onClick={close}>
            Chiudi
          </Button>
        </div>
      )}
      <Toast message={message} onClose={closeMessage} />
    </Card>
  );
}
