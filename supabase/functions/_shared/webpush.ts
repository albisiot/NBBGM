// Web Push standard senza librerie: chiavi VAPID (RFC 8292) e contenuto cifrato aes128gcm (RFC 8188 e 8291),
// solo con WebCrypto. Gira uguale su Deno (Edge Function push) e su Node (test e script delle chiavi).
//
// Le chiavi VAPID sono una coppia P-256: la pubblica (65 byte, punto non compresso) va nell'app per iscriversi,
// la privata (32 byte) resta segreta nella Edge Function. Entrambe in base64url, come le dà web-push.

export type Bytes = Uint8Array<ArrayBuffer>;
/** Chiave di WebCrypto (i tipi di Node non la dichiarano globale, quelli di Deno sì). */
export type Key = Awaited<ReturnType<typeof crypto.subtle.importKey>>;
export interface KeyPair {
  publicKey: Key;
  privateKey: Key;
}

const enc = new TextEncoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromB64url(text: string): Bytes {
  const b64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, '='));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function concat(...parts: Uint8Array[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let i = 0;
  for (const p of parts) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}

export interface VapidKeys {
  /** Pubblica, 65 byte in base64url. */
  publicKey: string;
  /** Privata, 32 byte in base64url. */
  privateKey: string;
  /** Contatto per i servizi push: mailto: o https:. */
  subject: string;
}

/** Coppia di chiavi VAPID nuova (per pnpm push:keys). */
export async function generateVapidKeys(): Promise<{ publicKey: string; privateKey: string }> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey));
  if (!jwk.d) throw new Error('Chiave privata non esportata');
  return { publicKey: b64url(pub), privateKey: jwk.d };
}

/** Chiave privata come JWK per WebCrypto: d più le coordinate x e y della pubblica. */
function vapidJwk(keys: Pick<VapidKeys, 'publicKey' | 'privateKey'>) {
  const pub = fromB64url(keys.publicKey);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('Chiave pubblica VAPID non valida');
  if (fromB64url(keys.privateKey).length !== 32) throw new Error('Chiave privata VAPID non valida');
  return {
    kty: 'EC',
    crv: 'P-256',
    d: keys.privateKey,
    x: b64url(pub.slice(1, 33)),
    y: b64url(pub.slice(33, 65)),
    ext: true,
  };
}

/** Intestazione Authorization VAPID: un JWT ES256 per l'origine del servizio push, valido 12 ore. */
export async function vapidAuthorization(
  endpoint: string,
  keys: VapidKeys,
  now = Date.now(),
): Promise<string> {
  const header = b64url(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const claims = b64url(
    enc.encode(
      JSON.stringify({
        aud: new URL(endpoint).origin,
        exp: Math.floor(now / 1000) + 12 * 3600,
        sub: keys.subject,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    'jwk',
    vapidJwk(keys),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  // WebCrypto firma ECDSA nel formato r||s di 64 byte, quello che chiede il JWT
  const signature = new Uint8Array(
    await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(`${header}.${claims}`)),
  );
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${keys.publicKey}`;
}

/** HKDF-SHA-256: estrazione con il salt ed espansione con info, in una volta. */
export async function hkdf(salt: Bytes, ikm: Bytes, info: Bytes, length: number): Promise<Bytes> {
  const key = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, key, length * 8),
  );
}

/** Dimensione del record dichiarata nell'intestazione: il contenuto sta in un solo record. */
export const RECORD_SIZE = 4096;

export const KEY_INFO = 'WebPush: info\0';
export const CEK_INFO = 'Content-Encoding: aes128gcm\0';
export const NONCE_INFO = 'Content-Encoding: nonce\0';

/**
 * Cifra il contenuto per un'iscrizione (p256dh e auth del browser): intestazione (salt, dimensione del record,
 * chiave pubblica effimera) e un solo record cifrato con AES-128-GCM. salt e coppia effimera si passano solo nei
 * test; di solito sono nuovi a ogni notifica.
 */
export async function encryptPayload(
  payload: Uint8Array,
  p256dh: string,
  authSecret: string,
  opts: { salt?: Bytes; ephemeral?: KeyPair } = {},
): Promise<Bytes> {
  const uaPublic = fromB64url(p256dh);
  const auth = fromB64url(authSecret);
  const salt = opts.salt ?? crypto.getRandomValues(new Uint8Array(16));
  const ephemeral =
    opts.ephemeral ??
    ((await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, [
      'deriveBits',
    ])) as KeyPair);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey('raw', ephemeral.publicKey));
  const uaKey = await crypto.subtle.importKey(
    'raw',
    uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'ECDH', public: uaKey }, ephemeral.privateKey, 256),
  );
  const ikm = await hkdf(auth, shared, concat(enc.encode(KEY_INFO), uaPublic, asPublic), 32);
  const cek = await hkdf(salt, ikm, enc.encode(CEK_INFO), 16);
  const nonce = await hkdf(salt, ikm, enc.encode(NONCE_INFO), 12);
  // Un solo record: il contenuto più il delimitatore 0x02 dell'ultimo record, senza riempimento
  const plain = concat(payload, new Uint8Array([2]));
  if (plain.length + 16 > RECORD_SIZE) throw new Error('Notifica troppo lunga');
  const key = await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['encrypt']);
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plain));
  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE);
  header[20] = asPublic.length;
  header.set(asPublic, 21);
  return concat(header, cipher);
}

export interface PushTarget {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface PushOptions {
  /** Secondi per cui il servizio push tiene la notifica se il dispositivo è spento. */
  ttl: number;
  urgency: 'very-low' | 'low' | 'normal' | 'high';
}

/** Richiesta HTTP da mandare al servizio push dell'iscrizione, con il contenuto (JSON) cifrato. */
export async function pushRequest(
  target: PushTarget,
  payload: string,
  keys: VapidKeys,
  opts: PushOptions,
): Promise<{ url: string; init: { method: 'POST'; headers: Record<string, string>; body: Bytes } }> {
  const body = await encryptPayload(enc.encode(payload), target.p256dh, target.auth);
  return {
    url: target.endpoint,
    init: {
      method: 'POST',
      headers: {
        Authorization: await vapidAuthorization(target.endpoint, keys),
        'Content-Encoding': 'aes128gcm',
        'Content-Type': 'application/octet-stream',
        TTL: String(opts.ttl),
        Urgency: opts.urgency,
      },
      body,
    },
  };
}
