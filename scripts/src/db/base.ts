// Dati di partenza per Supabase (base_teams, base_players, base_contracts, base_dead_money) ricavati dalla lega
// importata dal file Excel. Il file prodotto contiene i giocatori reali: resta in data/, fuori dal repo.
import type { LeagueData } from '@nbbgm/engine';
import { baseRowsFromLeague, baseTeamRows } from '../../../supabase/functions/_shared/league.ts';

function rowsSql(table: string, rows: readonly object[], onConflict = ''): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0] as object);
  const json = '[\n' + rows.map((r) => JSON.stringify(r)).join(',\n') + '\n]';
  if (json.includes('$base$')) throw new Error('I dati contengono il delimitatore $base$');
  return (
    `insert into ${table} (${cols.join(', ')})\n` +
    `select ${cols.join(', ')} from jsonb_populate_recordset(null::${table}, $base$${json}$base$::jsonb)` +
    `${onConflict ? `\n${onConflict}` : ''};\n\n`
  );
}

/** SQL che sostituisce il dataset indicato (es. "2026-27") con i dati della lega. */
export function buildBaseSql(league: LeagueData, dataset = league.season): string {
  const ds = dataset.replace(/'/g, "''");
  const rows = baseRowsFromLeague(league, dataset);
  let sql =
    `-- Generato da pnpm db:seed dai file Excel importati: contiene i giocatori reali, non va nel repo.\n` +
    `-- Dataset ${dataset}: ${league.players.length} giocatori, ${league.contracts.length} contratti.\n\n` +
    'begin;\n\n';
  sql += rowsSql(
    'public.base_teams',
    baseTeamRows(),
    'on conflict (code) do update set city = excluded.city, name = excluded.name, full_name = excluded.full_name,\n' +
      '  conference = excluded.conference, division = excluded.division',
  );
  sql += `delete from public.base_dead_money where dataset = '${ds}';\n`;
  sql += `delete from public.base_players where dataset = '${ds}';\n\n`;
  sql += rowsSql('public.base_players', rows.players);
  sql += rowsSql('public.base_contracts', rows.contracts);
  sql += rowsSql('public.base_dead_money', rows.deadMoney);
  // Il draft è una voce della scheda che non cambia: le leghe già create lo prendono dai giocatori reali con lo
  // stesso slug, solo dove manca (il resto dei giocatori delle leghe in corso resta com'era alla creazione)
  sql +=
    'update public.players p set draft = b.draft\n' +
    `from public.base_players b\n` +
    `where b.dataset = '${ds}' and b.slug = p.slug and p.draft is null and b.draft is not null;\n\n`;
  return sql + 'commit;\n';
}
