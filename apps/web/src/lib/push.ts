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

/** Quanto serve di un'iscrizione del browser (PushSubscription). */
export interface SubscriptionLike {
  endpoint: string;
  options: { applicationServerKey: ArrayBuffer | null };
  toJSON(): PushSubscriptionJSON;
  unsubscribe(): Promise<boolean>;
}

/** Il gestore delle iscrizioni del dispositivo (pushManager del service worker), con il permesso concesso. */
export interface PushDevice {
  permission: NotificationPermission | null;
  getSubscription(): Promise<SubscriptionLike | null>;
  subscribe(key: Uint8Array<ArrayBuffer>): Promise<SubscriptionLike>;
}

/** Le chiamate al server per le iscrizioni. */
export interface PushServer {
  save(sub: SubscriptionLike): Promise<void>;
  remove(endpoint: string): Promise<void>;
}

/**
 * Iscrizione con la chiave attuale: quella che c'è, se è stata fatta con questa chiave, altrimenti una nuova (le
 * chiavi VAPID sono cambiate e la vecchia iscrizione non vale più). replaced è l'indirizzo di quella tolta.
 */
export async function subscriptionWithKey(
  device: PushDevice,
  key: string,
): Promise<{ sub: SubscriptionLike; replaced: string | null }> {
  const wanted = keyBytes(key);
  const sub = await device.getSubscription();
  const current = sub?.options.applicationServerKey;
  if (sub && (!current || sameKey(new Uint8Array(current), wanted))) return { sub, replaced: null };
  if (sub) await sub.unsubscribe().catch(() => false);
  return { sub: await device.subscribe(wanted), replaced: sub?.endpoint ?? null };
}

export type PushSyncResult =
  /** Niente da fare: chiave mancante, permesso non concesso o nessuna iscrizione su questo dispositivo. */
  | 'off'
  /** L'iscrizione l'ha fatta un altro account su questo dispositivo: non la si prende senza un tocco. */
  | 'other-user'
  /** Salvata di nuovo sul server, così com'era. */
  | 'saved'
  /** Rifatta con la chiave VAPID attuale e salvata; la vecchia tolta dal server. */
  | 'renewed';

/**
 * Riallinea l'iscrizione del dispositivo con il server: se il browser ne ha una e il permesso è concesso, la salva
 * di nuovo (save_push_subscription è idempotente: il server può averla persa, per esempio come scaduta); se è
 * stata fatta con un'altra chiave la rifà con quella attuale. owner è l'account che ha attivato le notifiche su
 * questo dispositivo (memoria del browser): se è un altro, non si fa nulla.
 */
export async function syncSubscription(
  device: PushDevice,
  key: string,
  server: PushServer,
  userId: string,
  owner: string | null,
): Promise<PushSyncResult> {
  if (!key || device.permission !== 'granted') return 'off';
  if (!(await device.getSubscription())) return 'off';
  if (owner && owner !== userId) return 'other-user';
  const { sub, replaced } = await subscriptionWithKey(device, key);
  await server.save(sub);
  if (replaced && replaced !== sub.endpoint) await server.remove(replaced).catch(() => undefined);
  return replaced ? 'renewed' : 'saved';
}

const OWNER_KEY = 'nbbgm:notifiche-utente';

function readOwner(): string | null {
  try {
    return localStorage.getItem(OWNER_KEY);
  } catch {
    return null;
  }
}

function writeOwner(userId: string | null): void {
  try {
    if (userId) localStorage.setItem(OWNER_KEY, userId);
    else localStorage.removeItem(OWNER_KEY);
  } catch {
    // Senza memoria del browser si riallinea comunque
  }
}

const supabaseServer: PushServer = {
  async save(sub) {
    const json = sub.toJSON();
    const { error } = await supabase.rpc('save_push_subscription', {
      p_endpoint: sub.endpoint,
      p_p256dh: json.keys?.p256dh ?? '',
      p_auth: json.keys?.auth ?? '',
      p_user_agent: navigator.userAgent,
    });
    if (error) throw error;
  },
  async remove(endpoint) {
    const { error } = await supabase.rpc('delete_push_subscription', { p_endpoint: endpoint });
    if (error) throw error;
  },
};

function deviceOf(reg: ServiceWorkerRegistration): PushDevice {
  return {
    permission: typeof Notification === 'undefined' ? null : Notification.permission,
    getSubscription: () => reg.pushManager.getSubscription(),
    subscribe: (key) => reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }),
  };
}

/**
 * Riallinea l'iscrizione di questo dispositivo per l'account collegato (all'avvio, all'apertura del profilo e
 * quando il service worker avvisa che il browser l'ha cambiata). Non chiede mai il permesso.
 */
export async function syncPush(userId: string): Promise<PushSyncResult> {
  if (pushAvailability(currentPushEnvironment()) !== 'ok') return 'off';
  const reg = await registration();
  if (!reg) return 'off';
  const result = await syncSubscription(deviceOf(reg), VAPID_PUBLIC_KEY, supabaseServer, userId, readOwner());
  if (result === 'saved' || result === 'renewed') writeOwner(userId);
  return result;
}

/** Chiede il permesso (va chiamata da un tocco), iscrive il dispositivo e salva l'iscrizione sul server. */
export async function enablePush(userId: string): Promise<void> {
  const reg = await registration();
  if (!reg) throw new Error('Le notifiche funzionano con l’app pubblicata, non in questa versione di prova.');
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('Permesso per le notifiche non concesso.');
  // Un'iscrizione fatta con un'altra chiave (chiavi cambiate) non vale più: se ne fa una nuova
  const { sub, replaced } = await subscriptionWithKey(deviceOf(reg), VAPID_PUBLIC_KEY);
  await supabaseServer.save(sub);
  if (replaced && replaced !== sub.endpoint) await supabaseServer.remove(replaced).catch(() => undefined);
  writeOwner(userId);
}

function sameKey(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

/** Toglie l'iscrizione di questo dispositivo, dal server e dal browser (notifiche spente o uscita). */
export async function disablePush(): Promise<void> {
  const sub = await currentSubscription();
  writeOwner(null);
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
