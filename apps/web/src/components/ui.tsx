// Pezzi d'interfaccia comuni.
import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

/**
 * Pulsanti nello stile Edicola: maiuscolo stretto e angoli vivi. primary è d'inchiostro; accent è il rosso, per
 * l'azione principale della pagina (Sono pronto): uno per pagina, perché il rosso segna anche gli avvisi; danger
 * è il rosso scuro delle azioni che non si annullano; ghost è un link in corsivo sottolineato.
 */
export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  const styles = {
    primary:
      'bg-stampa-900 text-stampa-25 hover:bg-stampa-700 disabled:bg-stampa-400 dark:bg-stampa-100 dark:text-stampa-900 dark:hover:bg-stampa-50 dark:disabled:bg-stampa-600',
    accent:
      'bg-rosso-600 text-white hover:bg-rosso-700 disabled:bg-rosso-300 dark:bg-rosso-500 dark:hover:bg-rosso-600 dark:disabled:bg-rosso-900',
    danger:
      'bg-rosso-700 text-white hover:bg-rosso-800 disabled:bg-rosso-300 dark:bg-rosso-500 dark:hover:bg-rosso-600 dark:disabled:bg-rosso-900',
    secondary:
      'border border-stampa-900 bg-transparent text-stampa-900 hover:bg-stampa-100 disabled:border-stampa-300 disabled:text-stampa-400 dark:border-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-800 dark:disabled:border-stampa-700',
    ghost:
      'text-stampa-800 underline underline-offset-4 hover:bg-stampa-100 dark:text-stampa-100 dark:hover:bg-stampa-800',
  }[variant];
  const type =
    variant === 'ghost'
      ? 'font-serif text-[0.95rem] font-semibold italic'
      : 'font-titolo text-[0.95rem] font-semibold tracking-wider uppercase';
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 py-2 transition-colors disabled:cursor-not-allowed ${type} ${styles} ${className}`}
      {...props}
    />
  );
}

/** Etichetta dei campi e dei gruppi di scelte: maiuscolo stretto, come le testatine del giornale. */
const FIELD_LABEL =
  'font-titolo text-xs font-semibold tracking-widest uppercase text-stampa-800 dark:text-stampa-100';

/**
 * Pulsante da toccare due volte per le azioni che non si annullano con un tocco: il primo chiede conferma
 * (confirmLabel), il secondo esegue. Dopo 5 secondi senza conferma torna com'era. Il cambio di etichetta lo
 * annuncia ai lettori di schermo una regione nascosta, sempre presente (confirmAnnouncement).
 */
export function ConfirmButton({
  confirmLabel,
  onConfirm,
  children,
  ...props
}: Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onClick'> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  confirmLabel: string;
  onConfirm: () => void;
}) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), CONFIRM_MS);
    return () => clearTimeout(t);
  }, [armed]);
  return (
    <>
      <Button
        {...props}
        onClick={() => {
          if (!armed) return setArmed(true);
          setArmed(false);
          onConfirm();
        }}
      >
        {armed ? confirmLabel : children}
      </Button>
      {/* Fuori dal flusso (sr-only è absolute): non sposta i pulsanti vicini */}
      <span role="status" className="sr-only">
        {confirmAnnouncement(armed, confirmLabel)}
      </span>
    </>
  );
}

export const CONFIRM_MS = 5000;

/** Che cosa sentono i lettori di schermo quando il pulsante chiede conferma (niente quando torna com'era). */
export function confirmAnnouncement(armed: boolean, confirmLabel: string): string {
  return armed ? `${confirmLabel} Tocca di nuovo entro ${CONFIRM_MS / 1000} secondi per confermare.` : '';
}

export function TextInput({
  label,
  hint,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className={FIELD_LABEL}>{label}</span>
      <input
        className="mt-1 block min-h-11 w-full rounded-sm border border-stampa-900 bg-stampa-25 px-3 py-2 text-base text-stampa-900 focus:ring-2 focus:ring-rosso-200 focus:outline-none dark:border-stampa-300 dark:bg-stampa-800 dark:text-stampa-50 dark:focus:ring-rosso-900"
        {...props}
      />
      {hint && (
        <span className="mt-1 block text-[0.8125rem] text-stampa-500 italic dark:text-stampa-400">
          {hint}
        </span>
      )}
    </label>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`border border-stampa-900 bg-stampa-25 p-4 sm:p-6 dark:border-stampa-600 dark:bg-stampa-800 ${className}`}
    >
      {children}
    </section>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  return (
    <p
      role="alert"
      className="border-2 border-rosso-600 bg-stampa-25 px-3 py-2 text-sm text-rosso-800 dark:border-rosso-300 dark:bg-stampa-800 dark:text-rosso-200"
    >
      {children}
    </p>
  );
}

export function Spinner({ label = 'Caricamento…' }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-stampa-500 italic dark:text-stampa-400" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-stampa-300 border-t-rosso-600" />
      {label}
    </p>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-3xl leading-tight font-bold text-stampa-900 dark:text-stampa-50">{children}</h1>
      {sub && <p className="mt-1 text-sm text-stampa-600 italic dark:text-stampa-300">{sub}</p>}
    </header>
  );
}

export function Choice<T extends string | number | null>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T; disabled?: boolean; note?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <fieldset>
      <legend className={FIELD_LABEL}>{label}</legend>
      <div className="mt-2 grid gap-2">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={`flex min-h-11 items-center gap-3 rounded-sm border px-3 py-2 text-sm ${
              o.value === value
                ? 'border-stampa-900 bg-stampa-25 ring-1 ring-stampa-900 dark:border-stampa-100 dark:bg-stampa-800 dark:ring-stampa-100'
                : 'border-stampa-300 dark:border-stampa-600'
            } ${o.disabled ? 'opacity-50' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              className="accent-stampa-900 dark:accent-stampa-100"
              checked={o.value === value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span>
              {o.label}
              {o.note && <span className="block text-xs text-stampa-500 dark:text-stampa-400">{o.note}</span>}
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

/** Scelta tra poche viste (es. Conference / Division): pulsanti affiancati. */
export function Segmented<T extends string | number>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: T }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap border border-stampa-900 dark:border-stampa-100"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 min-w-11 px-3 font-titolo text-sm font-semibold tracking-wider uppercase ${
            o.value === value
              ? 'bg-stampa-900 text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900'
              : 'text-stampa-700 hover:bg-stampa-100 dark:text-stampa-200 dark:hover:bg-stampa-800'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export interface ToastMessage {
  ok: boolean;
  text: string;
}

/** Millisecondi per cui resta un messaggio di conferma. */
export const TOAST_MS = 6000;

/** Gli errori restano di più, ma non coprono per sempre il fondo della pagina: si chiudono anche prima. */
export const TOAST_ERROR_MS = 15000;

/** Per quanto resta un messaggio prima di chiudersi da solo. */
export const toastDuration = (m: ToastMessage): number => (m.ok ? TOAST_MS : TOAST_ERROR_MS);

/**
 * Esito di un'azione in un avviso fisso in basso, visibile in qualunque punto della pagina (su telefono il
 * pulsante premuto può essere molto più in basso dell'inizio della pagina). I contenitori restano sempre nella
 * pagina perché i lettori di schermo annuncino i messaggi nuovi: le conferme con calma (status), gli errori
 * subito (alert).
 */
export function Toast({ message, onClose }: { message: ToastMessage | null; onClose: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onClose, toastDuration(message));
    return () => clearTimeout(t);
  }, [message, onClose]);
  const card = (m: ToastMessage) => (
    <div
      // Conferme d'inchiostro, errori con il bordo rosso: come i riquadri del giornale
      className={`pointer-events-auto flex w-full max-w-lg items-center gap-2 py-1 pr-1 pl-4 text-sm shadow-lg ${
        m.ok
          ? 'bg-stampa-900 text-stampa-25 dark:bg-stampa-100 dark:text-stampa-900'
          : 'bg-stampa-25 text-rosso-800 ring-2 ring-rosso-600 dark:bg-stampa-800 dark:text-rosso-200 dark:ring-rosso-300'
      }`}
    >
      <p className="min-w-0 flex-1 py-2">{m.text}</p>
      <button
        type="button"
        aria-label="Chiudi il messaggio"
        onClick={onClose}
        className="inline-flex size-11 shrink-0 items-center justify-center hover:bg-black/10 dark:hover:bg-white/10"
      >
        ✕
      </button>
    </div>
  );
  return (
    <div className="dock-above-nav pointer-events-none fixed inset-x-0 bottom-0 z-40 flex flex-col items-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div role="status" aria-live="polite" className="flex w-full justify-center">
        {message?.ok && card(message)}
      </div>
      <div role="alert" className="flex w-full justify-center">
        {message && !message.ok && card(message)}
      </div>
    </div>
  );
}

/** Sigla della squadra in un riquadro: piena d'inchiostro la propria (strong), a filo le altre. */
export function TeamCode({ code, strong = false }: { code: string; strong?: boolean }) {
  return (
    <span
      className={`inline-block w-11 shrink-0 border px-1 text-center font-titolo text-[0.8125rem] font-semibold tracking-wide ${
        strong
          ? 'border-stampa-900 bg-stampa-900 text-stampa-25 dark:border-stampa-100 dark:bg-stampa-100 dark:text-stampa-900'
          : 'border-stampa-900 text-stampa-900 dark:border-stampa-300 dark:text-stampa-100'
      }`}
    >
      {code}
    </span>
  );
}
