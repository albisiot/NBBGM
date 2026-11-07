// Modifiche non salvate nella pagina Squadra (quintetto, minuti, tattiche), condivise con la barra del turno: prima
// di segnarsi pronti l'app chiede se salvarle. Le registra la pagina finché è aperta, con la funzione per salvarle.
// Con lo stile Edicola la barra del turno, finché ci sono, mostra "Da salvare" con i minuti, Annulla e Salva al posto
// del turno e del Pronto (la pagina non ha più la barra Salva in basso).
import { useSyncExternalStore } from 'react';

export interface Unsaved {
  leagueId: string;
  /** Salva le modifiche; true se è andata bene (l'errore lo mostra la pagina). */
  save: () => Promise<boolean>;
  /** Somma dei minuti delle impostazioni modificate: la barra del turno la mostra al posto del turno. */
  minutes?: number;
  /** Quello che impedisce di salvare (minuti che non fanno 240, titolare mancante...), o null. */
  problem?: string | null;
  /** Lascia le modifiche e torna alle impostazioni di prima (Annulla nella barra del turno). */
  discard?: () => void;
}

/** Minuti da distribuire in una partita: 5 giocatori per 48 minuti. */
export const TEAM_MINUTES = 240;

/** I minuti nella barra del turno: "240 su 240 minuti", o quanti ne mancano o ce ne sono di troppo. */
export function minutesLine(total: number): string {
  const head = `${total} su ${TEAM_MINUTES} minuti`;
  const diff = Math.abs(TEAM_MINUTES - total);
  if (diff === 0) return head;
  if (total < TEAM_MINUTES) return `${head}: ${diff === 1 ? 'ne manca 1' : `ne mancano ${diff}`}`;
  return `${head}: ${diff} di troppo`;
}

/**
 * La riga sotto "Da salvare" nella barra del turno: i minuti, in rosso se non fanno 240; con i minuti giusti, in
 * rosso quello che impedisce ancora di salvare.
 */
export function unsavedLine(u: Pick<Unsaved, 'minutes' | 'problem'>): { text: string; alert: boolean } {
  if (u.minutes !== undefined && u.minutes !== TEAM_MINUTES)
    return { text: minutesLine(u.minutes), alert: true };
  if (u.problem) return { text: u.problem, alert: true };
  if (u.minutes !== undefined) return { text: minutesLine(u.minutes), alert: false };
  return { text: 'Modifiche non salvate', alert: false };
}

let current: Unsaved | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** La pagina Squadra dice che ha (o non ha più) modifiche da salvare. */
export function setUnsaved(entry: Unsaved | null): void {
  if (entry === current) return;
  current = entry;
  emit();
}

/** Toglie le modifiche registrate, solo se sono ancora quelle (la pagina se ne va). */
export function clearUnsaved(entry: Unsaved): void {
  if (current === entry) setUnsaved(null);
}

export function getUnsaved(leagueId: string): Unsaved | null {
  return current && current.leagueId === leagueId ? current : null;
}

/** Le modifiche non salvate della lega, se ci sono. */
export function useUnsaved(leagueId: string): Unsaved | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => getUnsaved(leagueId),
    () => null,
  );
}
