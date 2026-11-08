// Per i test che arrivano in fretta alla fine della regular season: punteggi finti (senza box score) per tutti i
// giorni tranne l'ultimo, e il turno aperto della lega di prova diventa l'ultimo giorno, che gioca il server.
import type { PGlite } from '@electric-sql/pglite';
import { Rng } from '@nbbgm/engine';

export interface RegularTurn {
  /** Numero del turno (indice del giorno con partite). */
  number: number;
  /** Giorno della stagione (giorni dall'apertura). */
  day: number;
}

/** L'ultimo turno di regular season della stagione corrente: il giorno in cui giocano tutte e 30. */
export async function lastRegularTurn(db: PGlite, league: string): Promise<RegularTurn> {
  const r = await db.query<RegularTurn>(
    `select g.round_number as number, g.day
     from public.games g join public.leagues l on l.current_season_id = g.season_id
     where l.id = $1 and g.kind = 'regular'
     order by g.round_number desc limit 1`,
    [league],
  );
  return r.rows[0]!;
}

/**
 * Punteggi finti (niente pareggi) per le partite di regular season prima dell'ultimo giorno, e il turno aperto
 * diventa l'ultimo giorno, senza Pronto automatici (l'ultimo giorno giocano tutti).
 */
export async function skipToLastRegularDay(
  db: PGlite,
  league: string,
  round: string,
  seed: string,
): Promise<RegularTurn> {
  const last = await lastRegularTurn(db, league);
  const rng = new Rng(seed);
  const games = await db.query<{ id: string }>(
    `select id from public.games where league_id = $1 and kind = 'regular' and round_number < $2 order by id`,
    [league, last.number],
  );
  const values = games.rows.map((g) => {
    const h = 95 + Math.floor(rng.next() * 40);
    let a = 95 + Math.floor(rng.next() * 40);
    if (a === h) a++;
    return `('${g.id}'::uuid, ${h}, ${a})`;
  });
  await db.exec(`
    update public.games g set home_score = v.h, away_score = v.a, overtimes = 0, played_at = now()
    from (values ${values.join(',')}) as v(id, h, a) where g.id = v.id;
    update public.rounds set number = ${last.number}, day = ${last.day} where id = '${round}';
    delete from public.ready_flags where round_id = '${round}';
  `);
  return last;
}
