// Notifiche nel profilo: attivarle su questo dispositivo e scegliere quali ricevere (valgono per tutti i propri
// dispositivi). Senza la chiave pubblica VAPID nella build non si vede nulla.
import { useEffect, useState } from 'react';
import { friendlyError } from '../lib/errors.ts';
import {
  currentPushEnvironment,
  currentSubscription,
  disablePush,
  enablePush,
  notificationSettings,
  NOTIFICATION_KINDS,
  pushAvailability,
  saveNotificationSettings,
  type NotificationSettings,
} from '../lib/push.ts';
import { useAsync } from '../lib/useAsync.ts';
import { Button, Card, ErrorText } from './ui.tsx';

export function PushSettings({ userId }: { userId: string }) {
  const [availability] = useState(() => pushAvailability(currentPushEnvironment()));
  if (availability === 'off') return null;
  return (
    <Card className="space-y-3">
      <h2 className="font-semibold">Notifiche</h2>
      {availability === 'install' && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Su iPhone e iPad le notifiche arrivano solo con l’app installata: in Safari tocca{' '}
          <strong>Condividi</strong> → <strong>Aggiungi alla schermata Home</strong>, poi apri NBBGM
          dall’icona e attivale qui (serve iOS 16.4 o successivo).
        </p>
      )}
      {availability === 'unsupported' && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Questo browser non supporta le notifiche.
        </p>
      )}
      {availability === 'denied' && (
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Le notifiche di NBBGM sono bloccate nelle impostazioni del browser (o del telefono): sbloccale lì e
          torna qui.
        </p>
      )}
      {availability === 'ok' && <PushControls userId={userId} />}
    </Card>
  );
}

function PushControls({ userId }: { userId: string }) {
  const [subscribed, setSubscribed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { data: saved } = useAsync(() => notificationSettings(userId), [userId]);
  const [settings, setSettings] = useState<NotificationSettings | null>(null);
  useEffect(() => {
    if (saved) setSettings(saved);
  }, [saved]);
  useEffect(() => {
    currentSubscription().then(
      (s) => setSubscribed(s !== null),
      () => setSubscribed(false),
    );
  }, []);

  async function run(action: () => Promise<void>, after: () => void) {
    setBusy(true);
    setError(null);
    try {
      await action();
      after();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <p className="text-sm text-slate-600 dark:text-slate-300">
        {subscribed
          ? 'Le notifiche sono attive su questo dispositivo.'
          : 'Ricevi una notifica quando serve una tua decisione o quando la lega passa al turno successivo.'}
      </p>
      <Button
        variant={subscribed ? 'secondary' : 'primary'}
        disabled={busy || subscribed === null}
        onClick={() =>
          void (subscribed
            ? run(disablePush, () => setSubscribed(false))
            : run(enablePush, () => setSubscribed(true)))
        }
      >
        {subscribed ? 'Disattiva su questo dispositivo' : 'Attiva su questo dispositivo'}
      </Button>
      {settings && (
        <fieldset className="space-y-1">
          <legend className="text-sm font-medium">Quali notifiche (su tutti i tuoi dispositivi)</legend>
          {NOTIFICATION_KINDS.map((k) => (
            <label key={k.key} className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4 accent-orange-600"
                checked={settings[k.key]}
                disabled={busy}
                onChange={(e) => {
                  const next = { ...settings, [k.key]: e.target.checked };
                  void run(
                    () => saveNotificationSettings(userId, next),
                    () => setSettings(next),
                  );
                }}
              />
              <span>
                {k.label}
                <span className="block text-xs text-slate-500 dark:text-slate-400">{k.note}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
