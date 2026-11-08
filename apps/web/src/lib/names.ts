// Nomi dei giocatori nelle tabelle (box score, statistiche, classifiche dello storico): il nome puntato, come nei
// tabellini dei giornali, così la colonna dei nomi resta stretta e le cifre si leggono meglio. Modulo puro.

/** Iniziale di una parola, con il punto: "J." da "Jayson"; con i trattini "K.-A." da "Karl-Anthony". */
function initials(word: string): string {
  return word
    .split('-')
    .filter((part) => part !== '')
    .map((part) => `${[...part][0]?.toUpperCase() ?? ''}.`)
    .join('-');
}

/**
 * "J. Tatum" da "Jayson" e "Tatum", "K.-A. Towns" da "Karl-Anthony" e "Towns", "N. Smith Jr." da "Nick" e
 * "Smith Jr."; senza nome solo il cognome.
 */
export function shortName(firstName: string, lastName: string): string {
  const first = firstName.trim().split(/\s+/).filter(Boolean).map(initials).join(' ');
  const last = lastName.trim();
  if (!first) return last;
  if (!last) return firstName.trim();
  return `${first} ${last}`;
}
