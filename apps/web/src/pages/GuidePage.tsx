// Come si gioca: una guida breve per chi entra in una lega. Le regole complete stanno nel documento di design.
import { Link } from 'react-router';
import { Card, PageTitle } from '../components/ui.tsx';

const SECTIONS: { title: string; text: string[] }[] = [
  {
    title: 'I turni',
    text: [
      'La lega avanza a turni: in regular season un turno è una giornata, una partita per squadra. Poi play-in, playoff e un’offseason di 7 turni (draft, rinnovi, quattro turni di free agency, preparazione).',
      'Il turno si gioca quando tutti i manager sono pronti, oppure alla scadenza se il commissario ne ha impostata una, oppure quando il commissario lo forza.',
      'Se per 3 turni di fila la scadenza arriva senza che nessun manager faccia niente, la lega si mette in pausa da sola: la riprende il commissario, o il primo che preme Sono pronto.',
    ],
  },
  {
    title: 'Sono pronto',
    text: [
      'Sistema la squadra e premi Sono pronto: il pulsante c’è in cima a ogni pagina della lega. Puoi toglierlo finché il turno non parte.',
      'Chi non conferma gioca con le ultime impostazioni salvate: se manca un giocatore (infortunato, ceduto) il sostituto lo sceglie il bot.',
    ],
  },
  {
    title: 'La squadra',
    text: [
      'In Squadra scegli i 5 titolari (uno per ruolo), i minuti di ognuno (in tutto 240) e le tattiche. Auto propone quintetto e minuti; poi si salva.',
      'Energia, morale e infortuni contano: chi gioca sempre tanti minuti arriva stanco.',
    ],
  },
  {
    title: 'L’allenatore',
    text: [
      'Se non puoi seguire la squadra, affidala all’allenatore (in Squadra), per un turno, fino a una data, fino a fine fase o finché non la riprendi. Fa quintetto e minuti come Auto e risulti pronto a ogni turno.',
      'Non fa mercato e si ferma quando arriva una decisione da prendere: finché non rispondi la lega aspetta.',
    ],
  },
  {
    title: 'Avvisi e decisioni',
    text: [
      'Le decisioni arrivano nel riquadro Da fare, in cima alla pagina della lega: proposte di scambio ricevute, rosa sotto 13, giocatori in scadenza, draft, free agency. Prendile prima di premere Sono pronto; in cima alle altre pagine vedi quante ne hai aperte. Gli avvisi da leggere (infortuni, esiti del mercato) stanno sotto il turno.',
      'Se il turno si chiude senza risposta, le proposte di scambio sono rifiutate e il resto lo decide la logica del bot (o non si fa: un rinnovo non fatto lascia andare il giocatore).',
    ],
  },
  {
    title: 'Il mercato',
    text: [
      'Agli svincolati si fanno offerte a busta chiusa: alla chiusura del turno ognuno sceglie l’offerta migliore sopra la sua richiesta. Sopra il salary cap si firma solo al minimo. Chi tagli non lo puoi rifirmare fino alla stagione dopo.',
      'Gli scambi (giocatori e scelte al draft, anche protette o come swap) si propongono a una squadra: i bot decidono alla chiusura del turno, i manager rispondono entro il turno. Dopo la giornata 56 gli scambi si fermano fino all’offseason.',
      'Il bilancio conta: ricavi uguali per tutti, a metà tra il cap e la soglia della luxury tax; stipendi e tassa si pagano. Con il saldo negativo si firma solo fino al monte stipendi minimo, oltre solo minimi per restare a 13.',
    ],
  },
  {
    title: 'Le pagine',
    text: [
      'Lega: le decisioni da prendere, il turno con chi è pronto e le ultime notizie. Squadra: quintetto, minuti, tattiche e allenatore. Mercato: svincolati, scambi, rinnovi e bilancio. Campionato: risultati, classifica e, da play-in in poi, il tabellone dei playoff.',
      'In Altro (sul telefono) o nel menu in alto: statistiche, cronaca della lega, storico delle stagioni, confronto tra giocatori e Info lega, con il codice invito per gli amici, le squadre, le impostazioni e la gestione per il commissario.',
    ],
  },
  {
    title: 'L’offseason',
    text: [
      'Dopo la finale: lottery e draft (ordini i tuoi preferiti, il server sceglie alla chiusura del turno), rinnovi dei giocatori in scadenza, quattro turni di free agency con richieste che scendono, poi la preparazione della stagione nuova.',
    ],
  },
  {
    title: 'Sul telefono',
    text: [
      'Installa l’app dalla schermata Home: su iPhone da Safari con Condividi → Aggiungi alla schermata Home, su Android dal menu del browser o con il pulsante Installa. Nell’app installata su iPhone conviene entrare con il codice via email.',
      'Nel profilo puoi attivare le notifiche: turno nuovo, decisione da prendere, il tuo turno nel draft dal vivo.',
    ],
  },
];

export function GuidePage() {
  return (
    <div className="space-y-4">
      <PageTitle sub="Le regole in breve, per cominciare.">Come si gioca</PageTitle>
      {SECTIONS.map((s) => (
        <Card key={s.title} className="space-y-2 !p-4">
          <h2 className="font-semibold">{s.title}</h2>
          {s.text.map((t, i) => (
            <p key={i} className="text-sm text-stampa-700 dark:text-stampa-200">
              {t}
            </p>
          ))}
        </Card>
      ))}
      <p className="text-sm">
        <Link to="/" className="font-semibold text-rosso-700 hover:underline dark:text-rosso-300">
          Torna alle tue leghe
        </Link>
      </p>
    </div>
  );
}
