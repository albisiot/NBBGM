// pnpm sim:seasons [stagioni] [--veloce] [--tetto=0.7]
// --veloce usa la partita finta dei test (per provare crescita ed economia in pochi secondi: energia e
// infortuni non sono significativi); --tetto prova un altro valore di POTENTIAL_SHRINK.
// Gioca N stagioni complete (calendario, playoff, offseason, bot) partendo dalla lega importata e controlla
// le metriche di lungo periodo del documento: overall stabili, nessuna dinastia, bilanci, energia, infortuni.
import {
  ENERGY_RECOVERY,
  MAX_STANDARD,
  MIN_STANDARD,
  autoSetup,
  createLeagueState,
  overall,
  playPostseasonTurn,
  playRegularTurn,
  runOffseason,
  simulateGame,
  standardRoster,
  twoWayRoster,
  validateLeague,
  validateSchedule,
  type GameResult,
  type LeagueState,
  type PlayGame,
  type TeamSetup,
} from '@nbbgm/engine';
import { loadLeague } from './calibrate.ts';
import { quickGame } from './quick-game.ts';

const args = process.argv.slice(2);
const SEASONS = Number(args.find((a) => !a.startsWith('--')) ?? 10);
const FAST = args.includes('--veloce');
const SHRINK = args.find((a) => a.startsWith('--tetto='))?.split('=')[1];
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
const num = (x: number, d = 1) => x.toFixed(d);
const mln = (x: number) => `${(x / 1e6).toFixed(0)} mln`;

interface SeasonMetrics {
  year: number;
  champion: string;
  best: string;
  top150: number;
  stars80: number;
  stars90: number;
  rotationAge: number;
  injuriesSerious: number;
  energy3436: number;
  negativeBalance: number;
  overTax: number;
  trades: number;
  signings: number;
  retirements: number;
  problems: string[];
  seconds: number;
}

function leagueSnapshot(state: LeagueState) {
  const ovr = state.players
    .filter((p) => p.teamId !== null)
    .map((p) => overall(p))
    .sort((a, b) => b - a);
  const top150 = ovr.slice(0, 150);
  const rotation = state.teams.flatMap((t) =>
    state.players
      .filter((p) => p.teamId === t.id)
      .sort((a, b) => overall(b) - overall(a))
      .slice(0, 8),
  );
  return {
    top150: top150.reduce((a, b) => a + b, 0) / top150.length,
    stars80: ovr.filter((o) => o >= 80).length,
    stars90: ovr.filter((o) => o >= 90).length,
    rotationAge: rotation.reduce((a, p) => a + p.age, 0) / rotation.length,
  };
}

function checkState(state: LeagueState): string[] {
  const problems = validateLeague({
    season: '',
    teams: state.teams,
    players: state.players,
    contracts: state.contracts,
    deadMoney: state.deadMoney,
  })
    .filter((i) => i.level === 'error')
    .map((i) => i.message);
  problems.push(...validateSchedule(state.teams, state.config.year, state.schedule));
  for (const t of state.teams) {
    const n = standardRoster(state, t.id).length;
    if (n < MIN_STANDARD || n > MAX_STANDARD) problems.push(`${t.id}: ${n} contratti standard`);
    if (twoWayRoster(state, t.id).length > 3) problems.push(`${t.id}: troppi two-way`);
  }
  if (new Set(state.players.map((p) => p.id)).size !== state.players.length)
    problems.push('id di giocatori duplicati');
  return problems;
}

/** Energia a inizio partita di un giocatore che gioca sempre gli stessi minuti, dopo 20 partite di fila. */
function energyExperiment(state: LeagueState, minutes: number): number {
  // Media su otto squadre, con la stella sempre alla Resistenza mediana della lega
  const runs = [0, 4, 8, 12, 16, 20, 24, 28].map((i) => energyRun(state, minutes, i));
  return runs.reduce((a, b) => a + b, 0) / runs.length;
}

function energyRun(state: LeagueState, minutes: number, teamIndex: number): number {
  const team = state.teams[teamIndex]!;
  const oppTeam = state.teams[(teamIndex + 1) % state.teams.length]!;
  const players = state.players
    .filter((p) => p.teamId === team.id && !p.injury)
    .map((p) => ({ ...p, energy: 100 }));
  const opp = state.players.filter((p) => p.teamId === oppTeam.id && !p.injury);
  const base = autoSetup(team.id, players);
  const star = base.starters[0];
  const others = base.players.filter((p) => p.id !== star);
  const rest = 240 - minutes;
  const otherTotal = others.reduce((a, p) => a + (base.minutes[p.id] ?? 0), 0);
  const mins: Record<string, number> = { [star]: minutes };
  for (const p of others) mins[p.id] = ((base.minutes[p.id] ?? 0) * rest) / otherTotal;
  let energy = 100;
  const starts: number[] = [];
  // Resistenza mediana della lega: il risultato non dipende da chi è la stella di quella squadra
  const staminas = state.players.map((x) => x.ratings.stamina).sort((x, y) => x - y);
  const stamina = staminas[Math.floor(staminas.length / 2)]!;
  const p = { ...players.find((x) => x.id === star)! };
  p.ratings = { ...p.ratings, stamina };
  for (let g = 0; g < 20; g++) {
    starts.push(energy);
    const setup: TeamSetup = {
      ...base,
      players: base.players.map((x) => (x.id === star ? { ...p, energy } : x)),
      minutes: mins,
    };
    const r = simulateGame(setup, autoSetup(oppTeam.id, opp), `energia-${minutes}-${teamIndex}-${g}`);
    energy = Math.min(
      100,
      (r.home.box.find((l) => l.playerId === star) ? r.finalEnergy[star]! : energy) +
        ENERGY_RECOVERY * (0.7 + (0.6 * p.ratings.stamina) / 100),
    );
  }
  const tail = starts.slice(10);
  return tail.reduce((a, b) => a + b, 0) / tail.length;
}

function main() {
  const { league, source } = loadLeague();
  const state = createLeagueState(league, 'stagioni', {
    potentialOnOverallScale: source !== 'giocatori reali',
    ...(SHRINK ? { potentialShrink: Number(SHRINK) } : {}),
  });
  const initial = leagueSnapshot(state);
  const pot80 = state.players.filter((p) => p.hidden.potential >= 80).length;
  console.log(
    `\n${SEASONS} stagioni a partire dalla ${source}${FAST ? ' (partite finte)' : ''}. Overall iniziali: media dei primi 150 ${num(initial.top150)}, ${initial.stars80} giocatori 80+, ${pot80} con potenziale 80+\n`,
  );

  const metrics: SeasonMetrics[] = [];
  for (let s = 0; s < SEASONS; s++) {
    const start = performance.now();
    const year = state.config.year;
    const problems = checkState(state);
    let serious = 0;
    const energyStarts = new Map<string, { e: number; g: number; min: number }>();
    const play: PlayGame = (home, away, seed) => {
      const r: GameResult = FAST ? quickGame(home, away, seed) : simulateGame(home, away, seed);
      serious += r.injuries.filter((i) => i.severity !== 'light').length;
      for (const [setup, side] of [
        [home, r.home],
        [away, r.away],
      ] as const) {
        for (const p of setup.players) {
          const line = side.box.find((l) => l.playerId === p.id);
          if (!line) continue;
          const x = energyStarts.get(p.id) ?? { e: 0, g: 0, min: 0 };
          x.e += p.energy;
          x.g++;
          x.min += line.seconds / 60;
          energyStarts.set(p.id, x);
        }
      }
      return r;
    };
    while (state.phase === 'regular') playRegularTurn(state, play);
    const negativeBalance = state.teams.filter((t) => t.balance < 0).length;
    const overTax = state.teams.filter((t) => t.taxHistory.at(-1)).length;
    while (state.phase === 'postseason') playPostseasonTurn(state, play);
    const summary = runOffseason(state);
    const snap = leagueSnapshot(state);
    const starters = [...energyStarts.values()].filter(
      (x) => x.g >= 40 && x.min / x.g >= 33 && x.min / x.g <= 36,
    );
    metrics.push({
      year,
      champion: summary.championId ?? '-',
      best: `${summary.bestRecordId} ${summary.records[summary.bestRecordId]!.w}-${summary.records[summary.bestRecordId]!.l}`,
      top150: snap.top150,
      stars80: snap.stars80,
      stars90: snap.stars90,
      rotationAge: snap.rotationAge,
      injuriesSerious: serious / 30,
      energy3436: starters.reduce((a, x) => a + x.e / x.g, 0) / Math.max(1, starters.length),
      negativeBalance,
      overTax,
      trades: summary.trades,
      signings: summary.signings,
      retirements: summary.retirements,
      problems: [...problems, ...checkState(state)],
      seconds: (performance.now() - start) / 1000,
    });
    const m = metrics.at(-1)!;
    console.log(
      `${year}-${(year + 1) % 100}: campione ${m.champion}, miglior record ${m.best}; primi 150 ${num(m.top150)}, 80+ ${m.stars80}; ` +
        `infortuni medi/gravi ${num(m.injuriesSerious)}; energia titolari ${num(m.energy3436)}; in rosso ${m.negativeBalance}, sopra la tassa ${m.overTax}; ` +
        `scambi ${m.trades}, firme ${m.signings}, ritiri ${m.retirements}; problemi ${m.problems.length} (${num(m.seconds, 0)} s)`,
    );
    for (const p of m.problems.slice(0, 5)) console.log(`   - ${p}`);
  }

  // Metriche di lungo periodo
  const titles = new Map<string, number>();
  for (const m of metrics) titles.set(m.champion, (titles.get(m.champion) ?? 0) + 1);
  const maxTitles = Math.max(...titles.values());
  const last = metrics.at(-1)!;
  const avg = (f: (m: SeasonMetrics) => number) => metrics.reduce((a, m) => a + f(m), 0) / metrics.length;
  const energy35 = energyExperiment(state, 35);
  const energy42 = energyExperiment(state, 42);
  const checks: [string, string, boolean][] = [
    [
      'Overall dei primi 150 (scarto dall’inizio)',
      `${num(last.top150 - initial.top150)}`,
      Math.abs(last.top150 - initial.top150) <= 2,
    ],
    [
      'Giocatori 80+ (rispetto all’inizio)',
      `${last.stars80} su ${initial.stars80}`,
      last.stars80 >= initial.stars80 * 0.6 && last.stars80 <= initial.stars80 * 1.5,
    ],
    [
      'Titoli massimi di una squadra',
      `${maxTitles} (${titles.size} campioni diversi)`,
      maxTitles <= Math.max(3, Math.ceil(SEASONS * 0.4)),
    ],
    [
      'Squadre in rosso a fine regular season (media)',
      num(avg((m) => m.negativeBalance)),
      avg((m) => m.negativeBalance) <= 15,
    ],
    [
      'Infortuni medi o gravi per squadra a stagione',
      num(avg((m) => m.injuriesSerious)),
      avg((m) => m.injuriesSerious) >= 2 && avg((m) => m.injuriesSerious) <= 4,
    ],
    ['Energia a inizio gara, titolare a 35 minuti', num(energy35), energy35 > 85],
    ['Energia a inizio gara, giocatore a 42 minuti', num(energy42), energy42 < 75],
    [
      'Problemi di validità (rose, contratti, calendario)',
      String(metrics.reduce((a, m) => a + m.problems.length, 0)),
      metrics.every((m) => m.problems.length === 0),
    ],
  ];
  console.log('\nMetriche di lungo periodo');
  const w = Math.max(...checks.map((c) => c[0].length));
  for (const [label, value, ok] of checks)
    console.log(`${label.padEnd(w)}  ${value.padEnd(24)}  ${ok ? 'ok' : 'FUORI'}`);
  console.log(
    `\nScambi tra bot per stagione: ${num(avg((m) => m.trades))}; firme: ${num(
      avg((m) => m.signings),
      0,
    )}; ritiri: ${num(
      avg((m) => m.retirements),
      0,
    )}`,
  );
  console.log(
    `Età media delle rotazioni: da ${num(metrics[0]!.rotationAge)} a ${num(last.rotationAge)}; saldi: da ${mln(Math.min(...state.teams.map((t) => t.balance)))} a ${mln(Math.max(...state.teams.map((t) => t.balance)))}`,
  );
  console.log(`Campioni: ${metrics.map((m) => m.champion).join(', ')}`);
  console.log(`Squadre sopra la tassa per stagione: ${metrics.map((m) => m.overTax).join(', ')}`);
  const fuori = checks.filter((c) => !c[2]).length;
  console.log(fuori ? `\n${fuori} metriche fuori obiettivo.` : '\nTutte le metriche sono negli obiettivi.');
  void pct;
}

main();
