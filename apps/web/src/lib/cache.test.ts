import { describe, expect, it } from 'vitest';
import { allPages, KeyedCache } from './cache.ts';
import { clearSeasonCache, currentStandings, seasonKey } from './useSeason.ts';

describe('KeyedCache', () => {
  it('stessa lega e stesso turno: una lettura sola', async () => {
    const cache = new KeyedCache<number>();
    let reads = 0;
    const load = async () => ++reads;
    expect(await cache.get('lega', 's1:t1', load)).toBe(1);
    expect(await cache.get('lega', 's1:t1', load)).toBe(1);
    expect(reads).toBe(1);
  });

  it('turno nuovo: si rilegge e il dato vecchio non torna più', async () => {
    const cache = new KeyedCache<string>();
    expect(await cache.get('lega', 's1:t1', async () => 'turno 1')).toBe('turno 1');
    expect(await cache.get('lega', 's1:t2', async () => 'turno 2')).toBe('turno 2');
    expect(await cache.get('lega', 's1:t2', async () => 'mai')).toBe('turno 2');
    // Tornare alla chiave vecchia non ridà il dato vecchio: c'è un dato per lega, quello dell'ultimo turno letto
    expect(await cache.get('lega', 's1:t1', async () => 'riletto')).toBe('riletto');
  });

  it('due richieste insieme condividono la stessa lettura', async () => {
    const cache = new KeyedCache<number>();
    let reads = 0;
    let finish: (v: number) => void = () => undefined;
    const load = () => {
      reads++;
      return new Promise<number>((r) => (finish = r));
    };
    const a = cache.get('lega', 'k', load);
    const b = cache.get('lega', 'k', load);
    finish(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(reads).toBe(1);
  });

  it('una lettura fallita non resta in cache', async () => {
    const cache = new KeyedCache<number>();
    await expect(cache.get('lega', 'k', () => Promise.reject(new Error('rete')))).rejects.toThrow('rete');
    expect(cache.scopes()).toEqual([]);
    expect(await cache.get('lega', 'k', async () => 3)).toBe(3);
  });

  it('un errore arrivato tardi non cancella la lettura nuova', async () => {
    const cache = new KeyedCache<number>();
    let fail: (e: Error) => void = () => undefined;
    const old = cache.get('lega', 't1', () => new Promise<number>((_, reject) => (fail = reject)));
    expect(await cache.get('lega', 't2', async () => 2)).toBe(2);
    fail(new Error('tardi'));
    await expect(old).rejects.toThrow('tardi');
    let reads = 0;
    expect(await cache.get('lega', 't2', async () => ++reads)).toBe(2);
    expect(reads).toBe(0);
  });

  it('tiene al massimo le ultime leghe usate', async () => {
    const cache = new KeyedCache<string>(2);
    await cache.get('a', 'k', async () => 'a');
    await cache.get('b', 'k', async () => 'b');
    // a usata di nuovo: esce b, la meno recente
    await cache.get('a', 'k', async () => 'mai');
    await cache.get('c', 'k', async () => 'c');
    expect(cache.scopes()).toEqual(['a', 'c']);
    cache.clear('a');
    expect(cache.scopes()).toEqual(['c']);
    cache.clear();
    expect(cache.scopes()).toEqual([]);
  });
});

describe('lettura già fatta (seconda analisi, prestazioni)', () => {
  it('has dice se c’è la lettura di quell’ambito con quella chiave', async () => {
    const cache = new KeyedCache<number>();
    expect(cache.has('lega', 's1:t1')).toBe(false);
    const pending = cache.get('lega', 's1:t1', async () => 1);
    expect(cache.has('lega', 's1:t1')).toBe(true);
    await pending;
    expect(cache.has('lega', 's1:t2')).toBe(false);
    expect(cache.has('altra', 's1:t1')).toBe(false);
  });

  it('classifica della pagina squadra: le sole partite giocate, una volta per turno', async () => {
    clearSeasonCache();
    const teams = (['AAA', 'BBB'] as const).map((code) => ({
      id: code,
      code,
      fullName: code,
      conference: 'East' as const,
      division: 'Atlantic',
    }));
    const league = {
      id: 'L',
      teams,
      seasonId: 's1',
      roundId: 't1',
      seasonYear: 2026,
    } as unknown as Parameters<typeof currentStandings>[0];
    let reads = 0;
    const read = {
      records: async () => {
        reads++;
        return [
          {
            turn: 0,
            phase: 'regular' as const,
            homeId: 'BBB',
            awayId: 'AAA',
            homeScore: 90,
            awayScore: 99,
            overtimes: 0,
          },
        ];
      },
    };
    const first = await currentStandings(league, read);
    expect(first.East.map((l) => [l.teamId, l.w, l.l, l.confRank])).toEqual([
      ['AAA', 1, 0, 1],
      ['BBB', 0, 1, 2],
    ]);
    await currentStandings(league, read);
    expect(reads).toBe(1);
    // Turno nuovo: si rilegge
    await currentStandings({ ...league, roundId: 't2' }, read);
    expect(reads).toBe(2);
  });
});

describe('seasonKey', () => {
  it('cambia con il turno e con la stagione', () => {
    const k = seasonKey({ seasonId: 's1', roundId: 'r1' });
    expect(seasonKey({ seasonId: 's1', roundId: 'r2' })).not.toBe(k);
    expect(seasonKey({ seasonId: 's2', roundId: 'r1' })).not.toBe(k);
    expect(seasonKey({ seasonId: 's1', roundId: 'r1' })).toBe(k);
  });
});

describe('allPages', () => {
  const rows = (n: number) => Array.from({ length: n }, (_, i) => i);
  const source = (total: number) => {
    const asked: [number, number][] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const page = async (from: number, to: number) => {
      asked.push([from, to]);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return rows(total).slice(from, to + 1);
    };
    return { page, asked, maxInFlight: () => maxInFlight };
  };

  it('una stagione (1.341 partite): due pagine insieme, in una volta', async () => {
    const s = source(1341);
    expect(await allPages(s.page)).toEqual(rows(1341));
    expect(s.asked).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(s.maxInFlight()).toBe(2);
  });

  it('esattamente 1.000 righe: la seconda pagina vuota chiude', async () => {
    const s = source(1000);
    expect(await allPages(s.page)).toEqual(rows(1000));
    expect(s.asked.length).toBe(2);
  });

  it('più di due pagine: continua finché una non è piena', async () => {
    const s = source(4500);
    expect(await allPages(s.page)).toEqual(rows(4500));
    expect(s.asked.map(([from]) => from)).toEqual([0, 1000, 2000, 3000, 4000, 5000]);
  });

  it('nessuna riga', async () => {
    expect(await allPages(source(0).page)).toEqual([]);
  });
});
