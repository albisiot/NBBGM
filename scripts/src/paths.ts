import { fileURLToPath } from 'node:url';
import path from 'node:path';

/** Radice del repository. */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Cartella dei dati generati (esclusa dal repo). */
export const DATA_DIR = path.join(ROOT, 'data');
