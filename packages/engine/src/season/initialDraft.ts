// Draft iniziale di tutti i giocatori (modalità "draft" delle rose iniziali): 13 giri a serpentina con ordine
// sorteggiato, sui giocatori con contratto standard (i two-way restano svincolati), così ogni squadra chiude con
// 13 contratti standard. In modalità lista il server esegue tutte le scelte di fila dalle liste dei manager;
// dal vivo c'è un tempo per scelta, e chi non sceglie in tempo riceve il primo disponibile della sua lista o,
// senza lista, il migliore per il ruolo più scoperto. I bot scelgono sempre da soli.
import { Rng } from '../rng.ts';
import type { Role } from '../types.ts';

export const INITIAL_DRAFT_ROUNDS = 13;

/** Giocatori per ruolo principale che la scelta automatica cerca in 13 giri. */
export const INITIAL_DRAFT_ROLE_TARGET: Readonly<Record<Role, number>> = { PG: 3, SG: 3, SF: 3, PF: 2, C: 2 };

export interface DraftProspect {
  id: string;
  role: Role;
  secondaryRole: Role | null;
  /** Overall al momento del draft (scala del motore). */
  overall: number;
}

/** Squadra che sceglie a ogni chiamata: primo giro sorteggiato, poi a serpentina. */
export function snakeOrder(teamIds: readonly string[], rounds: number, seed: string): string[] {
  const rng = new Rng(`${seed}:draft-iniziale`);
  const first = [...teamIds];
  for (let i = first.length - 1; i > 0; i--) {
    const j = rng.int(0, i);
    [first[i], first[j]] = [first[j] as string, first[i] as string];
  }
  const order: string[] = [];
  for (let r = 0; r < rounds; r++) order.push(...(r % 2 === 0 ? first : [...first].reverse()));
  return order;
}

const byOverall = (a: DraftProspect, b: DraftProspect) => b.overall - a.overall || (a.id < b.id ? -1 : 1);

/**
 * Scelta automatica: il primo disponibile della lista del manager; senza lista (o con la lista esaurita) il
 * migliore del ruolo più scoperto, e se tutti i ruoli sono coperti il migliore in assoluto.
 */
export function autoDraftPick(
  available: readonly DraftProspect[],
  roster: readonly DraftProspect[],
  list: readonly string[] = [],
): DraftProspect {
  if (available.length === 0) throw new Error('Nessun giocatore disponibile');
  const free = new Map(available.map((p) => [p.id, p]));
  for (const id of list) {
    const p = free.get(id);
    if (p) return p;
  }
  const need = { ...INITIAL_DRAFT_ROLE_TARGET } as Record<Role, number>;
  for (const p of roster) need[p.role]--;
  const maxNeed = Math.max(...Object.values(need));
  const sorted = [...available].sort(byOverall);
  if (maxNeed > 0) {
    const roles = (Object.keys(need) as Role[]).filter((r) => need[r] === maxNeed);
    // Tra i ruoli più scoperti vince quello con il migliore disponibile
    const best = sorted.find((p) => roles.includes(p.role));
    if (best) return best;
  }
  return sorted[0] as DraftProspect;
}

export type DraftMode = 'list' | 'live';

export interface DraftSnapshot {
  mode: DraftMode;
  state: 'waiting' | 'running' | 'done';
  /** Squadra per ogni chiamata (indice 0 = prima scelta). */
  order: readonly string[];
  /** Prossima chiamata da fare. */
  next: number;
  /** Scadenza della chiamata in corso (dal vivo), ISO. */
  deadline: string | null;
  pickSeconds: number;
  commissionerId: string;
  /** Squadra -> manager (null = bot). */
  owners: Readonly<Record<string, string | null>>;
  pool: readonly DraftProspect[];
  /** Giocatori già scelti, per chiamata. */
  made: readonly { pick: number; teamId: string; playerId: string }[];
  lists: Readonly<Record<string, readonly string[]>>;
}

export type DraftAction =
  | { kind: 'start'; userId: string }
  | { kind: 'pick'; userId: string; playerId: string }
  | { kind: 'tick' }
  | { kind: 'to-list'; userId: string };

export interface InitialDraftPick {
  pick: number;
  teamId: string;
  playerId: string;
  auto: boolean;
}

export interface DraftPlan {
  /** Il draft parte con queste scelte. */
  begin: boolean;
  /** Nuova modalità, se cambia. */
  mode: DraftMode | null;
  picks: InitialDraftPick[];
  /** Scadenza della prossima chiamata (dal vivo, se tocca a un umano), ISO. */
  deadline: string | null;
}

export class DraftError extends Error {}

/**
 * Cosa fare per un'azione sul draft: le scelte da registrare, a partire da snapshot.next, e la scadenza della
 * chiamata successiva. Funzione pura: chi la chiama legge lo stato e scrive il risultato in una transazione.
 */
export function planDraft(s: DraftSnapshot, action: DraftAction, now: Date): DraftPlan {
  let mode = s.mode;
  let begin = false;
  let modeChanged = false;
  const forced = new Set<number>();
  const manual = new Map<number, string>();

  switch (action.kind) {
    case 'start':
      if (action.userId !== s.commissionerId) throw new DraftError('Solo il commissario avvia il draft');
      if (s.state !== 'waiting') throw new DraftError('Il draft è già partito');
      begin = true;
      break;
    case 'to-list':
      if (action.userId !== s.commissionerId) throw new DraftError('Solo il commissario cambia la modalità');
      if (s.state !== 'running') throw new DraftError('Il draft non è in corso');
      if (mode === 'list') throw new DraftError('Il draft è già in modalità lista');
      mode = 'list';
      modeChanged = true;
      break;
    case 'pick': {
      if (s.state !== 'running') throw new DraftError('Il draft non è in corso');
      if (mode !== 'live') throw new DraftError('In modalità lista sceglie il server dalle liste');
      const team = s.order[s.next];
      if (team === undefined || s.owners[team] !== action.userId) throw new DraftError('Non tocca a te');
      manual.set(s.next, action.playerId);
      break;
    }
    case 'tick':
      if (s.state !== 'running' || mode !== 'live')
        return { begin, mode: null, picks: [], deadline: s.deadline };
      if (s.deadline !== null && new Date(s.deadline).getTime() > now.getTime())
        return { begin, mode: null, picks: [], deadline: s.deadline };
      forced.add(s.next);
      break;
  }

  const taken = new Set(s.made.map((m) => m.playerId));
  const rosters = new Map<string, DraftProspect[]>();
  const byId = new Map(s.pool.map((p) => [p.id, p]));
  for (const m of s.made) {
    const p = byId.get(m.playerId);
    if (p) rosters.set(m.teamId, [...(rosters.get(m.teamId) ?? []), p]);
  }

  const picks: InitialDraftPick[] = [];
  let i = s.next;
  for (; i < s.order.length; i++) {
    const team = s.order[i] as string;
    const human = s.owners[team] ?? null;
    const chosen = manual.get(i);
    let player: DraftProspect | undefined;
    let auto = true;
    if (chosen !== undefined) {
      player = byId.get(chosen);
      if (!player) throw new DraftError('Giocatore non disponibile nel draft');
      if (taken.has(chosen)) throw new DraftError('Giocatore già scelto');
      auto = false;
    } else if (mode === 'list' || human === null || forced.has(i)) {
      const available = s.pool.filter((p) => !taken.has(p.id));
      player = autoDraftPick(available, rosters.get(team) ?? [], s.lists[team] ?? []);
    } else {
      break; // dal vivo tocca a un umano: si aspetta la sua scelta
    }
    taken.add(player.id);
    rosters.set(team, [...(rosters.get(team) ?? []), player]);
    picks.push({ pick: i, teamId: team, playerId: player.id, auto });
  }

  const done = i >= s.order.length;
  const deadline =
    done || mode === 'list' ? null : new Date(now.getTime() + s.pickSeconds * 1000).toISOString();
  return { begin, mode: modeChanged ? mode : null, picks, deadline };
}
