// Anteprima di una proposta di scambio, prima di inviarla: per le due squadre, prima e dopo, monte stipendi, spazio
// sotto il cap o distanza dalla tassa con la tassa stimata, rosa standard e two-way contro i limiti, regola Stepien
// e vincolo del saldo in rosso. Si calcola nell'app con le funzioni del motore, sugli stessi dati che la pagina del
// mercato ha già letto: chi decide resta il server (checkMarketAction nella funzione market, poi la chiusura del
// turno). Il saldo e la storia della tassa dell'altra squadra sono riservati: per lei il vincolo del saldo non si
// può dire e la tassa si stima con le aliquote normali.
import {
  luxuryTax,
  MAX_STANDARD,
  MAX_TWO_WAY,
  MIN_STANDARD,
  OFFSEASON_MAX_ROSTER,
  stepienGaps,
  validateTrade,
  type DraftPick,
  type LeagueState,
  type SeasonConfig,
  type Trade,
} from '@nbbgm/engine';
import type { PickInfo } from './market.ts';
import type { SwapInfo } from './teams.ts';

export interface PreviewPlayer {
  id: string;
  firstName: string;
  lastName: string;
  contractType: string | null;
  salaries: readonly number[];
}

export interface PreviewTeam {
  id: string;
  code: string;
  roster: readonly PreviewPlayer[];
  deadMoney: readonly { salaries: readonly number[] }[];
  /** Saldo: noto solo per la propria squadra (quello degli altri è riservato). */
  balance: number | null;
  /** Ha pagato la tassa in 3 delle ultime 4 stagioni (aliquote maggiorate): noto solo per la propria squadra. */
  repeater: boolean | null;
}

export interface TradeSelection {
  /** Giocatori e scelte che la propria squadra cede, e quelli che riceve. */
  give: readonly string[];
  get: readonly string[];
  givePicks: readonly string[];
  getPicks: readonly string[];
  /** Protezioni messe sulle proprie prime scelte cedute: id della scelta -> top N. */
  protections: Readonly<Record<string, number>>;
  swaps: readonly { draft_year: number; round: number; holder: 'from' | 'to' }[];
}

export interface SideNumbers {
  payroll: number;
  /** Cap meno monte stipendi (negativo: sopra il cap). */
  capSpace: number;
  /** Soglia della tassa meno monte stipendi (negativo: sopra la soglia). */
  taxRoom: number;
  tax: number;
  standard: number;
  twoWay: number;
  total: number;
}

export interface SidePreview {
  teamId: string;
  code: string;
  before: SideNumbers;
  after: SideNumbers;
  /** Rosa dopo lo scambio dentro i limiti (in stagione 13-15 standard e 3 two-way, in offseason 21 in tutto). */
  rosterOk: boolean;
  /** Draft in cui lo scambio aprirebbe un buco nuovo (regola Stepien). */
  stepienGaps: number[];
  /** Vincolo del saldo in rosso: ok, bloccato (aumenta il monte con il saldo negativo) o non noto (altra squadra). */
  balance: 'ok' | 'blocked' | 'unknown';
  /** La tassa è una stima con le aliquote normali (non si sa se la squadra paga quelle maggiorate). */
  taxEstimated: boolean;
}

export interface TradePreview {
  sides: [SidePreview, SidePreview];
  /** Motivi per cui il server rifiuterebbe la proposta (le regole del motore, validateTrade). */
  problems: string[];
}

export interface PreviewInput {
  config: SeasonConfig;
  /** Turno corrente: tipo (regular, play-in, playoffs, offseason) e numero. */
  roundKind: string | null;
  roundNumber: number | null;
  me: PreviewTeam;
  partner: PreviewTeam;
  /** Scelte future della lega (per la regola Stepien servono tutte quelle delle due squadre). */
  picks: readonly PickInfo[];
  /** Swap ancora aperti che riguardano la propria squadra. */
  swaps: readonly SwapInfo[];
  sel: TradeSelection;
}

const isTwoWay = (p: PreviewPlayer) => p.contractType === 'two-way';

function numbers(
  config: SeasonConfig,
  roster: readonly PreviewPlayer[],
  deadMoney: PreviewTeam['deadMoney'],
  repeater: boolean,
): SideNumbers {
  const payroll =
    roster.filter((p) => !isTwoWay(p)).reduce((a, p) => a + (p.salaries[0] ?? 0), 0) +
    deadMoney.reduce((a, d) => a + (d.salaries[0] ?? 0), 0);
  const twoWay = roster.filter(isTwoWay).length;
  return {
    payroll,
    capSpace: config.salaryCap - payroll,
    taxRoom: config.luxuryTax - payroll,
    tax: luxuryTax(config, payroll, repeater),
    standard: roster.length - twoWay,
    twoWay,
    total: roster.length,
  };
}

/** Fase della lega come la vede il motore, dal tipo di turno. */
const phaseOf = (kind: string | null): LeagueState['phase'] =>
  kind === 'offseason' ? 'offseason' : kind === 'play-in' || kind === 'playoffs' ? 'postseason' : 'regular';

/**
 * Stato ridotto alle due squadre, con le sigle come id delle squadre (come sul server): basta a validateTrade, che
 * guarda solo i giocatori, i contratti, le scelte e gli swap delle due squadre, la fase e il turno. Il saldo
 * dell'altra squadra non si conosce: vale 0, quindi il suo vincolo del saldo non scatta qui.
 */
function miniState(input: PreviewInput): LeagueState {
  const { me, partner } = input;
  const code = new Map([
    [me.id, me.code],
    [partner.id, partner.code],
  ]);
  const teamCode = (id: string) => code.get(id) ?? id;
  const players = [
    ...me.roster.map((p) => ({ ...p, teamId: me.code })),
    ...partner.roster.map((p) => ({ ...p, teamId: partner.code })),
  ];
  const state = {
    seed: '',
    config: input.config,
    phase: phaseOf(input.roundKind),
    turn: input.roundKind === 'regular' ? (input.roundNumber ?? 0) : 0,
    teams: [
      { id: me.code, balance: me.balance ?? 0, taxHistory: [] },
      { id: partner.code, balance: partner.balance ?? 0, taxHistory: [] },
    ],
    players,
    contracts: players
      .filter((p) => p.contractType !== null)
      .map((p) => ({ playerId: p.id, teamId: p.teamId, type: p.contractType, salaries: [...p.salaries] })),
    deadMoney: [
      ...me.deadMoney.map((d) => ({ teamId: me.code, salaries: [...d.salaries] })),
      ...partner.deadMoney.map((d) => ({ teamId: partner.code, salaries: [...d.salaries] })),
    ],
    picks: input.picks.map((k): DraftPick => ({
      id: k.id,
      draftYear: k.draftYear,
      round: k.round,
      originalTeamId: teamCode(k.originalTeamId),
      ownerId: teamCode(k.ownerTeamId),
      protection: k.protection,
      deferrals: 0,
    })),
    swaps: input.swaps.map((w) => ({
      id: w.id,
      draftYear: w.draftYear,
      round: w.round,
      holderId: teamCode(w.holderTeamId),
      otherId: teamCode(w.otherTeamId),
    })),
  };
  return state as unknown as LeagueState;
}

/** La proposta come la legge il motore: A è la propria squadra, B l'altra. */
export function tradeOf(input: Pick<PreviewInput, 'me' | 'partner' | 'sel'>): Trade {
  const { me, partner, sel } = input;
  return {
    teamA: me.code,
    teamB: partner.code,
    playersA: [...sel.give],
    playersB: [...sel.get],
    picksA: [...sel.givePicks],
    picksB: [...sel.getPicks],
    swaps: sel.swaps.map((w) => ({
      draftYear: w.draft_year,
      round: w.round as 1 | 2,
      holderId: w.holder === 'from' ? me.code : partner.code,
      otherId: w.holder === 'from' ? partner.code : me.code,
    })),
    protections: Object.fromEntries(
      Object.entries(sel.protections).filter(([id, n]) => sel.givePicks.includes(id) && n > 0),
    ),
  };
}

export function tradePreview(input: PreviewInput): TradePreview {
  const { config, me, partner, sel } = input;
  const offseason = phaseOf(input.roundKind) === 'offseason';
  const state = miniState(input);
  const trade = tradeOf(input);
  const nextDraft = config.year + 1;
  const picksAfter = state.picks.map((p) => {
    const owner = trade.picksA.includes(p.id)
      ? trade.teamB
      : trade.picksB.includes(p.id)
        ? trade.teamA
        : p.ownerId;
    const protection = trade.protections?.[p.id] ?? p.protection;
    return { ...p, ownerId: owner, protection };
  });
  const side = (team: PreviewTeam, out: readonly string[], inn: PreviewPlayer[]): SidePreview => {
    const after = [...team.roster.filter((p) => !out.includes(p.id)), ...inn];
    const repeater = team.repeater ?? false;
    const b = numbers(config, team.roster, team.deadMoney, repeater);
    const a = numbers(config, after, team.deadMoney, repeater);
    const rosterOk =
      a.twoWay <= MAX_TWO_WAY &&
      (offseason
        ? a.total <= OFFSEASON_MAX_ROSTER
        : a.standard >= MIN_STANDARD && a.standard <= MAX_STANDARD);
    const gapsBefore = new Set(stepienGaps(state.picks, team.code, nextDraft));
    const salary = (ps: readonly PreviewPlayer[]) => ps.reduce((x, p) => x + (p.salaries[0] ?? 0), 0);
    const outgoing = team.roster.filter((p) => out.includes(p.id));
    return {
      teamId: team.id,
      code: team.code,
      before: b,
      after: a,
      rosterOk,
      stepienGaps: stepienGaps(picksAfter, team.code, nextDraft).filter((y) => !gapsBefore.has(y)),
      balance:
        team.balance === null
          ? 'unknown'
          : team.balance < 0 && salary(inn) > salary(outgoing)
            ? 'blocked'
            : 'ok',
      taxEstimated: team.repeater === null,
    };
  };
  const mine = me.roster.filter((p) => sel.give.includes(p.id));
  const theirs = partner.roster.filter((p) => sel.get.includes(p.id));
  return {
    sides: [side(me, sel.give, theirs), side(partner, sel.get, mine)],
    problems: validateTrade(state, trade),
  };
}
