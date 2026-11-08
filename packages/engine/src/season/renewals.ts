// Rinnovi con trattativa. Il giocatore da rinnovare (in scadenza nel turno dei rinnovi, all'ultimo anno di contratto in
// stagione) chiede uno stipendio per gli anni che vuole; il manager offre stipendio, anni (1-5) e un'eventuale opzione
// sull'ultimo anno, e il giocatore risponde subito: accetta, oppure rifiuta con una controproposta. Quanto accetta
// davvero resta nascosto: tra l'85 e il 100% della richiesta, meno con il morale alto e un buon carattere. Anni
// diversi da quelli che vuole valgono meno per lui, l'opzione del giocatore di più, quella della squadra di meno.
// Un'offerta sotto l'80% della richiesta gli toglie un po' di morale; dopo 3 rifiuti la trattativa si chiude e resta
// solo la sua ultima controproposta. Tutto senza caso: la stessa offerta ha sempre la stessa risposta, così la
// funzione del mercato risponde subito e la chiusura del turno non deve rifare nulla.
import type { ContractOption } from '../types.ts';
import { salaryRun } from './finance.ts';
import type { LeagueState, PlayerState } from './state.ts';

/** Offerte rifiutate dopo cui la trattativa si chiude. */
export const RENEWAL_ATTEMPTS = 3;
/** Sotto questa quota della richiesta l'offerta è un'offesa: il giocatore perde morale. */
export const LOWBALL_SHARE = 0.8;
/** Morale che il giocatore perde per ogni offerta sotto l'80% della richiesta. */
export const LOWBALL_MORALE = 3;
/** Quanto vale di meno per il giocatore ogni anno di differenza da quelli che vuole. */
export const YEAR_GAP_COST = 0.04;
/** Quanto vale in più per il giocatore la sua opzione sull'ultimo anno (e in meno quella della squadra). */
export const OPTION_WORTH = 0.05;
/** Sconto massimo sulla richiesta con il morale a 100 e con il carattere migliore. */
export const MORALE_DISCOUNT = 0.1;
export const CHARACTER_DISCOUNT = 0.05;
/** Le controproposte si arrotondano in su al mezzo milione: dicono poco della soglia vera. */
export const COUNTER_STEP = 500_000;

export interface RenewalTerms {
  /** Stipendio del primo anno; poi +5% l'anno, come tutti i contratti. */
  salary: number;
  years: number;
  /** Opzione sull'ultimo anno. */
  option: 'player' | 'team' | null;
}

/** Stato della trattativa con un giocatore (in una stagione). */
export interface RenewalTalk {
  /** Offerte rifiutate finora. */
  refusals: number;
  /** Ultima controproposta del giocatore. */
  counter: RenewalTerms | null;
}

export type RenewalReply =
  | { kind: 'accept' }
  | { kind: 'counter'; counter: RenewalTerms; lowball: boolean; attemptsLeft: number }
  /** Trattativa chiusa: resta solo questa controproposta, da prendere così com'è. */
  | { kind: 'final'; counter: RenewalTerms; lowball: boolean }
  /** Con il morale troppo basso non tratta. */
  | { kind: 'refuse' };

/** La richiesta come termini: stipendi e anni chiesti, senza opzioni. */
export function askTerms(salaries: readonly number[]): RenewalTerms {
  return { salary: salaries[0] ?? 0, years: salaries.length, option: null };
}

/** Stipendi e opzioni del contratto con questi termini. */
export function termsContract(t: RenewalTerms): { salaries: number[]; options: ContractOption[] } {
  const salaries = salaryRun(t.salary, t.years);
  return { salaries, options: salaries.map((_, i) => (i === t.years - 1 ? t.option : null)) };
}

/**
 * Quota della richiesta sotto cui il giocatore non scende (nascosta): da 0,85 a 1, con fino al 10% di sconto per il
 * morale sopra 50 e fino al 5% per il carattere.
 */
export function renewalFloorShare(p: Pick<PlayerState, 'morale' | 'hidden'>): number {
  const morale = Math.max(0, Math.min(1, (p.morale - 50) / 50));
  const character = Math.max(0, Math.min(1, p.hidden.character / 100));
  return 1 - MORALE_DISCOUNT * morale - CHARACTER_DISCOUNT * character;
}

function termsFactor(t: Pick<RenewalTerms, 'years' | 'option'>, preferredYears: number): number {
  const years = Math.max(0, 1 - YEAR_GAP_COST * Math.abs(t.years - preferredYears));
  const option = t.option === 'player' ? 1 + OPTION_WORTH : t.option === 'team' ? 1 - OPTION_WORTH : 1;
  return years * option;
}

/** Quanto vale un'offerta per il giocatore, in stipendio del primo anno sugli anni che vuole e senza opzioni. */
export function offerWorth(t: RenewalTerms, preferredYears: number): number {
  return t.salary * termsFactor(t, preferredYears);
}

/**
 * Risposta del giocatore a un'offerta di rinnovo. ask: la sua richiesta; talk: com'è andata finora; min e max: lo
 * stipendio minimo e massimo per lui (la controproposta ci resta dentro). Con il morale sotto minMorale non tratta.
 */
export function renewalReply(
  ask: RenewalTerms,
  p: Pick<PlayerState, 'morale' | 'hidden'>,
  offer: RenewalTerms,
  talk: RenewalTalk,
  limits: { min: number; max: number; minMorale: number },
): RenewalReply {
  if (p.morale < limits.minMorale) return { kind: 'refuse' };
  const worth = offerWorth(offer, ask.years);
  // Trattativa chiusa: vale solo la sua ultima controproposta
  if (talk.refusals >= RENEWAL_ATTEMPTS && talk.counter) {
    if (worth >= offerWorth(talk.counter, ask.years) - 1) return { kind: 'accept' };
    return { kind: 'final', counter: talk.counter, lowball: false };
  }
  const floor = ask.salary * renewalFloorShare(p);
  if (worth >= floor) return { kind: 'accept' };
  const lowball = worth < LOWBALL_SHARE * ask.salary;
  const counter = counterTerms(ask, offer, Math.max((worth + ask.salary) / 2, floor), limits);
  const refusals = talk.refusals + 1;
  if (refusals >= RENEWAL_ATTEMPTS) return { kind: 'final', counter, lowball };
  return { kind: 'counter', counter, lowball, attemptsLeft: RENEWAL_ATTEMPTS - refusals };
}

/**
 * Controproposta: gli anni del manager se distano al più uno da quelli che vuole (altrimenti i suoi), la sua opzione
 * se il manager gliel'ha offerta, e lo stipendio che per lui vale target, arrotondato in su al mezzo milione, mai più
 * della richiesta.
 */
function counterTerms(
  ask: RenewalTerms,
  offer: RenewalTerms,
  target: number,
  limits: { min: number; max: number },
): RenewalTerms {
  const years = Math.abs(offer.years - ask.years) <= 1 ? offer.years : ask.years;
  const option = offer.option === 'player' ? 'player' : null;
  const factor = termsFactor({ years, option }, ask.years);
  const ceiling = Math.min(limits.max, Math.round(ask.salary / factor / 10_000) * 10_000);
  const salary = Math.min(ceiling, Math.ceil(target / factor / COUNTER_STEP) * COUNTER_STEP);
  // Se anche al massimo non vale abbastanza (anni lontani, opzione), torna alla sua richiesta
  if (salary * factor < target - 1) return { ...ask };
  return { salary: Math.max(limits.min, salary), years, option };
}

/** Morale perso per le offerte offensive (sotto l'80% della richiesta) fatte nel turno: lowballs giocatore -> numero. */
export function applyLowballs(
  state: Pick<LeagueState, 'players'>,
  lowballs: ReadonlyMap<string, number>,
): void {
  for (const p of state.players) {
    const n = lowballs.get(p.id) ?? 0;
    if (n > 0) p.morale = Math.max(0, p.morale - LOWBALL_MORALE * n);
  }
}
