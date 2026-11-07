import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import {
  isAppShellResponse,
  isHashedAsset,
  looksLikeAppShell,
  notificationFromPush,
  notificationTarget,
  precachePlan,
  serviceWorkerSource,
  vapidKeyBytes,
  type ResponseInfo,
  type ShellEntry,
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

/** Cache finta: risposte per indirizzo assoluto. */
class FakeCache {
  readonly store = new Map<string, Response>();
  async match(r: string | { url: string }) {
    return this.store.get(key(r))?.clone();
  }
  async put(r: string | { url: string }, res: Response) {
    this.store.set(key(r), res);
  }
  async keys() {
    return [...this.store.keys()].map((url) => ({ url }));
  }
}

const key = (r: string | { url: string }) => new URL(typeof r === 'string' ? r : r.url, SCOPE).href;

/** CacheStorage finta, con più cache per nome come nel browser. */
class FakeCaches {
  readonly all = new Map<string, FakeCache>();
  async open(name: string) {
    let c = this.all.get(name);
    if (!c) this.all.set(name, (c = new FakeCache()));
    return c;
  }
  async keys() {
    return [...this.all.keys()];
  }
  async delete(name: string) {
    return this.all.delete(name);
  }
  async match(r: string | { url: string }) {
    for (const c of this.all.values()) {
      const hit = await c.match(r);
      if (hit) return hit;
    }
    return undefined;
  }
}

/**
 * Il sw.js generato, eseguito con finti self, caches e fetch: si provano installazione, attivazione e navigazioni
 * come nel browser. Più versioni possono condividere la stessa CacheStorage (un aggiornamento).
 */
function worker(
  network: (url: string, init: RequestInit) => Promise<Response>,
  opts: { version?: string; shell?: readonly (ShellEntry | string)[]; caches?: FakeCaches } = {},
) {
  const handlers: Record<string, (event: unknown) => void> = {};
  const caches = opts.caches ?? new FakeCaches();
  const version = opts.version ?? 'prova';
  const installed: { url: string; init: RequestInit }[] = [];
  const calls: RequestInit[] = [];
  class FakeRequest {
    constructor(
      readonly url: string,
      readonly init: RequestInit,
    ) {}
  }
  runInNewContext(serviceWorkerSource(version, opts.shell ?? ['./']), {
    self: {
      addEventListener: (type: string, h: (event: unknown) => void) => (handlers[type] = h),
      location: new URL(SCOPE),
      registration: { scope: SCOPE },
      skipWaiting: async () => undefined,
      clients: { claim: async () => undefined },
    },
    caches,
    fetch: (r: FakeRequest) => {
      calls.push(r.init);
      if (r.init?.cache === 'reload') installed.push({ url: r.url, init: r.init });
      return network(r.url, r.init);
    },
    Request: FakeRequest,
    Response,
    URL,
  });
  // La cache di questa versione (la pagina dell'app la salva qui)
  const own = new FakeCache();
  caches.all.set(`nbbgm-${version}`, own);
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
  async function lifecycle(type: 'install' | 'activate'): Promise<void> {
    const waits: Promise<unknown>[] = [];
    handlers[type]!({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  }
  return {
    handlers,
    navigate,
    install: () => lifecycle('install'),
    activate: () => lifecycle('activate'),
    installed,
    calls,
    caches,
    /** File nella cache di questa versione (dopo l'installazione è un'altra cache: si rilegge per nome). */
    get store() {
      return caches.all.get(`nbbgm-${version}`)?.store ?? new Map<string, Response>();
    },
  };
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

describe('aggiornamento: si scaricano solo i file cambiati (seconda analisi, prestazioni)', () => {
  it('riconosce i file con l’hash nel nome', () => {
    expect(isHashedAsset('assets/index-D1KxZ1nT.js')).toBe(true);
    expect(isHashedAsset('assets/useRoundChange-_cjnx4nM.js')).toBe(true);
    expect(isHashedAsset('assets/unsaved-vpaY_wZ-.js')).toBe(true);
    expect(isHashedAsset('assets/index-DXiK80W7.css')).toBe(true);
    expect(isHashedAsset('index.html')).toBe(false);
    expect(isHashedAsset('icons/icon-192.png')).toBe(false);
    expect(isHashedAsset('manifest.webmanifest')).toBe(false);
    expect(isHashedAsset('assets/senza.js')).toBe(false);
  });

  it('piano: con l’hash nel nome basta lo stesso nome, gli altri vogliono la stessa impronta', () => {
    const shell: ShellEntry[] = [
      { url: './', rev: 'v2' },
      { url: './assets/a-AAAAAAAA.js', rev: null },
      { url: './assets/b-BBBBBBBB.js', rev: null },
      { url: './icons/icon-192.png', rev: 'i1' },
      { url: './privacy.html', rev: 'p2' },
    ];
    const plan = precachePlan(
      shell,
      [
        {
          name: 'nbbgm-v1',
          urls: [SCOPE, `${SCOPE}assets/a-AAAAAAAA.js`, `${SCOPE}icons/icon-192.png`, `${SCOPE}privacy.html`],
          revisions: { './': 'v1', './icons/icon-192.png': 'i1', './privacy.html': 'p1' },
        },
      ],
      SCOPE,
    );
    expect(plan).toEqual([
      { url: './', from: null },
      { url: './assets/a-AAAAAAAA.js', from: 'nbbgm-v1' },
      { url: './assets/b-BBBBBBBB.js', from: null },
      { url: './icons/icon-192.png', from: 'nbbgm-v1' },
      { url: './privacy.html', from: null },
    ]);
    // Una cache senza impronte (scritta dal service worker di prima): solo i file con l'hash nel nome
    const old = precachePlan(
      shell,
      [{ name: 'nbbgm-x', urls: shell.map((e) => key(e.url)), revisions: {} }],
      SCOPE,
    );
    expect(old.filter((p) => p.from).map((p) => p.url)).toEqual([
      './assets/a-AAAAAAAA.js',
      './assets/b-BBBBBBBB.js',
    ]);
  });

  /** Un sito con i suoi file: la rete risponde con il contenuto della versione pubblicata. */
  function site() {
    const files = new Map<string, string>();
    const served: string[] = [];
    const state = { online: true, broken: null as string | null };
    const network = async (url: string) => {
      const href = key(url);
      if (!state.online) throw new TypeError('Failed to fetch');
      served.push(href.slice(SCOPE.length) || './');
      const body = files.get(href);
      if (body === undefined || href === state.broken) return page(href, 'Non trovato', 404);
      const type = href.endsWith('/') || href.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain';
      const res = new Response(body, { status: 200, headers: { 'content-type': type } });
      Object.defineProperty(res, 'url', { value: href });
      return res;
    };
    return {
      network,
      served,
      state,
      publish(content: Record<string, string>) {
        files.clear();
        for (const [u, b] of Object.entries(content)) files.set(key(u), b);
        served.length = 0;
      },
    };
  }

  const V1: Record<string, string> = {
    './': INDEX.replace('</head>', '<!-- v1 --></head>'),
    './assets/index-AAAAAAAA.js': 'console.log("index v1")',
    './assets/pagina-PPPPPPPP.js': 'console.log("pagina")',
    './icons/icon-192.png': 'icona',
    './privacy.html': PRIVACY,
  };
  const SHELL1: ShellEntry[] = [
    { url: './', rev: 'v1' },
    { url: './assets/index-AAAAAAAA.js', rev: null },
    { url: './assets/pagina-PPPPPPPP.js', rev: null },
    { url: './icons/icon-192.png', rev: 'i1' },
    { url: './privacy.html', rev: 'p1' },
  ];
  const V2: Record<string, string> = {
    './': INDEX.replace('</head>', '<!-- v2 --></head>'),
    './assets/index-BBBBBBBB.js': 'console.log("index v2")',
    './assets/pagina-PPPPPPPP.js': 'console.log("pagina")',
    './icons/icon-192.png': 'icona',
    './privacy.html': PRIVACY.replace('</body>', '<!-- v2 --></body>'),
  };
  const SHELL2: ShellEntry[] = [
    { url: './', rev: 'v2' },
    { url: './assets/index-BBBBBBBB.js', rev: null },
    { url: './assets/pagina-PPPPPPPP.js', rev: null },
    { url: './icons/icon-192.png', rev: 'i1' },
    { url: './privacy.html', rev: 'p2' },
  ];

  /** Un file chiesto dalla pagina (non una navigazione), come lo serve il service worker. */
  async function asset(w: ReturnType<typeof worker>, url: string): Promise<string | null> {
    let answer: Promise<Response | undefined> = Promise.resolve(undefined);
    w.handlers.fetch!({
      request: { method: 'GET', mode: 'no-cors', url: key(url) },
      respondWith: (p: Promise<Response | undefined>) => (answer = p),
      waitUntil: () => undefined,
    });
    const res = await answer.catch(() => undefined);
    return res && res.ok ? res.text() : null;
  }

  const files = (w: ReturnType<typeof worker>) =>
    [...w.store.keys()].filter((u) => !u.endsWith('nbbgm-impronte.json')).sort();

  it('alla versione nuova riusa i file uguali, cancella la cache vecchia e si apre senza rete', async () => {
    const net = site();
    const caches = new FakeCaches();
    net.publish(V1);
    const v1 = worker(net.network, { version: 'v1', shell: SHELL1, caches });
    await v1.install();
    await v1.activate();
    expect(net.served.sort()).toEqual(
      Object.keys(V1)
        .map((u) => u.slice(2) || './')
        .sort(),
    );

    // Pubblicazione: cambiano la pagina, il pezzo principale (nome nuovo) e privacy.html
    net.publish(V2);
    const v2 = worker(net.network, { version: 'v2', shell: SHELL2, caches });
    await v2.install();
    expect(net.served.sort()).toEqual(['./', 'assets/index-BBBBBBBB.js', 'privacy.html']);
    // Le copie riusate sono quelle di prima, e la cache nuova è completa
    const reused = await caches.all.get('nbbgm-v2')!.match('./assets/pagina-PPPPPPPP.js');
    expect(await reused!.text()).toBe('console.log("pagina")');
    expect(files(v2)).toEqual(SHELL2.map((e) => key(e.url)).sort());
    await v2.activate();
    expect(await caches.keys()).toEqual(['nbbgm-v2']);

    // Senza rete: la pagina dell'app nuova e i suoi file
    net.state.online = false;
    expect(await (await v2.navigate(SCOPE))!.text()).toContain('<!-- v2 -->');
    expect(await asset(v2, './assets/index-BBBBBBBB.js')).toBe('console.log("index v2")');
    expect(await asset(v2, './assets/pagina-PPPPPPPP.js')).toBe('console.log("pagina")');
    expect(await asset(v2, './icons/icon-192.png')).toBe('icona');
  });

  it('dalla cache del service worker di prima (senza impronte) riusa i file con l’hash nel nome', async () => {
    const net = site();
    const caches = new FakeCaches();
    const old = await caches.open('nbbgm-0123456789ab');
    for (const [u, b] of Object.entries(V1)) await old.put(u, new Response(b));
    net.publish(V2);
    const v2 = worker(net.network, { version: 'v2', shell: SHELL2, caches });
    await v2.install();
    expect(net.served.sort()).toEqual([
      './',
      'assets/index-BBBBBBBB.js',
      'icons/icon-192.png',
      'privacy.html',
    ]);
    await v2.activate();
    expect(await caches.keys()).toEqual(['nbbgm-v2']);
  });

  it('se un file non arriva l’installazione fallisce e resta la versione di prima; poi riprova', async () => {
    const net = site();
    const caches = new FakeCaches();
    net.publish(V1);
    const v1 = worker(net.network, { version: 'v1', shell: SHELL1, caches });
    await v1.install();
    await v1.activate();
    net.publish(V2);
    net.state.broken = key('./assets/index-BBBBBBBB.js');
    const v2 = worker(net.network, { version: 'v2', shell: SHELL2, caches });
    await expect(v2.install()).rejects.toThrow(/non scaricato/);
    // La versione di prima è intera (i suoi file più le impronte)
    expect(caches.all.get('nbbgm-v1')!.store.size).toBe(SHELL1.length + 1);
    net.state.broken = null;
    await v2.install();
    await v2.activate();
    expect(await caches.keys()).toEqual(['nbbgm-v2']);
    expect(await asset(v2, './assets/index-BBBBBBBB.js')).toBe('console.log("index v2")');
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
