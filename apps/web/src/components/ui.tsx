// Pezzi d'interfaccia comuni.
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

export function Button({
  variant = 'primary',
  className = '',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  const styles = {
    primary: 'bg-orange-600 text-white hover:bg-orange-700 disabled:bg-orange-300',
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
