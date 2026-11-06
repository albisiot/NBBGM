import { describe, expect, it } from 'vitest';
import { installAdvice, isIos, preferEmailCode } from './install.ts';

const IPHONE_SAFARI =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const IPAD_AS_MAC =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 15; Pixel 9) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

const p = (userAgent: string, standalone = false, maxTouchPoints = 5) => ({
  userAgent,
  standalone,
  maxTouchPoints,
});

describe('installazione dell’app', () => {
  it('riconosce iPhone e iPad, anche quando l’iPad si presenta come Mac', () => {
    expect(isIos(p(IPHONE_SAFARI))).toBe(true);
    expect(isIos(p(IPAD_AS_MAC))).toBe(true);
    expect(isIos(p(IPAD_AS_MAC, false, 0))).toBe(false);
    expect(isIos(p(ANDROID))).toBe(false);
  });

  it('suggerimento giusto per ogni caso, niente se è già installata', () => {
    expect(installAdvice(p(IPHONE_SAFARI), false)).toBe('ios');
    expect(installAdvice(p(IPHONE_CHROME), false)).toBe('ios-other-browser');
    expect(installAdvice(p(ANDROID), true)).toBe('prompt');
    expect(installAdvice(p(ANDROID), false)).toBeNull();
    expect(installAdvice(p(IPHONE_SAFARI, true), false)).toBeNull();
    expect(installAdvice(p(ANDROID, true), true)).toBeNull();
  });

  it('il codice via email si consiglia solo nell’app installata su iPhone', () => {
    expect(preferEmailCode(p(IPHONE_SAFARI, true))).toBe(true);
    expect(preferEmailCode(p(IPHONE_SAFARI, false))).toBe(false);
    expect(preferEmailCode(p(ANDROID, true))).toBe(false);
  });
});
