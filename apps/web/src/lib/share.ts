// Condivisione di un testo (riepilogo del turno, cerimonia di fine stagione): con il pannello del sistema
// (navigator.share, per esempio verso il gruppo WhatsApp) dove c'è, altrimenti copiato negli appunti.

interface ShareNavigator {
  share?: (data: { title?: string; text?: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
}

/**
 * Esito: shared (inviato dal pannello del sistema), copied (negli appunti), cancelled (il manager ha chiuso il
 * pannello: niente messaggi), failed (né l'uno né l'altro).
 */
export type ShareResult = 'shared' | 'copied' | 'cancelled' | 'failed';

export async function shareText(
  text: string,
  title: string,
  nav: ShareNavigator = navigator as ShareNavigator,
): Promise<ShareResult> {
  if (typeof nav.share === 'function') {
    try {
      await nav.share({ title, text });
      return 'shared';
    } catch (e) {
      // Pannello chiuso senza scegliere: non si copia di nascosto
      if (e instanceof Error && e.name === 'AbortError') return 'cancelled';
      // Condivisione non permessa (per esempio fuori da un tocco): si prova con gli appunti
    }
  }
  try {
    if (!nav.clipboard) return 'failed';
    await nav.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

/** Messaggio da mostrare in basso dopo la condivisione (null: niente da dire). */
export function shareMessage(r: ShareResult): { ok: boolean; text: string } | null {
  if (r === 'copied')
    return {
      ok: true,
      text: 'Copiato negli appunti: incollalo dove vuoi, per esempio nel gruppo della lega.',
    };
  if (r === 'failed') return { ok: false, text: 'Non si riesce né a condividere né a copiare il testo.' };
  return null;
}

/** Indirizzo di una pagina dell'app ("#/lega/<id>"), da mettere in fondo ai testi condivisi. */
export function appLink(
  hashPath: string,
  loc: Pick<Location, 'origin' | 'pathname'> = window.location,
): string {
  return `${loc.origin}${loc.pathname}#${hashPath}`;
}
