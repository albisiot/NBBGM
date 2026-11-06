// Notifiche push su questo dispositivo: iscrizione con la chiave pubblica VAPID (VITE_VAPID_PUBLIC_KEY), salvata
// sul server con save_push_subscription, e tipi di notifica scelti nel profilo. Senza la chiave l'app non
// propone nulla. Su iPhone le notifiche funzionano da iOS 16.4 e solo nell'app installata sulla schermata Home;
// il permesso si chiede dopo un tocco del manager.
import { currentPlatform, isIos, type PlatformInfo } from './install.ts';
import { supabase } from './supabase.ts';

export const VAPID_PUBLIC_KEY = ((import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined) ?? '').trim();

export type PushAvailability =
  /** Manca la chiave pubblica: l'app non parla di notifiche. */
  | 'off'
  /** Il browser non le supporta (o il service worker non c'è, come in sviluppo). */
  | 'unsupported'
  /** iPhone o iPad nel browser: prima va installata l'app. */
  | 'install'
  /** Il manager le ha bloccate nelle impostazioni del browser. */
  | 'denied'
  | 'ok';

export interface PushEnvironment {
  key: string;
  platform: PlatformInfo;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  permission: NotificationPermission | null;
}

/** Si possono attivare le notifiche qui? */
export function pushAvailability(env: PushEnvironment): PushAvailability {
  if (!env.key) return 'off';
  if (isIos(env.platform) && !env.platform.standalone) return 'install';
  if (!env.hasServiceWorker || !env.hasPushManager || env.permission === null) return 'unsupported';
  if (env.permission === 'denied') return 'denied';
  return 'ok';
}

export function currentPushEnvironment(): PushEnvironment {
  return {
    key: VAPID_PUBLIC_KEY,
    platform: currentPlatform(),
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: typeof window !== 'undefined' && 'PushManager' in window,
    permission: typeof Notification === 'undefined' ? null : Notification.permission,
  };
}

/** Chiave pubblica in base64url -> byte, come la vuole pushManager.subscribe. */
export function keyBytes(key: string): Uint8Array<ArrayBuffer> {
  const b64 = key.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Registrazione del service worker, se c'è (in sviluppo no: allora le notifiche non si possono provare). */
async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  return (await navigator.serviceWorker.getRegistration()) ?? null;
}

/** Iscrizione di questo dispositivo, se c'è. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await registration();
  return reg ? reg.pushManager.getSubscription() : null;
}

/** Chiede il permesso (va chiamata da un tocco), iscrive il dispositivo e salva l'iscrizione sul server. */
export async function enablePush(): Promise<void> {
  const reg = await registration();
  if (!reg) throw new Error('Le notifiche funzionano con l’app pubblicata, non in questa versione di prova.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permesso per le notifiche non concesso.');
  let sub = await reg.pushManager.getSubscription();
  // Un'iscrizione fatta con un'altra chiave (chiavi cambiate) non vale più
  const current = sub?.options.applicationServerKey;
  if (sub && current && !sameKey(new Uint8Array(current), keyBytes(VAPID_PUBLIC_KEY))) {
    await sub.unsubscribe();
    sub = null;
  }
  sub ??= await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: keyBytes(VAPID_PUBLIC_KEY),
  });
  const json = sub.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: sub.endpoint,
    p_p256dh: json.keys?.p256dh ?? '',
    p_auth: json.keys?.auth ?? '',
    p_user_agent: navigator.userAgent,
  });
  if (error) throw error;
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Toglie l'iscrizione di questo dispositivo, dal server e dal browser (notifiche spente o uscita). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: sub.endpoint });
  await sub.unsubscribe().catch(() => false);
  if (error) throw error;
}

export interface NotificationSettings {
  turn: boolean;
  decisions: boolean;
  draft: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationSettings = { turn: true, decisions: true, draft: true };

export const NOTIFICATION_KINDS: { key: keyof NotificationSettings; label: string; note: string }[] = [
  {
    key: 'turn',
    label: 'Turno nuovo',
    note: 'Quando si è giocato e si apre il turno successivo (non con l’allenatore).',
  },
  {
    key: 'decisions',
    label: 'Decisioni da prendere',
    note: 'Proposte di scambio, rosa sotto il minimo, draft, rinnovi, free agency.',
  },
  { key: 'draft', label: 'Draft dal vivo', note: 'Quando la tua scelta è tra le prossime tre.' },
];

export async function notificationSettings(userId: string): Promise<NotificationSettings> {
  const { data, error } = await supabase
    .from('notification_settings')
    .select('turn, decisions, draft')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return (data as NotificationSettings | null) ?? DEFAULT_NOTIFICATIONS;
}

export async function saveNotificationSettings(userId: string, s: NotificationSettings): Promise<void> {
  const { error } = await supabase
    .from('notification_settings')
    .upsert({ user_id: userId, ...s, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
  if (error) throw error;
}
