import { describe, expect, it } from 'vitest';
import {
  autoDraftPick,
  DraftError,
  INITIAL_DRAFT_ROUNDS,
  planDraft,
  snakeOrder,
  type DraftProspect,
  type DraftSnapshot,
} from '../src/season/initialDraft.ts';
import { ROLES, type Role } from '../src/types.ts';
import { Rng } from '../src/rng.ts';

const TEAMS = Array.from({ length: 30 }, (_, i) => `T${String(i + 1).padStart(2, '0')}`);

function pool(n = 440, seed = 'pool'): DraftProspect[] {
  const rng = new Rng(seed);
  return Array.from({ length: n }, (_, i) => ({
    id: `p${String(i).padStart(3, '0')}`,
    role: ROLES[i % 5] as Role,
    secondaryRole: null,
    overall: Math.round(rng.normal(62, 8) * 10) / 10,
  }));
}

function snapshot(over: Partial<DraftSnapshot> = {}): DraftSnapshot {
  return {
    mode: 'list',
    state: 'waiting',
    order: snakeOrder(TEAMS, INITIAL_DRAFT_ROUNDS, 'lega'),
    next: 0,
    deadline: null,
    pickSeconds: 60,
    commissionerId: 'u1',
    owners: Object.fromEntries(TEAMS.map((t, i) => [t, i < 3 ? `u${i + 1}` : null])),
    pool: pool(),
    made: [],
    lists: {},
    ...over,
  };
}

/** Applica un piano allo snapshot, come farebbe il database. */
function apply(s: DraftSnapshot, plan: ReturnType<typeof planDraft>): DraftSnapshot {
  const next = s.next + plan.picks.length;
  return {
    ...s,
    state: next >= s.order.length ? 'done' : 'running',
    mode: plan.mode ?? s.mode,
    next,
    deadline: plan.deadline,
    made: [...s.made, ...plan.picks.map((p) => ({ pick: p.pick, teamId: p.teamId, playerId: p.playerId }))],
  };
}

function rosterCheck(s: DraftSnapshot) {
  const ids = s.made.map((m) => m.playerId);
  expect(new Set(ids).size).toBe(ids.length);
  for (const t of TEAMS) expect(s.made.filter((m) => m.teamId === t)).toHaveLength(INITIAL_DRAFT_ROUNDS);
}

describe('ordine del draft iniziale', () => {
  it('è a serpentina, con 13 scelte per squadra', () => {
    const order = snakeOrder(TEAMS, INITIAL_DRAFT_ROUNDS, 'lega');
    expect(order).toHaveLength(390);
    expect(order.slice(30, 60)).toEqual([...order.slice(0, 30)].reverse());
    for (const t of TEAMS) expect(order.filter((x) => x === t)).toHaveLength(13);
    // Sorteggiato, ma uguale a parità di seed
    expect(snakeOrder(TEAMS, 13, 'lega')).toEqual(order);
    expect(snakeOrder(TEAMS, 13, 'altra').slice(0, 30)).not.toEqual(order.slice(0, 30));
  });
});

describe('scelta automatica', () => {
  const players: DraftProspect[] = [
    { id: 'c1', role: 'C', secondaryRole: null, overall: 70 },
    { id: 'pg1', role: 'PG', secondaryRole: null, overall: 80 },
    { id: 'pg2', role: 'PG', secondaryRole: null, overall: 75 },
    { id: 'sf1', role: 'SF', secondaryRole: null, overall: 65 },
  ];

  it('prende il primo disponibile della lista', () => {
    expect(autoDraftPick(players, [], ['zz', 'sf1', 'pg1']).id).toBe('sf1');
  });

  it('senza lista prende il migliore del ruolo più scoperto', () => {
    const roster = ['PG', 'PG', 'PG', 'SG', 'SG', 'SG', 'SF', 'SF', 'SF', 'PF', 'PF'].map((role, i) => ({
      id: `r${i}`,
      role: role as Role,
      secondaryRole: null,
      overall: 60,
    }));
    expect(autoDraftPick(players, roster).id).toBe('c1');
    expect(autoDraftPick(players, []).id).toBe('pg1');
  });
});

describe('draft in modalità lista', () => {
  it('si chiude tutto alla partenza, con le liste dei manager', () => {
    const s = snapshot({ lists: { T01: ['p439', 'p438'], T02: ['p439', 'p001'] } });
    expect(() => planDraft(s, { kind: 'start', userId: 'u2' }, new Date())).toThrow(DraftError);
    const plan = planDraft(s, { kind: 'start', userId: 'u1' }, new Date());
    expect(plan.begin).toBe(true);
    expect(plan.picks).toHaveLength(390);
    expect(plan.deadline).toBeNull();
    const done = apply(s, plan);
    expect(done.state).toBe('done');
    rosterCheck(done);
    // Chi aveva in lista p439 lo ha preso se è arrivato prima dell'altro
    const first = done.made.find((m) => m.playerId === 'p439');
    expect(['T01', 'T02']).toContain(first?.teamId);
    const t01 = done.made.filter((m) => m.teamId === 'T01').map((m) => m.playerId);
    expect(t01.some((id) => id === 'p439' || id === 'p438')).toBe(true);
  });
});

describe('draft dal vivo', () => {
  it('i bot scelgono da soli, gli umani a mano o allo scadere del tempo', () => {
    const t0 = new Date('2026-11-05T20:00:00Z');
    let s = snapshot({ mode: 'live' });
    s = apply(s, planDraft(s, { kind: 'start', userId: 'u1' }, t0));
    // Si ferma alla prima chiamata di un umano, con il tempo che corre
    const team = s.order[s.next] as string;
    expect(s.owners[team]).not.toBeNull();
    expect(s.deadline).toBe(new Date(t0.getTime() + 60_000).toISOString());

    // Prima della scadenza il controllo del tempo non fa nulla
    expect(planDraft(s, { kind: 'tick' }, new Date(t0.getTime() + 30_000)).picks).toEqual([]);
    // Non tocca a un altro manager
    const other = Object.values(s.owners).find((u) => u !== null && u !== s.owners[team]) as string;
    expect(() => planDraft(s, { kind: 'pick', userId: other, playerId: 'p000' }, t0)).toThrow(
      /Non tocca a te/,
    );

    let now = t0.getTime();
    let rounds = 0;
    while (s.state !== 'done' && rounds++ < 200) {
      const onClock = s.owners[s.order[s.next] as string] as string;
      now += 10_000;
      if (rounds % 3 === 0) {
        // Il manager non sceglie: allo scadere decide il server
        now += 61_000;
        s = apply(s, planDraft(s, { kind: 'tick' }, new Date(now)));
      } else {
        const taken = new Set(s.made.map((m) => m.playerId));
        const choice = s.pool.find((p) => !taken.has(p.id)) as DraftProspect;
        expect(() =>
          planDraft(
            s,
            { kind: 'pick', userId: onClock, playerId: s.made[0]?.playerId ?? 'x' },
            new Date(now),
          ),
        ).toThrow();
        s = apply(s, planDraft(s, { kind: 'pick', userId: onClock, playerId: choice.id }, new Date(now)));
      }
      // A metà il commissario passa alla modalità lista e il resto si chiude subito
      if (s.next > 200 && s.state === 'running') {
        const plan = planDraft(s, { kind: 'to-list', userId: 'u1' }, new Date(now));
        expect(plan.mode).toBe('list');
        s = apply(s, plan);
      }
    }
    expect(s.state).toBe('done');
    rosterCheck(s);
  });
});
