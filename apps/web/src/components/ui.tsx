// Pezzi d'interfaccia comuni.
import {
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
} from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  const styles = {
    primary: 'bg-orange-600 text-white hover:bg-orange-700 disabled:bg-orange-300',
    danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300 dark:disabled:bg-red-900',
    secondary:
      'border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 disabled:text-slate-400 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 dark:hover:bg-slate-700',
    ghost: 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
  }[variant];
  return (
    <button
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${styles} ${className}`}
      {...props}
    />
  );
}

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
      <span className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</span>
      <input
        className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-base text-slate-900 shadow-sm focus:border-orange-500 focus:ring-2 focus:ring-orange-200 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 dark:focus:ring-orange-900"
        {...props}
      />
      {hint && <span className="mt-1 block text-xs text-slate-500 dark:text-slate-400">{hint}</span>}
    </label>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={`rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6 dark:border-slate-700 dark:bg-slate-800 ${className}`}
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
      className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-200"
    >
      {children}
    </p>
  );
}

export function Spinner({ label = 'Caricamento…' }: { label?: string }) {
  return (
    <p className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400" role="status">
      <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-orange-600" />
      {label}
    </p>
  );
}

export function PageTitle({ children, sub }: { children: ReactNode; sub?: ReactNode }) {
  return (
    <header className="mb-4">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-50">{children}</h1>
      {sub && <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{sub}</p>}
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
      <legend className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</legend>
      <div className="mt-2 grid gap-2">
        {options.map((o) => (
          <label
            key={String(o.value)}
            className={`flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-sm ${
              o.value === value
                ? 'border-orange-500 bg-orange-50 dark:bg-orange-950'
                : 'border-slate-200 dark:border-slate-700'
            } ${o.disabled ? 'opacity-50' : 'cursor-pointer'}`}
          >
            <input
              type="radio"
              className="accent-orange-600"
              checked={o.value === value}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
            />
            <span>
              {o.label}
              {o.note && <span className="block text-xs text-slate-500 dark:text-slate-400">{o.note}</span>}
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
      className="inline-flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1 dark:bg-slate-800"
    >
      {options.map((o) => (
        <button
          key={String(o.value)}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={`min-h-11 min-w-11 rounded-md px-3 text-sm font-medium ${
            o.value === value
              ? 'bg-white text-orange-700 shadow-sm dark:bg-slate-700 dark:text-orange-300'
              : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white'
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
      className={`pointer-events-auto flex w-full max-w-lg items-center gap-2 rounded-xl py-1 pr-1 pl-4 text-sm shadow-lg ring-1 ${
        m.ok
          ? 'bg-green-50 text-green-900 ring-green-200 dark:bg-green-950 dark:text-green-50 dark:ring-green-800'
          : 'bg-red-50 text-red-800 ring-red-200 dark:bg-red-950 dark:text-red-100 dark:ring-red-800'
      }`}
    >
      <p className="min-w-0 flex-1 py-2">{m.text}</p>
      <button
        type="button"
        aria-label="Chiudi il messaggio"
        onClick={onClose}
        className="inline-flex size-11 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 dark:hover:bg-white/10"
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

/** Sigla della squadra in un riquadro. */
export function TeamCode({ code, strong = false }: { code: string; strong?: boolean }) {
  return (
    <span
      className={`inline-block w-11 shrink-0 rounded px-1 text-center text-xs font-bold ${
        strong
          ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-100'
          : 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-200'
      }`}
    >
      {code}
    </span>
  );
}
