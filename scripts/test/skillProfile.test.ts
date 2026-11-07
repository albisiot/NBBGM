// Seconda analisi, funzioni nuove: media della lega per i bisogni della squadra (public.league_skill_profile). La
// funzione SQL segue le regole di apps/web/src/lib/skills.ts: qui si confrontano sulla lega di prova del seed.
import type { PGlite } from '@electric-sql/pglite';
import type { Ratings } from '@nbbgm/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { rotationProfile, SKILL_GROUPS, type SkillProfile } from '../../apps/web/src/lib/skills.ts';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asAnon, asUser, createTestDb } from '../src/db/testdb.ts';

const ids = seedIds();
const LEAGUE = ids.league;
const ANNA = ids.user('anna');
const OUTSIDER = stableUuid('user:esterno-abilita');

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
  await db.query(`insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)`, [
    OUTSIDER,
    'esterno-abilita@nbbgm.test',
    { name: 'Esterno' },
  ]);
}, 120_000);

const profile = (user: string) =>
  asUser(
    db,
    user,
    async (tx) =>
      (
        await tx.query<{ p: Record<string, number | string> }>(
          'select public.league_skill_profile($1) as p',
          [LEAGUE],
        )
      ).rows[0]!.p,
  );

describe('media della lega per i bisogni della squadra', () => {
  it('la stessa media delle rotazioni che calcola l’app, squadra per squadra', async () => {
    const row = await profile(ANNA);
    console.info(`league_skill_profile: ${JSON.stringify(row).length} byte`);
    expect(Number(row.teams)).toBe(30);
    const players = (
      await db.query<{ id: string; team_id: string; ratings: Ratings; type: string }>(
        `select p.id, p.team_id, p.ratings, c.type from public.players p
         join public.contracts c on c.player_id = p.id
         where p.league_id = $1 and p.team_id is not null and not p.retired`,
        [LEAGUE],
      )
    ).rows;
    const teams = [...new Set(players.map((p) => p.team_id))];
    const sums = Object.fromEntries(SKILL_GROUPS.map((g) => [g.key, 0])) as SkillProfile;
    for (const t of teams) {
      const mine = rotationProfile(
        players.filter((p) => p.team_id === t).map((p) => ({ ...p, contractType: p.type })),
      );
      for (const g of SKILL_GROUPS) sums[g.key] += mine[g.key];
    }
    // Ogni squadra ha almeno 8 contratti non two-way: la media dei giocatori è la media delle squadre
    for (const g of SKILL_GROUPS) expect(Number(row[g.key])).toBeCloseTo(sums[g.key] / teams.length, 2);
  });

  it('chi non è nella lega non vede nulla; dall’API senza login non si chiama', async () => {
    expect(Number((await profile(OUTSIDER)).teams)).toBe(0);
    await expect(
      asAnon(db, (tx) => tx.query('select public.league_skill_profile($1)', [LEAGUE])),
    ).rejects.toThrow(/permission denied/);
  });
});
