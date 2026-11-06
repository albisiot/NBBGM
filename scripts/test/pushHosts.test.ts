// Seconda analisi dopo la Fase 13: le notifiche partono solo verso i servizi push dei browser. L'indirizzo di
// un'iscrizione lo manda l'app: prima se ne poteva salvare uno qualsiasi e far chiamare al server un indirizzo a
// scelta. Database (private.push_endpoint_ok e il vincolo su push_subscriptions) ed Edge Function
// (pushEndpointAllowed) ammettono gli stessi indirizzi; la migrazione cancella le iscrizioni già salvate verso
// altri; l'invio non segue i reindirizzamenti e ha un tempo massimo.
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  deliverPush,
  fetchSend,
  PUSH_TIMEOUT_MS,
  pushEndpointAllowed,
  type PushDb,
} from '../../supabase/functions/_shared/push.ts';
import { b64url, generateVapidKeys } from '../../supabase/functions/_shared/webpush.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asService, asUser, createTestDb, migrationFiles } from '../src/db/testdb.ts';
import { ROOT } from '../src/paths.ts';

const ids = seedIds();
const ANNA = ids.user('anna');

/** Chiavi di un'iscrizione vera (P-256 e auth), come le dà il browser. */
async function keys(): Promise<{ p256dh: string; auth: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  return { p256dh: b64url(raw), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) };
}

const ALLOWED = [
  'https://fcm.googleapis.com/fcm/send/abc:def',
  'https://android.googleapis.com/gcm/send/abc',
  'https://jmt17.google.com/fcm/send/abc',
  'https://updates.push.services.mozilla.com/wpush/v2/abc',
  'https://wns2-par02p.notify.windows.com/w/?token=abc',
  'https://web.push.apple.com/QGqH-abc',
  'https://FCM.googleapis.com/fcm/send/maiuscole',
];
const REFUSED = [
  'http://fcm.googleapis.com/fcm/send/abc',
  'https://push.example.test/abc',
  'https://fcm.googleapis.com.example.test/abc',
  'https://fcm.googleapis.com:8443/fcm/send/abc',
  'https://utente@fcm.googleapis.com/fcm/send/abc',
  'https://example.test/fcm.googleapis.com/',
  'https://push.apple.com/abc',
  'https://web.push.apple.com.example.test/abc',
  'https://notify.windows.com/w/abc',
  'https://127.0.0.1/abc',
  'https://localhost/abc',
  'https://updates-autopush.stage.mozaws.net/wpush/v2/abc',
  `https://fcm.googleapis.com/${'a'.repeat(1000)}`,
];

let db: PGlite;

describe('notifiche solo verso i servizi push', () => {
  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(buildSeedSql());
  }, 120_000);

  it('database ed Edge Function ammettono gli stessi indirizzi', async () => {
    for (const endpoint of [...ALLOWED, ...REFUSED]) {
      const sql = (await db.query<{ ok: boolean }>('select private.push_endpoint_ok($1) as ok', [endpoint]))
        .rows[0]!.ok;
      expect(sql, endpoint).toBe(ALLOWED.includes(endpoint));
      expect(pushEndpointAllowed(endpoint), endpoint).toBe(ALLOWED.includes(endpoint));
    }
  });

  it('un’iscrizione verso un altro indirizzo non si salva, nemmeno dal server', async () => {
    const k = await keys();
    const save = (endpoint: string) =>
      asUser(db, ANNA, (tx) =>
        tx.query('select public.save_push_subscription($1, $2, $3, $4)', [
          endpoint,
          k.p256dh,
          k.auth,
          'prova',
        ]),
      );
    for (const endpoint of REFUSED.filter((e) => e.startsWith('https://') && e.length <= 1000))
      await expect(save(endpoint), endpoint).rejects.toThrow(/servizio push non riconosciuto/);
    await save('https://web.push.apple.com/anna');
    await expect(
      asService(db, (tx) =>
        tx.query(
          'insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)',
          [ANNA, 'https://push.example.test/server', k.p256dh, k.auth],
        ),
      ),
    ).rejects.toThrow(/push_subscriptions_endpoint_host/);
    // La funzione del controllo resta chiusa al client
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query('select private.push_endpoint_ok($1)', ['https://web.push.apple.com/x']),
      ),
    ).rejects.toThrow(/permission denied/);
  });

  it('la migrazione cancella le iscrizioni già salvate verso altri indirizzi', async () => {
    const files = migrationFiles();
    const at = files.findIndex((f) => f.endsWith('20261106150000_push_hosts.sql'));
    expect(at).toBeGreaterThan(0);
    // Il database com'era prima, con un'iscrizione buona e una no
    const old = await PGlite.create();
    await old.exec(readFileSync(join(ROOT, 'scripts', 'src', 'db', 'shim.sql'), 'utf8'));
    for (const f of files.slice(0, at)) await old.exec(readFileSync(f, 'utf8'));
    await old.exec(buildSeedSql());
    const k = await keys();
    for (const endpoint of ['https://web.push.apple.com/buona', 'https://push.example.test/cattiva'])
      await old.query(
        'insert into public.push_subscriptions (user_id, endpoint, p256dh, auth) values ($1, $2, $3, $4)',
        [ANNA, endpoint, k.p256dh, k.auth],
      );
    for (const f of files.slice(at)) await old.exec(readFileSync(f, 'utf8'));
    const left = await old.query<{ endpoint: string }>('select endpoint from public.push_subscriptions');
    expect(left.rows.map((r) => r.endpoint)).toEqual(['https://web.push.apple.com/buona']);
    await old.close();
  }, 120_000);

  it('la Edge Function non manda verso altri indirizzi e li cancella', async () => {
    const k = await keys();
    const sent: string[] = [];
    let gone: string[] = [];
    const fake: PushDb = {
      async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
        if (name === 'push_take')
          return {
            notifications: [
              {
                id: 1,
                user_id: ANNA,
                league_id: ids.league,
                kind: 'turn',
                detail: null,
                pick: null,
                league_name: 'Lega di prova',
                round_kind: 'regular',
                round_number: 3,
                round_stage: null,
              },
            ],
            subscriptions: [
              { user_id: ANNA, endpoint: 'https://web.push.apple.com/buona', ...k },
              { user_id: ANNA, endpoint: 'https://push.example.test/cattiva', ...k },
            ],
            badges: {},
          } as T;
        gone = args.p_endpoints as string[];
        return gone.length as T;
      },
    };
    const vapid = { ...(await generateVapidKeys()), subject: 'mailto:prova@nbbgm.test' };
    const report = await deliverPush(fake, vapid, async (url) => {
      sent.push(url);
      return { status: 201 };
    });
    expect(sent).toEqual(['https://web.push.apple.com/buona']);
    expect(gone).toEqual(['https://push.example.test/cattiva']);
    expect(report).toMatchObject({ sent: 1, gone: 1, failed: 0 });
  });

  it('invio: niente reindirizzamenti e un tempo massimo', async () => {
    let init: RequestInit | undefined;
    const send = fetchSend(async (_url, i) => {
      init = i;
      return new Response(null, { status: 201 });
    });
    const body = new Uint8Array([1, 2, 3]);
    const post = { method: 'POST' as const, headers: { TTL: '60' }, body };
    expect(await send('https://web.push.apple.com/x', post)).toEqual({ status: 201 });
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', headers: { TTL: '60' }, body });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(PUSH_TIMEOUT_MS).toBe(10_000);

    // Con un server vero: il 302 resta un 302 (non si segue) e un server che non risponde scade
    let followed = false;
    const server = createServer((req, res) => {
      if (req.url === '/altrove') {
        followed = true;
        res.end();
      } else if (req.url !== '/lento') res.writeHead(302, { Location: '/altrove' }).end();
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    try {
      const real = fetchSend(fetch, 300);
      expect(await real(`http://127.0.0.1:${port}/push`, post)).toEqual({ status: 302 });
      expect(followed).toBe(false);
      await expect(real(`http://127.0.0.1:${port}/lento`, post)).rejects.toThrow(/timeout|abort/i);
    } finally {
      server.closeAllConnections();
      server.close();
    }
  });
});
