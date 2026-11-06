// Installazione dell'app sulla schermata Home: su iPhone e iPad si fa a mano (Condividi → Aggiungi alla
// schermata Home), su Android e sui computer con Chrome il browser lo propone con l'evento beforeinstallprompt,
// che va preso subito all'avvio (arriva una volta sola) e usato dopo un tocco del manager.
import { useSyncExternalStore } from 'react';

export interface PlatformInfo {
  userAgent: string;
  /** Touch su un "Macintosh": l'iPad con Safari si presenta come un Mac. */
  maxTouchPoints: number;
  /** L'app è aperta come app installata, non in una scheda del browser. */
  standalone: boolean;
}

/** iPhone, iPad o iPod (anche l'iPad che si presenta come Mac). */
export function isIos(p: Pick<PlatformInfo, 'userAgent' | 'maxTouchPoints'>): boolean {
  return /iPhone|iPad|iPod/.test(p.userAgent) || (/Macintosh/.test(p.userAgent) && p.maxTouchPoints > 1);
}

/**
 * Che suggerimento dare per installare l'app: niente se è già installata; su iPhone e iPad le istruzioni a mano
 * (solo da Safari si può aggiungere alla schermata Home; da un'altra app si apre prima in Safari); dove il browser
 * lo permette il pulsante Installa; altrimenti niente.
 */
export function installAdvice(
  p: PlatformInfo,
  canPrompt: boolean,
): 'ios' | 'ios-other-browser' | 'prompt' | null {
  if (p.standalone) return null;
  if (isIos(p)) return /CriOS|FxiOS|EdgiOS|GSA\//.test(p.userAgent) ? 'ios-other-browser' : 'ios';
  return canPrompt ? 'prompt' : null;
}

/** Nell'app installata su iPhone il login con Google si apre nel browser: conviene il codice via email. */
export function preferEmailCode(p: PlatformInfo): boolean {
  return p.standalone && isIos(p);
}

export function currentPlatform(): PlatformInfo {
  const standalone =
    (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints ?? 0, standalone };
}

// ---------------------------------------------------------------- beforeinstallprompt

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => {
  for (const l of listeners) l();
};

/** Da chiamare all'avvio: tiene da parte la proposta d'installazione del browser per il pulsante Installa. */
export function captureInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    notify();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    notify();
  });
}

/** C'è una proposta d'installazione del browser da mostrare. */
export function useCanPromptInstall(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => deferred !== null,
    () => false,
  );
}

/** Mostra la proposta d'installazione del browser (dopo un tocco del manager). */
export async function promptInstall(): Promise<boolean> {
  const e = deferred;
  if (!e) return false;
  deferred = null;
  notify();
  await e.prompt();
  return (await e.userChoice).outcome === 'accepted';
}

// ---------------------------------------------------------------- suggerimenti già visti

/** Legge un segno "già visto" dalla memoria del browser; senza memoria vale come non visto. */
export function seen(key: string): boolean {
  try {
    return localStorage.getItem(key) !== null;
  } catch {
    return false;
  }
}

export function markSeen(key: string): void {
  try {
    localStorage.setItem(key, String(Date.now()));
  } catch {
    // Senza memoria del browser il suggerimento tornerà la prossima volta
  }
}

export const INSTALL_HINT_KEY = 'nbbgm:installa-visto';
export const welcomeKey = (leagueId: string) => `nbbgm:benvenuto:${leagueId}`;
