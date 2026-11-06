// Modifiche non salvate nella pagina Squadra (quintetto, minuti, tattiche), condivise con la barra del turno: prima
// di segnarsi pronti l'app chiede se salvarle. Le registra la pagina finché è aperta, con la funzione per salvarle.
import { useSyncExternalStore } from 'react';

export interface Unsaved {
  leagueId: string;
  /** Salva le modifiche; true se è andata bene (l'errore lo mostra la pagina). */
  save: () => Promise<boolean>;
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
