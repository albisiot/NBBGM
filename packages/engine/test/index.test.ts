import { describe, expect, it } from 'vitest';
import { ENGINE_VERSION } from '../src/index.ts';

describe('engine', () => {
  it('espone la versione', () => {
    expect(ENGINE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
