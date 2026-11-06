// Al posto di @supabase/storage-js nella build (alias in vite.config.ts): l'app non usa lo Storage di Supabase, e
// il pacchetto vero (con iceberg-js) pesa circa 27 KB. supabase-js crea comunque il client dello Storage e
// riesporta StorageApiError: qui ci sono gli stessi nomi, senza niente dentro. Se una versione nuova di supabase-js
// chiedesse altro a storage-js, la build si fermerebbe per l'export mancante.

const MESSAGE = "Lo Storage di Supabase non è incluso nell'app (vedi apps/web/vite.config.ts)";

export class StorageClient {
  constructor(..._args: unknown[]) {}

  from(): never {
    throw new Error(MESSAGE);
  }
}

export class StorageApiError extends Error {
  constructor(message = MESSAGE) {
    super(message);
    this.name = 'StorageApiError';
  }
}
