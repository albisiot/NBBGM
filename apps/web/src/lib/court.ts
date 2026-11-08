// Formazione sul campo della pagina Squadra (stile Edicola): dove stanno i cinque posti sul mezzo campo, come si
// scrive il cognome nei riquadri, che cosa segnalano (infortunio, fuori ruolo, stanchezza, two-way), chi può
// prendere il posto di un titolare, la panchina e le note delle tattiche. Logica pura, senza React: le regole
// restano quelle del motore (roleFit, setupFromSettings) e della pagina (chi è già in campo si scambia di posto,
// gli infortunati non si scelgono).
import {
  roleFit,
  setupFromSettings,
  SLOT_ROLES,
  TWO_WAY_GAME_LIMIT,
  type Player,
  type Role,
  type SavedSettings,
  type Tactics,
} from '@nbbgm/engine';
import type { CoachDelegation } from './roster.ts';

/** Quello che serve di un giocatore per disegnarlo sul campo e in panchina. */
export type CourtPlayer = Pick<
  Player,
  'id' | 'firstName' | 'lastName' | 'role' | 'secondaryRole' | 'energy' | 'injury'
> & {
  contractType?: string | null;
  /** Statistiche di regular season della stagione (g: partite giocate). */
  stats?: Record<string, number>;
};

/** Il ruolo di ogni slot per esteso: titoli, frasi e lettori di schermo. */
export const ROLE_NAME: Record<Role, string> = {
  PG: 'playmaker',
  SG: 'guardia',
  SF: 'ala piccola',
  PF: 'ala grande',
  C: 'centro',
};

/** Sotto questa energia il giocatore è stanco: testo rosso, e la barra dell'energia diventa rossa. */
export const TIRED_BELOW = 75;

/**
 * Dove sta ogni slot sul mezzo campo, con il canestro in alto: centro e ala grande vicino al canestro, ala piccola
 * e guardia sulle ali, playmaker in punta. In orizzontale ogni riquadro si aggancia a un bordo con una percentuale
 * della larghezza (su un telefono stretto non esce dal campo), in verticale sta a una distanza fissa in rem dall'alto
 * o dal basso: il campo è alto 18,5rem, così anche un riquadro con il nome su due righe e il problema non tocca
 * quello sotto.
 */
export interface CourtSpot {
  left?: string;
  right?: string;
  top?: string;
  bottom?: string;
  transform?: string;
}

/** Posti nell'ordine degli slot: PG, SG, SF, PF, C. */
export const COURT_SPOTS: readonly CourtSpot[] = [
  { left: '50%', bottom: '0.5rem', transform: 'translateX(-50%)' },
  { right: '1.5%', top: '7.75rem' },
  { left: '1.5%', top: '7.75rem' },
  { right: '13%', top: '1.75rem' },
  { left: '13%', top: '1.75rem' },
];

/** Fino a quante lettere il cognome sta nel riquadro a 14 px. */
export const COURT_NAME_LETTERS = 10;

export interface CourtName {
  /** Una riga, o due andando a capo al trattino (che resta in fondo alla prima) o allo spazio. */
  lines: string[];
  /** 14 px fino a 10 lettere; oltre, 13 px su due righe o 12 px su una. */
  size: 14 | 13 | 12;
}

/**
 * Il cognome nel riquadro sul campo: sta sopra il voto e usa tutta la larghezza, mai abbreviato (il nome intero è
 * nel riquadro sotto il campo). Fino a 10 lettere 14 px; oltre, se c'è un trattino o uno spazio va a capo lì (dove
 * le due righe vengono più pari) a 13 px, altrimenti 12 px su una riga.
 */
export function courtName(lastName: string): CourtName {
  const name = lastName.trim();
  const letters = [...name.replace(/[\s'’.-]/g, '')].length;
  if (letters <= COURT_NAME_LETTERS) return { lines: [name], size: 14 };
  let best: [string, string] | null = null;
  for (let i = 1; i < name.length - 1; i++) {
    const c = name[i];
    if (c !== '-' && c !== ' ') continue;
    const first = c === '-' ? name.slice(0, i + 1) : name.slice(0, i).trimEnd();
    const second = name.slice(i + 1).trimStart();
    if (!first || !second) continue;
    const worst = Math.max(first.length, second.length);
    if (best === null || worst < Math.max(best[0].length, best[1].length)) best = [first, second];
  }
  return best ? { lines: best, size: 13 } : { lines: [name], size: 12 };
}

/** Punti percentuali che il giocatore perde nello slot: 0 nel ruolo principale o secondario, poi 3, 8 e 15. */
export function slotPenalty(p: Pick<Player, 'role' | 'secondaryRole'>, slot: Role): number {
  return Math.round((1 - roleFit(p, slot)) * 100);
}

export function isTired(p: Pick<Player, 'energy'>): boolean {
  return p.energy < TIRED_BELOW;
}

/** Ruolo principale e secondario: "SF/PF". */
export function rolesText(p: Pick<Player, 'role' | 'secondaryRole'>): string {
  return p.secondaryRole ? `${p.role}/${p.secondaryRole}` : p.role;
}

/** Il ruolo scritto nel riquadro: lo slot se lo gioca senza penalità, altrimenti il suo ruolo principale. */
export function boxRole(p: Pick<Player, 'role' | 'secondaryRole'>, slot: Role): Role {
  return slotPenalty(p, slot) === 0 ? slot : p.role;
}

export function gamesText(n: number): string {
  return n === 1 ? '1 partita' : `${n} partite`;
}

/**
 * Partite di regular season giocate da un two-way (al massimo 50), se il dato c'è. Sono le partite della stagione
 * nelle statistiche del giocatore: il motore le conta allo stesso modo (solo quelle in cui è entrato in campo).
 */
export function twoWayGames(p: Pick<CourtPlayer, 'contractType' | 'stats'>): number | null {
  if (p.contractType !== 'two-way') return null;
  const g = p.stats?.g;
  return typeof g === 'number' && Number.isFinite(g) ? g : null;
}

export type CourtNoteKind = 'injured' | 'role' | 'tired' | 'twoWay';

export interface CourtNote {
  kind: CourtNoteKind;
  /** Quello che si legge nel riquadro. */
  text: string;
  /** Quello che sentono i lettori di schermo. */
  voice: string;
}

/**
 * La riga sotto il voto di un riquadro: il problema più serio (infortunio, poi fuori ruolo, poi stanchezza) o, senza
 * problemi, le partite giocate dal two-way. Fuori dal campo (slot null) non c'è fuori ruolo.
 */
export function courtNote(p: CourtPlayer, slot: Role | null): CourtNote | null {
  if (p.injury) {
    const games = gamesText(p.injury.gamesRemaining);
    return { kind: 'injured', text: `Infortunato · ${games}`, voice: `infortunato, fuori ${games}` };
  }
  const penalty = slot ? slotPenalty(p, slot) : 0;
  if (penalty > 0)
    return {
      kind: 'role',
      text: `Fuori ruolo · −${penalty}%`,
      voice: `fuori ruolo, rende il ${penalty}% in meno`,
    };
  if (isTired(p)) {
    const text = `stanco, energia ${Math.round(p.energy)}`;
    return { kind: 'tired', text, voice: text };
  }
  const games = twoWayGames(p);
  if (games !== null) {
    const text = `${games} partite su ${TWO_WAY_GAME_LIMIT}`;
    return { kind: 'twoWay', text, voice: `two-way, ${text}` };
  }
  return null;
}

/** Il nome di un riquadro per i lettori di schermo: posto, giocatore, voto, minuti e problema. */
export function courtLabel(slot: Role, p: CourtPlayer | null, ovr: number, minutes: number): string {
  if (!p) return `${ROLE_NAME[slot]}: manca il titolare, tocca per sceglierlo`;
  const note = courtNote(p, slot);
  const parts = [`${ROLE_NAME[slot]}: ${p.firstName} ${p.lastName}`, `voto ${ovr}`, `${minutes} minuti`];
  if (p.contractType === 'two-way' && note?.kind !== 'twoWay') parts.push('two-way');
  if (note) parts.push(note.voice);
  return parts.join(', ');
}

/** Quello che si legge su un pulsante della panchina dopo i minuti, e se è un problema (rosso). */
export function benchNote(p: CourtPlayer): { text: string; alert: boolean } | null {
  if (p.injury) return { text: `infortunato, ${gamesText(p.injury.gamesRemaining)}`, alert: true };
  if (isTired(p)) return { text: 'stanco', alert: true };
  const games = twoWayGames(p);
  if (games !== null) return { text: `${games} su ${TWO_WAY_GAME_LIMIT}`, alert: false };
  return null;
}

/** Il nome di un pulsante della panchina per i lettori di schermo. */
export function benchLabel(p: CourtPlayer, minutes: number): string {
  const parts = [`${p.firstName} ${p.lastName}`, `${minutes} minuti`];
  if (p.contractType === 'two-way') parts.push('two-way');
  if (p.injury) parts.push(`infortunato, fuori ${gamesText(p.injury.gamesRemaining)}`);
  else if (isTired(p)) parts.push(`stanco, energia ${Math.round(p.energy)}`);
  const games = twoWayGames(p);
  if (games !== null) parts.push(`${games} partite su ${TWO_WAY_GAME_LIMIT}`);
  return parts.join(', ');
}

export interface SlotCandidate<P extends CourtPlayer = CourtPlayer> {
  player: P;
  /** Punti persi nello slot: 0 nel ruolo. */
  penalty: number;
  /** Lo slot dove è titolare adesso (i due si scambiano di posto), o null se è in panchina. */
  from: number | null;
}

/**
 * Chi può prendere lo slot: tutti tranne il titolare di adesso e gli infortunati, come nella scelta di prima. Prima
 * chi è nel ruolo, poi gli altri dalla penalità più piccola; a parità il voto più alto, poi il cognome.
 */
export function slotCandidates<P extends CourtPlayer>(
  roster: readonly P[],
  starters: readonly string[],
  slot: number,
  ovr: (p: P) => number,
): SlotCandidate<P>[] {
  const role = SLOT_ROLES[slot] as Role;
  const current = starters[slot] ?? '';
  return roster
    .filter((p) => p.id !== current && p.injury === null)
    .map((p) => {
      const at = starters.indexOf(p.id);
      return { player: p, penalty: slotPenalty(p, role), from: at >= 0 ? at : null };
    })
    .sort(
      (a, b) =>
        a.penalty - b.penalty ||
        ovr(b.player) - ovr(a.player) ||
        a.player.lastName.localeCompare(b.player.lastName, 'it') ||
        a.player.id.localeCompare(b.player.id),
    );
}

/** La riga sotto il nome di un candidato: ruoli, ruolo nello slot, dove gioca adesso; rossa se perde qualcosa. */
export function candidateNote(c: SlotCandidate): { text: string; alert: boolean } {
  const p = c.player;
  const parts = [rolesText(p), c.penalty === 0 ? 'nel ruolo' : `fuori ruolo, −${c.penalty}%`];
  if (c.from !== null) parts.push(`ora ${SLOT_ROLES[c.from]}, si scambiano`);
  else if (p.contractType === 'two-way') {
    const games = twoWayGames(p);
    parts.push(games !== null ? `two-way, ${games} partite su ${TWO_WAY_GAME_LIMIT}` : 'two-way');
  } else parts.push(`in panchina, energia ${Math.round(p.energy)}`);
  return { text: parts.join(' · '), alert: c.penalty > 0 || isTired(p) };
}

/** La panchina: chi non è titolare, prima chi ha più minuti, poi il voto più alto, poi il cognome. */
export function benchOrder<P extends CourtPlayer>(
  roster: readonly P[],
  starters: readonly string[],
  minutes: Readonly<Record<string, number>>,
  ovr: (p: P) => number,
): P[] {
  return roster
    .filter((p) => !starters.includes(p.id))
    .sort(
      (a, b) =>
        (minutes[b.id] ?? 0) - (minutes[a.id] ?? 0) ||
        ovr(b) - ovr(a) ||
        a.lastName.localeCompare(b.lastName, 'it'),
    );
}

export interface CourtIssue {
  /** Lo slot da sistemare (il pulsante Cambia apre il cambio di quel posto). */
  slot: number;
  text: string;
}

/**
 * Titolari da sistemare: gli infortunati, con chi li sostituisce alla partita (lo stesso conto del motore,
 * setupFromSettings), e chi gioca fuori ruolo con quanto perde.
 */
export function courtIssues(
  code: string,
  roster: readonly (Player & CourtPlayer)[],
  settings: SavedSettings,
): CourtIssue[] {
  const byId = new Map(roster.map((p) => [p.id, p]));
  let atGame: readonly string[] | null = null;
  const gameStarters = (): readonly string[] => {
    if (atGame === null) {
      try {
        atGame = setupFromSettings(code, roster, settings).starters;
      } catch {
        // Meno di 5 sani: alla partita decide il bot da solo
        atGame = [];
      }
    }
    return atGame;
  };
  const issues: CourtIssue[] = [];
  SLOT_ROLES.forEach((role, slot) => {
    const p = byId.get(settings.starters[slot] ?? '');
    if (!p) return;
    if (p.injury) {
      const sub = byId.get(gameStarters()[slot] ?? '');
      issues.push({
        slot,
        text:
          `${p.lastName} è fuori ${gamesText(p.injury.gamesRemaining)}. ` +
          (sub && sub.id !== p.id
            ? `Alla partita lo sostituisce ${sub.firstName} ${sub.lastName}.`
            : 'Alla partita lo sostituisce il migliore libero per il ruolo.'),
      });
      return;
    }
    const penalty = slotPenalty(p, role);
    if (penalty > 0)
      issues.push({
        slot,
        text: `${p.lastName} gioca da ${ROLE_NAME[role]}: in campo rende il ${penalty}% in meno.`,
      });
  });
  return issues;
}

/** I titoli dei gruppi di tattiche nel pannello. */
export const TACTIC_LEGEND: Record<keyof Tactics, string> = {
  pace: 'Ritmo',
  focus: 'Attacco',
  defense: 'Difesa',
  intensity: 'Intensità in difesa',
};

/** Che cosa fa la scelta fatta, in una riga sotto ogni gruppo di tattiche (dal motore partita). */
export const TACTIC_NOTES: { [K in keyof Tactics]: Record<Tactics[K], string> } = {
  pace: {
    slow: 'Lento: possessi più lunghi, meno contropiedi e meno fatica.',
    normal: 'Normale: circa 100 possessi a squadra.',
    fast: 'Veloce: più possessi e più contropiedi, ma si stanca prima.',
  },
  focus: {
    perimeter: 'Perimetro: più tiri da tre e dalla media, meno penetrazioni e gioco in post.',
    balanced: 'Equilibrato: le giocate seguono le tendenze dei giocatori.',
    inside: 'Interno: più penetrazioni, tagli e gioco in post, meno tiri da tre.',
  },
  defense: {
    man: 'A uomo: ognuno marca chi gioca nel suo ruolo, il lungo aiuta sulle penetrazioni.',
    zone: "A zona: protegge l'area, ma concede più tiri da tre.",
  },
  intensity: {
    low: 'Bassa: meno falli e meno fatica, ma meno palle rubate.',
    medium: 'Media: recuperi, falli e fatica nella norma.',
    high: 'Alta: più palle rubate, ma più falli e più fatica.',
  },
};

/** Fino a quando la squadra è affidata all'allenatore. */
export function coachUntilText(c: Pick<CoachDelegation, 'untilRound' | 'untilAt' | 'untilPhaseEnd'>): string {
  if (c.untilPhaseEnd) return 'fino alla fine della fase';
  // L'app la mette solo per il turno in corso: dopo quel turno il server la spegne
  if (c.untilRound !== null) return 'per questo turno';
  if (c.untilAt)
    return `fino al ${new Date(c.untilAt).toLocaleString('it-IT', { dateStyle: 'short', timeStyle: 'short' })}`;
  return 'finché non la riprendi';
}
