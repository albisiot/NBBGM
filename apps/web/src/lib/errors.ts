// Messaggi d'errore per il manager: quelli del database sono già in italiano, quelli di Supabase Auth no.

const AUTH_MESSAGES: [RegExp, string][] = [
  [/email rate limit|over_email_send_rate_limit/i, 'Troppe email in poco tempo: riprova tra qualche minuto.'],
  [
    /not authorized|email_address_not_authorized/i,
    'Per ora le email partono solo verso gli indirizzi autorizzati del progetto: chiedi al commissario.',
  ],
  [/token has expired|otp_expired|invalid.*(token|otp)|token.*invalid/i, 'Codice sbagliato o scaduto.'],
  [
    /for security purposes|only request this after/i,
    'Aspetta qualche secondo prima di chiedere un altro codice.',
  ],
  [/unable to validate email|invalid email|email.*invalid/i, 'Indirizzo email non valido.'],
  [/failed to fetch|network|load failed/i, 'Connessione assente: controlla la rete e riprova.'],
  [/jwt expired|session.*(missing|expired)/i, 'Accesso scaduto: entra di nuovo.'],
  [
    /row-level security/i,
    'Modifica non accettata: il turno è in chiusura. Riprova quando si apre il prossimo.',
  ],
];

export function friendlyError(e: unknown): string {
  const message =
    typeof e === 'string'
      ? e
      : e instanceof Error
        ? e.message
        : typeof e === 'object' && e !== null && 'message' in e
          ? String((e as { message: unknown }).message)
          : 'Errore sconosciuto';
  for (const [pattern, text] of AUTH_MESSAGES) if (pattern.test(message)) return text;
  return message;
}

/** Codice invito come lo salva il database: maiuscole, senza spazi né trattini. */
export function normalizeInviteCode(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Il codice ricevuto per email: solo cifre, da 6 a 8. */
export function normalizeOtp(code: string): string {
  return code.replace(/\D/g, '').slice(0, 8);
}
