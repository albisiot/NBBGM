// Accesso: Google oppure codice di 6 cifre via email (niente link magico: su iPhone si aprirebbe in Safari e
// non nella PWA installata).
import { useEffect, useState, type FormEvent } from 'react';
import { Button, Card, ErrorText, TextInput } from '../components/ui.tsx';
import { friendlyError, normalizeOtp } from '../lib/errors.ts';
import { supabase } from '../lib/supabase.ts';

const RESEND_SECONDS = 60;

export function LoginPage() {
  const [email, setEmail] = useState('');
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wait, setWait] = useState(0);

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
    const { error } = await supabase.auth.signInWithOtp({
      email: address,
      options: { shouldCreateUser: true },
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
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
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin + window.location.pathname },
    });
    if (error) setError(friendlyError(error));
  }

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-10">
      <div className="mb-6 text-center">
        <p className="text-4xl" aria-hidden>
          🏀
        </p>
        <h1 className="mt-2 text-3xl font-bold text-slate-900 dark:text-slate-50">NBBGM</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
          Il manageriale di basket a turni da giocare con gli amici.
        </p>
      </div>

      <Card className="space-y-4">
        {sentTo === null ? (
          <>
            <Button variant="secondary" className="w-full" onClick={google}>
              <GoogleIcon /> Continua con Google
            </Button>
            <div className="flex items-center gap-3 text-xs text-slate-400">
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" /> oppure{' '}
              <span className="h-px flex-1 bg-slate-200 dark:bg-slate-700" />
            </div>
            <form onSubmit={sendCode} className="space-y-3">
              <TextInput
                label="Email"
                type="email"
                autoComplete="email"
                inputMode="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="nome@esempio.it"
              />
              <Button type="submit" className="w-full" disabled={busy || !email.trim()}>
                {busy ? 'Invio…' : 'Mandami il codice'}
              </Button>
            </form>
          </>
        ) : (
          <form onSubmit={verify} className="space-y-3">
            <p className="text-sm text-slate-700 dark:text-slate-300">
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
            <Button type="submit" className="w-full" disabled={busy || code.length < 6}>
              {busy ? 'Controllo…' : 'Entra'}
            </Button>
            <div className="flex justify-between">
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
      </Card>
      <p className="mt-6 text-center text-xs text-slate-500 dark:text-slate-400">
        Un gioco privato tra amici.{' '}
        <a href="./privacy.html" className="underline hover:text-slate-700 dark:hover:text-slate-200">
          Informativa privacy
        </a>
      </p>
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
