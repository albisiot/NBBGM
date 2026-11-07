// Riepilogo del turno da condividere, sotto il titolo della pagina della lega (l'ultima partita della propria
// squadra). In due tocchi: il primo legge i dati (lib/summary.ts,
// che arriva a pezzi con il motore) e mostra il testo; il secondo lo manda al pannello di condivisione del sistema o
// agli appunti. Safari su iPhone apre il pannello solo subito dopo un tocco, non alla fine di un caricamento.
import { useCallback, useState } from 'react';
import type { LeagueDetail, LeagueTeam } from '../lib/leagues.ts';
import { friendlyError } from '../lib/errors.ts';
import { shareMessage, shareText, type ShareResult } from '../lib/share.ts';
import type { LastGame } from '../lib/turnStatus.ts';
import { Button, Toast, type ToastMessage } from './ui.tsx';

/** Testo pronto da condividere con i pulsanti Condividi (dove c'è il pannello del sistema), Copia e Chiudi. */
export function SharePreview({
  text,
  title,
  onClose,
  onResult,
}: {
  text: string;
  title: string;
  onClose: () => void;
  onResult: (r: ShareResult) => void;
}) {
  const canShare = typeof navigator.share === 'function';
  // Il testo come un ritaglio di giornale: filetto pieno sopra, a filo intorno
  return (
    <div className="space-y-3 border border-t-4 border-stampa-900 bg-stampa-25 p-3 dark:border-stampa-300 dark:bg-stampa-800">
      <pre className="font-serif text-[0.95rem] leading-relaxed break-words whitespace-pre-wrap">{text}</pre>
      <div className="flex flex-wrap gap-2">
        {canShare && <Button onClick={() => void shareText(text, title).then(onResult)}>Condividi</Button>}
        <Button
          variant={canShare ? 'secondary' : 'primary'}
          onClick={() => void shareText(text, title, { clipboard: navigator.clipboard }).then(onResult)}
        >
          Copia
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Chiudi
        </Button>
      </div>
    </div>
  );
}

export function ShareTurn({
  league,
  me,
  lastGame,
}: {
  league: LeagueDetail;
  me: LeagueTeam;
  lastGame: LastGame | null;
}) {
  const [busy, setBusy] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const close = useCallback(() => setMessage(null), []);

  async function prepare() {
    setBusy(true);
    setMessage(null);
    try {
      const { loadTurnSummary, summaryText } = await import('../lib/summary.ts');
      setText(summaryText(await loadTurnSummary(league, me, lastGame)));
    } catch (e) {
      setMessage({ ok: false, text: friendlyError(e) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      {text === null ? (
        <Button variant="secondary" disabled={busy} onClick={() => void prepare()}>
          {busy ? 'Preparo il riepilogo…' : 'Riepilogo da condividere'}
        </Button>
      ) : (
        <SharePreview
          text={text}
          title={`NBBGM · ${league.name}`}
          onClose={() => setText(null)}
          onResult={(r) => setMessage(shareMessage(r))}
        />
      )}
      <Toast message={message} onClose={close} />
    </>
  );
}
