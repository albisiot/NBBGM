import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  isAppShellResponse,
  looksLikeAppShell,
  notificationFromPush,
  notificationTarget,
  serviceWorkerSource,
  vapidKeyBytes,
  type ResponseInfo,
} from './serviceWorker.ts';
import { PUSH_CHANGED_MESSAGE } from './messages.ts';

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
        badge: `${SCOPE}icons/badge-96.png`,
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

describe('iscrizione cambiata dal browser (seconda analisi)', () => {
  const KEY = 'BA2a17odZj0g1meTbtftLsThN6pO9gj6i-U5M_ymKKFjjf9BO51FKHKofGKLng8goUEVr2q31hWk0T7CrK8jDgk';

  /** sw.js con un pushManager finto e finestre aperte che ricevono messaggi. */
  function changeWorker(vapidKey: string) {
    const handlers: Record<string, (event: unknown) => void> = {};
    const subscribed: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }[] = [];
    const messages: unknown[] = [];
    runInNewContext(serviceWorkerSource('prova', ['./'], vapidKey), {
      self: {
        addEventListener: (type: string, h: (event: unknown) => void) => (handlers[type] = h),
        location: new URL(SCOPE),
        registration: {
          scope: SCOPE,
          pushManager: {
            subscribe: async (o: { userVisibleOnly: boolean; applicationServerKey: Uint8Array }) => {
              subscribed.push(o);
              return { endpoint: 'https://web.push.apple.com/nuova' };
            },
          },
        },
        clients: { matchAll: async () => [{ postMessage: (m: unknown) => void messages.push(m) }] },
      },
      URL,
      Uint8Array,
    });
    const fire = async (event: Record<string, unknown>) => {
      const waits: Promise<unknown>[] = [];
      handlers.pushsubscriptionchange!({ ...event, waitUntil: (p: Promise<unknown>) => waits.push(p) });
      await Promise.all(waits);
    };
    return { fire, subscribed, messages };
  }

  it('la chiave VAPID della build entra in sw.js', () => {
    const bytes = vapidKeyBytes(KEY);
    expect(bytes).toHaveLength(65);
    expect(bytes[0]).toBe(4);
    expect(vapidKeyBytes('')).toEqual([]);
    expect(serviceWorkerSource('v', [], KEY)).toContain(JSON.stringify(bytes));
  });

  it('rifà l’iscrizione con la chiave dell’app e avvisa le finestre aperte', async () => {
    const w = changeWorker(KEY);
    await w.fire({ oldSubscription: { options: { applicationServerKey: new Uint8Array([9]).buffer } } });
    expect(w.subscribed).toHaveLength(1);
    expect(w.subscribed[0]!.userVisibleOnly).toBe(true);
    expect([...w.subscribed[0]!.applicationServerKey]).toEqual(vapidKeyBytes(KEY));
    expect(w.messages).toEqual([{ type: PUSH_CHANGED_MESSAGE }]);
  });

  it('se il browser ha già l’iscrizione nuova non ne fa un’altra; senza chiave usa quella vecchia', async () => {
    const given = changeWorker(KEY);
    await given.fire({ newSubscription: { endpoint: 'https://web.push.apple.com/data' } });
    expect(given.subscribed).toEqual([]);
    expect(given.messages).toHaveLength(1);
    const old = new Uint8Array([4, 1, 2]);
    const keyless = changeWorker('');
    await keyless.fire({ oldSubscription: { options: { applicationServerKey: old } } });
    expect(keyless.subscribed[0]!.applicationServerKey).toBe(old);
  });
});

describe('icona delle notifiche nella barra di stato (seconda analisi)', () => {
  it('è monocromatica e trasparente: Android ne usa solo la trasparenza', async () => {
    const { inflateSync } = await import('node:zlib');
    const png = readFileSync(new URL('../../public/icons/badge-96.png', import.meta.url));
    // IHDR: 96x96, 8 bit, tipo 6 (RGBA)
    expect(png.readUInt32BE(16)).toBe(96);
    expect(png.readUInt32BE(20)).toBe(96);
    expect(png[24]).toBe(8);
    expect(png[25]).toBe(6);
    let idat = Buffer.alloc(0);
    for (let i = 8; i < png.length;) {
      const n = png.readUInt32BE(i);
      if (png.toString('ascii', i + 4, i + 8) === 'IDAT')
        idat = Buffer.concat([idat, png.subarray(i + 8, i + 8 + n)]);
      i += 12 + n;
    }
    const raw = inflateSync(idat);
    const row = 96 * 4 + 1;
    const alpha = (x: number, y: number) => raw[y * row + 1 + x * 4 + 3];
    // Angoli trasparenti (fuori dalla palla), la palla piena, la cucitura centrale vuota
    expect(alpha(0, 0)).toBe(0);
    expect(alpha(95, 95)).toBe(0);
    expect(alpha(38, 34)).toBe(255);
    expect(alpha(48, 20)).toBe(0);
    // Tutto bianco: il colore lo decide Android
    for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) expect(raw[y * row + 1 + x * 4]).toBe(255);
  });
});
