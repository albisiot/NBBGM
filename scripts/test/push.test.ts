// Dopo la Fase 13: notifiche push. Cifratura Web Push (aes128gcm) e firma VAPID provate decifrando come fa il
// browser; sul database di prova: iscrizioni (ognuno vede le sue), coda per turno nuovo, avvisi bloccanti e draft
// dal vivo, preferenze del profilo, iscrizioni scadute.
import type { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  deliverPush,
  mergeNotifications,
  notificationText,
  vapidFromEnv,
  type OutboxRow,
  type PushBatch,
  type PushPayload,
} from '../../supabase/functions/_shared/push.ts';
import { advanceLeague } from '../../supabase/functions/_shared/turn.ts';
import {
  b64url,
  CEK_INFO,
  concat,
  encryptPayload,
  fromB64url,
  generateVapidKeys,
  hkdf,
  KEY_INFO,
  NONCE_INFO,
  vapidAuthorization,
  type Bytes,
  type KeyPair,
} from '../../supabase/functions/_shared/webpush.ts';
import { buildSeedSql, seedIds } from '../src/db/seed.ts';
import { asAnon, asService, asUser, createTestDb, serviceRpc } from '../src/db/testdb.ts';
import { quickGame } from '../src/quick-game.ts';

const enc = new TextEncoder();

/** Un browser finto: chiavi dell'iscrizione e decifratura come da RFC 8291. */
async function browser() {
  const pair = (await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
    'deriveBits',
  ])) as KeyPair;
  const uaPublic = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return {
    p256dh: b64url(uaPublic),
    auth: b64url(auth),
    async decrypt(body: Uint8Array): Promise<string> {
      const salt = body.slice(0, 16) as Bytes;
      const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
      expect(rs).toBe(4096);
      const idlen = body[20] as number;
      const asPublic = body.slice(21, 21 + idlen) as Bytes;
      const cipher = body.slice(21 + idlen) as Bytes;
      const asKey = await crypto.subtle.importKey(
        'raw',
        asPublic,
        { name: 'ECDH', namedCurve: 'P-256' },
        false,
        [],
      );
      const shared = new Uint8Array(
        await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, pair.privateKey, 256),
      );
      const ikm = await hkdf(auth, shared, concat(enc.encode(KEY_INFO), uaPublic, asPublic), 32);
      const cek = await hkdf(salt, ikm, enc.encode(CEK_INFO), 16);
      const nonce = await hkdf(salt, ikm, enc.encode(NONCE_INFO), 12);
      const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']);
      const plain = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, cipher));
      expect(plain.at(-1)).toBe(2);
      return new TextDecoder().decode(plain.slice(0, -1));
    },
  };
}

describe('Web Push senza librerie', () => {
  it('il contenuto cifrato si decifra con le chiavi del browser', async () => {
    const b = await browser();
    const text = JSON.stringify({ title: 'Lega', body: 'Turno nuovo: giornata 14 di 82.' });
    const body = await encryptPayload(enc.encode(text), b.p256dh, b.auth);
    expect(await b.decrypt(body)).toBe(text);
    // Ogni notifica ha salt e chiave effimera nuovi
    const again = await encryptPayload(enc.encode(text), b.p256dh, b.auth);
    expect(b64url(again)).not.toBe(b64url(body));
  });

  it('il JWT VAPID è firmato con la chiave privata e vale per l’origine del servizio push', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:prova@nbbgm.test' };
    expect(keys.publicKey).toHaveLength(87);
    expect(keys.privateKey).toHaveLength(43);
    const now = Date.parse('2026-11-06T12:00:00Z');
    const auth = await vapidAuthorization('https://web.push.apple.com/abc/def', keys, now);
    const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(auth);
    expect(m).not.toBeNull();
    const [, header, claims, signature, k] = m as unknown as string[];
    expect(k).toBe(keys.publicKey);
    expect(JSON.parse(new TextDecoder().decode(fromB64url(claims!)))).toEqual({
      aud: 'https://web.push.apple.com',
      exp: now / 1000 + 12 * 3600,
      sub: 'mailto:prova@nbbgm.test',
    });
    const pub = await crypto.subtle.importKey(
      'raw',
      fromB64url(keys.publicKey),
      { name: 'ECDSA', namedCurve: 'P-256' },
      false,
      ['verify'],
    );
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      pub,
      fromB64url(signature!),
      enc.encode(`${header}.${claims}`),
    );
    expect(ok).toBe(true);
  });

  it('chiavi dalle variabili d’ambiente, o niente', () => {
    expect(vapidFromEnv(() => undefined)).toBeNull();
    const env: Record<string, string> = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
    expect(vapidFromEnv((n) => env[n])).toEqual({
      publicKey: 'pub',
      privateKey: 'priv',
      subject: 'mailto:mondiali2014@gmail.com',
    });
  });
});

describe('testi delle notifiche', () => {
  const row = (over: Partial<OutboxRow>): OutboxRow => ({
    id: 1,
    user_id: 'u',
    league_id: 'L',
    kind: 'turn',
    detail: null,
    pick: null,
    league_name: 'Amici',
    round_kind: 'regular',
    round_number: 13,
    round_stage: null,
    ...over,
  });

  it('turno nuovo, decisione e draft con la pagina giusta', () => {
    expect(notificationText(row({ round_day: 1, season_year: 2026 }))).toEqual({
      body: 'Si è giocato. Turno nuovo: mercoledì 21 ottobre.',
      url: './#/lega/L',
    });
    expect(notificationText(row({ round_kind: 'playoffs', round_day: 180, season_year: 2026 })).body).toBe(
      'Si è giocato. Turno nuovo: playoff, domenica 18 aprile.',
    );
    // Senza il giorno (righe di prima): il numero del turno
    expect(notificationText(row({})).body).toBe('Si è giocato. Turno nuovo: turno 14.');
    expect(notificationText(row({ round_kind: 'offseason', round_stage: 'renewals' })).body).toBe(
      'Si è giocato. Turno nuovo: offseason, rinnovi.',
    );
    expect(notificationText(row({ kind: 'decision', detail: 'trade_offer' }))).toEqual({
      body: 'Hai ricevuto una proposta di scambio.',
      url: './#/lega/L/mercato?tab=scambi',
    });
    expect(notificationText(row({ kind: 'draft', detail: 'now', pick: 31 }))).toEqual({
      body: 'Draft: tocca a te (scelta n. 31).',
      url: './#/lega/L/draft',
    });
  });

  it('una notifica per persona e lega: turno nuovo e decisioni insieme', () => {
    const batch: PushBatch = {
      notifications: [
        row({ id: 1 }),
        row({ id: 2, kind: 'decision', detail: 'renewals' }),
        row({ id: 3, kind: 'decision', detail: 'trade_offer' }),
        row({ id: 4, user_id: 'v' }),
        row({ id: 5, league_id: 'M', league_name: 'Altra' }),
      ],
      subscriptions: [],
      badges: { u: 2 },
    };
    const m = mergeNotifications(batch);
    expect(m).toHaveLength(3);
    expect(m[0]).toMatchObject({
      userId: 'u',
      payload: {
        title: 'Amici',
        body: 'Si è giocato. Turno nuovo: turno 14. Hai 2 decisioni da prendere.',
        url: './#/lega/L/mercato?tab=scambi',
        tag: 'nbbgm-L',
        badge: 2,
        renotify: true,
      },
      options: { ttl: 86400, urgency: 'normal' },
    });
    expect(m[1]).toMatchObject({ userId: 'v', payload: { badge: 0, renotify: false } });
    expect(m[2]).toMatchObject({ payload: { title: 'Altra', tag: 'nbbgm-M' } });
  });
});

// ---------------------------------------------------------------- database

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const BRUNO = ids.user('bruno');
const CARLA = ids.user('carla');
const BOS = ids.team('BOS');
const LAL = ids.team('LAL');
const NYK = ids.team('NYK');

let db: PGlite;
const q = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
const take = () => serviceRpc(db).rpc<PushBatch>('push_take', { p_limit: 500 });

async function subscribe(user: string, endpoint: string, b: { p256dh: string; auth: string }) {
  await asUser(db, user, (tx) =>
    tx.query('select public.save_push_subscription($1, $2, $3, $4)', [endpoint, b.p256dh, b.auth, 'prova']),
  );
}

describe('notifiche sul database', () => {
  let annaPhone: Awaited<ReturnType<typeof browser>>;

  beforeAll(async () => {
    db = await createTestDb();
    await db.exec(buildSeedSql());
    annaPhone = await browser();
  }, 120_000);

  it('ognuno salva e vede solo le sue iscrizioni; senza login niente', async () => {
    await subscribe(ANNA, 'https://web.push.apple.com/anna-telefono', annaPhone);
    await subscribe(ANNA, 'https://fcm.googleapis.com/fcm/send/anna-computer', await browser());
    const mine = (user: string) =>
      asUser(
        db,
        user,
        async (tx) => (await tx.query('select endpoint from public.push_subscriptions')).rows.length,
      );
    expect(await mine(ANNA)).toBe(2);
    expect(await mine(BRUNO)).toBe(0);
    await expect(
      asAnon(db, (tx) =>
        tx.query('select public.save_push_subscription($1, $2, $3, $4)', ['https://x.test/a', 'a', 'b', 'c']),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query('insert into public.push_outbox (user_id, kind) values ($1, $2)', [ANNA, 'turn']),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, ANNA, (tx) =>
        tx.query('select public.save_push_subscription($1, $2, $3, $4)', [
          'http://x.test/a',
          annaPhone.p256dh,
          annaPhone.auth,
          '',
        ]),
      ),
    ).rejects.toThrow(/non valida/);
    // Lo stesso telefono, usato poi da Bruno, passa a lui
    await subscribe(BRUNO, 'https://fcm.googleapis.com/fcm/send/anna-computer', await browser());
    expect(await mine(ANNA)).toBe(1);
    expect(await mine(BRUNO)).toBe(1);
    await asUser(db, BRUNO, (tx) =>
      tx.query('select public.delete_push_subscription($1)', [
        'https://fcm.googleapis.com/fcm/send/anna-computer',
      ]),
    );
    expect(await mine(BRUNO)).toBe(0);
  });

  it('turno nuovo: solo a chi è iscritto, gioca e non ha l’allenatore; poi la coda si svuota', async () => {
    await subscribe(CARLA, 'https://updates.push.services.mozilla.com/wpush/v2/carla', await browser());
    // Bruno (LAL) è iscritto, ma il secondo giorno riposa: niente turno nuovo
    const brunoPhone = 'https://fcm.googleapis.com/fcm/send/bruno-telefono';
    await subscribe(BRUNO, brunoPhone, await browser());
    await asUser(db, CARLA, (tx) =>
      tx.query(`insert into public.coach_delegations (team_id, league_id, active) values ($1, $2, true)`, [
        NYK,
        LEAGUE,
      ]),
    );
    await take();
    await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
    const r = await advanceLeague(serviceRpc(db), LEAGUE, {
      newId: randomUUID,
      playGame: quickGame,
      botProposals: false,
    });
    expect(r.advanced).toBe(true);
    const batch = await take();
    const turns = batch.notifications.filter((n) => n.kind === 'turn');
    expect(turns.map((n) => n.user_id)).toEqual([ANNA]);
    expect(turns[0]).toMatchObject({
      league_id: LEAGUE,
      round_kind: 'regular',
      round_number: 1,
      round_day: 1,
      season_year: 2026,
    });
    expect(notificationText(turns[0]!).body).toBe('Si è giocato. Turno nuovo: mercoledì 21 ottobre.');
    expect(batch.subscriptions.filter((s) => s.user_id === ANNA)).toHaveLength(1);
    expect((await take()).notifications).toEqual([]);
    await asUser(db, BRUNO, (tx) => tx.query('select public.delete_push_subscription($1)', [brunoPhone]));
  }, 60_000);

  it('avviso bloccante nuovo: decisione per il manager, se non l’ha spenta nel profilo', async () => {
    const alert = (team: string) =>
      asService(db, (tx) =>
        tx.query(
          `insert into public.alerts (league_id, team_id, kind, blocking) values ($1, $2, 'trade_offer', true)`,
          [LEAGUE, team],
        ),
      );
    await alert(BOS);
    await alert(LAL);
    const batch = await take();
    expect(batch.notifications.map((n) => [n.user_id, n.kind, n.detail])).toEqual([
      [ANNA, 'decision', 'trade_offer'],
    ]);
    expect(batch.badges[ANNA]).toBeGreaterThanOrEqual(1);
    // Anna spegne le decisioni: niente più in coda; i turni restano
    // Come l'upsert dell'app (PostgREST riscrive anche user_id)
    const upsert = (user: string, decisions: boolean) =>
      asUser(db, user, (tx) =>
        tx.query(
          `insert into public.notification_settings (user_id, turn, decisions, draft) values ($1, true, $2, true)
           on conflict (user_id) do update set user_id = excluded.user_id, turn = excluded.turn,
             decisions = excluded.decisions, draft = excluded.draft`,
          [user, decisions],
        ),
      );
    await upsert(ANNA, true);
    await upsert(ANNA, false);
    await alert(BOS);
    expect((await take()).notifications).toEqual([]);
    // Le preferenze di Anna le cambia solo lei
    await asUser(db, BRUNO, (tx) =>
      tx.query('update public.notification_settings set decisions = true where user_id = $1', [ANNA]),
    );
    expect((await q<{ d: boolean }>('select decisions as d from public.notification_settings'))[0]!.d).toBe(
      false,
    );
    await asUser(db, ANNA, (tx) =>
      tx.query('update public.notification_settings set decisions = true where user_id = $1', [ANNA]),
    );
  });

  it('draft iniziale dal vivo: chi ha una scelta nelle prossime 3 chiamate', async () => {
    const order = [LAL, NYK, BOS, LAL, BOS, BOS, LAL, NYK];
    await asService(db, (tx) =>
      tx.query(
        `insert into public.initial_drafts (league_id, mode, state, team_order) values ($1, 'live', 'waiting', $2)`,
        [LEAGUE, order],
      ),
    );
    const draftRows = async () => (await take()).notifications.map((n) => [n.detail, n.pick]);
    await asService(db, (tx) =>
      tx.query(`update public.initial_drafts set state = 'running' where league_id = $1`, [LEAGUE]),
    );
    // Carla (NYK) ha la scelta 2 e Anna (BOS) la 3: entrano subito nella finestra; Bruno non è iscritto
    expect(await draftRows()).toEqual([
      ['soon', 2],
      ['soon', 3],
    ]);
    await asService(db, (tx) =>
      tx.query('update public.initial_drafts set next_pick = 2 where league_id = $1', [LEAGUE]),
    );
    // Ora tocca ad Anna la 3, già avvisata: entra solo la 5 (finestra 3-5)
    expect(await draftRows()).toEqual([['soon', 5]]);
    await asService(db, (tx) =>
      tx.query('update public.initial_drafts set next_pick = 5 where league_id = $1', [LEAGUE]),
    );
    expect(await draftRows()).toEqual([
      ['now', 6],
      ['soon', 8],
    ]);
    await asService(db, (tx) => tx.query('delete from public.initial_drafts where league_id = $1', [LEAGUE]));
  });

  it('la Edge Function manda, unisce e cancella le iscrizioni scadute', async () => {
    await subscribe(ANNA, 'https://wns2-par02p.notify.windows.com/w/anna-vecchio', await browser());
    await asService(db, (tx) =>
      tx.query(
        `insert into public.alerts (league_id, team_id, kind, blocking) values ($1, $2, 'renewals', true)`,
        [LEAGUE, BOS],
      ),
    );
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:prova@nbbgm.test' };
    const sent: { url: string; body: Uint8Array; headers: Record<string, string> }[] = [];
    const report = await deliverPush(serviceRpc(db), keys, async (url, init) => {
      sent.push({ url, body: init.body, headers: init.headers });
      return { status: url.endsWith('vecchio') ? 410 : 201 };
    });
    expect(report).toEqual({ taken: 1, messages: 1, sent: 1, gone: 1, failed: 0 });
    const phone = sent.find((s) => s.url.endsWith('anna-telefono'));
    expect(phone?.headers).toMatchObject({
      'Content-Encoding': 'aes128gcm',
      TTL: '86400',
      Urgency: 'normal',
    });
    const payload = JSON.parse(await annaPhone.decrypt(phone!.body)) as PushPayload;
    expect(payload).toMatchObject({
      title: 'Lega di prova',
      body: 'Rinnovi: decidi chi tenere tra i giocatori in scadenza.',
      url: `./#/lega/${LEAGUE}`,
      tag: `nbbgm-${LEAGUE}`,
    });
    expect(
      (
        await q<{ endpoint: string }>('select endpoint from public.push_subscriptions where user_id = $1', [
          ANNA,
        ])
      ).map((s) => s.endpoint),
    ).toEqual(['https://web.push.apple.com/anna-telefono']);
  });

  it('senza chiavi VAPID la coda si svuota senza mandare nulla', async () => {
    await asService(db, (tx) =>
      tx.query(
        `insert into public.alerts (league_id, team_id, kind, blocking) values ($1, $2, 'renewals', true)`,
        [LEAGUE, BOS],
      ),
    );
    let calls = 0;
    const report = await deliverPush(serviceRpc(db), null, async () => {
      calls++;
      return { status: 201 };
    });
    expect(report.taken).toBe(1);
    expect(calls).toBe(0);
    expect((await take()).notifications).toEqual([]);
  });

  it('una notifica che non si può mettere in coda non ferma il turno', async () => {
    // La chiamata alla Edge Function push fallisce (su Supabase: pg_net giù o indirizzo sbagliato)
    await db.exec(`alter function private.kick(text, jsonb) rename to kick_vero`);
    await db.exec(`
      create function private.kick(p_path text, p_body jsonb) returns void
      language plpgsql security definer set search_path = '' as $$
      begin
        if p_path = 'push' then raise exception 'chiamata fallita'; end if;
      end;
      $$;
    `);
    try {
      await asUser(db, ANNA, (tx) => tx.query('select public.force_round($1)', [LEAGUE]));
      const r = await advanceLeague(serviceRpc(db), LEAGUE, {
        newId: randomUUID,
        playGame: quickGame,
        botProposals: false,
      });
      expect(r.advanced).toBe(true);
      // La notifica è saltata, il turno no
      expect((await take()).notifications).toEqual([]);
    } finally {
      await db.exec(`
        drop function private.kick(text, jsonb);
        alter function private.kick_vero(text, jsonb) rename to kick;
      `);
    }
  }, 60_000);

  it('pg_cron butta le notifiche vecchie di 10 minuti', async () => {
    await asService(db, (tx) =>
      tx.query(
        `insert into public.push_outbox (user_id, league_id, kind, created_at) values ($1, $2, 'turn', now() - interval '11 minutes')`,
        [ANNA, LEAGUE],
      ),
    );
    await db.query('select private.push_retry()');
    expect((await take()).notifications).toEqual([]);
  });
});

describe('notifiche più tranquille', () => {
  const currentRound = async () =>
    (await q<{ id: string }>('select current_round_id as id from public.leagues where id = $1', [LEAGUE]))[0]!
      .id;
  const alert = (team: string, kind: string, round: string) =>
    asService(db, (tx) =>
      tx.query(
        `insert into public.alerts (league_id, team_id, kind, blocking, round_id) values ($1, $2, $3, true, $4)`,
        [LEAGUE, team, kind, round],
      ),
    );
  const decisions = async () =>
    (await take()).notifications.filter((n) => n.kind === 'decision').map((n) => [n.user_id, n.detail]);

  it('le decisioni uguali dello stesso turno arrivano una ogni 5 minuti', async () => {
    await take();
    const round = await currentRound();
    await alert(BOS, 'trade_offer', round);
    expect(await decisions()).toEqual([[ANNA, 'trade_offer']]);
    // Proposta ritirata e rifatta: l'avviso c'è, il telefono non vibra di nuovo
    await alert(BOS, 'trade_offer', round);
    await alert(BOS, 'trade_offer', round);
    expect(await decisions()).toEqual([]);
    // Un'altra decisione dello stesso turno passa
    await alert(BOS, 'roster_minimum', round);
    expect(await decisions()).toEqual([[ANNA, 'roster_minimum']]);
    // Passati 5 minuti, la stessa decisione torna ad avvisare; pg_cron intanto toglie i raggruppamenti scaduti
    await db.query(`update private.push_throttle set last_at = now() - interval '6 minutes'`);
    await db.query('select private.push_retry()');
    expect((await q<{ n: number }>('select count(*)::int as n from private.push_throttle'))[0]!.n).toBe(0);
    await alert(BOS, 'trade_offer', round);
    expect(await decisions()).toEqual([[ANNA, 'trade_offer']]);
    // Un turno diverso è un'altra decisione (i turni dell'offseason possono correre veloci)
    const other = (
      await q<{ id: string }>(
        `select id from public.rounds where league_id = $1 and id <> $2 order by number limit 1`,
        [LEAGUE, round],
      )
    )[0]!.id;
    await alert(BOS, 'trade_offer', other);
    expect(await decisions()).toEqual([[ANNA, 'trade_offer']]);
    await db.query(`update public.alerts set status = 'resolved' where league_id = $1 and status = 'open'`, [
      LEAGUE,
    ]);
  });

  it('al massimo 5 proposte alla stessa squadra nello stesso turno, con una notifica sola', async () => {
    await take();
    // Il test di prima ha appena avvisato Anna di una proposta in questo turno
    await db.query('delete from private.push_throttle');
    const round = await currentRound();
    const propose = () =>
      serviceRpc(db).rpc('market_write', {
        p_league: LEAGUE,
        p_round: round,
        p_team: LAL,
        p_action: { kind: 'propose_trade', to_team_id: BOS },
      });
    for (let i = 0; i < 5; i++) await propose();
    await expect(propose()).rejects.toThrow(/già fatto 5 proposte a questa squadra in questo turno/);
    expect(await decisions()).toEqual([[ANNA, 'trade_offer']]);
    // Verso un'altra squadra si propone ancora
    await serviceRpc(db).rpc('market_write', {
      p_league: LEAGUE,
      p_round: round,
      p_team: LAL,
      p_action: { kind: 'propose_trade', to_team_id: NYK },
    });
    await db.query(
      `update public.trade_offers set status = 'withdrawn' where league_id = $1 and status = 'pending'`,
      [LEAGUE],
    );
    await db.query(`update public.alerts set status = 'expired' where league_id = $1 and status = 'open'`, [
      LEAGUE,
    ]);
  });

  it('"Turno nuovo" non arriva a chi in playoff non gioca il turno', async () => {
    await subscribe(BRUNO, 'https://fcm.googleapis.com/fcm/send/bruno', await browser());
    const before = await currentRound();
    const season = (
      await q<{ id: string }>('select current_season_id as id from public.leagues where id = $1', [LEAGUE])
    )[0]!.id;
    const bot = (
      await q<{ id: string }>(
        'select id from public.teams where league_id = $1 and owner_id is null order by code limit 1',
        [LEAGUE],
      )
    )[0]!.id;
    // Un turno di playoff in cui gioca solo Boston (Anna) contro un bot; Bruno è eliminato
    const playoff = (
      await q<{ id: string }>(
        `insert into public.rounds (league_id, season_id, number, kind) values ($1, $2, 500, 'playoffs')
         returning id`,
        [LEAGUE, season],
      )
    )[0]!.id;
    await db.query(
      `insert into public.games (league_id, season_id, round_number, kind, home_team_id, away_team_id)
       values ($1, $2, 500, 'playoffs', $3, $4)`,
      [LEAGUE, season, BOS, bot],
    );
    await take();
    await db.query('update public.leagues set current_round_id = $2 where id = $1', [LEAGUE, playoff]);
    const turns = (await take()).notifications.filter((n) => n.kind === 'turn').map((n) => n.user_id);
    expect(turns).toEqual([ANNA]);
    // Si torna com'era
    await db.query('update public.leagues set current_round_id = $2 where id = $1', [LEAGUE, before]);
    await db.query('delete from public.games where league_id = $1 and round_number = 500', [LEAGUE]);
    await db.query('delete from public.rounds where id = $1', [playoff]);
    const back = (await take()).notifications.filter((n) => n.kind === 'turn').map((n) => n.user_id);
    expect(back.sort()).toEqual([ANNA, BRUNO].sort());
  });

  it('un’iscrizione rifiutata 3 volte di fila si cancella; un invio riuscito azzera il conto', async () => {
    const keys = { ...(await generateVapidKeys()), subject: 'mailto:prova@nbbgm.test' };
    const brunoEndpoint = 'https://fcm.googleapis.com/fcm/send/bruno';
    const failures = async () =>
      (
        await q<{ failures: number }>('select failures from public.push_subscriptions where endpoint = $1', [
          brunoEndpoint,
        ])
      )[0]?.failures;
    let status = 403;
    const round = await currentRound();
    const send = async (url: string) => ({ status: url === brunoEndpoint ? status : 201 });
    const notify = async (kind: string) => {
      await alert(LAL, kind, round);
      return deliverPush(serviceRpc(db), keys, send);
    };
    expect(await notify('renewals')).toMatchObject({ failed: 1, gone: 0 });
    expect(await failures()).toBe(1);
    // Un errore del servizio (5xx, 429) non conta
    status = 503;
    expect(await notify('free_agency')).toMatchObject({ failed: 1, gone: 0 });
    expect(await failures()).toBe(1);
    status = 201;
    expect(await notify('draft_pick')).toMatchObject({ sent: 1 });
    expect(await failures()).toBe(0);
    status = 401;
    await notify('preparation');
    await notify('roster_minimum');
    expect(await failures()).toBe(2);
    expect(await notify('trade_offer')).toMatchObject({ failed: 1, gone: 1 });
    expect(await failures()).toBeUndefined();
    await db.query(`update public.alerts set status = 'resolved' where league_id = $1 and status = 'open'`, [
      LEAGUE,
    ]);
  });
});
