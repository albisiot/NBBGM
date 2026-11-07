// Controllo di un'azione di mercato nei test, come la Edge Function market, ma con le due letture: lo stato leggero
// (market_state, quello che usa la funzione) e quello completo (league_state, quello del turno). I due controlli
// devono dare lo stesso esito: se un controllo nuovo usasse dati che market_state non dà, i test del mercato lo
// direbbero.
import {
  actionPlayer,
  checkMarketAction,
  type MarketAction,
} from '../../../supabase/functions/_shared/market.ts';
import type { LeagueStateRows } from '../../../supabase/functions/_shared/state.ts';

interface Rpc {
  rpc<T>(name: string, args: Record<string, unknown>): Promise<T>;
}

type Outcome = { ok: ReturnType<typeof checkMarketAction> } | { error: unknown };

function outcome(rows: LeagueStateRows, user: string, action: MarketAction): Outcome {
  try {
    return { ok: checkMarketAction(rows, user, action) };
  } catch (error) {
    return { error };
  }
}

const describeOutcome = (o: Outcome) =>
  'ok' in o
    ? JSON.stringify(o.ok)
    : `${(o.error as Error).constructor?.name}: ${(o.error as Error).message ?? String(o.error)}`;

/** Lo stato leggero dell'azione, come lo legge la Edge Function market. */
export function marketState(db: Rpc, league: string, action: MarketAction): Promise<LeagueStateRows> {
  return db.rpc<LeagueStateRows>('market_state', { p_league: league, p_player: actionPlayer(action) });
}

/**
 * checkMarketAction sullo stato leggero e su quello completo: stesso esito, altrimenti un errore che dice la
 * differenza. Restituisce il risultato o lancia l'errore del controllo (MarketError per il manager).
 */
export async function checkedMarketAction(
  db: Rpc,
  league: string,
  user: string,
  action: MarketAction,
): Promise<ReturnType<typeof checkMarketAction>> {
  const [light, full] = await Promise.all([
    marketState(db, league, action),
    db.rpc<LeagueStateRows>('league_state', { p_league: league }),
  ]);
  const a = outcome(light, user, action);
  const b = outcome(full, user, action);
  if (describeOutcome(a) !== describeOutcome(b))
    throw new Error(
      `market_state e league_state danno esiti diversi per ${JSON.stringify(action)}:\n  leggero: ${describeOutcome(a)}\n  completo: ${describeOutcome(b)}`,
    );
  if ('error' in a) throw a.error;
  return a.ok;
}
