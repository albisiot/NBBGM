import { ARCHETYPE_PROFILES, generatePlayer, overall, Rng, type Role } from '@nbbgm/engine';
import { describe, expect, it } from 'vitest';
import { BOT_BLOCK_SIZE, botTradeBlock } from './tradeBlock.ts';

const rng = new Rng('lista-bot');
const ROLES: Role[] = ['PG', 'SG', 'SF', 'PF', 'C'];
// Una rosa di 15 con età da 20 a 34 e contratti di 1-3 anni, più un two-way
const roster = Array.from({ length: 16 }, (_, i) => {
  const p = generatePlayer(rng, ARCHETYPE_PROFILES, {
    id: `p${i}`,
    role: ROLES[i % 5]!,
    level: rng.normal(0, 1),
  });
  return {
    ...p,
    age: 20 + i,
    contractType: i === 15 ? 'two-way' : 'standard',
    salaries: Array.from({ length: (i % 3) + 1 }, () => 5_000_000),
  };
});

describe('giocatori sul mercato dei bot', () => {
  it('in ricostruzione i veterani, dal più forte, al massimo 4', () => {
    const list = botTradeBlock(roster, 'rebuild');
    expect(list.length).toBeLessThanOrEqual(BOT_BLOCK_SIZE);
    expect(list.every((p) => p.age >= 29 && p.contractType !== 'two-way')).toBe(true);
    const ovr = list.map((p) => overall(p));
    expect(ovr).toEqual([...ovr].sort((a, b) => b - a));
  });

  it('in corsa i giovani fuori dagli 8 della rotazione', () => {
    const top8 = new Set(
      roster
        .filter((p) => p.contractType !== 'two-way')
        .sort((a, b) => overall(b) - overall(a))
        .slice(0, 8)
        .map((p) => p.id),
    );
    const list = botTradeBlock(roster, 'contend');
    expect(list.every((p) => p.age <= 24 && !top8.has(p.id))).toBe(true);
  });

  it('a metà strada i contratti in scadenza fuori dai primi 5', () => {
    const list = botTradeBlock(roster, 'middle');
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((p) => p.salaries.length === 1)).toBe(true);
  });
});
