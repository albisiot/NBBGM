// Accesso: Google oppure codice di 6 cifre via email (niente link magico: su iPhone si aprirebbe in Safari e
// non nella PWA installata). L'iscrizione è solo su invito: chi arriva dal link d'invito (#/entra/CODICE) manda
// il codice con la richiesta, e se il server rifiuta un account nuovo senza invito lo si chiede qui.
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorText, TextInput } from '../components/ui.tsx';
import { friendlyError, normalizeOtp } from '../lib/errors.ts';
import { currentPlatform, preferEmailCode } from '../lib/install.ts';
import { ROW_LINK } from '../lib/linkStyles.ts';
import { inviteCodeFromHash, isInviteRequired, oauthError, rememberPage } from '../lib/returnTo.ts';
import { supabase } from '../lib/supabase.ts';

const RESEND_SECONDS = 60;

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Iscrizione con Google rifiutata (email non invitata): l'errore torna nell'indirizzo
  const [error, setError] = useState<string | null>(() => oauthError(window.location.search));
  const [wait, setWait] = useState(0);
  const [invite, setInvite] = useState(() => inviteCodeFromHash(window.location.hash) ?? '');
  const [askInvite, setAskInvite] = useState(false);
  // Arrivati dal link d'invito: lo si dice in cima, prima di entrare
  const [invitedBy] = useState(() => inviteCodeFromHash(window.location.hash));

  // L'errore di Google, letto, esce dall'indirizzo (resta la pagina dopo #)
  useEffect(() => {
    if (new URLSearchParams(window.location.search).has('error'))
      window.history.replaceState(null, '', window.location.pathname + window.location.hash);
  }, []);
  // Nell'app installata su iPhone Google si apre nel browser e l'accesso resta lì: meglio il codice via email
  const [emailFirst] = useState(() => preferEmailCode(currentPlatform()));

  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function sendCode(e?: FormEvent) {
    e?.preventDefault();
    const address = (sentTo ?? email).trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    setError(null);
    // Il codice invito vale solo per un account nuovo (metadati dell'iscrizione): chi c'è già entra come prima
    const code = invite.toUpperCase().replace(/[^A-Z0-9]/g, '');
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true, ...(code ? { data: { invite_code: code } } : {}) },
    });
    setBusy(false);
    if (error) {
      if (isInviteRequired(error.message)) setAskInvite(true);
      return setError(friendlyError(error));
    }
    setSentTo(address);
    setCode('');
    setWait(RESEND_SECONDS);
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    if (!sentTo) return;
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.verifyOtp({
      email: sentTo,
      token: normalizeOtp(code),
      type: 'email',
    });
    setBusy(false);
    if (error) setError(friendlyError(error));
  }

  async function google() {
    setError(null);
    // Google torna all'indirizzo senza la pagina (#/entra/CODICE di un invito): la si ricorda per dopo
    rememberPage();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) setError(friendlyError(error));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-6 px-5 pt-[calc(var(--spazio-alto)+1.5rem)] pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:justify-center">
      {/* La testata del giornale, grande: qui non c'è l'intestazione delle altre pagine */}
      <header className="flex flex-col items-center gap-1.5 text-center">
        <p className="font-titolo text-[4.5rem] leading-[0.95] font-bold tracking-[0.01em]">NBBGM</p>
        <div
          aria-hidden="true"
          className="h-1 self-stretch border-t-2 border-b border-stampa-900 dark:border-stampa-100"
        />
        <p className="text-[0.875rem] italic">Il manageriale di basket a turni, tra amici</p>
        <div aria-hidden="true" className="h-px self-stretch bg-stampa-900 dark:bg-stampa-100" />
      </header>

      {invitedBy && (
        <p className="border border-stampa-900 bg-stampa-25 px-3 py-2.5 text-[0.95rem] leading-snug dark:border-stampa-600 dark:bg-stampa-800">
          Sei stato invitato in una lega (codice{' '}
          <strong className="font-titolo tracking-wider">{invitedBy}</strong>). Entra e scegli una squadra
          libera.
        </p>
      )}

      <section className="space-y-3">
        <h1 className="text-3xl font-bold">Entra</h1>
        {sentTo === null ? (
          <>
            <Button variant="secondary" className="min-h-12 w-full" onClick={google}>
              <GoogleIcon /> Continua con Google
            </Button>
            <div className="flex items-center gap-2.5 text-[0.8125rem] text-stampa-600 italic dark:text-stampa-300">
              <span aria-hidden="true" className="h-px flex-1 bg-stampa-300 dark:bg-stampa-600" />
              oppure con un codice via email
              <span aria-hidden="true" className="h-px flex-1 bg-stampa-300 dark:bg-stampa-600" />
            </div>
            <form onSubmit={sendCode} className="space-y-3">
              <TextInput
                label="La tua email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@esempio.it"
              />
              {askInvite && (
                <TextInput
                  label="Codice invito della lega"
                  hint="Te lo dà chi ha creato la lega: sono 6 caratteri, gli stessi del link d’invito."
                  autoComplete="off"
                  autoCapitalize="characters"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  placeholder="ABC234"
                />
              )}
              {/* L'azione principale della pagina: il pulsante rosso */}
              <Button
                type="submit"
                variant="accent"
                className="min-h-12 w-full"
                disabled={busy || !email.trim()}
              >
                {busy ? 'Invio…' : 'Mandami il codice'}
              </Button>
            </form>
            <p className="text-[0.95rem] leading-snug text-stampa-700 dark:text-stampa-200">
              Ti arrivano 6 cifre da scrivere qui.{' '}
              {/* Nell'app installata su iPhone Google si apre nel browser e l'accesso resta lì */}
              {emailFirst && (
                <em>
                  Nell’app installata su iPhone usa il <strong>codice via email</strong>: con Google l’accesso
                  si apre nel browser e l’app resta fuori.
                </em>
              )}
            </p>
          </>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-[0.95rem] leading-snug">
              Ti abbiamo mandato un codice a <strong>{sentTo}</strong>. Scrivilo qui.
            </p>
            <TextInput
              label="Codice"
              autoComplete="one-time-code"
              inputMode="numeric"
              autoFocus
              required
              value={code}
              onChange={(e) => setCode(normalizeOtp(e.target.value))}
              placeholder="123456"
              className="tracking-[0.4em]"
            />
            <Button
              type="submit"
              variant="accent"
              className="min-h-12 w-full"
              disabled={busy || code.length < 6}
            >
              {busy ? 'Controllo…' : 'Entra'}
            </Button>
            <div className="flex flex-wrap justify-between gap-2">
              <Button type="button" variant="ghost" onClick={() => setSentTo(null)}>
                Cambia email
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={busy || wait > 0}
                onClick={() => void sendCode()}
              >
                {wait > 0 ? `Rimanda tra ${wait} s` : 'Rimanda il codice'}
              </Button>
            </div>
          </form>
        )}
        <ErrorText>{error}</ErrorText>
      </section>

      <footer className="mt-auto flex flex-col items-center text-center text-[0.875rem] sm:mt-4">
        <span className="italic">Un gioco privato tra amici.</span>
        <a href="./privacy.html" className={ROW_LINK}>
          Informativa privacy
        </a>
      </footer>
    </main>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <path
        fill="#4285F4"
        d="M22.6 12.3c0-.8-.1-1.5-.2-2.3H12v4.3h5.9a5 5 0 0 1-2.2 3.3v2.8h3.6c2.1-1.9 3.3-4.8 3.3-8.1z"
      />
      <path
        fill="#34A853"
        d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1a6.5 6.5 0 0 1-6.1-4.5H2.2v2.9A11 11 0 0 0 12 23z"
      />
      <path fill="#FBBC05" d="M5.9 14.1a6.6 6.6 0 0 1 0-4.2V7H2.2a11 11 0 0 0 0 9.9l3.7-2.8z" />
      <path
        fill="#EA4335"
        d="M12 5.4c1.6 0 3.1.6 4.2 1.7l3.2-3.2A11 11 0 0 0 2.2 7l3.7 2.9A6.5 6.5 0 0 1 12 5.4z"
      />
    </svg>
  );
}
