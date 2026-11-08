// Come si gioca: una guida breve per chi entra in una lega, impaginata come un inserto del giornale (sezioni con il
// filetto, su due colonne da md). Le regole complete stanno nel documento di design.
import { Link } from 'react-router';
import { PageTitle, SectionTitle } from '../components/ui.tsx';
import { ROW_LINK } from '../lib/linkStyles.ts';

const SECTIONS: { title: string; text: string[] }[] = [
  {
    title: 'I turni',
    text: [
      'La lega avanza a turni, e un turno è un giorno del calendario, come nella NBA: da ottobre a metà aprile, ogni giorno da 2 a 15 partite, e ogni squadra gioca circa una sera su due (qualche volta due sere di fila, e si stanca). Poi play-in e playoff, sempre a giorni, e un’offseason di 7 turni (draft, rinnovi, quattro turni di free agency, preparazione).',
      'Il turno si gioca quando tutti i manager sono pronti, oppure alla scadenza se il commissario ne ha impostata una, oppure quando il commissario lo forza.',
      'Se per 3 turni di fila la scadenza arriva senza che nessun manager faccia niente, la lega si mette in pausa da sola: la riprende il commissario, o il primo che preme Sono pronto.',
    ],
  },
  {
    title: 'Sono pronto',
    text: [
      'Sistema la squadra e premi Sono pronto: il pulsante c’è in cima a ogni pagina della lega. Puoi toglierlo finché il turno non parte.',
      'Nei giorni in cui la tua squadra riposa sei già pronto: togli il Pronto se prima del turno vuoi fare mercato o cambiare la squadra. Se hai una decisione da prendere (per esempio una proposta di scambio) rispondi e poi premi Sono pronto.',
      'Il turno parte appena tutti sono pronti e qualcuno ha premuto Sono pronto; se sono tutti a riposo o con l’allenatore parte al ritmo scelto dal commissario (o subito, se chi riposa conferma il Pronto).',
      'Chi non conferma gioca con le ultime impostazioni salvate: se manca un giocatore (infortunato, ceduto) il sostituto lo sceglie il bot.',
    ],
  },
  {
    title: 'La squadra',
    text: [
      'In Squadra scegli i 5 titolari (uno per ruolo), i minuti di ognuno (in tutto 240) e le tattiche. Auto fa proporre al tuo allenatore quintetto, minuti e tattiche secondo la sua idea di gioco; poi si salva.',
      'Energia, morale e infortuni contano: chi gioca sempre tanti minuti arriva stanco, e la seconda sera di fila ancora di più. L’energia si recupera nelle notti di riposo.',
    ],
  },
  {
    title: 'L’allenatore',
    text: [
      'Ogni squadra ha un capo allenatore, con un’idea di gioco (Corri e tira, Spazi e tiro da tre, Difesa e fatica, Gioco interno, Movimento di palla, Equilibrio) che decide tattiche e giocatori preferiti, un carattere (rotazione corta o lunga, fiducia nei giovani o nei veterani, riposo per chi è stanco, flessibile o fedele alla sua idea) e tre qualità in stelle: Tattica (vale qualche vittoria a stagione), Sviluppo (i giovani crescono di più) e Gestione del gruppo (il morale tiene meglio). Lo vedi nella pagina della squadra.',
      'Se non puoi seguire la squadra, affidala all’allenatore (in Squadra), per un turno, fino a una data, fino a fine fase o finché non la riprendi. Fa quintetto, minuti e tattiche come Auto, con la sua idea di gioco, e risulti pronto a ogni turno. Non fa mercato e si ferma quando arriva una decisione da prendere: finché non rispondi la lega aspetta.',
      'Puoi cambiarlo in Mercato → Allenatori, in qualsiasi turno: il nuovo arriva alla chiusura del turno, alla sua richiesta, e quello di prima resta da pagare fino alla scadenza del contratto (meno, se un’altra squadra lo prende). Lo stipendio dell’allenatore è fuori dal cap e si paga partita per partita.',
    ],
  },
  {
    title: 'I bot',
    text: [
      'Le squadre senza manager hanno un proprietario con un obiettivo (vincere subito, costruire con pazienza, risparmiare, equilibrio, fare colpo) e un GM con un carattere: più o meno scambi, fedeltà ai suoi giocatori, potenziale o giocatori pronti al draft, pazienza con l’allenatore. Li vedi nella pagina della squadra, con le vittorie che il proprietario si aspetta.',
      'Il proprietario decide se andare in corsa o ricostruire, quanto spendere e quanto pagare la luxury tax; se l’allenatore resta molto sotto le attese lo cambia, soprattutto a fine stagione.',
    ],
  },
  {
    title: 'Avvisi e decisioni',
    text: [
      'Le decisioni arrivano nel riquadro Da decidere prima del turno, nella pagina della lega: proposte di scambio ricevute, rosa sotto 13, giocatori in scadenza, draft, free agency. Prendile prima di premere Sono pronto; in cima alle altre pagine vedi quante ne hai aperte. Gli avvisi da leggere (infortuni, esiti del mercato) stanno accanto alle ultime notizie della lega.',
      'Se il turno si chiude senza risposta, le proposte di scambio sono rifiutate e il resto lo decide la logica del bot (o non si fa: un rinnovo non fatto lascia andare il giocatore).',
    ],
  },
  {
    title: 'Il mercato',
    text: [
      'Agli svincolati si fanno offerte a busta chiusa: alla chiusura del turno ognuno sceglie l’offerta migliore sopra la sua richiesta. Sopra il salary cap si firma solo al minimo. Chi tagli non lo puoi rifirmare fino alla stagione dopo.',
      'Gli scambi (giocatori e scelte al draft, anche protette o come swap) si propongono a una squadra: i bot decidono alla chiusura del turno, i manager rispondono entro il turno. Dopo la trade deadline (il primo giovedì di febbraio) gli scambi si fermano fino all’offseason.',
      'Il bilancio conta: ricavi uguali per tutti, a metà tra il cap e la soglia della luxury tax più una parte per lo staff, a ogni partita; stipendi, allenatore e tassa si pagano. Con il saldo negativo si firma solo fino al monte stipendi minimo, oltre solo minimi per restare a 13.',
    ],
  },
  {
    title: 'Le pagine',
    text: [
      'Lega: le decisioni da prendere, il turno con chi è pronto e le ultime notizie. Squadra: quintetto, minuti, tattiche e allenatore. Mercato: svincolati, scambi, rinnovi, allenatori e bilancio. Campionato: risultati, calendario della stagione (mese o settimana: tocca un giorno per vederne le partite), classifica e, da play-in in poi, il tabellone dei playoff.',
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
      'Nel profilo puoi attivare le notifiche (turno nuovo, decisione da prendere, il tuo turno nel draft dal vivo) e scegliere il tema: automatico come il telefono, chiaro o scuro.',
    ],
  },
];

export function GuidePage() {
  return (
    <div className="space-y-6">
      <PageTitle sub="Le regole in breve, per cominciare.">Come si gioca</PageTitle>
      <div className="gap-8 md:columns-2">
        {SECTIONS.map((s) => (
          <section key={s.title} className="mb-6 space-y-2 break-inside-avoid">
            <SectionTitle>{s.title}</SectionTitle>
            {s.text.map((t, i) => (
              <p key={i} className="text-[0.95rem] leading-relaxed">
                {t}
              </p>
            ))}
          </section>
        ))}
      </div>
      <p>
        <Link to="/" className={ROW_LINK}>
          Torna alle tue leghe
        </Link>
      </p>
    </div>
  );
}
