// Notifiche push dal server: la coda del database (push_take) diventa un messaggio per persona e lega, cifrato e
// mandato a ogni dispositivo iscritto; le iscrizioni scadute (404, 410) si cancellano (push_gone), quelle
// rifiutate più volte di fila (400, 401, 403: per esempio dopo un cambio delle chiavi VAPID) le conta e le
// cancella il database (push_failed).
// Comune alla Edge Function push (Deno) e ai test (Node). I testi stanno qui, in italiano.
import { pushRequest, type PushOptions, type VapidKeys } from './webpush.ts';

export type PushKind = 'turn' | 'decision' | 'draft';

/** Una notifica della coda, con lega e turno per scriverne il testo. */
export interface OutboxRow {
  id: number;
  user_id: string;
  league_id: string | null;
  kind: PushKind;
  /** decision: tipo di avviso; draft: 'now' o 'soon'. */
  detail: string | null;
  /** draft: numero della scelta. */
  pick: number | null;
  league_name: string | null;
  round_kind: string | null;
  round_number: number | null;
  round_stage: string | null;
}

export interface SubscriptionRow {
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  /** Rifiuti di fila del servizio push (dal 20261106170400). */
  failures?: number;
}

export interface PushBatch {
  notifications: OutboxRow[];
  subscriptions: SubscriptionRow[];
  /** Decisioni bloccanti aperte per persona: il numero sull'icona. */
  badges: Record<string, number>;
}

/** Quello che arriva al service worker (in chiaro dopo la decifratura). */
export interface PushPayload {
  title: string;
  body: string;
  /** Pagina da aprire toccando la notifica, relativa al sito ("./#/lega/..."). */
  url: string;
  /** Una notifica per lega: la nuova prende il posto della vecchia sul dispositivo. */
  tag: string;
  badge: number;
  /** Vibra e suona di nuovo anche se sostituisce una notifica della stessa lega. */
  renotify: boolean;
}

export interface PushMessage {
  userId: string;
  payload: PushPayload;
  options: PushOptions;
}

const STAGE: Record<string, string> = {
  draft: 'draft',
  renewals: 'rinnovi',
  fa1: 'free agency, turno 1 di 4',
  fa2: 'free agency, turno 2 di 4',
  fa3: 'free agency, turno 3 di 4',
  fa4: 'free agency, turno 4 di 4',
  preparation: 'preparazione della stagione',
};

/** "giornata 14 di 82", "play-in", "playoff", "offseason, rinnovi" */
export function roundText(kind: string | null, number: number | null, stage: string | null): string {
  if (kind === 'regular' && number !== null) return `giornata ${number + 1} di 82`;
  if (kind === 'play-in') return 'play-in';
  if (kind === 'playoffs') return 'playoff';
  if (kind === 'offseason') return stage && STAGE[stage] ? `offseason, ${STAGE[stage]}` : 'offseason';
  return 'turno nuovo';
}

const DECISION: Record<string, string> = {
  trade_offer: 'Hai ricevuto una proposta di scambio.',
  roster_minimum: 'La rosa è sotto il minimo: rispondi all’avviso.',
  draft_pick: 'Draft: ordina i tuoi preferiti.',
  renewals: 'Rinnovi: decidi chi tenere tra i giocatori in scadenza.',
  free_agency: 'Free agency: fai le tue offerte agli svincolati.',
  preparation: 'Prepara rosa, quintetto e tattiche per la stagione nuova.',
};

/** Testo e pagina di una notifica della coda. */
export function notificationText(r: OutboxRow): { body: string; url: string } {
  const league = r.league_id ? `./#/lega/${r.league_id}` : './';
  switch (r.kind) {
    case 'turn':
      return {
        body: `Si è giocato. Turno nuovo: ${roundText(r.round_kind, r.round_number, r.round_stage)}.`,
        url: league,
      };
    case 'decision':
      return {
        body: DECISION[r.detail ?? ''] ?? 'C’è una decisione da prendere.',
        url: r.detail === 'trade_offer' ? `${league}/mercato?tab=scambi` : league,
      };
    case 'draft':
      return {
        body:
          r.detail === 'now'
            ? `Draft: tocca a te (scelta n. ${r.pick ?? '?'}).`
            : `Draft: tra poco tocca a te (scelta n. ${r.pick ?? '?'}).`,
        url: r.league_id ? `./#/lega/${r.league_id}/draft` : './',
      };
  }
}

const PRIORITY: Record<PushKind, number> = { draft: 3, decision: 2, turn: 1 };
const TTL: Record<PushKind, number> = { draft: 10 * 60, decision: 24 * 3600, turn: 12 * 3600 };

/**
 * Un messaggio per persona e lega: il più urgente (draft, poi decisione, poi turno nuovo) dà pagina e durata;
 * il turno nuovo e le decisioni dello stesso momento stanno nello stesso testo.
 */
export function mergeNotifications(batch: PushBatch): PushMessage[] {
  const groups = new Map<string, OutboxRow[]>();
  for (const r of batch.notifications) {
    const key = `${r.user_id}:${r.league_id ?? ''}`;
    const list = groups.get(key);
    if (list) list.push(r);
    else groups.set(key, [r]);
  }
  const out: PushMessage[] = [];
  for (const rows of groups.values()) {
    const top = [...rows].sort((a, b) => PRIORITY[b.kind] - PRIORITY[a.kind] || b.id - a.id)[0] as OutboxRow;
    const decisions = rows.filter((r) => r.kind === 'decision');
    const turn = rows.filter((r) => r.kind === 'turn').at(-1);
    let body = notificationText(top).body;
    if (top.kind === 'decision') {
      const what = decisions.length === 1 ? body : `Hai ${decisions.length} decisioni da prendere.`;
      body = turn ? `${notificationText(turn).body} ${what}` : what;
    }
    out.push({
      userId: top.user_id,
      payload: {
        title: top.league_name ?? 'NBBGM',
        body,
        url: notificationText(top).url,
        tag: `nbbgm-${top.league_id ?? 'app'}`,
        badge: batch.badges[top.user_id] ?? 0,
        renotify: top.kind !== 'turn',
      },
      options: { ttl: TTL[top.kind], urgency: top.kind === 'draft' ? 'high' : 'normal' },
    });
  }
  return out;
}

/**
 * Host dei servizi push dei browser (elenco di pushpad/known-push-services, senza gli host di prova di Mozilla): il
 * server manda le notifiche solo lì. Con il punto davanti vale per i sottodomini. Lo stesso elenco sta nel
 * database (private.push_endpoint_ok, migrazione 20261106150000_push_hosts.sql): le due liste vanno tenute uguali.
 */
export const PUSH_HOSTS = [
  // Chrome e i browser Chromium (Opera, Brave, Samsung Internet), Android
  'fcm.googleapis.com',
  'android.googleapis.com',
  'jmt17.google.com',
  // Firefox (updates.push.services.mozilla.com)
  '.push.services.mozilla.com',
  // Edge su Windows (WNS)
  '.notify.windows.com',
  // Safari su Mac, iPhone e iPad (web.push.apple.com)
  '.push.apple.com',
] as const;

/** L'indirizzo di un'iscrizione porta a un servizio push vero? https, nessuna porta né credenziali. */
export function pushEndpointAllowed(endpoint: string): boolean {
  if (endpoint.length > 1000) return false;
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '')
    return false;
  // L'hostname di URL è già in minuscolo; con il punto davanti serve almeno un nome prima (web.push.apple.com)
  const host = url.hostname;
  return PUSH_HOSTS.some((h) => (h.startsWith('.') ? host.endsWith(h) : host === h));
}

/** Tempo massimo per una richiesta a un servizio push. */
export const PUSH_TIMEOUT_MS = 10_000;

/**
 * Invio con fetch: senza seguire i reindirizzamenti (un servizio push non ne manda: un 3xx conta come errore) e
 * con un tempo massimo, così un servizio lento non tiene ferma la funzione.
 */
export function fetchSend(fetchImpl: typeof fetch = fetch, timeoutMs = PUSH_TIMEOUT_MS): Send {
  return async (url, init) => {
    const res = await fetchImpl(url, {
      ...init,
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    await res.body?.cancel();
    return { status: res.status };
  };
}

/** Le chiamate al database che servono: supabase-js nella Edge Function, PGlite nei test. */
export interface PushDb {
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

export type Send = (
  url: string,
  init: { method: 'POST'; headers: Record<string, string>; body: Uint8Array },
) => Promise<{ status: number }>;

export interface DeliveryReport {
  /** Notifiche prese dalla coda. */
  taken: number;
  messages: number;
  sent: number;
  /** Iscrizioni cancellate: scadute (404, 410) o rifiutate troppe volte di fila. */
  gone: number;
  failed: number;
}

/**
 * Risposte del servizio push che dicono che l'iscrizione, così com'è, non funzionerà più: chiavi VAPID cambiate
 * (401, 403) o iscrizione non valida (400). Non lo sono 413 (messaggio troppo lungo), 429 e gli errori 5xx.
 */
export const PERMANENT_FAILURES: ReadonlySet<number> = new Set([400, 401, 403]);

/**
 * Svuota la coda e manda le notifiche. Senza chiavi VAPID (keys null) la coda si svuota senza mandare nulla:
 * non si accumula e la funzione non viene richiamata ogni minuto.
 */
export async function deliverPush(
  db: PushDb,
  keys: VapidKeys | null,
  send: Send,
  limit = 500,
): Promise<DeliveryReport> {
  const batch = await db.rpc<PushBatch>('push_take', { p_limit: limit });
  const report: DeliveryReport = {
    taken: batch.notifications.length,
    messages: 0,
    sent: 0,
    gone: 0,
    failed: 0,
  };
  if (!keys || batch.notifications.length === 0) return report;
  const messages = mergeNotifications(batch);
  report.messages = messages.length;
  // Un'iscrizione verso un host che non è un servizio push non si usa e si cancella (il database già le rifiuta)
  const gone: string[] = batch.subscriptions
    .filter((s) => !pushEndpointAllowed(s.endpoint))
    .map((s) => s.endpoint);
  // Rifiuti permanenti, e invii riusciti di chi ne aveva avuti (il conto torna a zero)
  const refused: string[] = [];
  const recovered: string[] = [];
  await Promise.all(
    messages.flatMap((m) =>
      batch.subscriptions
        .filter((s) => s.user_id === m.userId && pushEndpointAllowed(s.endpoint))
        .map(async (s) => {
          try {
            const req = await pushRequest(s, JSON.stringify(m.payload), keys, m.options);
            const res = await send(req.url, req.init);
            if (res.status === 404 || res.status === 410) gone.push(s.endpoint);
            else if (res.status >= 200 && res.status < 300) {
              report.sent++;
              if ((s.failures ?? 0) > 0) recovered.push(s.endpoint);
            } else {
              report.failed++;
              if (PERMANENT_FAILURES.has(res.status)) refused.push(s.endpoint);
            }
          } catch {
            report.failed++;
          }
        }),
    ),
  );
  const unique = [...new Set(gone)];
  if (unique.length > 0) report.gone = await db.rpc<number>('push_gone', { p_endpoints: unique });
  // Un'iscrizione con più messaggi nello stesso giro conta un rifiuto solo
  if (refused.length > 0 || recovered.length > 0)
    report.gone += await db.rpc<number>('push_failed', {
      p_failed: [...new Set(refused)],
      p_ok: [...new Set(recovered)],
    });
  return report;
}

/** Chiavi VAPID dalle variabili d'ambiente (segreti della Edge Function), o null se mancano. */
export function vapidFromEnv(get: (name: string) => string | undefined): VapidKeys | null {
  const publicKey = get('VAPID_PUBLIC_KEY')?.trim();
  const privateKey = get('VAPID_PRIVATE_KEY')?.trim();
  if (!publicKey || !privateKey) return null;
  return { publicKey, privateKey, subject: get('VAPID_SUBJECT')?.trim() || 'mailto:mondiali2014@gmail.com' };
}
