// Cerimonia di fine stagione come un'edizione straordinaria del giornale: la fascia rossa, "<città> campione" a
// tutta pagina, l'MVP delle Finali in un riquadro, i premi in righe a puntini, Condividi e Chiudi. Nella pagina della
// lega compare dopo la finale finché il manager non la chiude (una volta per stagione, memoria del browser); nello
// Storico si riapre per ogni stagione conclusa.
import { AWARD_FORMULA, FINALS_MVP_FORMULA } from '@nbbgm/engine';
import { useCallback, useState } from 'react';
import { Link } from 'react-router';
import { ceremonyLink, ceremonySeen, ceremonyText, loadCeremony, markCeremonySeen } from '../lib/ceremony.ts';
import { useUserId } from '../lib/auth.tsx';
import { teamCity } from '../lib/frontPage.ts';
import { seasonLabel, type LeagueSeason } from '../lib/history.ts';
import type { LeagueDetail } from '../lib/leagues.ts';
import { LINK_BUTTON } from '../lib/linkStyles.ts';
import { shareMessage } from '../lib/share.ts';
import { useAsync } from '../lib/useAsync.ts';
import { SharePreview } from './ShareTurn.tsx';
import { Button, ErrorText, Kicker, SectionTitle, Spinner, Toast, type ToastMessage } from './ui.tsx';

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
  const finals = data.awards.find((a) => a.key === 'finals');
  const awards = data.awards.filter((a) => a.key !== 'finals');

  return (
    <section className="border-2 border-stampa-900 dark:border-stampa-100">
      <p className="bg-rosso-600 px-2 py-1.5 text-center font-titolo text-sm font-semibold tracking-[0.24em] text-white uppercase dark:bg-rosso-500">
        Edizione straordinaria
      </p>
      <div className="space-y-5 p-4 sm:p-6">
        <div className="space-y-1.5 text-center">
          <Kicker>
            {league.name} · Finale {seasonLabel(data.year)}
          </Kicker>
          <h2 className="text-[2.75rem] leading-[0.95] font-bold break-words sm:text-6xl">
            {teamCity(data.champion.fullName)} campione
          </h2>
          {data.finalist && (
            <p className="text-base leading-snug text-stampa-700 italic dark:text-stampa-200">
              I {data.champion.fullName} battono {teamCity(data.finalist.fullName)} {data.wins[0]}–
              {data.wins[1]} nella serie finale.
            </p>
          )}
          {owner && (
            <p className="font-titolo text-sm font-semibold tracking-wider text-rosso-700 uppercase dark:text-rosso-300">
              {owner === userId
                ? 'Il titolo è tuo: complimenti!'
                : `Campioni con ${data.champion.ownerName ?? 'il loro manager'}`}
            </p>
          )}
        </div>

        {finals && (
          <div className="flex items-center gap-3.5 border border-stampa-900 bg-stampa-25 p-3 dark:border-stampa-600 dark:bg-stampa-800">
            <span
              aria-hidden="true"
              className="flex size-16 shrink-0 flex-col items-center justify-center bg-stampa-900 text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900"
            >
              <span className="font-titolo text-2xl leading-none font-bold">{finals.teamCode}</span>
              <span className="mt-0.5 font-titolo text-[0.6875rem] font-medium tracking-widest">MVP</span>
            </span>
            <div className="min-w-0 space-y-0.5">
              <Kicker>{finals.label}</Kicker>
              <p className="font-titolo text-2xl leading-tight font-bold uppercase">
                <Link to={`/lega/${league.id}/giocatore/${finals.playerId}`} className="hover:underline">
                  {finals.name}
                </Link>
                <span className="sr-only"> ({finals.teamCode})</span>
              </p>
              <p className="text-[0.875rem] text-stampa-600 italic dark:text-stampa-300">{finals.note}</p>
            </div>
          </div>
        )}

        {awards.length > 0 && (
          <section>
            <SectionTitle>I premi della stagione</SectionTitle>
            <ul className="mt-1">
              {awards.map((a) => (
                <li key={a.key} className="py-1">
                  <div className="flex min-h-8 items-baseline gap-2 text-[0.95rem]">
                    <span className="shrink-0">{a.label}</span>
                    <span
                      aria-hidden="true"
                      className="min-w-4 flex-1 border-b-2 border-dotted border-stampa-300 dark:border-stampa-600"
                    />
                    <Link
                      to={`/lega/${league.id}/giocatore/${a.playerId}`}
                      className="min-w-0 truncate font-semibold hover:underline"
                    >
                      {a.name}
                    </Link>
                    <span className="shrink-0 font-titolo text-[0.8125rem] font-semibold">{a.teamCode}</span>
                  </div>
                  <p className="text-right text-[0.8125rem] text-stampa-600 italic dark:text-stampa-300">
                    {a.note}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        )}

        <details className="text-[0.875rem] text-stampa-700 dark:text-stampa-200">
          <summary className="min-h-11 cursor-pointer content-center font-semibold text-rosso-700 italic dark:text-rosso-300">
            Come si calcolano
          </summary>
          <ul className="list-disc space-y-1 pl-5">
            <li>MVP delle Finali: {FINALS_MVP_FORMULA.toLowerCase()}.</li>
            {awards.map((a) => (
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
            <Button variant="secondary" className="min-h-12 flex-1" onClick={close}>
              Chiudi
            </Button>
            {!inHistory && (
              <Link
                to={`/lega/${league.id}/storico?stagione=${data.year}`}
                className={`${LINK_BUTTON.secondary} min-h-12 flex-1`}
              >
                Storico
              </Link>
            )}
            {/* Nella pagina della lega il rosso resta a Sono pronto; nello Storico la cerimonia è tutta la pagina */}
            <Button
              variant={inHistory ? 'accent' : 'primary'}
              className="min-h-12 flex-1"
              onClick={() => setSharing(true)}
            >
              Condividi
            </Button>
          </div>
        )}
      </div>
      <Toast message={message} onClose={closeMessage} />
    </section>
  );
}
