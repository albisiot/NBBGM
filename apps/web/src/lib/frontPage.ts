// Prima pagina della lega nello stile Edicola: il titolo sull'ultima partita della propria squadra, le etichette
// delle squadre nel turno, la scadenza sotto il Pronto, la striscia della simulazione e il titolo della conferma del
// Pronto. Logica pura: niente React, Supabase o browser.
import { dateText, whenText } from './roundDate.ts';
import type { LastGame, Readiness } from './turnStatus.ts';

// Soprannomi di due parole: la città è quello che resta del nome
const TWO_WORD_NICKNAMES = ['Trail Blazers'];

/** "Boston" da "Boston Celtics", "Portland" da "Portland Trail Blazers", "LA" da "LA Clippers". */
export function teamCity(fullName: string): string {
  const name = fullName.trim();
  for (const nick of TWO_WORD_NICKNAMES)
    if (name.endsWith(` ${nick}`)) return name.slice(0, name.length - nick.length - 1);
  const space = name.lastIndexOf(' ');
  return space > 0 ? name.slice(0, space) : name;
}

export interface Headline {
  /** Occhiello: quando si è giocata. */
  kicker: string;
  title: string;
  /** Sommario sotto il titolo. */
  dek: string;
}

/** Quando si è giocata una partita: "Mercoledì 21 ottobre", "Playoff · domenica 18 aprile". */
export function gameWhen(game: Pick<LastGame, 'kind' | 'day' | 'seasonYear'>): string {
  return whenText(game.kind, game.day, game.seasonYear, { fallback: 'Regular season' });
}

/**
 * Titolo di giornale sull'ultima partita della propria squadra: "Boston batte Miami", "Boston travolge Miami"
 * (20 punti o più), "di misura" (3 o meno), "al supplementare". Con i Risultati senza spoiler solo chi ha giocato.
 * Le squadre si chiamano con la città, come sui giornali.
 */
export function gameHeadline(
  game: LastGame,
  teams: readonly { id: string; fullName: string }[],
  myTeamId: string,
  spoilerFree: boolean,
): Headline {
  const city = (id: string) => teamCity(teams.find((t) => t.id === id)?.fullName ?? '?');
  const kicker = `${gameWhen(game)} · ultima partita`;
  const away = city(game.awayTeamId);
  const home = city(game.homeTeamId);
  if (spoilerFree)
    return {
      kicker,
      title: `${away} – ${home}`,
      dek: 'Il risultato è nascosto: i Risultati sono senza spoiler.',
    };
  const homeWon = game.homeScore > game.awayScore;
  const [winner, loser] = homeWon ? [home, away] : [away, home];
  const [won, lost] = homeWon ? [game.homeScore, game.awayScore] : [game.awayScore, game.homeScore];
  const margin = won - lost;
  const title =
    game.overtimes > 0
      ? `${winner} batte ${loser} ${game.overtimes === 1 ? 'al supplementare' : `dopo ${game.overtimes} supplementari`}`
      : margin >= 20
        ? `${winner} travolge ${loser}`
        : margin <= 3
          ? `${winner} batte ${loser} di misura`
          : `${winner} batte ${loser}`;
  const atHome = game.homeTeamId === myTeamId;
  const mine = atHome === homeWon;
  return {
    kicker,
    title,
    dek: `${won}–${lost}, ${mine ? 'vittoria' : 'sconfitta'} ${atHome ? 'in casa' : 'in trasferta'}.`,
  };
}

/**
 * Come si segna lo stato di una squadra nel turno, a destra della riga a puntini: un'etichetta (pronto
 * d'inchiostro, a riposo e allenatore a filo, deve decidere rossa) o una nota in corsivo (non ancora pronto, non
 * gioca).
 */
export type ReadinessMark =
  { kind: 'tag'; tone: 'ink' | 'outline' | 'red'; label: string } | { kind: 'note'; label: string };

export function readinessMark(state: Readiness): ReadinessMark {
  switch (state) {
    case 'ready':
      return { kind: 'tag', tone: 'ink', label: 'Pronto' };
    case 'rest':
      return { kind: 'tag', tone: 'outline', label: 'Riposo · pronto' };
    case 'coach':
      return { kind: 'tag', tone: 'outline', label: 'Allenatore' };
    case 'blocked':
      return { kind: 'tag', tone: 'red', label: 'Deve decidere' };
    case 'waiting':
      return { kind: 'note', label: 'non ancora pronto' };
    case 'out':
      return { kind: 'note', label: 'non gioca' };
  }
}

/** Sotto il Pronto: quando si chiude il turno. left è il tempo che resta come lo scrive timeLeft (lib/turns.ts). */
export function deadlineNote(left: string): string {
  return left === 'scaduta'
    ? 'La scadenza è passata: il turno si chiude a momenti.'
    : `Il turno chiude ${left}, o prima se tutti sono pronti.`;
}

/** Striscia della simulazione in corso: "Si gioca mercoledì 21 ottobre", "Si giocano i playoff". */
export function closingLabel(kind: string, day: number | null, seasonYear: number | null): string {
  const date = dateText(day, seasonYear);
  if (kind === 'regular') return date ? `Si gioca ${date}` : 'Si gioca';
  if (kind === 'play-in') return 'Si gioca il play-in';
  if (kind === 'playoffs') return 'Si giocano i playoff';
  return 'Simulazione in corso';
}

/**
 * Titolo della conferma del Pronto. warnings sono gli avvisi di readyWarnings (lib/turns.ts): con modifiche non
 * salvate il primo è quello, gli altri riguardano le decisioni aperte.
 */
export function readyConfirmTitle(warnings: number, unsaved: boolean): string {
  const decisions = warnings - (unsaved ? 1 : 0);
  if (decisions <= 0) return 'Hai modifiche non salvate';
  return unsaved ? 'Decisioni aperte e modifiche non salvate' : 'Hai decisioni aperte';
}
