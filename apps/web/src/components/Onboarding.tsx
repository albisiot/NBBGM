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
import { Button, Card } from './ui.tsx';

const LINK = 'font-semibold text-orange-700 hover:underline dark:text-orange-300';

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
    <Card className="mb-4 space-y-2 !p-4">
      <h2 className="font-semibold">Installa NBBGM sul telefono</h2>
      {advice === 'prompt' && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Si apre dalla schermata Home come un’app, a tutto schermo e anche senza rete.
        </p>
      )}
      {advice === 'ios' && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
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
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Su iPhone e iPad l’app si installa da Safari: apri questa pagina in Safari, tocca{' '}
          <strong>Condividi</strong> e poi <strong>Aggiungi alla schermata Home</strong>.
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {advice === 'prompt' && (
          <Button onClick={() => void promptInstall().then((ok) => ok && close())}>Installa l’app</Button>
        )}
        <Button variant="ghost" onClick={close}>
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
    <Card className="space-y-3 border-orange-300 dark:border-orange-700">
      <div>
        <h2 className="text-lg font-semibold">Primi passi</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Guidi i {teamName}. Come si gioca, in breve:
        </p>
      </div>
      <ol className="list-decimal space-y-2 pl-5 text-sm text-slate-700 dark:text-slate-200">
        <li>
          In{' '}
          <Link to={`/lega/${leagueId}/squadra`} className={LINK}>
            Squadra
          </Link>{' '}
          scegli quintetto, minuti e tattiche (o tocca Auto) e salva.
        </li>
        <li>
          Quando hai finito premi <strong>Sono pronto</strong>: il turno si gioca quando tutti i manager sono
          pronti. Il pulsante c’è in cima a ogni pagina della lega.
        </li>
        <li>
          Se non puoi seguire la squadra, affidala all’<strong>allenatore</strong> (in Squadra): risulti
          pronto a ogni turno, ma si ferma quando c’è una decisione da prendere.
        </li>
        <li>
          Le decisioni (proposte di scambio, rinnovi, draft) arrivano come <strong>avvisi</strong> qui sotto.
          In{' '}
          <Link to={`/lega/${leagueId}/mercato`} className={LINK}>
            Mercato
          </Link>{' '}
          fai offerte agli svincolati e proponi scambi: tutto si esegue alla chiusura del turno.
        </li>
      </ol>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={close}>Ho capito</Button>
        <Link to="/guida" className={`text-sm ${LINK}`}>
          Come si gioca
        </Link>
      </div>
    </Card>
  );
}
