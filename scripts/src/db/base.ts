// Dati di partenza per Supabase (base_teams, base_players, base_contracts, base_dead_money) ricavati dalla lega
// importata dal file Excel. Il file prodotto contiene i giocatori reali: resta in data/, fuori dal repo.
import { TEAMS, type LeagueData } from '@nbbgm/engine';

function rowsSql(table: string, rows: readonly Record<string, unknown>[], onConflict = ''): string {
  if (rows.length === 0) return '';
  const cols = Object.keys(rows[0] as Record<string, unknown>);
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
  let sql =
    `-- Generato da pnpm db:seed dai file Excel importati: contiene i giocatori reali, non va nel repo.\n` +
    `-- Dataset ${dataset}: ${league.players.length} giocatori, ${league.contracts.length} contratti.\n\n` +
    'begin;\n\n';
  sql += rowsSql(
    'public.base_teams',
    TEAMS.map((t) => ({
      code: t.id,
      city: t.city,
      name: t.name,
      full_name: t.fullName,
      conference: t.conference,
      division: t.division,
    })),
    'on conflict (code) do update set city = excluded.city, name = excluded.name, full_name = excluded.full_name,\n' +
      '  conference = excluded.conference, division = excluded.division',
  );
  sql += `delete from public.base_dead_money where dataset = '${ds}';\n`;
  sql += `delete from public.base_players where dataset = '${ds}';\n\n`;
  sql += rowsSql(
    'public.base_players',
    league.players.map((p) => ({
      dataset,
      slug: p.id,
      team_code: p.teamId,
      first_name: p.firstName,
      last_name: p.lastName,
      nationality: p.nationality,
      role: p.role,
      secondary_role: p.secondaryRole,
      hand: p.hand,
      archetype: p.archetype,
      age: p.age,
      height_cm: p.heightCm,
      wingspan_cm: p.wingspanCm,
      weight_kg: p.weightKg,
      years_in_league: p.yearsInLeague,
      ratings: p.ratings,
      tendencies: p.tendencies,
      hidden: p.hidden,
    })),
  );
  sql += rowsSql(
    'public.base_contracts',
    league.contracts.map((c) => ({
      dataset,
      player_slug: c.playerId,
      team_code: c.teamId,
      type: c.type,
      salaries: c.salaries,
      options: c.options,
      guaranteed: c.guaranteed,
    })),
  );
  sql += rowsSql(
    'public.base_dead_money',
    league.deadMoney.map((d) => ({
      dataset,
      team_code: d.teamId,
      player_name: d.playerName,
      salaries: d.salaries,
    })),
  );
  return sql + 'commit;\n';
}
