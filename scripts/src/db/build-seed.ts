// pnpm db:seed — scrive supabase/seed.sql (lega di prova generata, caricata da `supabase db reset`) e, se c'è
// l'import dei file Excel, data/base.sql con i giocatori reali da caricare a mano nel progetto Supabase.
import type { LeagueData } from '@nbbgm/engine';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DATA_DIR, ROOT } from '../paths.ts';
import { buildBaseSql } from './base.ts';
import { buildSeedSql } from './seed.ts';

const seedFile = path.join(ROOT, 'supabase', 'seed.sql');
const seedSql = buildSeedSql();
writeFileSync(seedFile, seedSql);
console.log(`Scritto ${path.relative(ROOT, seedFile)} (${(seedSql.length / 1024).toFixed(0)} KB)`);

const leagueFile = path.join(DATA_DIR, 'league-2026-27.json');
if (existsSync(leagueFile)) {
  const league = JSON.parse(readFileSync(leagueFile, 'utf8')) as LeagueData;
  const baseFile = path.join(DATA_DIR, 'base.sql');
  const baseSql = buildBaseSql(league);
  writeFileSync(baseFile, baseSql);
  console.log(
    `Scritto ${path.relative(ROOT, baseFile)}: ${league.players.length} giocatori reali (resta fuori dal repo)`,
  );
} else {
  console.log('Nessun import dei file Excel in data/: salto data/base.sql (pnpm data:import per crearlo)');
}
