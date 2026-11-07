// Classi dei pulsanti e dei link dello stile Edicola, in un posto solo: le usano Button (components/ui.tsx) e i link
// che hanno l'aspetto dei pulsanti, quando l'azione porta a un'altra pagina (un link vero, non un pulsante che
// naviga). primary è d'inchiostro; accent è il rosso, per l'azione principale della pagina (Sono pronto): uno per
// pagina, perché il rosso segna anche gli avvisi; danger è il rosso scuro delle azioni che non si annullano;
// secondary è a filo; ghost è un link in corsivo sottolineato.

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger';

const COLORS: Record<ButtonVariant, string> = {
  primary:
    'bg-stampa-900 text-stampa-25 hover:bg-stampa-700 disabled:bg-stampa-400 dark:bg-stampa-100 dark:text-stampa-900 dark:hover:bg-stampa-50 dark:disabled:bg-stampa-600',
  accent:
    'bg-rosso-600 text-white hover:bg-rosso-700 disabled:bg-rosso-300 dark:bg-rosso-500 dark:hover:bg-rosso-600 dark:disabled:bg-rosso-900',
  danger:
    'bg-rosso-700 text-white hover:bg-rosso-800 disabled:bg-rosso-300 dark:bg-rosso-500 dark:hover:bg-rosso-600 dark:disabled:bg-rosso-900',
  secondary:
    'border border-stampa-900 bg-transparent text-stampa-900 hover:bg-stampa-100 disabled:border-stampa-300 disabled:text-stampa-400 dark:border-stampa-100 dark:text-stampa-50 dark:hover:bg-stampa-800 dark:disabled:border-stampa-700',
  ghost:
    'text-stampa-800 underline underline-offset-4 hover:bg-stampa-100 dark:text-stampa-100 dark:hover:bg-stampa-800',
};

const TYPE_GHOST = 'font-serif text-[0.95rem] font-semibold italic';
const TYPE = 'font-titolo text-[0.95rem] font-semibold tracking-wider uppercase';

/** Classi di un pulsante (o di un link che ne ha l'aspetto): alto almeno 44 px, angoli vivi. */
export function buttonClass(variant: ButtonVariant = 'primary', extra = ''): string {
  const type = variant === 'ghost' ? TYPE_GHOST : TYPE;
  return `inline-flex min-h-11 items-center justify-center gap-2 rounded-sm px-4 py-2 text-center transition-colors disabled:cursor-not-allowed ${type} ${COLORS[variant]}${extra ? ` ${extra}` : ''}`;
}

/** Link con l'aspetto dei pulsanti (Proponi uno scambio, Confronta, Apri la lega). */
export const LINK_BUTTON = {
  primary: buttonClass('primary'),
  secondary: buttonClass('secondary'),
  accent: buttonClass('accent'),
} as const;

/** Link in corsivo sottolineato, come il pulsante ghost, con meno margine ai lati (Tutti gli svincolati). */
export const GHOST_LINK = `inline-flex min-h-11 items-center px-2 ${TYPE_GHOST} ${COLORS.ghost}`;

/** Link nel testo: corsivo in grassetto, rosso come sui giornali. */
export const TEXT_LINK =
  'font-semibold text-rosso-700 italic underline-offset-4 hover:underline dark:text-rosso-300';

/** Link da solo su una riga (Tutta la cronaca, Come si gioca): alto quanto un pulsante, per il tocco. */
export const ROW_LINK = `inline-flex min-h-11 items-center ${TEXT_LINK}`;

/** Etichetta dei campi e dei gruppi di scelte: maiuscolo stretto, come le testatine del giornale. */
export const FIELD_LABEL =
  'font-titolo text-xs font-semibold tracking-widest uppercase text-stampa-800 dark:text-stampa-100';
