// Fase 8: le impostazioni salvate dal manager (quintetto, minuti, tattiche) le legge il motore nella simulazione.
// Il manager salva come dall'app (RLS), il server legge lo stato con league_state e gioca il turno.
import type { PGlite } from '@electric-sql/pglite';
import { playRegularTurn, simulateGame, type GameResult, type LeagueState } from '@nbbgm/engine';
import { beforeAll, describe, expect, it } from 'vitest';
import { leagueStateFromRows, type LeagueStateRows } from '../../supabase/functions/_shared/state.ts';
import { buildSeedSql, seedIds, stableUuid } from '../src/db/seed.ts';
import { asAnon, asService, asUser, createTestDb } from '../src/db/testdb.ts';

const ids = seedIds();
const ANNA = ids.user('anna');
const BOS = ids.team('BOS');

let db: PGlite;

beforeAll(async () => {
  db = await createTestDb();
  await db.exec(buildSeedSql());
}, 120_000);

async function loadState(): Promise<LeagueState> {
  const rows = await asService(
    db,
    async (tx) =>
      (await tx.query<{ s: LeagueStateRows }>('select public.league_state($1) as s', [ids.league])).rows[0]!
        .s,
  );
  return leagueStateFromRows(rows).state;
}

/** Gioca i turni dal corrente fino alla prima partita di Boston (il primo giorno riposa) e la restituisce. */
function playBoston(state: LeagueState): { result: GameResult; side: 'home' | 'away' } {
  for (let i = 0; i < 5; i++) {
    const results: GameResult[] = [];
    playRegularTurn(state, (h, a, seed) => {
      const r = simulateGame(h, a, seed);
      results.push(r);
      return r;
    });
    const result = results.find((r) => r.home.teamId === 'BOS' || r.away.teamId === 'BOS');
    if (result) return { result, side: result.home.teamId === 'BOS' ? 'home' : 'away' };
  }
  throw new Error('Boston non gioca nei primi 5 turni');
}

describe('stato della lega dal database', () => {
  it('ha squadre, giocatori, contratti e calendario come il seed', async () => {
    const state = await loadState();
    expect(state.teams).toHaveLength(30);
    expect(state.players).toHaveLength(480);
    expect(state.schedule).toHaveLength(1230);
    expect(state.turn).toBe(0);
    expect(state.teams.filter((t) => t.human).map((t) => t.id)).toEqual(['BOS', 'LAL', 'NYK']);
    // I valori nascosti arrivano al server (e solo a lui)
    expect(state.players[0]?.hidden.potential).toBeTypeOf('number');
  });
});

describe('impostazioni salvate nella simulazione', () => {
  let starters: string[];
  let minutes: Record<string, number>;

  beforeAll(async () => {
    // Anna mette in quintetto cinque riserve e una rotazione a dieci, con ritmo veloce e difesa a zona
    const roster = await db.query<{ id: string; role: string }>(
      'select id, role from public.players where team_id = $1 order by id',
      [BOS],
    );
    const sorted = roster.rows.map((r) => r.id);
    starters = sorted.slice(5, 10);
    const rotation = [32, 32, 32, 30, 30, 22, 20, 14, 14, 14];
    const ten = [...starters, ...sorted.slice(0, 5)];
    minutes = Object.fromEntries(ten.map((id, i) => [id, rotation[i] as number]));
    await asUser(db, ANNA, (tx) =>
      tx.query(
        'update public.team_settings set starters = $1, minutes = $2, tactics = $3 where team_id = $4',
        [starters, minutes, { pace: 'fast', focus: 'inside', defense: 'zone', intensity: 'high' }, BOS],
      ),
    );
  });

  it('il motore legge quintetto, minuti e tattiche salvati', async () => {
    const state = await loadState();
    const bos = state.teams.find((t) => t.id === 'BOS');
    expect(bos?.settings?.starters).toEqual(starters);
    expect(bos?.tactics).toEqual({ pace: 'fast', focus: 'inside', defense: 'zone', intensity: 'high' });

    const { result, side } = playBoston(state);
    const box = result[side].box;
    expect(new Set(box.filter((l) => l.starter).map((l) => l.playerId))).toEqual(new Set(starters));
    // Minuti vicini a quelli obiettivo (cambi per stanchezza, falli o infortuni a parte)
    const deviation =
      Object.entries(minutes).reduce((a, [id, m]) => {
        const line = box.find((l) => l.playerId === id);
        return a + Math.abs((line?.seconds ?? 0) / 60 - m);
      }, 0) / 10;
    expect(deviation).toBeLessThan(6);
  });

  it('se un titolare è infortunato il bot corregge solo il suo slot', async () => {
    const out = starters[1] as string;
    await asService(db, (tx) =>
      tx.query(
        `insert into public.injuries (player_id, league_id, body_part, severity, games_remaining)
         values ($1, $2, 'ankles', 'medium', 6)`,
        [out, ids.league],
      ),
    );
    const { result, side } = playBoston(await loadState());
    const box = result[side].box;
    expect(box.find((l) => l.playerId === out)).toBeUndefined();
    const playedStarters = box.filter((l) => l.starter).map((l) => l.playerId);
    expect(playedStarters).toHaveLength(5);
    for (const id of starters.filter((s) => s !== out)) expect(playedStarters).toContain(id);
  });

  it('una squadra del bot gioca con le scelte del bot', async () => {
    const state = await loadState();
    const mia = state.teams.find((t) => t.id === 'MIA');
    expect(mia?.human).toBe(false);
    expect(mia?.settings).toBeNull();
  });
});

describe('stime della scheda giocatore', () => {
  it('per i propri giocatori più precise, per gli altri più vaghe, mai i numeri', async () => {
    const own = (
      await db.query<{ id: string }>('select id from public.players where team_id = $1 limit 1', [BOS])
    ).rows[0]!.id;
    const other = (
      await db.query<{ id: string }>('select id from public.players where team_id = $1 limit 1', [
        ids.team('MIA'),
      ])
    ).rows[0]!.id;
    const scout = (id: string) =>
      asUser(
        db,
        ANNA,
        async (tx) =>
          (await tx.query<{ s: Record<string, unknown> }>('select public.player_scouting($1) as s', [id]))
            .rows[0]!.s,
      );
    const mine = await scout(own);
    const theirs = await scout(other);
    expect(mine.own).toBe(true);
    expect(theirs.own).toBe(false);
    const fiveLevels = ['molto bassa', 'bassa', 'media', 'alta', 'molto alta'];
    expect(fiveLevels).toContain(mine.offensive_consistency);
    expect(['bassa', 'media', 'alta']).toContain(theirs.offensive_consistency);
    // Nessun numero dei valori nascosti, salvo la stima del potenziale che vedono anche i bot
    const hidden = (
      await asService(db, (tx) =>
        tx.query<{ hidden: Record<string, number> }>(
          'select hidden from public.player_hidden where player_id = $1',
          [own],
        ),
      )
    ).rows[0]!.hidden;
    const text = JSON.stringify({ ...mine, potential: null });
    for (const [key, value] of Object.entries(hidden))
      if (key !== 'potential') expect(text.includes(`:${value}`), key).toBe(false);

    // Chi non è nella lega non vede nulla
    const outsider = stableUuid('user:estraneo-roster');
    await db.query(`insert into auth.users (id, email) values ($1, 'estraneo-roster@nbbgm.test')`, [
      outsider,
    ]);
    await expect(
      asUser(db, outsider, (tx) => tx.query('select public.player_scouting($1)', [own])),
    ).rejects.toThrow(/Giocatore non trovato/);
    await expect(asAnon(db, (tx) => tx.query('select public.player_scouting($1)', [own]))).rejects.toThrow(
      /permission denied/,
    );
  });
});
