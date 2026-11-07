// Menu della lega in basso su telefono (sotto sm): quattro voci principali più "Altro", che apre le altre pagine
// sopra la barra. Da sm in su resta il menu in alto (Layout). La barra tiene conto dell'area sicura in basso; la
// barra Salva di Squadra e i messaggi in basso le stanno sopra (classe dock-above-nav in index.css).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';

export interface LeagueLink {
  to: string;
  label: string;
}

/** Voci principali della barra in basso (scelte dall'utente: le pagine di ogni turno). */
export const MAIN_LINKS = ['', 'squadra', 'mercato', 'risultati'];

const ICON: Record<string, ReactNode> = {
  '': <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  squadra: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9" />
    </>
  ),
  mercato: <path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />,
  risultati: <path d="M4 20V10M10 20V4M16 20v-8M22 20H2" />,
  altro: (
    <>
      <circle cx="5" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="19" cy="12" r="1.5" />
    </>
  ),
};

function Icon({ name }: { name: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="size-6"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON[name]}
    </svg>
  );
}

const ITEM = 'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 px-1 text-xs font-medium';
const tone = (active: boolean) =>
  active
    ? 'text-orange-700 dark:text-orange-300'
    : 'text-slate-600 hover:text-slate-900 dark:text-slate-300 dark:hover:text-white';

const href = (id: string, to: string) => (to ? `/lega/${id}/${to}` : `/lega/${id}`);

export function BottomNav({ id, links }: { id: string; links: readonly LeagueLink[] }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLAnchorElement>(null);
  const main = links.filter((l) => MAIN_LINKS.includes(l.to));
  const more = links.filter((l) => !MAIN_LINKS.includes(l.to));
  const moreActive = more.some((l) => pathname.startsWith(href(id, l.to)));

  // Cambiando pagina il pannello si chiude
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    first.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <nav
      aria-label="Menu della lega"
      // Fondo pieno, senza backdrop-blur: un filtro renderebbe la barra il riferimento dei figli fixed (il velo che
      // chiude il pannello toccando fuori deve coprire tutto lo schermo). Con il pannello aperto la barra sta sopra
      // i messaggi in basso (z-40), che altrimenti coprirebbero le ultime voci
      className={`fixed inset-x-0 bottom-0 ${open ? 'z-50' : 'z-20'} border-t border-slate-200 bg-white pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] sm:hidden dark:border-slate-700 dark:bg-slate-900`}
    >
      {open && (
        <>
          {/* Tocco fuori dal pannello: si chiude */}
          <div aria-hidden="true" className="fixed inset-0 -z-10" onClick={() => setOpen(false)} />
          <ul
            id={panelId}
            className="absolute right-2 bottom-full mb-2 w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-1 shadow-lg dark:border-slate-700 dark:bg-slate-800"
          >
            {more.map((l, i) => (
              <li key={l.to}>
                <NavLink
                  ref={i === 0 ? first : undefined}
                  to={href(id, l.to)}
                  className={({ isActive }) =>
                    `flex min-h-11 items-center px-4 text-sm ${isActive ? 'font-semibold text-orange-700 dark:text-orange-300' : 'text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700'}`
                  }
                >
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </>
      )}
      <ul className="flex">
        {main.map((l) => (
          <li key={l.to} className="flex flex-1">
            <NavLink
              to={href(id, l.to)}
              end={l.to === ''}
              className={({ isActive }) => `${ITEM} ${tone(isActive)}`}
            >
              <Icon name={l.to} />
              {l.label}
            </NavLink>
          </li>
        ))}
        <li className="flex flex-1">
          <button
            ref={button}
            type="button"
            aria-expanded={open}
            aria-controls={panelId}
            aria-current={moreActive ? 'page' : undefined}
            onClick={() => setOpen((o) => !o)}
            className={`${ITEM} ${tone(open || moreActive)}`}
          >
            <Icon name="altro" />
            Altro
          </button>
        </li>
      </ul>
    </nav>
  );
}
