// Salvataggi in fila per i dati che si riscrivono interi a ogni modifica (le liste del draft). Senza, con tocchi
// veloci su ↑/↓ partono più salvataggi insieme e può arrivare per ultimo al server uno vecchio. Qui ne parte uno
// alla volta e, di quelli chiesti mentre uno era in corso, solo l'ultimo: quello che finisce per ultimo è sempre
// l'ultima versione.

export interface LatestSaver<T> {
  /** Chiede di salvare value; la promessa si chiude quando non resta niente da salvare. */
  save(value: T): Promise<void>;
}

export function latestSaver<T>(
  write: (value: T) => Promise<void>,
  onError: (e: unknown) => void,
): LatestSaver<T> {
  let next: { value: T } | null = null;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (next) {
      const { value } = next;
      next = null;
      try {
        await write(value);
      } catch (e) {
        onError(e);
      }
    }
    running = null;
  }

  return {
    save(value: T): Promise<void> {
      next = { value };
      running ??= drain();
      return running;
    },
  };
}
