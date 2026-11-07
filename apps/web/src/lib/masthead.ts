// Testata dell'app nello stile del giornale: la data sotto il nome e le iniziali del profilo. Modulo puro.

/** La data come sotto la testata di un giornale: "Sabato 7 novembre 2026". */
export function mastheadDate(date: Date): string {
  const s = date.toLocaleDateString('it-IT', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return s.charAt(0).toLocaleUpperCase('it-IT') + s.slice(1);
}

/** Le iniziali del nome per il riquadro del profilo: al più due, dalla prima e dall'ultima parola. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  const first = Array.from(words[0]!)[0] ?? '';
  const last = words.length > 1 ? (Array.from(words[words.length - 1]!)[0] ?? '') : '';
  return (first + last).toLocaleUpperCase('it-IT');
}
