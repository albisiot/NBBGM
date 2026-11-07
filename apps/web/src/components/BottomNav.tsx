// Menu della lega in basso su telefono (sotto sm): quattro voci principali più "Altro", che apre le altre pagine
// sopra la barra. Da sm in su resta il menu in alto (Layout). La barra è staccata dai bordi e tiene conto delle aree
// sicure; la barra Salva di Squadra e i messaggi in basso le stanno sopra (classe dock-above-nav in index.css).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router';
import { activeLink, LEAGUE_LINKS, leagueHref, MAIN_LINKS } from '../lib/leagueNav.ts';

// Icone delle voci principali, disegnate in linea (tratto di 1,8 su 24 × 24)
const ICON: Record<string, ReactNode> = {
  lega: <path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  squadra: (
    <>
      <circle cx="9" cy="7" r="4" />
      <path d="M2 21v-2a4 4 0 0 1 4-4h6a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8M22 21v-2a4 4 0 0 0-3-3.9" />
    </>
  ),
  mercato: <path d="m17 2 4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3" />,
  // Coppa: risultati, classifica e playoff
  campionato: (
    <path d="M7 3h10v6a5 5 0 0 1-10 0zM7 5H4v1.5A3.5 3.5 0 0 0 7.5 10M17 5h3v1.5a3.5 3.5 0 0 1-3.5 3.5M12 14v4M8 21h8M9.5 18h5" />
  ),
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
      className="size-[1.375rem]"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICON[name]}
    </svg>
  );
}

// Barra scura staccata dai bordi, con la voce aperta in una pillola rossa (stile Edicola)
const ITEM =
  'flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl px-1 font-titolo text-xs font-medium tracking-wider uppercase';
const tone = (active: boolean) =>
  active ? 'bg-rosso-600 text-white dark:bg-rosso-500' : 'text-stampa-200 hover:text-stampa-50';

export function BottomNav({ id }: { id: string }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const button = useRef<HTMLButtonElement>(null);
  const first = useRef<HTMLAnchorElement>(null);
  const main = LEAGUE_LINKS.filter((l) => MAIN_LINKS.includes(l.key));
  const more = LEAGUE_LINKS.filter((l) => !MAIN_LINKS.includes(l.key));
  // Voce attiva anche per le pagine sotto una voce (Campionato: risultati, classifica, playoff, partite)
  const active = activeLink(pathname, id);
  const moreActive = more.some((l) => l.key === active);

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
      // Staccata di 0,75rem dai lati e 0,625rem dal fondo, più le aree sicure: alta 4,25rem (index.css ne tiene conto)
      className={`fixed right-[calc(0.75rem+env(safe-area-inset-right))] bottom-[calc(0.625rem+env(safe-area-inset-bottom))] left-[calc(0.75rem+env(safe-area-inset-left))] ${open ? 'z-50' : 'z-20'} rounded-[1.375rem] bg-stampa-900 p-1.5 shadow-lg sm:hidden dark:bg-stampa-800 dark:ring-1 dark:ring-stampa-700`}
    >
      {open && (
        <>
          {/* Tocco fuori dal pannello: si chiude */}
          <div aria-hidden="true" className="fixed inset-0 -z-10" onClick={() => setOpen(false)} />
          <ul
            id={panelId}
            className="absolute right-0 bottom-full mb-2 w-56 overflow-hidden border border-stampa-900 bg-stampa-25 py-1 shadow-lg dark:border-stampa-600 dark:bg-stampa-800"
          >
            {more.map((l, i) => (
              <li key={l.key}>
                <Link
                  ref={i === 0 ? first : undefined}
                  to={leagueHref(id, l.to)}
                  aria-current={active === l.key ? 'page' : undefined}
                  className={`flex min-h-11 items-center px-4 font-titolo text-sm tracking-wider uppercase ${active === l.key ? 'font-semibold text-rosso-700 dark:text-rosso-300' : 'text-stampa-800 hover:bg-stampa-100 dark:text-stampa-100 dark:hover:bg-stampa-700'}`}
                >
                  {l.label}
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <ul className="flex">
        {main.map((l) => (
          <li key={l.key} className="flex flex-1">
            <Link
              to={leagueHref(id, l.to)}
              aria-current={active === l.key ? 'page' : undefined}
              className={`${ITEM} ${tone(active === l.key)}`}
            >
              <Icon name={l.key} />
              {l.label}
            </Link>
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
