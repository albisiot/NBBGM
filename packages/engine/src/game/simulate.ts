import { BODY_PARTS, BODY_PART_LABEL, DURABILITY_KEY, type BodyPart, type RatingKey } from '../fields.ts';
import { Rng } from '../rng.ts';
import type { InjurySeverity, Player, Role } from '../types.ts';
import { DEFAULT_PARAMS, type EngineParams } from './params.ts';
import { SLOT_ROLES, roleFit } from './setup.ts';
import type { GameEvent, GameInjury, GameResult, PlayerLine, TeamSetup, TeamTotals } from './types.ts';

type SideKey = 'home' | 'away';
type Zone = 'rim' | 'short' | 'mid' | 'three';
type ShotKind = keyof EngineParams['base'];
type Play = 'three' | 'mid' | 'drive' | 'post' | 'iso' | 'pnr' | 'cut';

interface SimPlayer {
  p: Player;
  line: PlayerLine;
  energy: number;
  fouls: number;
  /** Minuti obiettivo in secondi. */
  target: number;
  injured: boolean;
  formOff: number;
  formDef: number;
  sizeF: number;
  /** Slot in campo (0-4) o -1 in panchina. */
  slot: number;
}

interface Side {
  key: SideKey;
  setup: TeamSetup;
  players: SimPlayer[];
  court: SimPlayer[];
  closers: Set<SimPlayer>;
  score: number;
  quarters: number[];
  teamFouls: number;
  foulsLast2: number;
  possessions: number;
  lastSubCheck: number;
  zones: Record<Zone, { m: number; a: number }>;
}

interface ShotPlan {
  shooter: SimPlayer;
  kind: ShotKind;
  zone: Zone;
  assistP: number;
  passer: SimPlayer | null;
  open: boolean;
  helper: SimPlayer | null;
}

const REGULATION = 2880;
const FT_TABLE: [number, number][] = [
  [20, 0.4],
  [30, 0.47],
  [50, 0.61],
  [60, 0.69],
  [70, 0.75],
  [80, 0.81],
  [90, 0.87],
  [99, 0.92],
];
const KIND_LABEL: Record<ShotKind, string> = {
  dunk: 'schiacciata',
  layup: 'layup',
  close: 'tiro da sotto',
  floater: 'floater',
  hook: 'gancio',
  fade: 'fadeaway',
  midCatch: 'tiro dalla media',
  midPull: 'tiro dal palleggio',
  threeCatch: 'tripla',
  threePull: 'tripla dal palleggio',
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

function interpolate(table: [number, number][], x: number): number {
  const first = table[0] as [number, number];
  if (x <= first[0]) return first[1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i] as [number, number];
    const [x0, y0] = table[i - 1] as [number, number];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return (table[table.length - 1] as [number, number])[1];
}

function emptyLine(p: Player, starter: boolean): PlayerLine {
  return {
    playerId: p.id,
    name: `${p.firstName} ${p.lastName}`,
    starter,
    seconds: 0,
    pts: 0,
    fgm: 0,
    fga: 0,
    tpm: 0,
    tpa: 0,
    ftm: 0,
    fta: 0,
    orb: 0,
    drb: 0,
    ast: 0,
    stl: 0,
    blk: 0,
    tov: 0,
    pf: 0,
    plusMinus: 0,
  };
}

/**
 * Simula una partita possesso per possesso. Funzione pura: stesso input e stesso seed danno la stessa partita.
 * Non modifica i giocatori: l'energia finale e gli infortuni sono nel risultato.
 */
export function simulateGame(
  home: TeamSetup,
  away: TeamSetup,
  seed: string,
  params: EngineParams = DEFAULT_PARAMS,
): GameResult {
  return new GameSim(home, away, seed, params).run();
}

class GameSim {
  private readonly rng: Rng;
  private readonly P: EngineParams;
  private readonly home: Side;
  private readonly away: Side;
  private period = 1;
  private clock = 720;
  private elapsed = 0;
  private readonly events: GameEvent[] = [];
  private readonly injuries: GameInjury[] = [];
  private pendingInjuries: { sp: SimPlayer; side: Side }[] = [];

  constructor(home: TeamSetup, away: TeamSetup, seed: string, params: EngineParams) {
    this.rng = new Rng(seed);
    this.P = params;
    this.home = this.makeSide('home', home);
    this.away = this.makeSide('away', away);
  }

  // ------------------------------------------------------------ preparazione
  private makeSide(key: SideKey, setup: TeamSetup): Side {
    const available = setup.players.filter((p) => p.injury === null).slice(0, 13);
    const ids = new Set(available.map((p) => p.id));
    for (const id of setup.starters) {
      if (!ids.has(id)) throw new Error(`${setup.teamId}: il titolare ${id} non è disponibile`);
    }
    const totalMinutes = available.reduce((a, p) => a + (setup.minutes[p.id] ?? 0), 0);
    const scale = totalMinutes > 0 ? 240 / totalMinutes : 1;
    const players = available.map((p): SimPlayer => {
      const slot = setup.starters.indexOf(p.id);
      const spread = (c: number) => this.P.formBase + (this.P.formRange * (100 - c)) / 100;
      return {
        p,
        line: emptyLine(p, slot >= 0),
        energy: p.energy,
        fouls: 0,
        target: (setup.minutes[p.id] ?? 0) * scale * 60,
        injured: false,
        formOff: this.rng.normal(0, spread(p.hidden.offensiveConsistency)),
        formDef: this.rng.normal(0, spread(p.hidden.defensiveConsistency)),
        sizeF: ((p.heightCm + 0.5 * (p.wingspanCm - p.heightCm)) / 203) ** 4,
        slot,
      };
    });
    const court = setup.starters.map((id) => players.find((sp) => sp.p.id === id) as SimPlayer);
    const closers = new Set([...players].sort((a, b) => b.target - a.target).slice(0, 5));
    return {
      key,
      setup,
      players,
      court,
      closers,
      score: 0,
      quarters: [],
      teamFouls: 0,
      foulsLast2: 0,
      possessions: 0,
      lastSubCheck: 0,
      zones: { rim: { m: 0, a: 0 }, short: { m: 0, a: 0 }, mid: { m: 0, a: 0 }, three: { m: 0, a: 0 } },
    };
  }

  // ------------------------------------------------------------ partita
  run(): GameResult {
    const tipHome = this.jumpBall();
    let first = tipHome ? this.home : this.away;
    for (this.period = 1; ; this.period++) {
      const length = this.period <= 4 ? 720 : 300;
      this.clock = length;
      this.home.teamFouls = this.away.teamFouls = 0;
      this.home.foulsLast2 = this.away.foulsLast2 = 0;
      const startScore = [this.home.score, this.away.score];
      if (this.period >= 5) first = this.jumpBall() ? this.home : this.away;
      let off = this.period === 1 || this.period === 4 || this.period >= 5 ? first : this.other(first);
      this.event(
        null,
        [],
        this.period <= 4
          ? `Inizio del ${this.period}° quarto`
          : `Inizio del ${this.period - 4}° supplementare`,
      );
      let transition = false;
      while (this.clock > 0) {
        const next = this.possession(off, this.other(off), transition);
        off = next.side;
        transition = next.transition;
        this.applyInjuries();
        this.checkSubs(this.home);
        this.checkSubs(this.away);
      }
      this.home.quarters.push(this.home.score - (startScore[0] as number));
      this.away.quarters.push(this.away.score - (startScore[1] as number));
      this.event(
        null,
        [],
        `Fine del ${this.period <= 4 ? `${this.period}° quarto` : `${this.period - 4}° supplementare`}`,
      );
      // A inizio periodo i giocatori in difficoltà di falli possono rientrare
      this.home.lastSubCheck = this.away.lastSubCheck = -1e9;
      if (this.period >= 4 && this.home.score !== this.away.score) break;
      this.checkSubs(this.home);
      this.checkSubs(this.away);
    }
    return this.result();
  }

  private other(side: Side): Side {
    return side === this.home ? this.away : this.home;
  }

  private jumpBall(): boolean {
    const reach = (s: Side) => {
      const c = s.court[4] as SimPlayer;
      return c.p.heightCm + c.p.ratings.vertical / 4;
    };
    return this.rng.chance(1 / (1 + Math.exp((reach(this.away) - reach(this.home)) / 6)));
  }

  // ------------------------------------------------------------ efficacia e abilità
  private eff(sp: SimPlayer, kind: 'off' | 'def'): number {
    const P = this.P;
    const fatigue = 1 - P.fatigueMaxPenalty * clamp((P.fatigueThreshold - sp.energy) / 40, 0, 1);
    const morale = 1 + (0.06 * (sp.p.morale - 50)) / 100;
    const fit = sp.slot >= 0 ? roleFit(sp.p, SLOT_ROLES[sp.slot] as Role) : 1;
    return fatigue * morale * fit * (1 + (kind === 'off' ? sp.formOff : sp.formDef));
  }

  private r(sp: SimPlayer, key: RatingKey, kind: 'off' | 'def' = 'off'): number {
    return sp.p.ratings[key] * this.eff(sp, kind);
  }

  private intensity(side: Side, low: number, high: number): number {
    const i = side.setup.tactics.intensity;
    return i === 'low' ? low : i === 'high' ? high : 1;
  }

  private margin(side: Side): number {
    return side.score - this.other(side).score;
  }

  private clutch(sp: SimPlayer, side: Side): number {
    if (this.period < 4 || this.clock > 300 || Math.abs(this.margin(side)) > 5) return 0;
    return this.P.clutchMax * clamp((this.r(sp, 'clutch') - 60) / 35, -1, 1);
  }

  // ------------------------------------------------------------ tempo, energia, infortuni
  private advance(dt: number): void {
    dt = Math.max(0, Math.min(dt, this.clock));
    if (dt === 0) return;
    const P = this.P;
    for (const side of [this.home, this.away]) {
      const drainF =
        this.intensity(side, 0.9, 1.15) *
        (side.setup.tactics.pace === 'fast' ? 1.08 : side.setup.tactics.pace === 'slow' ? 0.94 : 1);
      for (const sp of side.players) {
        if (sp.slot >= 0) {
          sp.line.seconds += dt;
          sp.energy = Math.max(
            0,
            sp.energy - (P.energyDrain * (1.25 - sp.p.ratings.stamina / 200) * drainF * dt) / 60,
          );
          this.rollInjury(sp, side, dt);
        } else if (!sp.injured) {
          sp.energy = Math.min(100, sp.energy + (P.benchRecovery * dt) / 60);
        }
      }
    }
    this.clock -= dt;
    this.elapsed += dt;
  }

  private partRisk(p: Player, part: BodyPart): number {
    return ((100 - p.hidden[DURABILITY_KEY[part]]) / 20) ** 1.5;
  }

  private rollInjury(sp: SimPlayer, side: Side, dt: number): void {
    if (sp.injured || this.pendingInjuries.some((x) => x.sp === sp)) return;
    const risks = BODY_PARTS.map((part) => this.partRisk(sp.p, part));
    const durability = risks.reduce((a, b) => a + b, 0) / risks.length;
    const fatigue = sp.energy < 40 ? 2.2 : sp.energy < 60 ? 1.5 : 1;
    const age = 1 + 0.06 * Math.max(0, sp.p.age - 30);
    const p =
      (this.P.injuryPerMinute * dt * durability * fatigue * age * this.intensity(side, 0.95, 1.1)) / 60;
    if (this.rng.chance(p)) this.pendingInjuries.push({ sp, side });
  }

  private applyInjuries(): void {
    for (const { sp, side } of this.pendingInjuries) {
      const parts = BODY_PARTS.map((part) => this.partRisk(sp.p, part));
      const part = BODY_PARTS[this.rng.weightedIndex(parts)] as BodyPart;
      const fragile = (parts[BODY_PARTS.indexOf(part)] as number) > 1.5;
      const s = this.P.injurySeverity;
      const severity: InjurySeverity = (['light', 'medium', 'severe'] as const)[
        this.rng.weightedIndex([s.light, s.medium * (fragile ? 1.3 : 1), s.severe * (fragile ? 1.6 : 1)])
      ] as InjurySeverity;
      const games =
        severity === 'light'
          ? this.rng.int(1, 3)
          : severity === 'medium'
            ? this.rng.int(4, 15)
            : this.rng.int(16, 60);
      sp.injured = true;
      this.injuries.push({
        playerId: sp.p.id,
        team: side.key,
        bodyPart: part,
        severity,
        games,
        elapsed: this.elapsed,
      });
      const label = severity === 'light' ? 'leggero' : severity === 'medium' ? 'medio' : 'grave';
      this.event(
        side,
        [sp.p.id],
        `${sp.p.lastName} si infortuna (${BODY_PART_LABEL[part]}, ${label}): ${games} partite di stop`,
      );
      this.checkSubs(side, true);
    }
    this.pendingInjuries = [];
  }

  // ------------------------------------------------------------ cambi
  private expected(sp: SimPlayer): number {
    return (sp.target * this.elapsed) / REGULATION;
  }

  private foulTrouble(sp: SimPlayer): boolean {
    if (sp.fouls >= this.P.foulOut) return true;
    const limit = this.P.foulTrouble[Math.min(this.period, 5) - 1] as number;
    if (this.period === 4 && this.clock <= 360) return sp.fouls >= this.P.foulOut;
    return sp.fouls >= limit;
  }

  private checkSubs(side: Side, force = false): void {
    const P = this.P;
    if (!force && this.elapsed - side.lastSubCheck < P.subCheckSeconds) return;
    side.lastSubCheck = this.elapsed;
    const late = this.period >= 4 && this.clock <= 300 && Math.abs(this.margin(side)) <= 10;
    for (let slot = 0; slot < 5; slot++) {
      const cur = side.court[slot] as SimPlayer;
      const forced = cur.injured || cur.fouls >= P.foulOut;
      const role = SLOT_ROLES[slot] as Role;
      const value = (c: SimPlayer) =>
        (this.expected(c) - c.line.seconds) / 60 +
        (c.energy - 75) / 8 +
        25 * (roleFit(c.p, role) - 1) +
        (late && side.closers.has(c) ? 20 : 0);
      // Chi deve uscire per forza (infortunio, sesto fallo) può essere sostituito anche da chi ha falli
      const bench = side.players.filter(
        (c) => c.slot < 0 && !c.injured && (forced ? c.fouls < P.foulOut : !this.foulTrouble(c)),
      );
      const eligible = bench.filter(
        (c) => forced || c.energy >= 72 || (late && side.closers.has(c) && c.energy >= 55),
      );
      if (eligible.length === 0) continue;
      const wantOut =
        forced ||
        this.foulTrouble(cur) ||
        cur.energy < P.subEnergy ||
        (cur.line.seconds - this.expected(cur) > P.subMinutesSlack && !(late && side.closers.has(cur))) ||
        (late && !side.closers.has(cur) && eligible.some((c) => side.closers.has(c)));
      if (!wantOut) continue;
      const best = eligible.reduce((a, b) => (value(b) > value(a) ? b : a));
      if (!forced && !this.foulTrouble(cur) && cur.energy >= P.subEnergy && value(best) <= value(cur) + 0.5)
        continue;
      best.slot = slot;
      cur.slot = -1;
      side.court[slot] = best;
      this.event(side, [best.p.id, cur.p.id], `Entra ${best.p.lastName}, esce ${cur.p.lastName}`);
    }
  }

  // ------------------------------------------------------------ possesso
  private possession(off: Side, def: Side, transition: boolean): { side: Side; transition: boolean } {
    const P = this.P;
    off.possessions++;
    const late = this.period >= 4 && this.clock <= 120;

    // Falli sistematici di chi è sotto nel finale
    const deficit = off.score - def.score;
    if (this.period >= 4 && this.clock <= 50 && deficit >= 3 && deficit <= 9) {
      while (this.clock > 0) {
        this.advance(this.rng.int(2, 4));
        const target = off.court[
          this.rng.weightedIndex(off.court.map((sp) => (100 - this.r(sp, 'freeThrow')) ** 2))
        ] as SimPlayer;
        const fouler = this.rng.pick(def.court);
        const bonus = this.commitFoul(def, fouler, target, 'fallo sistematico');
        if (bonus) {
          // Con il rimbalzo offensivo sull'ultimo libero il possesso continua: chi è sotto fa di nuovo fallo
          if (this.freeThrows(off, def, target, 2).side === def) return { side: def, transition: false };
          continue;
        }
        if (this.clock <= 0) return { side: def, transition: false };
      }
      return { side: def, transition: false };
    }

    let shotClock = 24;
    for (let attempt = 0; ; attempt++) {
      // Durata del possesso
      let dur: number;
      if (transition) dur = Math.round(clamp(this.rng.normal(P.transitionSeconds, 2), 2, 10));
      else if (attempt > 0) dur = Math.round(clamp(this.rng.normal(P.offensiveReboundSeconds, 3), 2, 14));
      else if (late && deficit > 0) dur = Math.round(clamp(this.rng.normal(21, 2), 12, 24));
      else if (late && deficit < 0) dur = Math.round(clamp(this.rng.normal(8, 3), 3, 16));
      else {
        const pace = (t: Side) => P.possessionSeconds[t.setup.tactics.pace];
        const mean = 0.65 * pace(off) + 0.35 * pace(def);
        dur = Math.round(clamp(this.rng.normal(mean, P.possessionSd), 4, shotClock));
      }
      const rushed = this.clock <= dur && this.clock <= 4;
      this.advance(Math.max(1, dur));
      shotClock = 14;

      // Palla persa
      const handler = this.pickHandler(off);
      const security =
        0.35 * this.r(handler, 'ballHandle') +
        0.25 * this.r(handler, 'hands') +
        0.2 * this.r(handler, 'passAccuracy') +
        0.2 * this.r(handler, 'offensiveIQ');
      const pressure =
        def.court.reduce(
          (a, d) =>
            a +
            (0.5 * this.r(d, 'steal', 'def') + 0.5 * this.r(d, 'passLaneReading', 'def')) *
              (0.85 + (0.3 * d.p.tendencies.steal) / 100),
          0,
        ) / 5;
      const pTo =
        P.turnoverBase *
        Math.exp((P.turnoverSkillK * (pressure - security)) / 100) *
        this.intensity(def, 0.92, 1.1) *
        (transition ? 1.05 : 1);
      if (this.rng.chance(pTo)) return this.turnover(off, def, handler);

      // Fallo lontano dal tiro
      const hardness = def.court.reduce((a, d) => a + d.p.tendencies.hardFoul, 0) / 5;
      if (
        this.rng.chance(
          P.nonShootingFoulBase * this.intensity(def, 0.9, 1.15) * (0.8 + (0.4 * hardness) / 100),
        )
      ) {
        const fouler = def.court[
          this.rng.weightedIndex(def.court.map((d) => d.p.tendencies.hardFoul + d.p.tendencies.steal))
        ] as SimPlayer;
        if (this.commitFoul(def, fouler, handler, 'fallo')) {
          // Rimbalzo offensivo sull'ultimo libero: stesso possesso, con 14 secondi
          if (this.freeThrows(off, def, handler, 2).side === def) return { side: def, transition: false };
          transition = false;
          continue;
        }
        if (this.clock <= 0) return { side: def, transition: false };
      }

      // Tiro
      const plan = this.planShot(
        off,
        def,
        transition,
        late && deficit < 0 && deficit <= -3 && this.clock <= 40,
      );
      const outcome = this.shoot(off, def, plan, transition, rushed);
      // Fallo sul tiro con rimbalzo offensivo sull'ultimo libero: stesso possesso, con 14 secondi
      if (outcome === 'kept') {
        transition = false;
        continue;
      }
      if (outcome !== 'miss') return { side: def, transition: false };

      // Rimbalzo
      const offensive = this.rebound(off, def, plan.zone === 'three' ? 1.05 : 1);
      if (!offensive)
        return {
          side: def,
          transition: this.rng.chance(this.transitionChance(def, P.transitionAfterRebound)),
        };
      if (this.clock <= 0) return { side: def, transition: false };
      transition = false;
      // Tap-in immediato del rimbalzista
      const rebounder = offensive;
      if (
        this.rng.chance(P.putbackChance * (rebounder.p.role === 'C' || rebounder.p.role === 'PF' ? 1 : 0.45))
      ) {
        this.advance(this.rng.int(1, 2));
        const dunk =
          this.r(rebounder, 'standingDunk') > 60 &&
          this.rng.chance(rebounder.p.tendencies.dunkOverLayup / 100);
        const put: ShotPlan = {
          shooter: rebounder,
          kind: dunk ? 'dunk' : 'close',
          zone: 'rim',
          assistP: 0,
          passer: null,
          open: false,
          helper: null,
        };
        const res = this.shoot(off, def, put, false, false);
        if (res === 'kept') continue;
        if (res !== 'miss') return { side: def, transition: false };
        const again = this.rebound(off, def, 1);
        if (!again || this.clock <= 0) return { side: def, transition: false };
      }
    }
  }

  private transitionChance(side: Side, base: number): number {
    const pace = side.setup.tactics.pace;
    const speed = side.court.reduce((a, sp) => a + this.r(sp, 'speed'), 0) / 5;
    return base * (pace === 'fast' ? 1.35 : pace === 'slow' ? 0.7 : 1) * (0.7 + (0.6 * speed) / 100);
  }

  private usage(sp: SimPlayer): number {
    const skill =
      0.3 * Math.max(this.r(sp, 'threePoint'), this.r(sp, 'midRange')) +
      0.25 * Math.max(this.r(sp, 'layup'), this.r(sp, 'closeShot'), this.r(sp, 'drivingDunk')) +
      0.15 * this.r(sp, 'pullUp') +
      0.15 * this.r(sp, 'ballHandle') +
      0.15 * this.r(sp, 'offensiveIQ');
    const t = sp.p.tendencies;
    return (
      (skill / 65) ** this.P.usageExponent *
      (0.75 + (0.5 * t.pullUpOverPass) / 100) *
      (0.85 + (0.3 * t.isolation) / 100)
    );
  }

  private pickHandler(off: Side): SimPlayer {
    return off.court[
      this.rng.weightedIndex(
        off.court.map(
          (sp) => this.usage(sp) * ((this.r(sp, 'ballHandle') + this.r(sp, 'passVision')) / 130) ** 2,
        ),
      )
    ] as SimPlayer;
  }

  // ------------------------------------------------------------ scelta del tiro
  private planShot(off: Side, def: Side, transition: boolean, needThree: boolean): ShotPlan {
    const shooter = off.court[this.rng.weightedIndex(off.court.map((sp) => this.usage(sp)))] as SimPlayer;
    if (transition) {
      const three = this.rng.chance(0.27 * (0.5 + shooter.p.tendencies.three / 100));
      if (three)
        return {
          shooter,
          kind: 'threeCatch',
          zone: 'three',
          assistP: this.P.assist.transition,
          passer: null,
          open: this.rng.chance(0.4),
          helper: null,
        };
      return this.drivePlan(off, def, shooter, this.P.assist.transition, false);
    }
    const t = shooter.p.tendencies;
    const focus = off.setup.tactics.focus;
    const zone = def.setup.tactics.defense === 'zone';
    const skill: Record<Play, number> = {
      three: this.r(shooter, 'threePoint'),
      mid: this.r(shooter, 'midRange'),
      drive:
        (this.r(shooter, 'layup') + this.r(shooter, 'drivingDunk') + this.r(shooter, 'speedWithBall')) / 3,
      post: (this.r(shooter, 'postControl') + this.r(shooter, 'hook') + this.r(shooter, 'postFade')) / 3,
      iso: (this.r(shooter, 'ballHandle') + this.r(shooter, 'pullUp')) / 2,
      pnr: (this.r(shooter, 'ballHandle') + this.r(shooter, 'passVision')) / 2,
      cut: (this.r(shooter, 'closeShot') + this.r(shooter, 'layup')) / 2,
    };
    const w: Record<Play, number> = {
      three:
        t.three *
        this.P.threeWeight *
        (focus === 'perimeter' ? 1.3 : focus === 'inside' ? 0.75 : 1) *
        (zone ? 1.2 : 1) *
        (needThree ? 2.5 : 1),
      mid:
        t.midRange *
        this.P.midWeight *
        (focus === 'perimeter' ? 1.05 : focus === 'inside' ? 0.9 : 1) *
        (zone ? 1.1 : 1),
      drive: t.drive * (focus === 'perimeter' ? 0.9 : focus === 'inside' ? 1.15 : 1) * (zone ? 0.85 : 1),
      post: t.post * 0.8 * (focus === 'perimeter' ? 0.65 : focus === 'inside' ? 1.45 : 1) * (zone ? 0.85 : 1),
      iso: t.isolation * 0.5,
      pnr: t.pickAndRoll * 0.6,
      cut: t.cut * 0.5 * (focus === 'inside' ? 1.15 : focus === 'perimeter' ? 0.9 : 1) * (zone ? 0.9 : 1),
    };
    const iq = 0.6 + this.r(shooter, 'offensiveIQ') / 120;
    const plays = Object.keys(w) as Play[];
    const play = plays[this.rng.weightedIndex(plays.map((k) => w[k] * (skill[k] / 65) ** iq))] as Play;
    const A = this.P.assist;

    switch (play) {
      case 'three': {
        const pull = this.rng.chance(t.pullUpOverPass / 160);
        return {
          shooter,
          kind: pull ? 'threePull' : 'threeCatch',
          zone: 'three',
          assistP: pull ? A.pull : A.three,
          passer: null,
          open: false,
          helper: null,
        };
      }
      case 'mid': {
        const pull = this.rng.chance(t.pullUpOverPass / 130);
        return {
          shooter,
          kind: pull ? 'midPull' : 'midCatch',
          zone: 'mid',
          assistP: pull ? A.pull : A.mid,
          passer: null,
          open: false,
          helper: null,
        };
      }
      case 'drive':
        return this.drivePlan(off, def, shooter, A.drive, true);
      case 'post': {
        const opts = [
          this.r(shooter, 'hook'),
          this.r(shooter, 'postFade'),
          (this.r(shooter, 'closeShot') * this.r(shooter, 'strength')) / 80,
        ];
        const k = this.rng.weightedIndex(opts.map((v) => v ** 2));
        const kind: ShotKind = k === 0 ? 'hook' : k === 1 ? 'fade' : 'close';
        return {
          shooter,
          kind,
          zone: kind === 'close' ? 'rim' : 'short',
          assistP: A.post,
          passer: null,
          open: false,
          helper: null,
        };
      }
      case 'iso': {
        const jumper = this.r(shooter, 'pullUp');
        const drive = (this.r(shooter, 'layup') + this.r(shooter, 'drivingDunk')) / 2;
        if (this.rng.chance(jumper / (jumper + drive))) {
          const three = this.rng.chance(t.three / (t.three + t.midRange + 1));
          return {
            shooter,
            kind: three ? 'threePull' : 'midPull',
            zone: three ? 'three' : 'mid',
            assistP: A.iso,
            passer: null,
            open: false,
            helper: null,
          };
        }
        return this.drivePlan(off, def, shooter, A.iso, true);
      }
      case 'pnr': {
        const vision = this.r(shooter, 'passVision');
        const k = this.rng.weightedIndex([t.pullUpOverPass * 0.6, t.drive * 0.6, vision * 0.5, vision * 0.5]);
        if (k === 0) {
          const three = this.rng.chance(t.three / (t.three + t.midRange + 1));
          return {
            shooter,
            kind: three ? 'threePull' : 'midPull',
            zone: three ? 'three' : 'mid',
            assistP: A.pull,
            passer: null,
            open: false,
            helper: null,
          };
        }
        if (k === 1) return this.drivePlan(off, def, shooter, A.drive, true);
        const mates = off.court.filter((sp) => sp !== shooter);
        if (k === 2) {
          const roller = mates[
            this.rng.weightedIndex(
              mates.map(
                (sp) => ((this.r(sp, 'standingDunk') + this.r(sp, 'closeShot')) / 100) ** 4 * sp.sizeF,
              ),
            )
          ] as SimPlayer;
          const dunk =
            this.r(roller, 'standingDunk') > 55 && this.rng.chance(roller.p.tendencies.dunkOverLayup / 100);
          return {
            shooter: roller,
            kind: dunk ? 'dunk' : 'close',
            zone: 'rim',
            assistP: A.roll,
            passer: shooter,
            open: false,
            helper: null,
          };
        }
        const kick = mates[
          this.rng.weightedIndex(mates.map((sp) => (this.r(sp, 'threePoint') / 70) ** 3))
        ] as SimPlayer;
        return {
          shooter: kick,
          kind: 'threeCatch',
          zone: 'three',
          assistP: A.kick,
          passer: shooter,
          open: this.rng.chance(0.35),
          helper: null,
        };
      }
      case 'cut': {
        const dunk = this.rng.chance(((t.dunkOverLayup / 100) * this.r(shooter, 'vertical')) / 90);
        return {
          shooter,
          kind: dunk ? 'dunk' : 'layup',
          zone: 'rim',
          assistP: A.cut,
          passer: null,
          open: false,
          helper: null,
        };
      }
    }
  }

  private drivePlan(off: Side, def: Side, shooter: SimPlayer, assistP: number, canHelp: boolean): ShotPlan {
    const P = this.P;
    let helper: SimPlayer | null = null;
    if (canHelp) {
      const bigs = [def.court[3] as SimPlayer, def.court[4] as SimPlayer];
      const h = bigs.reduce((a, b) =>
        this.r(b, 'helpDefense', 'def') > this.r(a, 'helpDefense', 'def') ? b : a,
      );
      const zoneF = def.setup.tactics.defense === 'zone' ? 1.15 : 1;
      if (this.rng.chance(P.helpChance * (this.r(h, 'helpDefense', 'def') / 65) * zoneF)) {
        if (this.rng.chance(P.kickOutChance * (this.r(shooter, 'passVision') / 70))) {
          const mates = off.court.filter((sp) => sp !== shooter);
          const kick = mates[
            this.rng.weightedIndex(mates.map((sp) => (this.r(sp, 'threePoint') / 70) ** 3))
          ] as SimPlayer;
          return {
            shooter: kick,
            kind: 'threeCatch',
            zone: 'three',
            assistP: P.assist.kick,
            passer: shooter,
            open: true,
            helper: null,
          };
        }
        helper = h;
      }
    }
    const t = shooter.p.tendencies;
    if (
      this.r(shooter, 'drivingDunk') > 50 &&
      this.rng.chance(((t.dunkOverLayup / 100) * this.r(shooter, 'vertical')) / 90)
    ) {
      return { shooter, kind: 'dunk', zone: 'rim', assistP, passer: null, open: false, helper };
    }
    if (this.rng.chance(P.floaterShare))
      return { shooter, kind: 'floater', zone: 'short', assistP, passer: null, open: false, helper };
    const kind: ShotKind = this.r(shooter, 'closeShot') > this.r(shooter, 'layup') + 5 ? 'close' : 'layup';
    return { shooter, kind, zone: 'rim', assistP, passer: null, open: false, helper };
  }

  // ------------------------------------------------------------ tiro, falli, liberi
  private shotSkill(sp: SimPlayer, kind: ShotKind, putback: boolean): number {
    switch (kind) {
      case 'dunk':
        return putback
          ? this.r(sp, 'standingDunk')
          : Math.max(this.r(sp, 'drivingDunk'), this.r(sp, 'standingDunk'));
      case 'layup':
        return this.r(sp, 'layup');
      case 'close':
        return this.r(sp, 'closeShot');
      case 'floater':
        return (this.r(sp, 'layup') + this.r(sp, 'midRange')) / 2;
      case 'hook':
        return this.r(sp, 'hook');
      case 'fade':
        return this.r(sp, 'postFade');
      case 'midCatch':
        return this.r(sp, 'midRange');
      case 'midPull':
        return (this.r(sp, 'midRange') + this.r(sp, 'pullUp')) / 2;
      case 'threeCatch':
        return this.r(sp, 'threePoint');
      case 'threePull':
        return (this.r(sp, 'threePoint') + this.r(sp, 'pullUp')) / 2;
    }
  }

  private defenseValue(d: SimPlayer, zone: Zone): number {
    const contest = 0.85 + (0.3 * d.p.tendencies.contest) / 100;
    if (zone === 'mid' || zone === 'three') return this.r(d, 'perimeterDefense', 'def') * contest;
    return (
      (0.7 * this.r(d, 'interiorDefense', 'def') + 0.3 * this.r(d, 'block', 'def')) *
      contest *
      d.sizeF ** 0.25
    );
  }

  private defender(def: Side, shooter: SimPlayer, zone: Zone): { d: SimPlayer; value: number } {
    const inside = zone === 'rim' || zone === 'short';
    const valueOf = (d: SimPlayer) => this.defenseValue(d, zone);
    // Vicino a canestro conta anche il miglior protettore del ferro, non solo il marcatore
    const rimGuard = () => Math.max(valueOf(def.court[3] as SimPlayer), valueOf(def.court[4] as SimPlayer));
    if (def.setup.tactics.defense === 'zone') {
      const group = inside ? def.court.slice(3) : def.court.slice(0, 3);
      const avg = group.reduce((a, d) => a + valueOf(d), 0) / group.length;
      const d = group[this.rng.weightedIndex(group.map((g) => valueOf(g)))] as SimPlayer;
      return { d, value: avg * (inside ? 1.03 : 0.97) };
    }
    const d = def.court[shooter.slot] as SimPlayer;
    const value = inside
      ? (1 - this.P.rimProtectionShare) * valueOf(d) + this.P.rimProtectionShare * rimGuard()
      : valueOf(d);
    return { d, value };
  }

  private shoot(
    off: Side,
    def: Side,
    plan: ShotPlan,
    transition: boolean,
    rushed: boolean,
  ): 'made' | 'miss' | 'fouled' | 'kept' {
    const P = this.P;
    const { shooter, kind, zone } = plan;
    const putback =
      plan.assistP === 0 &&
      plan.passer === null &&
      !transition &&
      zone === 'rim' &&
      (kind === 'close' || kind === 'dunk');
    const { d, value } = this.defender(def, shooter, zone);
    let D = value;
    if (plan.helper) D = Math.max(D, this.defenseValue(plan.helper, zone)) * 1.08;
    if (plan.open) D *= P.openShotDefense;
    const A = this.shotSkill(shooter, kind, putback);
    let p = P.base[kind] + (P.skillK * (A - D)) / 100 + this.clutch(shooter, off);
    if (off === this.home) p += P.homeAdvantage;
    if (transition) p += P.transitionBonus;
    if (rushed) p -= 0.08;
    p = clamp(p, 0.05, 0.95);
    const three = zone === 'three';
    const points = three ? 3 : 2;

    // Fallo sul tiro
    const fouler = plan.helper && this.rng.chance(0.5) ? plan.helper : d;
    const blockLean = zone === 'rim' || zone === 'short' ? 0.85 + (0.3 * fouler.p.tendencies.block) / 100 : 1;
    const pFoul =
      P.shootingFoul[zone] *
      (0.6 + (0.8 * this.r(shooter, 'drawFoul')) / 100) *
      (0.75 + (0.5 * shooter.p.tendencies.drawFoul) / 100) *
      (0.8 + (0.4 * fouler.p.tendencies.hardFoul) / 100) *
      this.intensity(def, 0.9, 1.15) *
      blockLean;
    if (this.rng.chance(pFoul)) {
      this.commitFoul(def, fouler, shooter, 'fallo sul tiro');
      let after: { side: Side };
      if (this.rng.chance(p * P.andOneMakeFactor)) {
        this.made(off, def, plan, points, true);
        after = this.freeThrows(off, def, shooter, 1);
      } else {
        after = this.freeThrows(off, def, shooter, points);
      }
      // 'kept': l'ultimo libero è sbagliato e il rimbalzo è dell'attacco, che tiene la palla
      return after.side === off ? 'kept' : 'fouled';
    }

    // Stoppata: vicino a canestro è lei a causare l'errore. Può stoppare il marcatore, chi aiuta o il lungo vicino.
    if (zone === 'rim' || zone === 'short') {
      const candidates = plan.helper
        ? [plan.helper, d]
        : [d, def.court[3] as SimPlayer, def.court[4] as SimPlayer];
      const blockPower = (b: SimPlayer) => {
        const reach = clamp((b.p.wingspanCm - b.p.heightCm + 10) / 15, 0.6, 1.5) * b.sizeF ** 0.5;
        return (this.r(b, 'block', 'def') / 70) ** 1.6 * (0.7 + (0.6 * b.p.tendencies.block) / 100) * reach;
      };
      const blocker = candidates[
        this.rng.weightedIndex(candidates.map((b, i) => blockPower(b) * (i === 0 ? 1.6 : 1)))
      ] as SimPlayer;
      const pBlock =
        P.blockBase *
        blockPower(blocker) *
        (kind === 'dunk' ? 0.5 : kind === 'floater' || kind === 'fade' ? 0.6 : 1);
      if (this.rng.chance(pBlock)) {
        this.attempt(off, shooter, zone, false);
        blocker.line.blk++;
        this.event(def, [blocker.p.id, shooter.p.id], `${blocker.p.lastName} stoppa ${shooter.p.lastName}`);
        return 'miss';
      }
    }

    if (this.rng.chance(p)) {
      this.made(off, def, plan, points, false);
      return 'made';
    }
    this.attempt(off, shooter, zone, false);
    this.event(off, [shooter.p.id], `${shooter.p.lastName} sbaglia: ${KIND_LABEL[kind]}`);
    return 'miss';
  }

  /** Conta un tiro tentato (e segnato) nel tabellino e nelle statistiche per zona. */
  private attempt(off: Side, shooter: SimPlayer, zone: Zone, made: boolean): void {
    shooter.line.fga++;
    if (zone === 'three') shooter.line.tpa++;
    if (made) {
      shooter.line.fgm++;
      if (zone === 'three') shooter.line.tpm++;
    }
    const z = off.zones[zone];
    z.a++;
    if (made) z.m++;
  }

  private made(off: Side, def: Side, plan: ShotPlan, points: number, andOne: boolean): void {
    const { shooter } = plan;
    this.attempt(off, shooter, plan.zone, true);
    this.score(off, def, shooter, points);
    let passer = plan.passer;
    if (this.rng.chance(plan.assistP)) {
      if (!passer) {
        const mates = off.court.filter((sp) => sp !== shooter);
        passer = mates[
          this.rng.weightedIndex(
            mates.map(
              (sp) =>
                ((this.r(sp, 'passAccuracy') + this.r(sp, 'passVision')) / 130) ** this.P.passerExponent,
            ),
          )
        ] as SimPlayer;
      }
      passer.line.ast++;
    } else passer = null;
    const assist = passer ? ` (assist ${passer.p.lastName})` : '';
    const what = points === 3 ? 'segna da tre' : `segna: ${KIND_LABEL[plan.kind]}`;
    this.event(
      off,
      passer ? [shooter.p.id, passer.p.id] : [shooter.p.id],
      `${shooter.p.lastName} ${what}${assist}${andOne ? ', con fallo' : ''}`,
    );
  }

  private score(off: Side, def: Side, sp: SimPlayer, points: number): void {
    sp.line.pts += points;
    off.score += points;
    for (const c of off.court) c.line.plusMinus += points;
    for (const c of def.court) c.line.plusMinus -= points;
  }

  /** Registra un fallo; restituisce true se manda in lunetta per il bonus. */
  private commitFoul(def: Side, fouler: SimPlayer, on: SimPlayer, label: string): boolean {
    fouler.fouls++;
    fouler.line.pf++;
    def.teamFouls++;
    if (this.clock <= 120) def.foulsLast2++;
    const bonus = def.teamFouls >= (this.period <= 4 ? 5 : 4) || (this.clock <= 120 && def.foulsLast2 >= 2);
    const out = fouler.fouls >= this.P.foulOut ? ` — ${fouler.p.lastName} esce per falli` : '';
    this.event(def, [fouler.p.id, on.p.id], `${label} di ${fouler.p.lastName} su ${on.p.lastName}${out}`);
    if (out) this.checkSubs(def, true);
    return bonus;
  }

  private freeThrows(off: Side, def: Side, sp: SimPlayer, n: number): { side: Side; transition: boolean } {
    let made = 0;
    let lastMissed = false;
    for (let i = 0; i < n; i++) {
      sp.line.fta++;
      const p = clamp(interpolate(FT_TABLE, this.r(sp, 'freeThrow')) + this.clutch(sp, off), 0.3, 0.96);
      if (this.rng.chance(p)) {
        sp.line.ftm++;
        made++;
        this.score(off, def, sp, 1);
        lastMissed = false;
      } else lastMissed = true;
    }
    this.event(off, [sp.p.id], `${sp.p.lastName} ${made}/${n} ai liberi`);
    if (lastMissed && this.clock > 0) {
      const offensive = this.rebound(off, def, 0.5);
      if (offensive) return { side: off, transition: false };
    }
    return { side: def, transition: false };
  }

  private rebound(off: Side, def: Side, factor: number): SimPlayer | null {
    const P = this.P;
    // Valori rapportati alla media della lega: i rimbalzi offensivi hanno valori più bassi di quelli difensivi
    const norm = (key: RatingKey) =>
      key === 'offensiveRebound' ? P.reboundMeans.offensive : P.reboundMeans.defensive;
    const strength = (sp: SimPlayer, key: RatingKey) =>
      (this.r(sp, key) / norm(key)) * sp.sizeF * (0.8 + (0.4 * sp.p.ratings.hustle) / 100);
    const O = off.court.reduce((a, sp) => a + strength(sp, 'offensiveRebound'), 0);
    const D = def.court.reduce((a, sp) => a + strength(sp, 'defensiveRebound'), 0);
    const base = P.offensiveReboundBase * factor;
    const pOrb = 1 / (1 + (D / O) ** P.reboundExponent * ((1 - base) / base));
    const teamRebound = this.rng.chance(P.teamReboundShare);
    if (this.rng.chance(pOrb)) {
      if (teamRebound) {
        this.event(off, [], 'Rimbalzo offensivo di squadra');
        return off.court[0] as SimPlayer;
      }
      const sp = off.court[
        this.rng.weightedIndex(off.court.map((c) => strength(c, 'offensiveRebound') ** P.reboundPickExponent))
      ] as SimPlayer;
      sp.line.orb++;
      this.event(off, [sp.p.id], `Rimbalzo offensivo di ${sp.p.lastName}`);
      return sp;
    }
    if (teamRebound) {
      this.event(def, [], 'Rimbalzo di squadra');
      return null;
    }
    const sp = def.court[
      this.rng.weightedIndex(def.court.map((c) => strength(c, 'defensiveRebound') ** P.reboundPickExponent))
    ] as SimPlayer;
    sp.line.drb++;
    this.event(def, [sp.p.id], `Rimbalzo di ${sp.p.lastName}`);
    return null;
  }

  private turnover(off: Side, def: Side, handler: SimPlayer): { side: Side; transition: boolean } {
    const P = this.P;
    handler.line.tov++;
    const stealLean = def.court.reduce((a, d) => a + d.p.tendencies.steal, 0) / 5;
    if (this.rng.chance(P.liveBallTurnoverShare * (0.8 + (0.4 * stealLean) / 100))) {
      const stealer = def.court[
        this.rng.weightedIndex(
          def.court.map((d) => (this.r(d, 'steal', 'def') * d.p.tendencies.steal) ** 1.5),
        )
      ] as SimPlayer;
      stealer.line.stl++;
      this.event(
        off,
        [handler.p.id, stealer.p.id],
        `Palla persa di ${handler.p.lastName}, recupera ${stealer.p.lastName}`,
      );
      return { side: def, transition: this.rng.chance(this.transitionChance(def, P.transitionAfterSteal)) };
    }
    if (this.rng.chance(P.offensiveFoulShare / (1 - P.liveBallTurnoverShare))) {
      handler.fouls++;
      handler.line.pf++;
      const out = handler.fouls >= P.foulOut ? ` — esce per falli` : '';
      this.event(off, [handler.p.id], `Fallo in attacco di ${handler.p.lastName}${out}`);
      if (out) this.checkSubs(off, true);
    } else {
      this.event(off, [handler.p.id], `Palla persa di ${handler.p.lastName}`);
    }
    return { side: def, transition: false };
  }

  // ------------------------------------------------------------ cronaca e risultato
  private event(side: Side | null, players: string[], text: string): void {
    this.events.push({
      period: this.period,
      clock: this.clock,
      elapsed: this.elapsed,
      team: side ? side.key : null,
      players,
      text,
      home: this.home.score,
      away: this.away.score,
    });
  }

  private totals(side: Side): TeamTotals {
    const t: TeamTotals = {
      pts: 0,
      fgm: 0,
      fga: 0,
      tpm: 0,
      tpa: 0,
      ftm: 0,
      fta: 0,
      orb: 0,
      drb: 0,
      ast: 0,
      stl: 0,
      blk: 0,
      tov: 0,
      pf: 0,
      possessions: side.possessions,
      zones: {
        rim: { ...side.zones.rim },
        short: { ...side.zones.short },
        mid: { ...side.zones.mid },
        three: { ...side.zones.three },
      },
    };
    for (const { line } of side.players) {
      for (const k of [
        'pts',
        'fgm',
        'fga',
        'tpm',
        'tpa',
        'ftm',
        'fta',
        'orb',
        'drb',
        'ast',
        'stl',
        'blk',
        'tov',
        'pf',
      ] as const)
        t[k] += line[k];
    }
    return t;
  }

  private result(): GameResult {
    const pack = (s: Side) => ({
      teamId: s.setup.teamId,
      score: s.score,
      quarters: s.quarters,
      box: s.players.map((sp) => sp.line),
      totals: this.totals(s),
    });
    const finalEnergy: Record<string, number> = {};
    for (const sp of [...this.home.players, ...this.away.players])
      finalEnergy[sp.p.id] = Math.round(sp.energy * 10) / 10;
    return {
      home: pack(this.home),
      away: pack(this.away),
      overtimes: Math.max(0, this.period - 4),
      finalEnergy,
      injuries: this.injuries,
      playByPlay: this.events,
    };
  }
}
