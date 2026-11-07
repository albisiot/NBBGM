// Dati che restano uguali per tutto un turno (le partite della stagione): si tengono in memoria per lega, con la
// chiave del turno. Quando la lega passa al turno successivo la chiave cambia e si rileggono; nel frattempo
// Risultati, Classifica e Playoff li riusano senza scaricarli di nuovo.

/**
 * Cache di letture in corso o finite: una per ambito (la lega), valida finché la chiave (stagione e turno) resta
 * la stessa. Due richieste uguali insieme condividono la stessa lettura; una lettura fallita non resta in cache.
 */
export class KeyedCache<T> {
  private readonly entries = new Map<string, { key: string; value: Promise<T> }>();

  /** maxScopes: quante leghe tenere al massimo (le meno recenti escono per prime). */
  constructor(private readonly maxScopes = 3) {}

  get(scope: string, key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(scope);
    if (hit && hit.key === key) {
      // In fondo alla Map: è la più recente
      this.entries.delete(scope);
      this.entries.set(scope, hit);
      return hit.value;
    }
    const value = load();
    const entry = { key, value };
    this.entries.delete(scope);
    this.entries.set(scope, entry);
    while (this.entries.size > this.maxScopes) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
    value.catch(() => {
      // Una lettura fallita si rifà alla prossima richiesta (se nel frattempo non è arrivata un'altra lettura)
      if (this.entries.get(scope) === entry) this.entries.delete(scope);
    });
    return value;
  }

  /** C'è (o è in corso) la lettura dell'ambito con questa chiave. */
  has(scope: string, key: string): boolean {
    return this.entries.get(scope)?.key === key;
  }

  /** Dimentica un ambito (o tutto). */
  clear(scope?: string): void {
    if (scope === undefined) this.entries.clear();
    else this.entries.delete(scope);
  }

  /** Ambiti in cache, dal meno recente (per i test). */
  scopes(): string[] {
    return [...this.entries.keys()];
  }
}

/**
 * Tutte le righe di una lettura a pagine (PostgREST ne dà al massimo 1.000 per richiesta), chiedendo `parallel`
 * pagine alla volta invece di una dopo l'altra. Si ferma alla prima pagina non piena.
 */
export async function allPages<T>(
  page: (from: number, to: number) => Promise<T[]>,
  size = 1000,
  parallel = 2,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += size * parallel) {
    const batch = await Promise.all(
      Array.from({ length: parallel }, (_, i) => page(from + i * size, from + (i + 1) * size - 1)),
    );
    for (const rows of batch) {
      out.push(...rows);
      if (rows.length < size) return out;
    }
  }
}
