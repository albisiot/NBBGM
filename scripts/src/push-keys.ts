// pnpm push:keys: crea una coppia di chiavi VAPID per le notifiche push e scrive dove vanno. Le chiavi si
// generano sul proprio computer e non si salvano da nessuna parte: la privata va solo nei segreti di Supabase.
import { generateVapidKeys } from '../../supabase/functions/_shared/webpush.ts';

const keys = await generateVapidKeys();
console.log(`Chiavi VAPID nuove (la privata non va nel repository né nell'app):

  VAPID_PUBLIC_KEY=${keys.publicKey}
  VAPID_PRIVATE_KEY=${keys.privateKey}

1. Segreti della Edge Function push (dalla radice del repository, con il login della CLI e il progetto collegato):
   npx.cmd --yes supabase@3.0.0 secrets set --remote VAPID_PUBLIC_KEY=${keys.publicKey} VAPID_PRIVATE_KEY=${keys.privateKey} VAPID_SUBJECT=mailto:mondiali2014@gmail.com

2. Variabile del repository per GitHub Pages (Settings > Secrets and variables > Actions > Variables):
   VAPID_PUBLIC_KEY = ${keys.publicKey}

3. Per provare in locale: in apps/web/.env.local
   VITE_VAPID_PUBLIC_KEY=${keys.publicKey}

Cambiando le chiavi le iscrizioni dei dispositivi non valgono più: ognuno riattiva le notifiche dal profilo.`);
