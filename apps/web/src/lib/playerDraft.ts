// Draft NBA di un giocatore in parole: anno e scelta assoluta, con il giro, oppure "non scelto".
import type { DraftInfo } from '@nbbgm/engine';

/**
 * Per la scheda: "2018, 3ª scelta (1° giro)", "non scelto", "non scelto (2027)" per i prospetti della lega che
 * nessuno ha preso; "—" se non è noto (giocatori generati fuori dal draft).
 */
export function draftText(draft: DraftInfo | null | undefined): string {
  if (!draft) return '—';
  if (draft.pick === null || draft.round === null)
    return draft.year === null ? 'non scelto' : `non scelto (${draft.year})`;
  return `${draft.year}, ${draft.pick}ª scelta (${draft.round}° giro)`;
}

/** Per le tabelle strette (confronto): "2018, n. 3", "non scelto". */
export function draftShort(draft: DraftInfo | null | undefined): string {
  if (!draft) return '—';
  if (draft.pick === null) return 'non scelto';
  return `${draft.year}, n. ${draft.pick}`;
}
