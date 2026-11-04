import { Rng } from '../rng.ts';
import type { DraftPick, DraftSwap } from './state.ts';

/** Anni futuri di scelte scambiabili, come nella NBA. */
export const PICK_YEARS = 7;
/** Rinvii massimi di una scelta protetta prima di trasformarsi nella seconda scelta. */
export const MAX_DEFERRALS = 3;

export function pickId(draftYear: number, round: 1 | 2, originalTeamId: string): string {
  return `${draftYear}-${round}-${originalTeamId}`;
}

/** Ogni squadra possiede le proprie scelte di primo e secondo giro per i prossimi 7 draft. */
export function initialPicks(teamIds: readonly string[], firstDraftYear: number): DraftPick[] {
  const picks: DraftPick[] = [];
  for (let y = firstDraftYear; y < firstDraftYear + PICK_YEARS; y++) {
    for (const t of teamIds) for (const round of [1, 2] as const) picks.push(newPick(y, round, t));
  }
  return picks;
}

export function newPick(draftYear: number, round: 1 | 2, teamId: string): DraftPick {
  return {
    id: pickId(draftYear, round, teamId),
    draftYear,
    round,
    originalTeamId: teamId,
    ownerId: teamId,
    protection: null,
    deferrals: 0,
  };
}

/** Vero se la squadra possiede almeno una prima scelta libera (non protetta) di quel draft. */
export function ownsFreeFirst(picks: readonly DraftPick[], teamId: string, draftYear: number): boolean {
  return picks.some(
    (p) => p.draftYear === draftYear && p.round === 1 && p.ownerId === teamId && p.protection === null,
  );
}

/**
 * Regola Stepien: una squadra non può restare senza prima scelta in due draft futuri consecutivi.
 * Una scelta propria ceduta con protezione conta come ceduta.
 */
export function violatesStepien(picks: readonly DraftPick[], teamId: string, nextDraftYear: number): boolean {
  for (let y = nextDraftYear; y < nextDraftYear + PICK_YEARS - 1; y++) {
    if (!ownsFreeFirst(picks, teamId, y) && !ownsFreeFirst(picks, teamId, y + 1)) return true;
  }
  return false;
}

export interface DraftSlot {
  round: 1 | 2;
  /** Posizione nel giro, da 1. */
  number: number;
  originalTeamId: string;
  ownerId: string;
}

export interface DraftResolution {
  slots: DraftSlot[];
  notes: string[];
}

/**
 * Applica protezioni e swap al draft di quest'anno. order1 e order2 sono le squadre d'origine in ordine di
 * scelta. Modifica picks (toglie quelle usate, sposta quelle rinviate) e restituisce chi sceglie in ogni slot.
 */
export function resolveDraft(
  picks: DraftPick[],
  swaps: DraftSwap[],
  draftYear: number,
  order1: readonly string[],
  order2: readonly string[],
): DraftResolution {
  const notes: string[] = [];
  const find = (round: 1 | 2, team: string, year = draftYear) =>
    picks.find((p) => p.draftYear === year && p.round === round && p.originalTeamId === team);
  const slots: DraftSlot[] = [];
  const owners = new Map<string, string>();

  for (const [round, order] of [
    [1, order1],
    [2, order2],
  ] as const) {
    order.forEach((team, i) => {
      const pick = find(round, team);
      owners.set(pickId(draftYear, round, team), pick ? pick.ownerId : team);
      slots.push({ round, number: i + 1, originalTeamId: team, ownerId: pick ? pick.ownerId : team });
    });
  }

  // Protezioni sul primo giro
  for (const slot of slots.filter((s) => s.round === 1)) {
    const pick = find(1, slot.originalTeamId) as DraftPick | undefined;
    if (
      !pick ||
      pick.protection === null ||
      pick.ownerId === pick.originalTeamId ||
      slot.number > pick.protection
    )
      continue;
    const creditor = pick.ownerId;
    const team = pick.originalTeamId;
    slot.ownerId = team;
    if (pick.deferrals < MAX_DEFERRALS) {
      const next = find(1, team, draftYear + 1);
      if (next && next.ownerId === team) {
        next.ownerId = creditor;
        next.protection = pick.protection;
        next.deferrals = pick.deferrals + 1;
        notes.push(
          `La prima scelta ${draftYear} di ${team} (protetta top ${pick.protection}) è uscita al n. ${slot.number}: resta a ${team} e passa al ${draftYear + 1}`,
        );
        continue;
      }
    }
    const second = slots.find((s) => s.round === 2 && s.originalTeamId === team);
    if (second && second.ownerId === team) {
      second.ownerId = creditor;
      notes.push(
        `La prima scelta ${draftYear} di ${team} (protetta) diventa la sua seconda scelta, che va a ${creditor}`,
      );
    } else {
      notes.push(
        `La prima scelta ${draftYear} di ${team} (protetta) resta a ${team}: nessuna seconda scelta disponibile per ${creditor}`,
      );
    }
  }

  // Swap: chi ha il diritto prende la migliore delle due, se possiede ancora la propria e l'altra squadra la sua
  for (const swap of swaps.filter((s) => s.draftYear === draftYear)) {
    const a = slots.find((s) => s.round === swap.round && s.originalTeamId === swap.holderId);
    const b = slots.find((s) => s.round === swap.round && s.originalTeamId === swap.otherId);
    if (!a || !b) continue;
    if (b.number < a.number && a.ownerId === swap.holderId && b.ownerId === swap.otherId) {
      a.ownerId = swap.otherId;
      b.ownerId = swap.holderId;
      notes.push(
        `Swap ${draftYear}: ${swap.holderId} prende la scelta n. ${b.number} e cede la n. ${a.number} a ${swap.otherId}`,
      );
    }
  }

  for (let i = picks.length - 1; i >= 0; i--)
    if ((picks[i] as DraftPick).draftYear === draftYear) picks.splice(i, 1);
  for (let i = swaps.length - 1; i >= 0; i--)
    if ((swaps[i] as DraftSwap).draftYear === draftYear) swaps.splice(i, 1);
  return { slots, notes };
}

/** Probabilità NBA della prima scelta (su 1000 combinazioni) per le 14 squadre in lottery, dalla peggiore. */
export const LOTTERY_ODDS = [140, 140, 140, 125, 105, 90, 75, 60, 45, 30, 20, 15, 10, 5];

/**
 * Lottery: si estraggono le prime 4 scelte con le probabilità NBA, le altre seguono l'ordine inverso di
 * classifica. worstFirst sono le 14 squadre fuori dai playoff, dalla peggiore.
 */
export function drawLottery(worstFirst: readonly string[], seed: string): string[] {
  const rng = new Rng(`${seed}:lottery`);
  const pool = worstFirst.map((id, i) => ({ id, w: LOTTERY_ODDS[i] ?? 0 }));
  const drawn: string[] = [];
  for (let k = 0; k < 4 && pool.length; k++) {
    const i = rng.weightedIndex(pool.map((p) => p.w));
    drawn.push((pool[i] as { id: string }).id);
    pool.splice(i, 1);
  }
  return [...drawn, ...pool.map((p) => p.id)];
}
