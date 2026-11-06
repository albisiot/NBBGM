import { describe, expect, it } from 'vitest';
import { keyBytes, pushAvailability, type PushEnvironment } from './push.ts';

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
