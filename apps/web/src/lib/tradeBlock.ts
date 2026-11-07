// Giocatori sul mercato: quelli che un manager segna come disponibili a uno scambio (tabella trade_block, scritta
// dal client per la propria squadra a turno aperto) e, per le squadre dei bot, una lista ricavata dalla loro
// strategia. È solo un'indicazione: lo scambio lo decidono la valutazione del bot o la risposta del manager.
import { overall, type Player } from '@nbbgm/engine';
import { supabase } from './supabase.ts';

/**
 * Giocatori sul mercato della lega, per squadra (solo le squadre dei manager: i bot non scrivono); con teamId solo
 * quelli della squadra.
 */
export async function tradeBlock(leagueId: string, teamId?: string): Promise<Map<string, Set<string>>> {
  let query = supabase.from('trade_block').select('team_id, player_id').eq('league_id', leagueId);
  if (teamId) query = query.eq('team_id', teamId);
  const { data, error } = await query;
  // Database non ancora aggiornato (l'app si pubblica insieme alle migrazioni): nessuna lista
  if (error?.code === '42P01' || error?.code === 'PGRST205') return new Map();
  if (error) throw error;
  const out = new Map<string, Set<string>>();
  for (const r of (data ?? []) as { team_id: string; player_id: string }[]) {
    const set = out.get(r.team_id) ?? new Set<string>();
    set.add(r.player_id);
    out.set(r.team_id, set);
  }
  return out;
}

/** Mette o toglie un proprio giocatore dalla lista (la RLS lo permette solo a turno aperto). */
export async function setOnBlock(
  leagueId: string,
  teamId: string,
  playerId: string,
  on: boolean,
): Promise<void> {
  const { error } = on
    ? await supabase.from('trade_block').insert({ league_id: leagueId, team_id: teamId, player_id: playerId })
    : await supabase.from('trade_block').delete().eq('team_id', teamId).eq('player_id', playerId);
  if (error) throw error;
}

/** Giocatori al massimo nella lista ricavata per un bot. */
export const BOT_BLOCK_SIZE = 4;

type BlockPlayer = Player & { contractType: string | null; salaries: readonly number[] };

/**
 * Lista di un bot dalla sua strategia, tra i contratti standard:
 *   rebuild  i veterani (da 29 anni), dal più forte: valgono di più per chi è in corsa;
 *   contend  i giovani (fino a 24 anni) fuori dagli 8 della rotazione: in cambio cerca chi aiuta subito;
 *   middle   i contratti in scadenza fuori dai primi 5.
 * A parità si ordina per overall e poi per nome.
 */
export function botTradeBlock<P extends BlockPlayer>(
  roster: readonly P[],
  strategy: 'contend' | 'middle' | 'rebuild',
): P[] {
  const rows = roster
    .filter((p) => p.contractType !== 'two-way')
    .map((p) => ({ p, ovr: overall(p) }))
    .sort(
      (a, b) =>
        b.ovr - a.ovr ||
        `${a.p.lastName} ${a.p.firstName}`.localeCompare(`${b.p.lastName} ${b.p.firstName}`, 'it'),
    );
  const picked =
    strategy === 'rebuild'
      ? rows.filter((r) => r.p.age >= 29)
      : strategy === 'contend'
        ? rows.slice(8).filter((r) => r.p.age <= 24)
        : rows.slice(5).filter((r) => r.p.salaries.length === 1);
  return picked.slice(0, BOT_BLOCK_SIZE).map((r) => r.p);
}
