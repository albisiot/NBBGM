// Segreto condiviso tra il database e le Edge Functions che chiama senza utente (advance-turn, push, tick del
// draft dal vivo). Il database lo manda nell'intestazione x-nbbgm-secret (private.function_headers, migrazione
// 20261106170000_function_secret.sql); la funzione lo confronta con il suo segreto NBBGM_FUNCTIONS_SECRET.
// Finché il segreto della funzione non c'è, si accetta tutto come prima: la pubblicazione non ferma i turni.

export const SECRET_HEADER = 'x-nbbgm-secret';
export const SECRET_ENV = 'NBBGM_FUNCTIONS_SECRET';

/** Confronto a tempo costante: il tempo della risposta non dice quanti caratteri sono giusti. */
export function sameSecret(a: string, b: string): boolean {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

/**
 * La chiamata viene dal database? Sì se la funzione non ha ancora un segreto (expected vuoto o assente) oppure se
 * l'intestazione lo porta uguale.
 */
export function trustedCaller(headers: Headers, expected: string | undefined): boolean {
  const secret = expected?.trim();
  if (!secret) return true;
  const given = headers.get(SECRET_HEADER);
  return given !== null && sameSecret(given, secret);
}
