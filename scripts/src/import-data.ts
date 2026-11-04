// pnpm data:import [file giocatori] [file contratti]
// Legge i due Excel, controlla i dati e scrive in data/ la lega e il report di qualità.
// Aggiorna anche i profili degli archetipi usati dal generatore (solo medie, nessun nome).
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { computeArchetypeProfiles, validateLeague } from '@nbbgm/engine';
import { openWorkbook, readSheet } from './import/excel.ts';
import { parseLeague } from './import/parse.ts';
import { qualityReport } from './import/report.ts';
import { DATA_DIR, ROOT } from './paths.ts';

const SEASON = '2026-27';
const playersFile = process.argv[2] ?? path.join(ROOT, 'NBA_2026-27_valutazioni_v2.xlsx');
const contractsFile = process.argv[3] ?? path.join(ROOT, 'NBA_2026-27_contratti.xlsx');

async function main() {
  console.log(`Giocatori: ${playersFile}\nContratti: ${contractsFile}`);
  const pw = await openWorkbook(playersFile);
  const cw = await openWorkbook(contractsFile);
  const players = readSheet(pw, 'GIOCATORI', 2);
  const contracts = readSheet(cw, 'CONTRATTI', 1);
  const dead = readSheet(cw, 'TAGLIATI', 1);

  const { league, errors, dunkestPrice } = parseLeague({
    playerHeader: players.header,
    playerRows: players.rows,
    firstPlayerRow: 3,
    contractHeader: contracts.header,
    contractRows: contracts.rows,
    deadHeader: dead.header,
    deadRows: dead.rows,
    season: SEASON,
  });
  if (errors.length) {
    console.error(`\nFile rifiutato: ${errors.length} errori`);
    for (const e of errors.slice(0, 50)) console.error(`- ${e}`);
    if (errors.length > 50) console.error(`... e altri ${errors.length - 50}`);
    process.exitCode = 1;
    return;
  }

  const issues = validateLeague(league);
  const blocking = issues.filter((i) => i.level === 'error');
  if (blocking.length) {
    console.error(`\nLega non valida: ${blocking.length} errori`);
    for (const e of blocking.slice(0, 50)) console.error(`- ${e.message}`);
    process.exitCode = 1;
    return;
  }

  await mkdir(DATA_DIR, { recursive: true });
  const leagueFile = path.join(DATA_DIR, `league-${SEASON}.json`);
  const reportFile = path.join(DATA_DIR, 'import-report.md');
  await writeFile(leagueFile, JSON.stringify(league));
  await writeFile(reportFile, qualityReport(league, issues, dunkestPrice));

  const profiles = computeArchetypeProfiles(league.players);
  const profilesFile = path.join(ROOT, 'packages/engine/src/archetype-profiles.ts');
  await writeFile(
    profilesFile,
    [
      '// File generato da `pnpm data:import`: profili degli archetipi ricavati dai giocatori reali.',
      '// Contiene solo medie e dispersioni, nessun dato dei singoli giocatori.',
      "import type { ArchetypeProfile } from './profiles.ts';",
      '',
      `export const ARCHETYPE_PROFILES: readonly ArchetypeProfile[] = ${JSON.stringify(profiles, null, 2)};`,
      '',
    ].join('\n'),
  );

  console.log(`\nImport riuscito: ${league.players.length} giocatori, ${league.contracts.length} contratti.`);
  console.log(`Avvisi: ${issues.length}`);
  for (const w of issues) console.log(`- ${w.message}`);
  console.log(
    `\nScritti:\n- ${leagueFile}\n- ${reportFile}\n- ${profilesFile} (${profiles.length} archetipi)`,
  );
}

await main();
