import { describe, expect, it } from 'vitest';
import { PUSH_CHANGED_MESSAGE } from '../pwa/messages.ts';
import {
  keyBytes,
  pushAvailability,
  subscriptionWithKey,
  syncSubscription,
  type PushDevice,
  type PushEnvironment,
  type PushServer,
  type SubscriptionLike,
} from './push.ts';
import { isPushChanged } from './pushWatch.ts';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0';

const env = (over: Partial<PushEnvironment> = {}): PushEnvironment => ({
  key: 'BA2a',
  platform: { userAgent: ANDROID, maxTouchPoints: 5, standalone: false },
  hasServiceWorker: true,
  hasPushManager: true,
  permission: 'default',
  ...over,
});

describe('notifiche sul dispositivo', () => {
  it('senza la chiave pubblica l’app non parla di notifiche', () => {
    expect(pushAvailability(env({ key: '' }))).toBe('off');
  });

  it('su iPhone servono l’app installata e iOS 16.4', () => {
    const iphone = { userAgent: IPHONE, maxTouchPoints: 5 };
    expect(pushAvailability(env({ platform: { ...iphone, standalone: false } }))).toBe('install');
    expect(pushAvailability(env({ platform: { ...iphone, standalone: true } }))).toBe('ok');
    // iOS prima della 16.4: niente PushManager nemmeno nell'app installata
    expect(pushAvailability(env({ platform: { ...iphone, standalone: true }, hasPushManager: false }))).toBe(
      'unsupported',
    );
  });

  it('browser senza notifiche o con il permesso negato', () => {
    expect(pushAvailability(env({ permission: null }))).toBe('unsupported');
    expect(pushAvailability(env({ hasServiceWorker: false }))).toBe('unsupported');
    expect(pushAvailability(env({ permission: 'denied' }))).toBe('denied');
    expect(pushAvailability(env({ permission: 'granted' }))).toBe('ok');
  });

  it('la chiave pubblica in base64url diventa i 65 byte del punto P-256', () => {
    const key = 'BA2a17odZj0g1meTbtftLsThN6pO9gj6i-U5M_ymKKFjjf9BO51FKHKofGKLng8goUEVr2q31hWk0T7CrK8jDgk';
    const bytes = keyBytes(key);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
  });
});

describe('iscrizione riallineata con il server (seconda analisi)', () => {
  const KEY = 'BA2a17odZj0g1meTbtftLsThN6pO9gj6i-U5M_ymKKFjjf9BO51FKHKofGKLng8goUEVr2q31hWk0T7CrK8jDgk';
  const OLD_KEY = 'BOLDb2dkYXRhLWNoaWF2ZS12ZWNjaGlhLWRpLXByb3ZhLXBlci1pLXRlc3QtZGVsbGEtYXBw';

  function fakeDevice(opts: { permission?: NotificationPermission; key?: string | null; none?: boolean }) {
    const log: string[] = [];
    const make = (endpoint: string, key: string | null): SubscriptionLike => ({
      endpoint,
      options: { applicationServerKey: key ? keyBytes(key).buffer : null },
      toJSON: () => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } }),
      unsubscribe: async () => {
        log.push(`via ${endpoint}`);
        current = null;
        return true;
      },
    });
    let current: SubscriptionLike | null = opts.none
      ? null
      : make('https://web.push.apple.com/vecchia', opts.key ?? KEY);
    const device: PushDevice = {
      permission: opts.permission ?? 'granted',
      getSubscription: async () => current,
      subscribe: async (key) => {
        log.push(`nuova ${key.length}`);
        current = make('https://web.push.apple.com/nuova', KEY);
        return current;
      },
    };
    const server: PushServer = {
      save: async (sub) => void log.push(`salva ${sub.endpoint}`),
      remove: async (endpoint) => void log.push(`togli ${endpoint}`),
    };
    return { device, server, log };
  }

  it('con il permesso e un’iscrizione la salva di nuovo, così com’è', async () => {
    const f = fakeDevice({});
    expect(await syncSubscription(f.device, KEY, f.server, 'anna', null)).toBe('saved');
    expect(f.log).toEqual(['salva https://web.push.apple.com/vecchia']);
    // Anche un browser che non dice la chiave dell'iscrizione
    const unknown = fakeDevice({ key: null });
    expect(await syncSubscription(unknown.device, KEY, unknown.server, 'anna', 'anna')).toBe('saved');
  });

  it('con la chiave VAPID cambiata rifà l’iscrizione e toglie la vecchia dal server', async () => {
    const f = fakeDevice({ key: OLD_KEY });
    expect(await syncSubscription(f.device, KEY, f.server, 'anna', 'anna')).toBe('renewed');
    expect(f.log).toEqual([
      'via https://web.push.apple.com/vecchia',
      'nuova 65',
      'salva https://web.push.apple.com/nuova',
      'togli https://web.push.apple.com/vecchia',
    ]);
  });

  it('senza permesso, senza iscrizione o senza chiave non fa nulla; non prende quella di un altro account', async () => {
    for (const f of [fakeDevice({ permission: 'default' }), fakeDevice({ none: true })]) {
      expect(await syncSubscription(f.device, KEY, f.server, 'anna', null)).toBe('off');
      expect(f.log).toEqual([]);
    }
    const nokey = fakeDevice({});
    expect(await syncSubscription(nokey.device, '', nokey.server, 'anna', null)).toBe('off');
    const other = fakeDevice({});
    expect(await syncSubscription(other.device, KEY, other.server, 'anna', 'bruno')).toBe('other-user');
    expect(other.log).toEqual([]);
  });

  it('il messaggio del service worker si riconosce', () => {
    expect(isPushChanged({ type: PUSH_CHANGED_MESSAGE })).toBe(true);
    expect(isPushChanged({ type: 'altro' })).toBe(false);
    expect(isPushChanged(null)).toBe(false);
    expect(isPushChanged('nbbgm:iscrizione-cambiata')).toBe(false);
  });

  it('subscriptionWithKey: tiene quella buona, sostituisce quella con la chiave vecchia', async () => {
    const good = fakeDevice({});
    expect((await subscriptionWithKey(good.device, KEY)).replaced).toBeNull();
    const old = fakeDevice({ key: OLD_KEY });
    const r = await subscriptionWithKey(old.device, KEY);
    expect(r.replaced).toBe('https://web.push.apple.com/vecchia');
    expect(r.sub.endpoint).toBe('https://web.push.apple.com/nuova');
  });
});
