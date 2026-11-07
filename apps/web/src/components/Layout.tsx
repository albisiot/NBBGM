// Testata con il selettore delle leghe e il profilo, il menu della lega aperta, poi la pagina.
import { Suspense, useEffect, useRef } from 'react';
import { Link, Outlet, useLocation, useMatch, useNavigate } from 'react-router';
import { useAuth, useUserId } from '../lib/auth.tsx';
import { refreshAppBadge } from '../lib/appBadge.ts';
import { activeLink, LEAGUE_LINKS, leagueHref } from '../lib/leagueNav.ts';
import { LAST_LEAGUE_KEY, myLeagues, type MyLeague } from '../lib/leagues.ts';
import { lazyPart } from '../lib/lazyPage.ts';
import { initials, mastheadDate } from '../lib/masthead.ts';
import { navScrollDelta } from '../lib/navScroll.ts';
import { watchPushSubscription } from '../lib/pushWatch.ts';
import { onResume } from '../lib/resume.ts';
import { useAsync } from '../lib/useAsync.ts';
import { BottomNav } from './BottomNav.tsx';
import { Spinner } from './ui.tsx';
import { UpdateBanner } from './UpdateBanner.tsx';

// La barra del turno arriva a pezzi come le pagine: all'avvio (pagina d'accesso, elenco delle leghe) non serve
const TurnBar = lazyPart(() => import('./TurnBar.tsx'), 'TurnBar');

export function Layout() {
  const userId = useUserId();
  const { displayName } = useAuth();
  const match = useMatch('/lega/:id/*');
  const current = match?.params.id ?? '';
  // Nella pagina della lega c'è la scheda del turno completa: la barra serve sulle altre
  const leagueHome = useMatch('/lega/:id') !== null;
  // Testata intera nell'elenco delle leghe e nella pagina della lega
  const listPage = useMatch('/') !== null;
  const full = leagueHome || listPage;
  // Si rilegge a ogni cambio di lega (per esempio dopo esserne entrati), tenendo l'elenco intanto
  const { data: leagues } = useAsync(() => myLeagues(userId), [userId, current], { keep: true });
  // Numero delle decisioni aperte sull'icona dell'app: all'avvio e al ritorno in primo piano
  useEffect(() => {
    refreshAppBadge();
    return onResume(refreshAppBadge);
  }, [userId]);
  // Notifiche: l'iscrizione del dispositivo si riallinea con il server all'avvio e quando il browser la cambia
  useEffect(() => watchPushSubscription(userId), [userId]);

  return (
    <div
      className={`min-h-dvh bg-stampa-50 text-stampa-900 dark:bg-stampa-900 dark:text-stampa-50 ${current ? 'has-bottom-nav' : ''}`}
    >
      {/* Testata del giornale: intera nell'elenco delle leghe e nella pagina della lega (NBBGM grande, data, lega),
          su una riga sola e fissa in alto nelle altre pagine, dove serve spazio. Sopra lascia --spazio-alto
          (index.css): su iPhone la fascia appena sotto la barra di stato è sfumata dal sistema */}
      <header
        className={`${full ? '' : 'sticky top-0'} z-10 bg-stampa-50 pt-(--spazio-alto) pr-[env(safe-area-inset-right)] pl-[env(safe-area-inset-left)] dark:bg-stampa-900`}
      >
        <div className="mx-auto max-w-4xl px-4">
          {full ? (
            <>
              <div className="flex items-center gap-2 pt-2">
                <span aria-hidden="true" className="size-11 shrink-0" />
                <Link
                  to="/"
                  className="flex-1 text-center font-titolo text-[2rem] leading-none font-bold tracking-wide sm:text-5xl"
                >
                  NBBGM
                </Link>
                <ProfileLink name={displayName} />
              </div>
              <div className="mt-2 h-1 border-t-2 border-b border-stampa-900 dark:border-stampa-100" />
              <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 text-sm">
                <span className="italic">{mastheadDate(new Date())}</span>
                <LeagueSelect leagues={leagues} current={current} />
              </div>
              <div className="h-px bg-stampa-900 dark:bg-stampa-100" />
            </>
          ) : (
            <div className="flex min-h-[3.25rem] items-center gap-2 border-b-4 border-double border-stampa-900 dark:border-stampa-100">
              <Link to="/" className="font-titolo text-[1.375rem] font-bold tracking-wide">
                NBBGM
              </Link>
              <LeagueSelect leagues={leagues} current={current} grow />
              <ProfileLink name={displayName} />
            </div>
          )}
        </div>
        {current && <LeagueNav id={current} />}
        <UpdateBanner />
      </header>
      <main className="main-above-nav mx-auto max-w-4xl pt-6 pr-[max(1rem,env(safe-area-inset-right))] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[max(1rem,env(safe-area-inset-left))]">
        {/* Le pagine arrivano a pezzi (lib/lazyPage.ts): intanto l'intestazione resta e sotto si vede il caricamento */}
        {current && !leagueHome && (
          <Suspense fallback={null}>
            <TurnBar leagueId={current} userId={userId} />
          </Suspense>
        )}
        <Suspense fallback={<Spinner />}>
          <Outlet />
        </Suspense>
      </main>
      {/* Su telefono il menu della lega sta in basso (quattro voci e Altro); da sm in su in alto */}
      {current && <BottomNav id={current} />}
    </div>
  );
}

/** Le leghe dell'utente, come testo nella testata: si cambia lega da qui. */
function LeagueSelect({
  leagues,
  current,
  grow = false,
}: {
  leagues: MyLeague[] | null | undefined;
  current: string;
  grow?: boolean;
}) {
  const navigate = useNavigate();
  if (!leagues || leagues.length === 0) return grow ? <span className="flex-1" /> : null;
  return (
    <span className={`relative flex min-w-0 items-center ${grow ? 'flex-1 justify-end' : ''}`}>
      <select
        aria-label="Lega"
        className="min-h-11 max-w-full min-w-0 cursor-pointer appearance-none truncate border-0 bg-transparent py-0 pr-6 pl-1 text-right text-sm font-semibold text-stampa-900 dark:text-stampa-50"
        value={current}
        onChange={(e) => {
          const id = e.target.value;
          if (!id) return navigate('/');
          try {
            localStorage.setItem(LAST_LEAGUE_KEY, id);
          } catch {
            // Senza memoria del browser si ricomincia dall'elenco
          }
          navigate(`/lega/${id}`);
        }}
      >
        <option value="">Le tue leghe</option>
        {leagues.map((l) => (
          <option key={l.leagueId} value={l.leagueId}>
            {l.name} · {l.teamCode}
          </option>
        ))}
      </select>
      <svg
        aria-hidden="true"
        viewBox="0 0 24 24"
        className="pointer-events-none absolute right-0 size-4"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      >
        <path d="m6 9 6 6 6-6" />
      </svg>
    </span>
  );
}

/** Il profilo in un riquadro con le iniziali. */
function ProfileLink({ name }: { name: string }) {
  const short = initials(name);
  return (
    <Link
      to="/profilo"
      aria-label={name ? `Profilo di ${name}` : 'Profilo'}
      className="inline-flex size-11 shrink-0 items-center justify-center border border-stampa-900 font-titolo text-sm font-semibold hover:bg-stampa-100 dark:border-stampa-100 dark:hover:bg-stampa-800"
    >
      {short || (
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className="size-5"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
        >
          <circle cx="12" cy="8" r="4" />
          <path d="M4 21a8 8 0 0 1 16 0" />
        </svg>
      )}
    </Link>
  );
}

function LeagueNav({ id }: { id: string }) {
  const nav = useRef<HTMLElement>(null);
  const { pathname } = useLocation();
  // Voce attiva anche per le pagine sotto una voce (Campionato: risultati, classifica, playoff, partite)
  const active = activeLink(pathname, id);
  // La voce della pagina aperta in vista (su telefono il menu scorre): solo il menu, non la pagina
  useEffect(() => {
    const el = nav.current;
    const current = el?.querySelector('[aria-current="page"]');
    if (!el || !current) return;
    const delta = navScrollDelta(el.getBoundingClientRect(), current.getBoundingClientRect());
    if (delta !== 0) el.scrollLeft += delta;
  }, [pathname, id]);
  // Le sezioni del giornale: maiuscolo stretto, la pagina aperta in rosso con il filetto sotto
  return (
    <nav
      ref={nav}
      aria-label="Menu della lega"
      className="mx-auto hidden max-w-4xl overflow-x-auto border-b border-stampa-900 px-2 sm:block dark:border-stampa-100"
    >
      <ul className="flex justify-center gap-x-5 font-titolo text-[0.95rem] tracking-widest uppercase">
        {LEAGUE_LINKS.map((l) => (
          <li key={l.key}>
            <Link
              to={leagueHref(id, l.to)}
              aria-current={active === l.key ? 'page' : undefined}
              className={`inline-flex min-h-11 items-center border-b-[3px] whitespace-nowrap ${
                active === l.key
                  ? 'border-rosso-600 font-semibold text-rosso-700 dark:border-rosso-300 dark:text-rosso-300'
                  : 'border-transparent text-stampa-700 hover:text-stampa-900 dark:text-stampa-200 dark:hover:text-stampa-50'
              }`}
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
