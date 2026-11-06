import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  isAppShellResponse,
  looksLikeAppShell,
  notificationFromPush,
  notificationTarget,
  serviceWorkerSource,
  type ResponseInfo,
} from './serviceWorker.ts';

const SCOPE = 'https://albisiot.github.io/NBBGM/';
const INDEX = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const PRIVACY = readFileSync(new URL('../../public/privacy.html', import.meta.url), 'utf8');
const PORTAL = '<!doctype html><html><head><title>Wi-Fi</title></head><body>Accedi alla rete</body></html>';

const info = (over: Partial<ResponseInfo> = {}): ResponseInfo => ({
  ok: true,
  status: 200,
  redirected: false,
  type: 'basic',
  url: SCOPE,
  headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }),
  ...over,
});

describe('pagina dell’app', () => {
  it('è la radice del sito o index.html, con risposta 200 HTML non deviata', () => {
    expect(isAppShellResponse(info(), SCOPE)).toBe(true);
    expect(isAppShellResponse(info({ url: `${SCOPE}index.html` }), SCOPE)).toBe(true);
    expect(isAppShellResponse(info({ url: `${SCOPE}privacy.html` }), SCOPE)).toBe(false);
    expect(isAppShellResponse(info({ ok: false, status: 404 }), SCOPE)).toBe(false);
    expect(isAppShellResponse(info({ redirected: true }), SCOPE)).toBe(false);
    expect(isAppShellResponse(info({ type: 'opaqueredirect', status: 0, ok: false }), SCOPE)).toBe(false);
    expect(
      isAppShellResponse(info({ headers: new Headers({ 'content-type': 'application/json' }) }), SCOPE),
    ).toBe(false);
  });

  it('si riconosce dal contenuto: index.html sì, privacy.html e un portale Wi-Fi no', () => {
    expect(looksLikeAppShell(INDEX)).toBe(true);
    expect(looksLikeAppShell(PRIVACY)).toBe(false);
    expect(looksLikeAppShell(PORTAL)).toBe(false);
  });
});

/** Il sw.js generato, eseguito con finti self, caches e fetch: si provano le navigazioni come nel browser. */
function worker(network: (url: string, init: RequestInit) => Promise<Response>) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const store = new Map<string, Response>();
  const key = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, SCOPE).href;
  const installed: { url: string; init: RequestInit }[] = [];
  const cache = {
    put: async (r: string, res: Response) => void store.set(key(r), res),
    addAll: async (requests: { url: string; init: RequestInit }[]) => void installed.push(...requests),
  };
  const calls: RequestInit[] = [];
  class FakeRequest {
    constructor(
      readonly url: string,
      readonly init: RequestInit,
    ) {}
  }
  runInNewContext(serviceWorkerSource('prova', ['./']), {
    self: {
      addEventListener: (type: string, h: (event: unknown) => void) => (handlers[type] = h),
      location: new URL(SCOPE),
      registration: { scope: SCOPE },
      skipWaiting: async () => undefined,
    },
    caches: {
      open: async () => cache,
      match: async (r: string | { url: string }) => store.get(key(r))?.clone(),
    },
    fetch: (r: FakeRequest) => {
      calls.push(r.init);
      return network(r.url, r.init);
    },
    Request: FakeRequest,
    Response,
    URL,
  });
  async function navigate(url: string): Promise<Response | undefined> {
    let answer: Promise<Response | undefined> = Promise.resolve(undefined);
    const waits: Promise<unknown>[] = [];
    handlers.fetch!({
      request: { method: 'GET', mode: 'navigate', url },
      respondWith: (p: Promise<Response | undefined>) => (answer = p),
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    const res = await answer;
    await Promise.all(waits);
    return res;
  }
  async function install(): Promise<void> {
    const waits: Promise<unknown>[] = [];
    handlers.install!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return { navigate, install, installed, store, calls };
}

/** Risposta di rete con l'indirizzo finale (in Node una Response costruita a mano non ce l'ha). */
function page(url: string, html: string, status = 200): Response {
  const res = new Response(html, { status, headers: { 'content-type': 'text/html; charset=utf-8' } });
  Object.defineProperty(res, 'url', { value: url });
  return res;
}

describe('service worker', () => {
  it('all’installazione scarica i file senza la cache HTTP', async () => {
    const w = worker(async (url) => page(url, INDEX));
    await w.install();
    expect(w.installed.map((r) => [r.url, r.init.cache])).toEqual([['./', 'reload']]);
  });

  it('chiede la pagina senza la cache HTTP e salva solo la pagina dell’app', async () => {
    const w = worker(async (url) => page(url, url.endsWith('privacy.html') ? PRIVACY : INDEX));
    expect((await w.navigate(SCOPE))?.status).toBe(200);
    expect(w.calls[0]).toMatchObject({ cache: 'no-cache', redirect: 'manual' });
    expect(w.store.has(SCOPE)).toBe(true);
    // privacy.html passa, ma non prende il posto della pagina dell'app
    w.store.clear();
    expect(await (await w.navigate(`${SCOPE}privacy.html`))!.text()).toBe(PRIVACY);
    expect(w.store.size).toBe(0);
  });

  it('non salva la pagina di un portale Wi-Fi né una risposta di errore', async () => {
    const portal = worker(async (url) => page(url, PORTAL));
    await portal.navigate(SCOPE);
    expect(portal.store.size).toBe(0);
    const missing = worker(async (url) => page(url, 'Non trovato', 404));
    await missing.navigate(SCOPE);
    expect(missing.store.size).toBe(0);
  });

  it('senza rete apre la pagina salvata', async () => {
    let online = true;
    const w = worker(async (url) => {
      if (!online) throw new TypeError('Failed to fetch');
      return page(url, INDEX);
    });
    await w.navigate(SCOPE);
    online = false;
    expect(await (await w.navigate(SCOPE))!.text()).toBe(INDEX);
    // Una pagina che non è in cache: si apre l'app
    expect(await (await w.navigate(`${SCOPE}altro.html`))!.text()).toBe(INDEX);
  });
});

describe('notifiche push nel service worker', () => {
  it('testo, pagina e numero dal messaggio, con valori di riserva', () => {
    const n = notificationFromPush(
      { title: 'Amici', body: 'Turno nuovo', url: './#/lega/L', tag: 'nbbgm-L', badge: 2, renotify: false },
      SCOPE,
    );
    expect(n).toEqual({
      title: 'Amici',
      options: {
        body: 'Turno nuovo',
        tag: 'nbbgm-L',
        renotify: false,
        icon: `${SCOPE}icons/icon-192.png`,
        badge: `${SCOPE}icons/icon-192.png`,
        data: { url: `${SCOPE}#/lega/L` },
      },
      badge: 2,
    });
    const empty = notificationFromPush(null, SCOPE);
    expect(empty).toMatchObject({
      title: 'NBBGM',
      options: { tag: 'nbbgm', data: { url: SCOPE } },
      badge: null,
    });
  });

  it('toccando si apre solo una pagina dell’app', () => {
    expect(notificationTarget('./#/lega/L/mercato?tab=scambi', SCOPE)).toBe(
      `${SCOPE}#/lega/L/mercato?tab=scambi`,
    );
    expect(notificationTarget('https://altro.example/truffa', SCOPE)).toBe(SCOPE);
    expect(notificationTarget('https://albisiot.github.io/altro/', SCOPE)).toBe(SCOPE);
    expect(notificationTarget(42, SCOPE)).toBe(SCOPE);
  });

  /** sw.js con finti self e clients: si mandano gli eventi push e notificationclick. */
  function pushWorker(open: { url: string }[]) {
    const handlers: Record<string, (event: unknown) => void> = {};
    const shown: { title: string; options: Record<string, unknown> }[] = [];
    const badges: (number | 'clear')[] = [];
    const navigated: string[] = [];
    const opened: string[] = [];
    const clients = open.map((c) => ({
      url: c.url,
      focus: async function () {
        return this;
      },
      navigate: async (url: string) => void navigated.push(url),
    }));
    runInNewContext(serviceWorkerSource('prova', ['./']), {
      self: {
        addEventListener: (type: string, h: (event: unknown) => void) => (handlers[type] = h),
        location: new URL(SCOPE),
        registration: {
          scope: SCOPE,
          showNotification: async (title: string, options: Record<string, unknown>) =>
            void shown.push({ title, options }),
        },
        navigator: {
          setAppBadge: async (n: number) => void badges.push(n),
          clearAppBadge: async () => void badges.push('clear'),
        },
        clients: {
          matchAll: async () => clients,
          openWindow: async (url: string) => void opened.push(url),
        },
      },
      URL,
    });
    const fire = async (type: string, event: Record<string, unknown>) => {
      const waits: Promise<unknown>[] = [];
      handlers[type]!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    };
    return { fire, shown, badges, navigated, opened };
  }

  it('mostra la notifica e aggiorna il numero sull’icona', async () => {
    const w = pushWorker([]);
    await w.fire('push', {
      data: { json: () => ({ title: 'Amici', body: 'Decidi', badge: 3, url: './#/lega/L' }) },
    });
    expect(w.shown).toHaveLength(1);
    expect(w.shown[0]).toMatchObject({
      title: 'Amici',
      options: { body: 'Decidi', data: { url: `${SCOPE}#/lega/L` } },
    });
    expect(w.badges).toEqual([3]);
    // Un messaggio illeggibile mostra comunque una notifica
    await w.fire('push', { data: { json: () => JSON.parse('{') } });
    expect(w.shown[1]?.title).toBe('NBBGM');
  });

  it('toccandola porta l’app aperta alla pagina giusta, o la apre', async () => {
    const close = () => undefined;
    const withApp = pushWorker([{ url: `${SCOPE}#/` }]);
    await withApp.fire('notificationclick', { notification: { close, data: { url: `${SCOPE}#/lega/L` } } });
    expect(withApp.navigated).toEqual([`${SCOPE}#/lega/L`]);
    const closed = pushWorker([]);
    await closed.fire('notificationclick', { notification: { close, data: { url: `${SCOPE}#/lega/L` } } });
    expect(closed.opened).toEqual([`${SCOPE}#/lega/L`]);
  });
});
