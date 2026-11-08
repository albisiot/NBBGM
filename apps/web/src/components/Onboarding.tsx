// Aiuti per chi comincia: il suggerimento per installare l'app e i primi passi in una lega nuova. Si chiudono e
// non tornano (memoria del browser).
import { useState } from 'react';
import { Link } from 'react-router';
import {
  currentPlatform,
  INSTALL_HINT_KEY,
  installAdvice,
  markSeen,
  promptInstall,
  seen,
  useCanPromptInstall,
  welcomeKey,
} from '../lib/install.ts';
import { ROW_LINK, TEXT_LINK } from '../lib/linkStyles.ts';
import { Button, Card, Kicker } from './ui.tsx';

/** Suggerimento per installare l'app sulla schermata Home (solo nel browser, non nell'app installata). */
export function InstallHint() {
  const canPrompt = useCanPromptInstall();
  const [hidden, setHidden] = useState(() => seen(INSTALL_HINT_KEY));
  const advice = installAdvice(currentPlatform(), canPrompt);
  if (hidden || !advice) return null;
  const close = () => {
    markSeen(INSTALL_HINT_KEY);
    setHidden(true);
  };
  return (
    <Card className="space-y-2 !p-3 sm:!p-4">
      <h2 className="text-base font-semibold tracking-wider">Tienila sul telefono</h2>
      {advice === 'prompt' && (
        <p className="text-[0.95rem] leading-snug">
          Installa NBBGM: si apre dalla schermata Home come un’app, a tutto schermo e anche senza rete.
        </p>
      )}
      {advice === 'ios' && (
        <ol className="list-decimal space-y-1 pl-5 text-[0.95rem] leading-snug">
          <li>
            Tocca <strong>Condividi</strong> (il quadrato con la freccia in su, in basso o in alto in Safari).
          </li>
          <li>
            Scegli <strong>Aggiungi alla schermata Home</strong>, poi <strong>Aggiungi</strong>.
          </li>
          <li>Apri NBBGM dall’icona: le notifiche su iPhone arrivano solo così.</li>
        </ol>
      )}
      {advice === 'ios-other-browser' && (
        <p className="text-[0.95rem] leading-snug">
          Su iPhone e iPad l’app si installa da Safari: apri questa pagina in Safari, tocca{' '}
          <strong>Condividi</strong> e poi <strong>Aggiungi alla schermata Home</strong>.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {advice === 'prompt' && (
          <Button onClick={() => void promptInstall().then((ok) => ok && close())}>Installa l’app</Button>
        )}
        <Button variant="ghost" className="px-1" onClick={close}>
          {advice === 'prompt' ? 'Non ora' : 'Ho capito'}
        </Button>
      </div>
    </Card>
  );
}

/** Primi passi la prima volta che si apre una lega con una propria squadra. */
export function WelcomeCard({ leagueId, teamName }: { leagueId: string; teamName: string }) {
  const [hidden, setHidden] = useState(() => seen(welcomeKey(leagueId)));
  if (hidden) return null;
  const close = () => {
    markSeen(welcomeKey(leagueId));
    setHidden(true);
  };
  return (
    <Card className="space-y-3 !p-3 sm:!p-4">
      <div className="space-y-0.5">
        <Kicker>Benvenuto · guidi i {teamName}</Kicker>
        <h2 className="text-xl font-bold">Primi passi</h2>
      </div>
      {/* I numeri in Oswald, come i punti di un elenco del giornale */}
      <ol className="space-y-2 text-[0.95rem] leading-snug">
        {[
          <>
            In{' '}
            <Link to={`/lega/${leagueId}/squadra`} className={TEXT_LINK}>
              Squadra
            </Link>{' '}
            scegli quintetto, minuti e tattiche (o tocca Auto) e salva.
          </>,
          <>
            Quando hai finito premi <strong>Sono pronto</strong>: il turno (un giorno del calendario) si gioca
            quando tutti i manager sono pronti. Il pulsante c’è in cima a ogni pagina della lega. Nei giorni
            in cui la tua squadra riposa sei già pronto.
          </>,
          <>
            Se non puoi seguire la squadra, affidala all’<strong>allenatore</strong> (in Squadra): risulti
            pronto a ogni turno, ma si ferma quando c’è una decisione da prendere.
          </>,
          <>
            Le decisioni (proposte di scambio, rinnovi, draft) arrivano nel riquadro{' '}
            <strong>Da decidere prima del turno</strong>, in questa pagina. In{' '}
            <Link to={`/lega/${leagueId}/mercato`} className={TEXT_LINK}>
              Mercato
            </Link>{' '}
            fai offerte agli svincolati e proponi scambi: tutto si esegue alla chiusura del turno.
          </>,
        ].map((step, i) => (
          <li key={i} className="flex gap-3">
            <span
              aria-hidden="true"
              className="w-4 shrink-0 text-right font-titolo text-lg leading-tight font-bold text-rosso-700 dark:text-rosso-300"
            >
              {i + 1}
            </span>
            <span>{step}</span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button onClick={close}>Ho capito</Button>
        <Link to="/guida" className={ROW_LINK}>
          Come si gioca
        </Link>
      </div>
    </Card>
  );
}
