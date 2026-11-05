import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'scripts',
    include: ['test/**/*.test.ts'],
    passWithNoTests: true,
    // I test del database caricano Postgres in WebAssembly e tutte le migrazioni
    testTimeout: 60_000,
    hookTimeout: 120_000,
  },
});
