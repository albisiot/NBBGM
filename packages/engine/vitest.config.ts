import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine',
    include: ['test/**/*.test.ts'],
    // La stagione completa dura qualche secondo e gira in parallelo con i test del database
    testTimeout: 30_000,
  },
});
