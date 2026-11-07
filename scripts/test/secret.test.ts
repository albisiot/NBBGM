// Segreto condiviso tra il database e le Edge Functions chiamate senza utente (advance-turn, push, tick del draft):
// il database lo mette nell'intestazione solo se è configurato, le funzioni lo controllano solo se hanno il loro.
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  SECRET_ENV,
  SECRET_HEADER,
  sameSecret,
  trustedCaller,
} from '../../supabase/functions/_shared/secret.ts';
import { ROOT } from '../src/paths.ts';
import { asUser, createTestDb } from '../src/db/testdb.ts';

const SECRET = 'a'.repeat(40) + 'b'.repeat(24);

describe('controllo nelle Edge Functions', () => {
  it('senza segreto configurato accetta tutto, come prima', () => {
    expect(trustedCaller(new Headers(), undefined)).toBe(true);
    expect(trustedCaller(new Headers(), '  ')).toBe(true);
    expect(trustedCaller(new Headers({ [SECRET_HEADER]: 'qualsiasi' }), '')).toBe(true);
  });

  it('con il segreto vuole l’intestazione giusta', () => {
    expect(trustedCaller(new Headers(), SECRET)).toBe(false);
    expect(trustedCaller(new Headers({ [SECRET_HEADER]: SECRET }), SECRET)).toBe(true);
    expect(trustedCaller(new Headers({ [SECRET_HEADER]: SECRET }), `${SECRET}\n`)).toBe(true);
    expect(trustedCaller(new Headers({ [SECRET_HEADER]: SECRET.slice(1) }), SECRET)).toBe(false);
    expect(trustedCaller(new Headers({ [SECRET_HEADER]: `${SECRET}x` }), SECRET)).toBe(false);
    expect(trustedCaller(new Headers({ Authorization: `Bearer ${SECRET}` }), SECRET)).toBe(false);
  });

  it('confronta i segreti carattere per carattere', () => {
    expect(sameSecret('abc', 'abc')).toBe(true);
    expect(sameSecret('abc', 'abd')).toBe(false);
    expect(sameSecret('abc', 'ab')).toBe(false);
    expect(sameSecret('', '')).toBe(true);
    expect(sameSecret('è', 'e')).toBe(false);
  });

  it('advance-turn, push e il tick del draft lo controllano', () => {
    for (const name of ['advance-turn', 'push', 'draft']) {
      const src = readFileSync(join(ROOT, 'supabase', 'functions', name, 'index.ts'), 'utf8');
      expect(src, name).toContain('trustedCaller(req.headers, Deno.env.get(SECRET_ENV))');
    }
    expect(SECRET_ENV).toBe('NBBGM_FUNCTIONS_SECRET');
  });
});

describe('intestazioni del database', () => {
  let db: PGlite;
  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);
  afterAll(async () => {
    await db.close();
  });

  const headers = async () =>
    (await db.query<{ h: Record<string, string> }>('select private.function_headers() as h')).rows[0]!.h;

  it('senza il segreto in private.settings mandano solo il tipo', async () => {
    expect(await headers()).toEqual({ 'Content-Type': 'application/json' });
  });

  it('con il segreto lo aggiungono, con il nome che le funzioni leggono', async () => {
    await db.query(`insert into private.settings (key, value) values ('functions_secret', $1)`, [SECRET]);
    expect(await headers()).toEqual({ 'Content-Type': 'application/json', [SECRET_HEADER]: SECRET });
    // Un segreto troppo corto non vale: meglio nessuna intestazione che una indovinabile
    await db.query(`update private.settings set value = 'corto' where key = 'functions_secret'`);
    expect(await headers()).toEqual({ 'Content-Type': 'application/json' });
    await db.query(`delete from private.settings where key = 'functions_secret'`);
  });

  it('nessun client legge il segreto', async () => {
    await expect(
      asUser(db, '00000000-0000-0000-0000-000000000001', (tx) =>
        tx.query(`select value from private.settings where key = 'functions_secret'`),
      ),
    ).rejects.toThrow(/permission denied/);
    await expect(
      asUser(db, '00000000-0000-0000-0000-000000000001', (tx) =>
        tx.query('select private.function_headers()'),
      ),
    ).rejects.toThrow(/permission denied/);
  });
});
