// Menu della lega a scorrimento orizzontale (su telefono non ci stanno tutte le voci): la voce della pagina
// aperta va portata in vista, altrimenti aprendo per esempio Storico da un link il menu mostra Lega e Squadra.

/**
 * Di quanto scorrere il menu (in pixel, positivo verso destra) perché la voce tra itemLeft e itemRight stia tutta
 * tra viewLeft e viewRight, con un margine che lascia vedere un pezzo della voce accanto. 0 se è già in vista.
 */
export function navScrollDelta(
  view: { left: number; right: number },
  item: { left: number; right: number },
  margin = 24,
): number {
  if (item.left < view.left) return item.left - view.left - margin;
  if (item.right > view.right) {
    // Una voce più larga del menu si allinea a sinistra
    const delta = item.right - view.right + margin;
    return Math.min(delta, item.left - view.left);
  }
  return 0;
}
