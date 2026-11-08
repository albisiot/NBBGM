// Elenco delle leghe nello stile Edicola: per ogni lega una riga sotto il nome, con un'etichetta solo quando serve
// (tocca a te e turno bloccato in rosso, simulazione d'inchiostro, draft a filo), il turno, chi è pronto e le
// decisioni aperte; la lega in pausa tutta in corsivo. Logica pura, dallo stato dal vivo di lib/leaguesLive.ts.
import type { MyLeague } from './leagues.ts';
import type { LeagueLive } from './leaguesLive.ts';
import { whenText } from './roundDate.ts';

export interface LeagueLine {
  /** Etichetta in evidenza, prima del testo. */
  tag: { label: string; tone: 'red' | 'ink' | 'outline' } | null;
  /** Il resto della riga, da unire con " · ". */
  parts: string[];
  /** "2 decisioni" (in grassetto), null se non ce ne sono. */
  decisions: string | null;
  /** Lega in pausa: la riga in corsivo, senza etichetta. */
  quiet: boolean;
}

/** "Mer 21 ott", "Play-in · ven 16 apr", "Playoff · dom 18 apr", "Offseason"; null senza turno. */
export function roundShort(
  kind: string | null,
  number: number | null,
  day: number | null = null,
  seasonYear: number | null = null,
): string | null {
  if (kind === null || number === null) return null;
  if (kind === 'offseason') return 'Offseason';
  if (kind !== 'regular' && kind !== 'play-in' && kind !== 'playoffs') return null;
  return whenText(kind, day, seasonYear, { short: true, fallback: `Turno ${number + 1}` });
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** La riga di una lega nell'elenco; senza stato dal vivo (database non ancora aggiornato) solo il turno. */
export function leagueListLine(
  league: Pick<MyLeague, 'seasonYear' | 'roundKind' | 'roundNumber'> & Partial<Pick<MyLeague, 'roundDay'>>,
  live: LeagueLive | null,
): LeagueLine {
  const round =
    roundShort(league.roundKind, league.roundNumber, league.roundDay ?? null, league.seasonYear) ??
    (league.seasonYear === null ? 'In preparazione' : `Stagione ${league.seasonYear}`);
  const decisions = live && live.decisions > 0 ? plural(live.decisions, 'decisione', 'decisioni') : null;
  const line = (tag: LeagueLine['tag'], parts: string[], quiet = false): LeagueLine => ({
    tag,
    parts,
    decisions,
    quiet,
  });
  if (!live || live.phase === null) return line(null, [round]);
  const ready = live.humans > 0 ? [`pronti ${live.ready} su ${live.humans}`] : [];
  switch (live.phase) {
    case 'draft':
      return line({ label: 'Draft', tone: 'outline' }, [round, 'il draft iniziale è in corso']);
    case 'failed':
      return line({ label: 'Turno bloccato', tone: 'red' }, [round, 'la simulazione non è riuscita']);
    case 'late':
      return line({ label: 'Si gioca', tone: 'ink' }, [round, 'la simulazione è in ritardo']);
    case 'closing':
      return line({ label: 'Si gioca', tone: 'ink' }, [round, 'la simulazione è in corso']);
    case 'paused':
      return line(
        null,
        ['In pausa', round, myStateText(live.myState)].filter((p) => p !== ''),
        true,
      );
    case 'open': {
      const mustAct = live.myState === 'waiting' || live.myState === 'blocked';
      const mine = mustAct ? '' : myStateText(live.myState);
      return line(
        mustAct ? { label: 'Tocca a te', tone: 'red' } : null,
        [round, ...ready, mine].filter((p) => p !== ''),
      );
    }
  }
}

/** Lo stato della propria squadra in poche parole. */
function myStateText(state: LeagueLive['myState']): string {
  switch (state) {
    case 'ready':
      return 'sei pronto';
    case 'rest':
      return 'riposi, sei pronto';
    case 'coach':
      return 'con l’allenatore';
    case 'blocked':
    case 'waiting':
      return 'non sei pronto';
    case 'out':
      return 'non giochi questo turno';
    default:
      return '';
  }
}
