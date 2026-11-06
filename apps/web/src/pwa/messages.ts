// Messaggi tra il service worker e le finestre dell'app (piccolo, per stare nel pezzo iniziale senza il resto).

/** Il browser ha cambiato l'iscrizione alle notifiche (pushsubscriptionchange): l'app la salva sul server. */
export const PUSH_CHANGED_MESSAGE = 'nbbgm:iscrizione-cambiata';
