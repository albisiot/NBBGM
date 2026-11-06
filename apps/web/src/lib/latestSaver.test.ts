import { describe, expect, it } from 'vitest';
import { latestSaver } from './latestSaver.ts';

/** Scrittura finta che finisce solo quando la si chiude a mano, come una rete lenta. */
function slowServer() {
  const writes: string[][] = [];
  const pending: (() => void)[] = [];
  let saved: string[] | null = null;
  return {
    writes,
    saved: () => saved,
    finishOne: async () => {
      pending.shift()?.();
      await new Promise((r) => setTimeout(r, 0));
    },
    write: (value: string[]) =>
      new Promise<void>((resolve) => {
        writes.push(value);
        pending.push(() => {
          saved = value;
          resolve();
        });
      }),
  };
}

describe('salvataggi delle liste in fila', () => {
  it('uno alla volta, e dei tocchi arrivati nel frattempo parte solo l’ultimo', async () => {
    const server = slowServer();
    const saver = latestSaver(server.write, () => {});
    void saver.save(['a', 'b', 'c']);
    void saver.save(['b', 'a', 'c']);
    void saver.save(['b', 'c', 'a']);
    const done = saver.save(['c', 'b', 'a']);
    // In volo solo il primo
    expect(server.writes).toEqual([['a', 'b', 'c']]);
    await server.finishOne();
    // Poi direttamente l'ultimo: i due in mezzo non partono
    expect(server.writes).toEqual([
      ['a', 'b', 'c'],
      ['c', 'b', 'a'],
    ]);
    await server.finishOne();
    await done;
    expect(server.saved()).toEqual(['c', 'b', 'a']);
  });

  it('un errore non ferma i salvataggi dopo', async () => {
    const errors: unknown[] = [];
    const saved: number[] = [];
    let fail = true;
    const saver = latestSaver(
      async (n: number) => {
        if (fail) {
          fail = false;
          throw new Error('rete');
        }
        saved.push(n);
      },
      (e) => errors.push(e),
    );
    await saver.save(1);
    await saver.save(2);
    expect(errors).toHaveLength(1);
    expect(saved).toEqual([2]);
  });
});
