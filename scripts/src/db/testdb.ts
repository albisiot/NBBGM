// Database di prova in memoria: PGlite con le migrazioni di supabase/migrations, per i test di sicurezza
// e di apply_turn senza Docker né un progetto Supabase.
import { PGlite, type Transaction } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from '../paths.ts';

export const MIGRATIONS_DIR = join(ROOT, 'supabase', 'migrations');

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

/** Postgres vuoto con il necessario di Supabase e tutte le migrazioni, in ordine. */
export async function createTestDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(readFileSync(new URL('./shim.sql', import.meta.url), 'utf8'));
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`Migrazione ${file}: ${(e as Error).message}`, { cause: e });
    }
  }
  return db;
}

/**
 * Esegue fn come un utente autenticato (come farebbe il client con il suo JWT), dentro una transazione che
 * si chiude con fn: se fn lancia, tutto torna indietro.
 */
export async function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query(`select set_config('request.jwt.claims', $1, true)`, [
      JSON.stringify({ sub: userId, role: 'authenticated' }),
    ]);
    await tx.exec('set local role authenticated');
    return fn(tx);
  });
}

/** Come asUser, ma senza login (chiave anon). */
export async function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role anon');
    return fn(tx);
  });
}

/** Come il server (Edge Functions con la chiave service_role): salta la RLS. */
export async function asService<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.exec('set local role service_role');
    return fn(tx);
  });
}
