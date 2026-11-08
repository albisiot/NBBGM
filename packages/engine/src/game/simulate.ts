import { BODY_PARTS, BODY_PART_LABEL, DURABILITY_KEY, type BodyPart, type RatingKey } from '../fields.ts';
import { Rng } from '../rng.ts';
import type { InjurySeverity, Player } from '../types.ts';
import { DEFAULT_PARAMS, type EngineParams } from './params.ts';
import { SLOT_ROLES, roleFit } from './setup.ts';
import type { GameEvent, GameInjury, GameResult, PlayerLine, TeamSetup, TeamTotals } from './types.ts';

type SideKey = 'home' | 'away';
type Zone = 'rim' | 'short' | 'mid' | 'three';
type ShotKind = keyof EngineParams['base'];
type Play = 'three' | 'mid' | 'drive' | 'post' | 'iso' | 'pnr' | 'cut';
/** Tiro cercato nel finale: la tripla per recuperare (tie3: per pareggiare sull'ultimo tiro), il 2 per pareggiare. */
type ShotGoal = 'tie3' | 'three' | 'two' | null;

interface SimPlayer {
  p: Player;
  line: PlayerLine;
  energy: number;
  fouls: number;
  /** Minuti obiettivo in secondi. */
  target: number;
  /** Energia sotto cui esce per stanchezza e sopra cui può rientrare dalla panchina (dai minuti obiettivo). */
  subOut: number;
  subIn: number;
  injured: boolean;
  /**
   * Infortunato rimasto nello slot perché non c'era nessuno per sostituirlo: non gioca più, la squadra resta in 4
   * (o meno). Non tira, non passa, non difende, non prende rimbalzi e non accumula minuti.
   */
  absent: boolean;
  formOff: number;
  formDef: number;
  sizeF: number;
  /** Slot in campo (0-4) o -1 in panchina. */
  slot: number;
  // Valori fissi per tutta la partita, calcolati una volta con le stesse formule (stessi numeri, bit per bit)
  /** Adattamento al ruolo in ognuno dei 5 slot (roleFit). */
  fits: number[];
  /** Effetto del morale sulle abilità. */
  moraleF: number;
  /** 1 + forma del giorno, in attacco e in difesa. */
  formOffF: number;
  formDefF: number;
  /** Consumo di energia per la Resistenza. */
  staminaF: number;
  /** Rischio di infortunio di ogni distretto (dalle durabilità), la loro media e l'effetto dell'età. */
  risks: number[];
  durability: number;
  ageF: number;
  // Efficacia in attacco e in difesa e peso nella scelta di chi gioca la palla: valgono finché energia e slot
  // restano quelli con cui sono stati calcolati
  effEnergy: number;
  effSlot: number;
  effOff: number;
  effDef: number;
  usage: number;
  usageReady: boolean;
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

/** Giocatori minimi in campo: sotto, chi si infortuna senza sostituto continua (come per la FIBA, che con meno di 2 dà la partita persa). */
const MIN_PRESENT = 2;

/** Difesa di una squadra che gioca in meno di 5. */
const SHORTHANDED_DEFENSE = 0.85;

/** In campo e in grado di giocare (senza gli assenti). */
function present(side: Side): SimPlayer[] {
  return side.court.filter((sp) => !sp.absent);
}

/**
 * I due lunghi (slot 4 e 5) che proteggono il ferro e aiutano, senza gli assenti; se mancano entrambi, chi c'è
 * (con fallback: false niente, per le stoppate dove il marcatore c'è già).
 */
function insideDefenders(side: Side, fallback = true): SimPlayer[] {
  const bigs = [side.court[3] as SimPlayer, side.court[4] as SimPlayer];
  if (!bigs[0]?.absent && !bigs[1]?.absent) return bigs;
  const left = bigs.filter((b) => !b.absent);
  return left.length > 0 || !fallback ? left : present(side);
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
 * Momento da cui far ripartire una partita (per i test dei finali): periodo, secondi alla fine del periodo,
 * punteggio e chi ha la palla. Il risultato conta solo quello che succede da lì in poi.
 */
export interface GameSituation {
  period: number;
  clock: number;
  home: number;
  away: number;
  ball: SideKey;
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
  from?: GameSituation,
): GameResult {
  return new GameSim(home, away, seed, params).run(from);
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
      const target = (setup.minutes[p.id] ?? 0) * scale * 60;
      // Chi deve giocare più di longMinutes resta in campo anche stanco e rientra prima: chi chiede 42 minuti li
      // gioca, salvo falli e stanchezza estrema
      const extra = Math.max(0, target / 60 - this.P.longMinutes);
      const spread = (c: number) => this.P.formBase + (this.P.formRange * (100 - c)) / 100;
      const formOff = this.rng.normal(0, spread(p.hidden.offensiveConsistency));
      const formDef = this.rng.normal(0, spread(p.hidden.defensiveConsistency));
      const risks = BODY_PARTS.map((part) => ((100 - p.hidden[DURABILITY_KEY[part]]) / 20) ** 1.5);
      return {
        p,
        line: emptyLine(p, slot >= 0),
        energy: p.energy,
        fouls: 0,
        target,
        subOut: Math.max(this.P.subEnergyFloor, this.P.subEnergy - this.P.longSubOutStep * extra),
        subIn: Math.max(this.P.returnEnergyFloor, this.P.returnEnergy - this.P.longSubInStep * extra),
        injured: false,
        absent: false,
        formOff,
        formDef,
        sizeF: ((p.heightCm + 0.5 * (p.wingspanCm - p.heightCm)) / 203) ** 4,
        slot,
        fits: SLOT_ROLES.map((role) => roleFit(p, role)),
        // L'allenatore conta come il morale: moltiplica tutte le abilità (senza allenatore per 1, numeri identici)
        moraleF: (1 + (0.06 * (p.morale - 50)) / 100) * (1 + (setup.coaching ?? 0)),
        formOffF: 1 + formOff,
        formDefF: 1 + formDef,
        staminaF: 1.25 - p.ratings.stamina / 200,
        risks,
        durability: risks.reduce((a, b) => a + b, 0) / risks.length,
        ageF: 1 + 0.06 * Math.max(0, p.age - 30),
        effEnergy: NaN,
        effSlot: -2,
        effOff: 1,
        effDef: 1,
        usage: 0,
        usageReady: false,
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
  run(from?: GameSituation): GameResult {
    const periodLength = (period: number) => (period <= 4 ? 720 : 300);
    let first: Side;
    if (from) {
      first = from.ball === 'home' ? this.home : this.away;
      this.home.score = from.home;
      this.away.score = from.away;
      for (let k = 1; k < from.period; k++) this.elapsed += periodLength(k);
      this.elapsed += periodLength(from.period) - from.clock;
    } else first = this.jumpBall() ? this.home : this.away;
    for (this.period = from?.period ?? 1; ; this.period++) {
      const resume = from !== undefined && this.period === from.period;
      const length = periodLength(this.period);
      this.clock = resume ? from.clock : length;
      this.home.teamFouls = this.away.teamFouls = 0;
      this.home.foulsLast2 = this.away.foulsLast2 = 0;
      const startScore = [this.home.score, this.away.score];
      if (this.period >= 5 && !resume) first = this.jumpBall() ? this.home : this.away;
      let off =
        resume || this.period === 1 || this.period === 4 || this.period >= 5 ? first : this.other(first);
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
      const center = s.court[4] as SimPlayer;
      const jump = (c: SimPlayer) => c.p.heightCm + c.p.ratings.vertical / 4;
      if (!center.absent) return jump(center);
      return Math.max(...present(s).map(jump));
    };
    return this.rng.chance(1 / (1 + Math.exp((reach(this.away) - reach(this.home)) / 6)));
  }

  // ------------------------------------------------------------ efficacia e abilità
  /**
   * Efficacia del giocatore: fatica, morale, ruolo dello slot e forma del giorno moltiplicano le abilità. Si
   * ricalcola solo quando cambiano energia o slot; altrimenti resta quella già calcolata (stessi numeri).
   */
  private fresh(sp: SimPlayer): void {
    if (sp.effEnergy === sp.energy && sp.effSlot === sp.slot) return;
    const P = this.P;
    const fatigue = 1 - P.fatigueMaxPenalty * clamp((P.fatigueThreshold - sp.energy) / 40, 0, 1);
    const fit = sp.slot >= 0 ? (sp.fits[sp.slot] as number) : 1;
    const base = fatigue * sp.moraleF * fit;
    sp.effOff = base * sp.formOffF;
    sp.effDef = base * sp.formDefF;
    sp.effEnergy = sp.energy;
    sp.effSlot = sp.slot;
    sp.usageReady = false;
  }

  private r(sp: SimPlayer, key: RatingKey, kind: 'off' | 'def' = 'off'): number {
    this.fresh(sp);
    return sp.p.ratings[key] * (kind === 'off' ? sp.effOff : sp.effDef);
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
        if (sp.slot >= 0 && !sp.absent) {
          sp.line.seconds += dt;
          sp.energy = Math.max(0, sp.energy - (P.energyDrain * sp.staminaF * drainF * dt) / 60);
          this.rollInjury(sp, side, dt);
        } else if (!sp.injured) {
          sp.energy = Math.min(100, sp.energy + (P.benchRecovery * dt) / 60);
        }
      }
    }
    this.clock -= dt;
    this.elapsed += dt;
  }

  private rollInjury(sp: SimPlayer, side: Side, dt: number): void {
    if (sp.injured || this.pendingInjuries.some((x) => x.sp === sp)) return;
    const fatigue = sp.energy < 40 ? 2.2 : sp.energy < 60 ? 1.5 : 1;
    const p =
      (this.P.injuryPerMinute * dt * sp.durability * fatigue * sp.ageF * this.intensity(side, 0.95, 1.1)) /
      60;
    if (this.rng.chance(p)) this.pendingInjuries.push({ sp, side });
  }

  private applyInjuries(): void {
    for (const { sp, side } of this.pendingInjuries) {
      // Il distretto: più è fragile (durabilità bassa), più è probabile
      const k = this.rng.weightedIndex(sp.risks);
      const part = BODY_PARTS[k] as BodyPart;
      const fragile = (sp.risks[k] as number) > 1.5;
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

  /**
   * Quanto conviene avere un giocatore in campo in uno slot: minuti che gli mancano rispetto all'obiettivo, energia,
   * adattamento al ruolo, e nel finale chi chiude la partita.
   */
  private subValue(side: Side, c: SimPlayer, slot: number, late: boolean): number {
    return (
      (this.expected(c) - c.line.seconds) / 60 +
      (c.energy - 75) / 8 +
      25 * ((c.fits[slot] as number) - 1) +
      (late && side.closers.has(c) ? 20 : 0)
    );
  }

  private checkSubs(side: Side, force = false): void {
    const P = this.P;
    if (!force && this.elapsed - side.lastSubCheck < P.subCheckSeconds) return;
    side.lastSubCheck = this.elapsed;
    const late = this.period >= 4 && this.clock <= 300 && Math.abs(this.margin(side)) <= 10;
    for (let slot = 0; slot < 5; slot++) {
      const cur = side.court[slot] as SimPlayer;
      const forced = cur.injured || cur.fouls >= P.foulOut;
      const value = (c: SimPlayer) => this.subValue(side, c, slot, late);
      // Chi deve uscire per forza (infortunio, sesto fallo) può essere sostituito anche da chi ha falli
      const bench = side.players.filter(
        (c) => c.slot < 0 && !c.injured && (forced ? c.fouls < P.foulOut : !this.foulTrouble(c)),
      );
      const eligible = bench.filter(
        (c) => forced || c.energy >= c.subIn || (late && side.closers.has(c) && c.energy >= 55),
      );
      if (eligible.length === 0) {
        // Infortunato senza nessuno per sostituirlo: esce lo stesso e la squadra resta in 4 (o meno), finché in
        // campo restano almeno MIN_PRESENT giocatori. Chi ha 6 falli invece resta, come nella NBA.
        if (cur.injured && !cur.absent && present(side).length > MIN_PRESENT) {
          cur.absent = true;
          this.event(
            side,
            [cur.p.id],
            `${cur.p.lastName} esce: nessuno può sostituirlo, si gioca in ${present(side).length}`,
          );
        }
        continue;
      }
      const wantOut =
        forced ||
        this.foulTrouble(cur) ||
        cur.energy < cur.subOut ||
        (cur.line.seconds - this.expected(cur) > P.subMinutesSlack && !(late && side.closers.has(cur))) ||
        (late && !side.closers.has(cur) && eligible.some((c) => side.closers.has(c)));
      if (!wantOut) continue;
      const best = eligible.reduce((a, b) => (value(b) > value(a) ? b : a));
      if (!forced && !this.foulTrouble(cur) && cur.energy >= cur.subOut && value(best) <= value(cur) + 0.5)
        continue;
      best.slot = slot;
      cur.slot = -1;
      cur.absent = false;
      side.court[slot] = best;
      this.event(side, [best.p.id, cur.p.id], `Entra ${best.p.lastName}, esce ${cur.p.lastName}`);
    }
    this.pullLongMinutes(side, late);
  }

  /**
   * Chi ha più di longMinutes minuti obiettivo ed è indietro di più di subMinutesSlack non aspetta che qualcuno
   * voglia uscire: rientra nello slot dove sostituirlo conviene di più (con lo stesso valore dei cambi). Senza,
   * un giocatore da 42 minuti restava in panchina anche dieci minuti e ne giocava circa 35.
   */
  private pullLongMinutes(side: Side, late: boolean): void {
    const P = this.P;
    for (const c of side.players) {
      if (c.slot >= 0 || c.injured || c.target <= P.longMinutes * 60 || this.foulTrouble(c)) continue;
      if (c.energy < c.subIn || this.expected(c) - c.line.seconds <= P.subMinutesSlack) continue;
      let bestSlot = -1;
      let gain = 0.5;
      for (let slot = 0; slot < 5; slot++) {
        const cur = side.court[slot] as SimPlayer;
        if (late && side.closers.has(cur) && !side.closers.has(c)) continue;
        const g = this.subValue(side, c, slot, late) - this.subValue(side, cur, slot, late);
        if (g > gain) {
          gain = g;
          bestSlot = slot;
        }
      }
      if (bestSlot < 0) continue;
      const cur = side.court[bestSlot] as SimPlayer;
      c.slot = bestSlot;
      cur.slot = -1;
      cur.absent = false;
      side.court[bestSlot] = c;
      this.event(side, [c.p.id, cur.p.id], `Entra ${c.p.lastName}, esce ${cur.p.lastName}`);
    }
  }

  // ------------------------------------------------------------ possesso
  private possession(off: Side, def: Side, transition: boolean): { side: Side; transition: boolean } {
    const P = this.P;
    off.possessions++;
    const E = P.endgame;
    // Ultimi 2 minuti del quarto periodo e dei supplementari
    const late = this.period >= 4 && this.clock <= E.lateSeconds;
    // Vantaggio di chi attacca (negativo se è sotto)
    const lead = off.score - def.score;

    // Falli sistematici: chi è sotto e non ha la palla fa fallo quando chi è avanti potrebbe far scorrere il
    // tempo, cioè quando restano meno di 24 secondi per ogni possesso che gli serve per recuperare
    if (
      this.period >= 4 &&
      lead >= 1 &&
      lead <= E.foulMaxLead &&
      this.clock <= E.foulSecondsPerPossession * Math.ceil(lead / 3)
    ) {
      while (this.clock > 0) {
        // Qualche secondo per arrivare al fallo, lasciandone almeno uno sul cronometro
        this.advance(Math.min(this.rng.int(2, 4), Math.max(0, this.clock - 1)));
        const target = off.court[
          this.rng.weightedIndex(
            off.court.map((sp) => (sp.absent ? 0 : (100 - this.r(sp, 'freeThrow')) ** 2)),
          )
        ] as SimPlayer;
        const fouler = this.rng.pick(present(def));
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
      const startClock = this.clock;
      let dur: number;
      let lastShot = false;
      if (transition) dur = Math.round(clamp(this.rng.normal(P.transitionSeconds, 2), 2, 10));
      else if (attempt > 0) dur = Math.round(clamp(this.rng.normal(P.offensiveReboundSeconds, 3), 2, 14));
      // Chi è avanti gestisce il cronometro
      else if (late && lead > 0) dur = Math.round(clamp(this.rng.normal(21, 2), 12, 24));
      // Ultimo tiro: in parità si tira allo scadere, sotto di un possesso si lascia qualche secondo per il
      // rimbalzo o per un fallo
      else if (late && lead <= 0 && lead >= -3 && this.clock <= E.lastShotSeconds) {
        dur = Math.max(1, this.clock - (lead === 0 ? this.rng.int(1, 3) : this.rng.int(2, 5)));
        lastShot = true;
      }
      // In parità si gioca con calma, per non lasciare troppo tempo agli avversari
      else if (late && lead === 0) dur = Math.round(clamp(this.rng.normal(19, 3), 10, shotClock));
      // Chi è sotto accelera
      else if (late && lead < 0) dur = Math.round(clamp(this.rng.normal(8, 3), 3, 16));
      else {
        const pace = (t: Side) => P.possessionSeconds[t.setup.tactics.pace];
        const mean = 0.65 * pace(off) + 0.35 * pace(def);
        dur = Math.round(clamp(this.rng.normal(mean, P.possessionSd), 4, shotClock));
      }
      // Poco tempo: un possesso che parte con pochi secondi alla fine del periodo finisce con un tiro affrettato,
      // con 1-2 secondi è quasi una preghiera; l'ultimo tiro preparato trova la difesa pronta
      const hurry =
        startClock <= 2
          ? E.heavePenalty
          : startClock <= 5
            ? E.hurryPenalty
            : lastShot
              ? E.lastShotPenalty
              : 0;
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
            d.absent
              ? a
              : a +
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
      const hardness = def.court.reduce((a, d) => (d.absent ? a : a + d.p.tendencies.hardFoul), 0) / 5;
      if (
        this.rng.chance(
          P.nonShootingFoulBase * this.intensity(def, 0.9, 1.15) * (0.8 + (0.4 * hardness) / 100),
        )
      ) {
        const fouler = def.court[
          this.rng.weightedIndex(
            def.court.map((d) => (d.absent ? 0 : d.p.tendencies.hardFoul + d.p.tendencies.steal)),
          )
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
      // Nel finale chi è sotto di 3 o più cerca la tripla, e sotto di 3 sull'ultimo tiro quasi solo quella; sotto
      // di 2 sull'ultimo tiro si va per il pareggio da 2
      const goal: ShotGoal =
        late && lead === -3 && startClock <= E.lastShotSeconds
          ? 'tie3'
          : late && lead <= -3 && startClock <= 40
            ? 'three'
            : late && lead === -2 && startClock <= E.lastShotSeconds
              ? 'two'
              : null;
      const plan = this.planShot(off, def, transition, goal);
      const outcome = this.shoot(off, def, plan, transition, hurry);
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
      // Rimbalzo di squadra (palla fuori): si rimette in gioco, niente tap-in
      if (offensive === 'team') continue;
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
        const res = this.shoot(off, def, put, false, 0);
        if (res === 'kept') continue;
        if (res !== 'miss') return { side: def, transition: false };
        const again = this.rebound(off, def, 1);
        if (!again || this.clock <= 0) return { side: def, transition: false };
      }
    }
  }

  private transitionChance(side: Side, base: number): number {
    const pace = side.setup.tactics.pace;
    const speed = side.court.reduce((a, sp) => (sp.absent ? a : a + this.r(sp, 'speed')), 0) / 5;
    return base * (pace === 'fast' ? 1.35 : pace === 'slow' ? 0.7 : 1) * (0.7 + (0.6 * speed) / 100);
  }

  /** Peso del giocatore nella scelta di chi gioca la palla (come le abilità, vale finché energia e slot restano). */
  private usage(sp: SimPlayer): number {
    this.fresh(sp);
    if (!sp.usageReady) {
      sp.usage = this.computeUsage(sp);
      sp.usageReady = true;
    }
    return sp.usage;
  }

  private computeUsage(sp: SimPlayer): number {
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
        off.court.map((sp) =>
          sp.absent ? 0 : this.usage(sp) * ((this.r(sp, 'ballHandle') + this.r(sp, 'passVision')) / 130) ** 2,
        ),
      )
    ] as SimPlayer;
  }

  // ------------------------------------------------------------ scelta del tiro
  private planShot(off: Side, def: Side, transition: boolean, goal: ShotGoal): ShotPlan {
    const shooter = off.court[
      this.rng.weightedIndex(off.court.map((sp) => (sp.absent ? 0 : this.usage(sp))))
    ] as SimPlayer;
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
        (goal === 'tie3' ? 12 : goal === 'three' ? 2.5 : goal === 'two' ? 0.3 : 1),
      mid:
        t.midRange *
        this.P.midWeight *
        (focus === 'perimeter' ? 1.05 : focus === 'inside' ? 0.9 : 1) *
        (zone ? 1.1 : 1),
      drive: t.drive * (focus === 'perimeter' ? 0.9 : focus === 'inside' ? 1.15 : 1) * (zone ? 0.85 : 1),
      post:
        t.post *
        this.P.postWeight *
        (focus === 'perimeter' ? 0.65 : focus === 'inside' ? 1.45 : 1) *
        (zone ? 0.85 : 1),
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
        const mates = off.court.filter((sp) => sp !== shooter && !sp.absent);
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
      const bigs = insideDefenders(def);
      const h = bigs.reduce((a, b) =>
        this.r(b, 'helpDefense', 'def') > this.r(a, 'helpDefense', 'def') ? b : a,
      );
      const zoneF = def.setup.tactics.defense === 'zone' ? 1.15 : 1;
      if (this.rng.chance(P.helpChance * (this.r(h, 'helpDefense', 'def') / 65) * zoneF)) {
        if (this.rng.chance(P.kickOutChance * (this.r(shooter, 'passVision') / 70))) {
          const mates = off.court.filter((sp) => sp !== shooter && !sp.absent);
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
    const rimGuard = () => Math.max(...insideDefenders(def).map(valueOf));
    // In 4 (o meno) si difende peggio: qualcuno resta sempre libero
    const short = def.court.some((d) => d.absent) ? SHORTHANDED_DEFENSE : 1;
    if (def.setup.tactics.defense === 'zone') {
      let group = (inside ? def.court.slice(3) : def.court.slice(0, 3)).filter((d) => !d.absent);
      if (group.length === 0) group = present(def);
      const avg = group.reduce((a, d) => a + valueOf(d), 0) / group.length;
      const d = group[this.rng.weightedIndex(group.map((g) => valueOf(g)))] as SimPlayer;
      return { d, value: avg * (inside ? 1.03 : 0.97) * short };
    }
    // Senza il suo marcatore (assente) sul tiratore arriva il migliore di chi c'è
    const marker = def.court[shooter.slot] as SimPlayer;
    const d = marker.absent ? present(def).reduce((a, b) => (valueOf(b) > valueOf(a) ? b : a)) : marker;
    const value = inside
      ? (1 - this.P.rimProtectionShare) * valueOf(d) + this.P.rimProtectionShare * rimGuard()
      : valueOf(d);
    return { d, value: value * short };
  }

  private shoot(
    off: Side,
    def: Side,
    plan: ShotPlan,
    transition: boolean,
    /** Quanto si perde sulla probabilità di canestro per il poco tempo. */
    hurry: number,
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
    const margin = this.margin(off);
    p -= P.comebackPerPoint * clamp(margin, -P.comebackCap, P.comebackCap);
    if (this.period >= 4 && this.clock <= 300 && margin !== 0 && Math.abs(margin) <= 8)
      p -= P.comebackClose * Math.sign(margin);
    if (transition) p += P.transitionBonus;
    p -= hurry;
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
      const candidates = plan.helper ? [plan.helper, d] : [d, ...insideDefenders(def, false)];
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
        const mates = off.court.filter((sp) => sp !== shooter && !sp.absent);
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
    for (const c of off.court) if (!c.absent) c.line.plusMinus += points;
    for (const c of def.court) if (!c.absent) c.line.plusMinus -= points;
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

  /** Chi prende il rimbalzo offensivo ('team' se è di squadra, palla fuori), o null se è della difesa. */
  private rebound(off: Side, def: Side, factor: number): SimPlayer | 'team' | null {
    const P = this.P;
    // Valori rapportati alla media della lega: i rimbalzi offensivi hanno valori più bassi di quelli difensivi
    const norm = (key: RatingKey) =>
      key === 'offensiveRebound' ? P.reboundMeans.offensive : P.reboundMeans.defensive;
    const strength = (sp: SimPlayer, key: RatingKey) =>
      sp.absent ? 0 : (this.r(sp, key) / norm(key)) * sp.sizeF * (0.8 + (0.4 * sp.p.ratings.hustle) / 100);
    const O = off.court.reduce((a, sp) => a + strength(sp, 'offensiveRebound'), 0);
    const D = def.court.reduce((a, sp) => a + strength(sp, 'defensiveRebound'), 0);
    const base = P.offensiveReboundBase * factor;
    const pOrb = 1 / (1 + (D / O) ** P.reboundExponent * ((1 - base) / base));
    const teamRebound = this.rng.chance(P.teamReboundShare);
    if (this.rng.chance(pOrb)) {
      if (teamRebound) {
        this.event(off, [], 'Rimbalzo offensivo di squadra');
        return 'team';
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
    const stealLean = def.court.reduce((a, d) => (d.absent ? a : a + d.p.tendencies.steal), 0) / 5;
    if (this.rng.chance(P.liveBallTurnoverShare * (0.8 + (0.4 * stealLean) / 100))) {
      const stealer = def.court[
        this.rng.weightedIndex(
          def.court.map((d) => (d.absent ? 0 : (this.r(d, 'steal', 'def') * d.p.tendencies.steal) ** 1.5)),
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
