// pnpm sim:seasons [stagioni] [--veloce] [--tetto=0.7] [--ricavi=180] [--seme=stagioni]
// --veloce usa la partita finta dei test (per provare crescita ed economia in pochi secondi: energia e
// infortuni non sono significativi); --tetto prova un altro valore di POTENTIAL_SHRINK; --ricavi prova altri ricavi
// stagionali 2026-27 in milioni; --seme gioca con un altro seed (per vedere quanto le metriche dipendono dal caso).
// Gioca N stagioni complete (calendario, playoff, offseason, bot) partendo dalla lega importata e controlla
// le metriche di lungo periodo del documento: overall stabili, nessuna dinastia, bilanci, energia, infortuni.
import {
  CONFIG_2026_27,
  MAX_STANDARD,
  MIN_STANDARD,
  autoSetup,
  backToBacks,
  createLeagueState,
  overall,
  playPostseasonTurn,
  playRegularTurn,
  recoverEnergy,
  runOffseason,
  simulateGame,
  standardRoster,
  teamDays,
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
const REVENUE = args.find((a) => a.startsWith('--ricavi='))?.split('=')[1];
const SEED = args.find((a) => a.startsWith('--seme='))?.split('=')[1] ?? 'stagioni';
const pct = (x: number) => `${(x * 100).toFixed(0)}%`;
/** Il monte stipendi mediano può stare fino al 2% sotto il cap. */
const PAYROLL_CAP_TOLERANCE = 0.98;
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
  /** Partite al giorno nel calendario (senza l'ultimo giorno, con tutte e 30) e back-to-back per squadra. */
  perDayMin: number;
  perDayMax: number;
  b2bMin: number;
  b2bMax: number;
  b2bMean: number;
  negativeBalance: number;
  overTax: number;
  /** Monte stipendi mediano a fine regular season, rispetto al cap e alla soglia della tassa. */
  payrollMedian: number;
  cap: number;
  taxLine: number;
  underMinimum: number;
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

interface EnergyRun {
  /** Energia media a inizio gara (partite dalla 11ª alla 30ª), e nella seconda sera dei back-to-back. */
  energy: number;
  backToBack: number;
  minutes: number;
}

/**
 * Energia a inizio partita di un giocatore che gioca sempre gli stessi minuti, nelle prime 30 partite del
 * calendario vero della sua squadra: tra una partita e l'altra recupera per le notti fino alla prossima.
 */
function energyExperiment(state: LeagueState, minutes: number): EnergyRun {
  // Media su tutte le squadre, con la stella sempre alla Resistenza mediana della lega
  const runs = state.teams.map((_, i) => energyRun(state, minutes, i));
  const avg = (f: (r: EnergyRun) => number) => runs.reduce((a, r) => a + f(r), 0) / runs.length;
  return {
    energy: avg((r) => r.energy),
    backToBack: avg((r) => r.backToBack),
    minutes: avg((r) => r.minutes),
  };
}

function energyRun(state: LeagueState, minutes: number, teamIndex: number): EnergyRun {
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
  const b2b: number[] = [];
  const played: number[] = [];
  const days = teamDays(state.schedule).get(team.id) ?? [];
  // Resistenza mediana della lega: il risultato non dipende da chi è la stella di quella squadra
  const staminas = state.players.map((x) => x.ratings.stamina).sort((x, y) => x - y);
  const stamina = staminas[Math.floor(staminas.length / 2)]!;
  const p = { ...players.find((x) => x.id === star)! };
  p.ratings = { ...p.ratings, stamina };
  for (let g = 0; g < 30; g++) {
    if (g >= 10) starts.push(energy);
    if (g >= 10 && g > 0 && days[g]! - days[g - 1]! === 1) b2b.push(energy);
    const setup: TeamSetup = {
      ...base,
      players: base.players.map((x) => (x.id === star ? { ...p, energy } : x)),
      minutes: mins,
    };
    const r = simulateGame(setup, autoSetup(oppTeam.id, opp), `energia-${minutes}-${teamIndex}-${g}`);
    const line = r.home.box.find((l) => l.playerId === star);
    // I minuti contano nelle partite senza infortunio e senza problemi di falli (al massimo 3) e nei tempi
    // regolamentari: "salvo falli", come dice l'obiettivo
    if (line && line.pf <= 3 && r.overtimes === 0 && !r.injuries.some((i) => i.playerId === star))
      played.push(line.seconds / 60);
    energy = recoverEnergy(line ? r.finalEnergy[star]! : energy, p.ratings.stamina, days[g + 1]! - days[g]!);
  }
  const mean = (x: number[]) => x.reduce((a, b) => a + b, 0) / Math.max(1, x.length);
  return { energy: mean(starts), backToBack: mean(b2b), minutes: mean(played.slice(-20)) };
}

function main() {
  const { league, source } = loadLeague();
  const state = createLeagueState(league, SEED, {
    potentialOnOverallScale: source !== 'giocatori reali',
    ...(SHRINK ? { potentialShrink: Number(SHRINK) } : {}),
    ...(REVENUE ? { config: { ...CONFIG_2026_27, revenue: Number(REVENUE) * 1e6 } } : {}),
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
    const perDay = new Map<number, number>();
    for (const g of state.schedule) perDay.set(g.day, (perDay.get(g.day) ?? 0) + 1);
    const dayCounts = [...perDay.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([, n]) => n)
      .slice(0, -1);
    const b2b = [...backToBacks(state.schedule).values()];
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
    const settlement = state.lastSettlement ?? [];
    const payrolls = settlement.map((x) => x.payroll).sort((a, b) => a - b);
    const payrollMedian = (payrolls[14]! + payrolls[15]!) / 2;
    const underMinimum = settlement.filter((x) => x.shortfall > 0).length;
    const { salaryCap: cap, luxuryTax: taxLine } = state.config;
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
      perDayMin: Math.min(...dayCounts),
      perDayMax: Math.max(...dayCounts),
      b2bMin: Math.min(...b2b),
      b2bMax: Math.max(...b2b),
      b2bMean: b2b.reduce((a, b) => a + b, 0) / b2b.length,
      negativeBalance,
      overTax,
      payrollMedian,
      cap,
      taxLine,
      underMinimum,
      trades: summary.trades,
      signings: summary.signings,
      retirements: summary.retirements,
      problems: [...problems, ...checkState(state)],
      seconds: (performance.now() - start) / 1000,
    });
    const m = metrics.at(-1)!;
    console.log(
      `${year}-${(year + 1) % 100}: campione ${m.champion}, miglior record ${m.best}; primi 150 ${num(m.top150)}, 80+ ${m.stars80}; ` +
        `partite al giorno ${m.perDayMin}-${m.perDayMax}, back-to-back ${m.b2bMin}-${m.b2bMax}; ` +
        `infortuni medi/gravi ${num(m.injuriesSerious)}; energia titolari ${num(m.energy3436)}; in rosso ${m.negativeBalance}, sopra la tassa ${m.overTax}, ` +
        `sotto il minimo ${m.underMinimum}, monte mediano ${mln(m.payrollMedian)} (cap ${mln(m.cap)}, tassa ${mln(m.taxLine)}); ` +
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
  // Il bilancio deve contare: il saldo tipico non può crescere (o calare) di più di una stagione di ricavi
  const balances = state.teams.map((t) => t.balance).sort((a, b) => a - b);
  const medianBalance = (balances[14]! + balances[15]!) / 2;
  // Bilanci dei bot alla fine: non tutti in rosso né tutti ricchi (più di una stagione di ricavi da parte)
  const bots = state.teams.filter((t) => !t.human);
  const botsRed = bots.filter((t) => t.balance < 0).length;
  const botsRich = bots.filter((t) => t.balance > state.config.revenue).length;
  // Dalla seconda stagione (la prima sono i contratti veri, con la mediana proprio alla soglia della tassa). Senza
  // eccezioni (mid-level) chi ha spazio si ferma al cap: in qualche stagione la mediana sta proprio lì
  const later = metrics.slice(1);
  const payrollOk = later.filter(
    (m) => m.payrollMedian >= m.cap * PAYROLL_CAP_TOLERANCE && m.payrollMedian <= m.taxLine,
  ).length;
  const payrollAvg = later.reduce((a, m) => a + m.payrollMedian / m.cap, 0) / Math.max(1, later.length);
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
      'Saldo mediano a fine simulazione (stagioni di ricavi)',
      num(medianBalance / state.config.revenue, 2),
      Math.abs(medianBalance) <= state.config.revenue,
    ],
    [
      'Bot in rosso / ricchi a fine simulazione',
      `${botsRed} / ${botsRich} su ${bots.length}`,
      botsRed >= 2 && botsRed <= bots.length * 0.6 && botsRich <= bots.length * 0.3,
    ],
    [
      'Monte stipendi mediano tra cap (-2%) e tassa (dalla 2ª stagione)',
      `${payrollOk} su ${later.length}, in media ${num(payrollAvg, 2)} cap`,
      payrollOk === later.length && payrollAvg >= 1,
    ],
    [
      'Squadre sotto il monte stipendi minimo (media)',
      num(avg((m) => m.underMinimum)),
      avg((m) => m.underMinimum) <= 3,
    ],
    [
      'Squadre sopra la tassa (minimo e media per stagione)',
      `${Math.min(...metrics.map((m) => m.overTax))} e ${num(avg((m) => m.overTax))}`,
      metrics.every((m) => m.overTax >= 1) && avg((m) => m.overTax) <= 12,
    ],
    [
      'Infortuni medi o gravi per squadra a stagione',
      num(avg((m) => m.injuriesSerious)),
      avg((m) => m.injuriesSerious) >= 2 && avg((m) => m.injuriesSerious) <= 4,
    ],
    [
      'Partite al giorno nel calendario (min e max, senza l’ultimo giorno)',
      `${Math.min(...metrics.map((m) => m.perDayMin))}-${Math.max(...metrics.map((m) => m.perDayMax))}`,
      metrics.every((m) => m.perDayMin >= 1 && m.perDayMax <= 13),
    ],
    [
      'Back-to-back per squadra (min, max e media)',
      `${Math.min(...metrics.map((m) => m.b2bMin))}-${Math.max(...metrics.map((m) => m.b2bMax))}, ${num(avg((m) => m.b2bMean))}`,
      metrics.every((m) => m.b2bMin >= 10 && m.b2bMax <= 16),
    ],
    ['Energia a inizio gara, titolare a 35 minuti', num(energy35.energy), energy35.energy > 85],
    [
      'Seconda sera di un back-to-back, titolare a 35 minuti',
      num(energy35.backToBack),
      energy35.backToBack < energy35.energy - 3,
    ],
    ['Energia a inizio gara, giocatore a 42 minuti', num(energy42.energy), energy42.energy < 75],
    // Chi chiede 42 minuti li gioca, salvo falli e stanchezza estrema (partite con al massimo 3 falli)
    [
      'Minuti giocati con 42 minuti obiettivo (senza problemi di falli)',
      num(energy42.minutes),
      energy42.minutes >= 40,
    ],
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
