// Edge Function push: manda le notifiche in coda (push_outbox). La chiama il database con pg_net quando mette
// in coda qualcosa (turno nuovo, avviso bloccante, draft dal vivo) e pg_cron ogni minuto se una chiamata si è
// persa. Non si fida di chi chiama e non riceve nulla: prende la coda dal database e la svuota. Le chiavi VAPID
// sono segreti della funzione (VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT): senza, la coda si svuota e
// non parte nulla.
//
// POST  ->  { taken, messages, sent, gone, failed }
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { deliverPush, vapidFromEnv, type PushDb } from '../_shared/push.ts';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function serverKey(): string {
  const secrets = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
  const key = secrets.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key) throw new Error('Manca la chiave del server');
  return key;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Metodo non ammesso' }, 405);
  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', serverKey(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const db: PushDb = {
      async rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
        const { data, error } = await admin.rpc(name, args);
        if (error) throw new Error(`${name}: ${error.message}`);
        return data as T;
      },
    };
    const keys = vapidFromEnv((name) => Deno.env.get(name));
    if (!keys) console.warn('Mancano le chiavi VAPID: le notifiche in coda si scartano');
    const report = await deliverPush(db, keys, async (url, init) => {
      const res = await fetch(url, init);
      await res.body?.cancel();
      return { status: res.status };
    });
    if (report.taken > 0) console.log(`Notifiche: ${JSON.stringify(report)}`);
    return json(report);
  } catch (e) {
    console.error(e);
    return json({ error: 'Errore del server' }, 500);
  }
});
