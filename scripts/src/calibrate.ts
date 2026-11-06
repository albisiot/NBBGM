// pnpm sim:calibrate [partite]
// Gioca N partite tra le squadre della lega importata (o generata, se manca data/) e confronta le medie
// con gli intervalli NBA del documento di design.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  ARCHETYPE_PROFILES,
  autoSetup,
  generateLeague,
  overall,
  Rng,
  simulateGame,
  type GameResult,
  type LeagueData,
  type TeamSetup,
} from '@nbbgm/engine';
import { DATA_DIR } from './paths.ts';

const N = Number(process.argv[2] ?? 1000);

export function loadLeague(): { league: LeagueData; source: string } {
  const file = path.join(DATA_DIR, 'league-2026-27.json');
  if (existsSync(file))
    return { league: JSON.parse(readFileSync(file, 'utf8')) as LeagueData, source: 'giocatori reali' };
  return { league: generateLeague(new Rng('calibrazione'), ARCHETYPE_PROFILES), source: 'lega generata' };
}

/** Overall della squadra: media dell'overall pesata sui minuti obiettivo. */
export function teamRating(setup: TeamSetup): number {
  let sum = 0;
  for (const p of setup.players) sum += overall(p) * (setup.minutes[p.id] ?? 0);
  return sum / 240;
}

interface Target {
  label: string;
  value: (s: Summary) => number;
  lo: number;
  hi: number;
  fmt?: (x: number) => string;
}
type Summary = Record<string, number>;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const num = (x: number) => x.toFixed(1);

const TARGETS: Target[] = [
  { label: 'Punti', value: (s) => s.pts!, lo: 110, hi: 118 },
  { label: 'Possessi', value: (s) => s.poss!, lo: 96, hi: 102 },
  { label: 'Tiri da 2', value: (s) => s.fg2!, lo: 0.52, hi: 0.56, fmt: pct },
  { label: 'Tiri da 3', value: (s) => s.fg3!, lo: 0.35, hi: 0.37, fmt: pct },
  { label: 'Tentativi da 3', value: (s) => s.tpa!, lo: 34, hi: 39 },
  { label: 'Tiri liberi', value: (s) => s.ft!, lo: 0.76, hi: 0.8, fmt: pct },
  { label: 'Liberi tentati', value: (s) => s.fta!, lo: 20, hi: 24 },
  { label: 'Rimbalzi', value: (s) => s.reb!, lo: 42, hi: 46 },
  { label: 'Quota rimbalzi offensivi', value: (s) => s.orbShare!, lo: 0.22, hi: 0.28, fmt: pct },
  { label: 'Assist', value: (s) => s.ast!, lo: 24, hi: 28 },
  { label: 'Rubate', value: (s) => s.stl!, lo: 7, hi: 9 },
  { label: 'Stoppate', value: (s) => s.blk!, lo: 4, hi: 6 },
  { label: 'Palle perse', value: (s) => s.tov!, lo: 13, hi: 15 },
  { label: 'Vittorie in casa', value: (s) => s.homeWin!, lo: 0.55, hi: 0.58, fmt: pct },
  { label: 'Vittorie con overall +5 (campo neutro)', value: (s) => s.plus5!, lo: 0.65, hi: 0.7, fmt: pct },
  { label: 'Infortuni medi o gravi per squadra a stagione', value: (s) => s.injSerious!, lo: 2, hi: 4 },
  // Finali: nella NBA circa il 6% delle partite va ai supplementari e circa una su sei si decide di 3 punti o meno.
  // Su molte partite il motore sta intorno al 4,5-5% di supplementari: spingere di più le rimonte renderebbe troppo
  // fragili i vantaggi nel finale (chi è avanti di 5 a 5 minuti dalla fine vince circa tre volte su quattro)
  { label: 'Partite ai supplementari', value: (s) => s.otShare!, lo: 0.04, hi: 0.07, fmt: pct },
  { label: 'Partite decise di 3 punti o meno', value: (s) => s.close3!, lo: 0.14, hi: 0.2, fmt: pct },
];

/**
 * Regressione logistica vittoria della squadra di casa ~ differenza di overall (metodo di Newton).
 * Restituisce la probabilità di vittoria con +5 di overall su campo neutro: stima più stabile
 * del conteggio delle sole partite con differenza tra 4 e 6.
 */
export function favoriteWinAt5(games: { result: GameResult; ratings: [number, number] }[]): number {
  let a = 0;
  let b = 0;
  const xs = games.map((g) => g.ratings[0] - g.ratings[1]);
  const ys = games.map((g) => (g.result.home.score > g.result.away.score ? 1 : 0));
  for (let it = 0; it < 30; it++) {
    let ga = 0,
      gb = 0,
      haa = 0,
      hab = 0,
      hbb = 0;
    xs.forEach((x, i) => {
      const p = 1 / (1 + Math.exp(-(a + b * x)));
      const w = p * (1 - p);
      ga += ys[i]! - p;
      gb += (ys[i]! - p) * x;
      haa += w;
      hab += w * x;
      hbb += w * x * x;
    });
    const det = haa * hbb - hab * hab;
    if (det === 0) break;
    a += (hbb * ga - hab * gb) / det;
    b += (haa * gb - hab * ga) / det;
  }
  return 1 / (1 + Math.exp(-5 * b));
}

export function summarize(games: { result: GameResult; ratings: [number, number] }[]): Summary {
  const s: Summary = {};
  let teamGames = 0;
  const add = (k: string, v: number) => (s[k] = (s[k] ?? 0) + v);
  let homeWins = 0;
  let close = 0;
  let closeWins = 0;
  let injuriesSerious = 0;
  let injuriesAll = 0;
  let ot = 0;
  let close3 = 0;
  for (const { result, ratings } of games) {
    if (result.home.score > result.away.score) homeWins++;
    if (result.overtimes) ot++;
    if (Math.abs(result.home.score - result.away.score) <= 3) close3++;
    const diff = ratings[0] - ratings[1];
    if (Math.abs(diff) >= 4 && Math.abs(diff) <= 6) {
      close++;
      if (diff > 0 === result.home.score > result.away.score) closeWins++;
    }
    injuriesAll += result.injuries.length;
    injuriesSerious += result.injuries.filter((i) => i.severity !== 'light').length;
    for (const [me, opp] of [
      [result.home, result.away],
      [result.away, result.home],
    ] as const) {
      const t = me.totals;
      teamGames++;
      add('pts', t.pts);
      add('poss', t.possessions);
      add('fgm2', t.fgm - t.tpm);
      add('fga2', t.fga - t.tpa);
      add('tpm', t.tpm);
      add('tpa', t.tpa);
      add('ftm', t.ftm);
      add('fta', t.fta);
      add('reb', t.orb + t.drb);
      add('orb', t.orb);
      add('oppDrb', opp.totals.drb);
      add('ast', t.ast);
      add('stl', t.stl);
      add('blk', t.blk);
      add('tov', t.tov);
      add('pf', t.pf);
      for (const [z, v] of Object.entries(t.zones)) {
        add(`z_${z}_m`, v.m);
        add(`z_${z}_a`, v.a);
      }
    }
  }
  const zoneTotal = ['rim', 'short', 'mid', 'three'].reduce((a, z) => a + (s[`z_${z}_a`] ?? 0), 0);
  for (const z of ['rim', 'short', 'mid', 'three']) {
    s[`share_${z}`] = (s[`z_${z}_a`] ?? 0) / zoneTotal;
    s[`pct_${z}`] = (s[`z_${z}_m`] ?? 0) / (s[`z_${z}_a`] ?? 1);
  }
  const per = (k: string) => (s[k] ?? 0) / teamGames;
  return {
    pts: per('pts'),
    poss: per('poss'),
    fg2: (s.fgm2 ?? 0) / (s.fga2 ?? 1),
    fg3: (s.tpm ?? 0) / (s.tpa ?? 1),
    tpa: per('tpa'),
    ft: (s.ftm ?? 0) / (s.fta ?? 1),
    fta: per('fta'),
    reb: per('reb'),
    orbShare: (s.orb ?? 0) / ((s.orb ?? 0) + (s.oppDrb ?? 0)),
    ast: per('ast'),
    stl: per('stl'),
    blk: per('blk'),
    tov: per('tov'),
    pf: per('pf'),
    homeWin: homeWins / games.length,
    plus5: favoriteWinAt5(games),
    plus5Raw: close ? closeWins / close : NaN,
    plus5Games: close,
    injSerious: (injuriesSerious / teamGames) * 82,
    injAll: (injuriesAll / teamGames) * 82,
    otShare: ot / games.length,
    close3: close3 / games.length,
    ...Object.fromEntries(Object.entries(s).filter(([k]) => k.startsWith('share_') || k.startsWith('pct_'))),
  };
}

/** Migliori per media a partita (almeno 20 partite) ed energia finale dei titolari. */
export function playerLeaders(results: GameResult[]) {
  const acc = new Map<
    string,
    { name: string; g: number; pts: number; reb: number; ast: number; min: number }
  >();
  let energy = 0;
  let starters = 0;
  for (const r of results) {
    for (const side of [r.home, r.away]) {
      for (const l of side.box) {
        if (l.seconds === 0) continue;
        const a = acc.get(l.playerId) ?? { name: l.name, g: 0, pts: 0, reb: 0, ast: 0, min: 0 };
        a.g++;
        a.pts += l.pts;
        a.reb += l.orb + l.drb;
        a.ast += l.ast;
        a.min += l.seconds / 60;
        acc.set(l.playerId, a);
        if (l.starter) {
          energy += r.finalEnergy[l.playerId] ?? 0;
          starters++;
        }
      }
    }
  }
  const list = [...acc.values()].filter((a) => a.g >= 20);
  const top = (k: 'pts' | 'reb' | 'ast' | 'min') =>
    list
      .map((a) => ({ name: a.name, value: a[k] / a.g }))
      .sort((x, y) => y.value - x.value)
      .slice(0, 5);
  return {
    starterEnergy: energy / starters,
    top: {
      'Punti a partita': top('pts'),
      'Rimbalzi a partita': top('reb'),
      'Assist a partita': top('ast'),
      'Minuti a partita': top('min'),
    },
  };
}

function main() {
  const { league, source } = loadLeague();
  const setups = league.teams.map((t) =>
    autoSetup(
      t.id,
      league.players.filter((p) => p.teamId === t.id),
    ),
  );
  const ratings = setups.map(teamRating);
  const rng = new Rng('calendario-calibrazione');
  const games: { result: GameResult; ratings: [number, number] }[] = [];
  const start = performance.now();
  for (let g = 0; g < N; g++) {
    const h = rng.int(0, setups.length - 1);
    let a = rng.int(0, setups.length - 2);
    if (a >= h) a++;
    const result = simulateGame(setups[h]!, setups[a]!, `calibrazione-${g}`);
    games.push({ result, ratings: [ratings[h]!, ratings[a]!] });
  }
  const ms = (performance.now() - start) / N;
  const s = summarize(games);
  const leaders = playerLeaders(games.map((g) => g.result));

  console.log(`\nCalibrazione: ${N} partite tra le squadre della ${source}, ${ms.toFixed(1)} ms a partita\n`);
  const rows = TARGETS.map((t) => {
    const v = t.value(s);
    const f = t.fmt ?? num;
    const ok = v >= t.lo && v <= t.hi;
    return [t.label, f(v), `${f(t.lo)} - ${f(t.hi)}`, ok ? 'ok' : 'FUORI'];
  });
  const w = [0, 1, 2, 3].map((i) =>
    Math.max(...rows.map((r) => r[i]!.length), ['Statistica', 'Media', 'Obiettivo', ''][i]!.length),
  );
  const line = (r: string[]) => r.map((c, i) => c.padEnd(w[i]!)).join('  ');
  console.log(line(['Statistica', 'Media', 'Obiettivo', '']));
  for (const r of rows) console.log(line(r));
  console.log(
    `\nPartite con differenza di overall tra 4 e 6: ${s.plus5Games}, vinte dalla più forte: ${pct(s.plus5Raw!)}`,
  );
  console.log(
    `Infortuni (tutti) per squadra a stagione: ${num(s.injAll!)}; falli per squadra: ${num(s.pf!)}`,
  );
  console.log(`Overall di squadra: da ${num(Math.min(...ratings))} a ${num(Math.max(...ratings))}`);
  const zl = { rim: 'al ferro', short: 'da vicino', mid: 'dalla media', three: 'da tre' } as const;
  console.log(
    'Tiri per zona (quota e %): ' +
      (Object.keys(zl) as (keyof typeof zl)[])
        .map((z) => `${zl[z]} ${pct(s[`share_${z}`]!)} / ${pct(s[`pct_${z}`]!)}`)
        .join(', '),
  );
  console.log(
    'Riferimento NBA: al ferro ~31% / 66%, da vicino ~18% / 45%, dalla media ~10% / 42%, da tre ~41% / 36%',
  );
  console.log(`Energia media a fine partita dei titolari: ${num(leaders.starterEnergy)}`);
  for (const [label, list] of Object.entries(leaders.top)) {
    console.log(`${label}: ${list.map((x) => `${x.name} ${num(x.value)}`).join(', ')}`);
  }
  const fuori = rows.filter((r) => r[3] === 'FUORI').length;
  console.log(fuori ? `\n${fuori} valori fuori intervallo.` : '\nTutti i valori sono negli intervalli.');
  if (ms > 30) console.log(`Attenzione: ${ms.toFixed(1)} ms a partita, sopra l'obiettivo di 30 ms.`);
}

if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) main();
