// pnpm data:import [file giocatori] [file contratti] [--profili]
// Legge i due Excel, controlla i dati e scrive in data/ la lega e il report di qualità.
// Con --profili aggiorna anche i profili degli archetipi usati dal generatore (solo medie, nessun nome). Di solito
// restano quelli ricavati dal file v2: quelli dei dati 2K del v4, anche riportati sulla scala del v2, generano classi
// del draft più deboli (overall medio 51,6 contro 54,5; l'1% migliore da 75 invece che da 81) e nelle simulazioni
// di 10 stagioni le squadre in rosso salgono da circa 14 a 16 in media. Cambiarli cambia anche le classi del draft
// delle leghe in corso e le impronte del test golden.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { computeArchetypeProfiles, validateLeague } from '@nbbgm/engine';
import { openWorkbook, readSheet } from './import/excel.ts';
import { parseLeague } from './import/parse.ts';
import { qualityReport } from './import/report.ts';
import { toReferenceScale } from './import/scale.ts';
import { DATA_DIR, ROOT } from './paths.ts';

const SEASON = '2026-27';
const args = process.argv.slice(2);
const files = args.filter((a) => !a.startsWith('--'));
const writeProfiles = args.includes('--profili');
const playersFile = files[0] ?? path.join(ROOT, 'NBA_2026-27_valutazioni_v4_completo.xlsx');
const contractsFile = files[1] ?? path.join(ROOT, 'NBA_2026-27_contratti.xlsx');

async function main() {
  console.log(`Giocatori: ${playersFile}\nContratti: ${contractsFile}`);
  const pw = await openWorkbook(playersFile);
  const cw = await openWorkbook(contractsFile);
  const players = readSheet(pw, 'GIOCATORI', 2);
  const contracts = readSheet(cw, 'CONTRATTI', 1);
  const dead = readSheet(cw, 'TAGLIATI', 1);

  const parsed = parseLeague({
    playerHeader: players.header,
    playerRows: players.rows,
    firstPlayerRow: 3,
    contractHeader: contracts.header,
    contractRows: contracts.rows,
    deadHeader: dead.header,
    deadRows: dead.rows,
    season: SEASON,
  });
  const { errors, dunkestPrice } = parsed;
  if (errors.length) {
    console.error(`\nFile rifiutato: ${errors.length} errori`);
    for (const e of errors.slice(0, 50)) console.error(`- ${e}`);
    if (errors.length > 50) console.error(`... e altri ${errors.length - 50}`);
    process.exitCode = 1;
    return;
  }

  // Abilità sulla scala su cui sono calibrati motore ed economia (vedi scale.ts)
  const scaled = toReferenceScale(parsed.league.players);
  const league = { ...parsed.league, players: scaled.players };

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
  await writeFile(reportFile, qualityReport(league, issues, dunkestPrice, scaled.changes));

  const written = [leagueFile, reportFile];
  if (writeProfiles) {
    // Profili dai soli giocatori nelle rose NBA: dal v4 tra gli svincolati ci sono anche giocatori europei con
    // valori stimati dalle mediane dei giocatori NBA
    const profiles = computeArchetypeProfiles(league.players.filter((p) => p.teamId !== null));
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
    written.push(`${profilesFile} (${profiles.length} archetipi)`);
  }

  console.log(`\nImport riuscito: ${league.players.length} giocatori, ${league.contracts.length} contratti.`);
  console.log(`Avvisi: ${issues.length}`);
  for (const w of issues) console.log(`- ${w.message}`);
  console.log(`\nScritti:\n${written.map((w) => `- ${w}`).join('\n')}`);
  if (!writeProfiles) console.log('Profili degli archetipi invariati (per rigenerarli: --profili).');
}

await main();
