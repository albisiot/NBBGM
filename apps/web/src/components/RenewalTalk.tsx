// Trattativa del rinnovo di un giocatore: la sua richiesta, com'è andata finora, l'offerta del manager (stipendio del
// primo anno, anni, opzione sull'ultimo anno) e la risposta del giocatore, che il server dà subito: accetta, oppure
// rifiuta con una controproposta. Dopo 3 rifiuti resta solo la sua ultima controproposta; un'offerta molto bassa gli
// toglie morale. Il rinnovo concordato si firma alla chiusura del turno. Si usa nel mercato (turno dei rinnovi) e
// nella scheda del giocatore (in stagione, all'ultimo anno di contratto).
import { useState } from 'react';
import {
  millions,
  offerInput,
  offerSalary,
  RENEWAL_TRIES,
  salaryRunOf,
  termsText,
  type ContractOptionKind,
  type MarketAction,
  type RenewalAnswer,
  type RenewalTalkInfo,
  type RosterRequest,
} from '../lib/market.ts';
import { BAD, FIELD, FIELD_LABEL, META } from './inkParts.tsx';
import { Button, Tag } from './ui.tsx';

/** Testo della risposta del giocatore, per chi ha appena fatto l'offerta. */
export function answerText(reply: RenewalAnswer): string {
  if (reply.kind === 'accept') return 'Ha accettato: il rinnovo si firma alla chiusura del turno.';
  const offended = reply.lowball ? ' L’offerta l’ha offeso: il morale è sceso.' : '';
  if (reply.kind === 'final')
    return `Non tratta più: resta la sua ultima controproposta, ${termsText(reply.counter)}.${offended}`;
  return `Rifiuta e chiede ${termsText(reply.counter)}. ${
    reply.attemptsLeft === 1 ? 'Ancora un tentativo' : `Ancora ${reply.attemptsLeft} tentativi`
  } prima che chiuda la trattativa.${offended}`;
}

export function RenewalTalk({
  player,
  ask,
  talk,
  request,
  busy,
  offer,
  run,
}: {
  player: { id: string; firstName: string; lastName: string };
  /** Stipendi chiesti, dalla stagione che arriva. */
  ask: number[];
  talk: RenewalTalkInfo | null;
  /** Rinnovo già concordato nel turno, se c'è. */
  request: RosterRequest | null;
  busy: boolean;
  /** Manda un'offerta di rinnovo: la risposta del giocatore, o null se l'azione non è riuscita. */
  offer: (action: MarketAction) => Promise<RenewalAnswer | null>;
  run: (action: MarketAction, ok: string) => Promise<boolean>;
}) {
  const name = `${player.firstName} ${player.lastName}`;
  const askFirst = ask[0] ?? 0;
  const [years, setYears] = useState(ask.length || 1);
  const [salary, setSalary] = useState(offerInput(askFirst));
  const [option, setOption] = useState<ContractOptionKind>(null);
  const [reply, setReply] = useState<RenewalAnswer | null>(null);
  const first = offerSalary(salary, askFirst);
  const runOf = first !== null ? salaryRunOf(first, years) : [];

  if (request)
    return (
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <Tag tone="ink">Rinnovo concordato</Tag>{' '}
          <span className={META}>
            {request.salaries.length} {request.salaries.length === 1 ? 'anno' : 'anni'},{' '}
            {millions(request.salaries[0] ?? 0)} il primo
            {request.options.includes('player')
              ? ', opzione del giocatore'
              : request.options.includes('team')
                ? ', opzione della squadra'
                : ''}
            . Si firma alla chiusura del turno.
          </span>
        </span>
        <Button
          variant="ghost"
          disabled={busy}
          aria-label={`Annulla il rinnovo di ${name}`}
          onClick={() => void run({ kind: 'withdraw_request', request_id: request.id }, 'Rinnovo annullato.')}
        >
          Annulla
        </Button>
      </div>
    );

  const counter = reply && reply.kind !== 'accept' ? reply.counter : (talk?.counter ?? null);
  const refusals = Math.max(talk?.refusals ?? 0, reply?.kind === 'final' ? RENEWAL_TRIES : 0);
  const closed = refusals >= RENEWAL_TRIES;
  async function send(action: MarketAction) {
    const r = await offer(action);
    if (r) setReply(r);
  }

  return (
    <div className="space-y-2">
      <p className={META}>
        Chiede {ask.length} {ask.length === 1 ? 'anno' : 'anni'}, {millions(askFirst)} il primo (+5% l’anno).
        {closed
          ? ' Trattativa chiusa: resta solo la sua ultima controproposta.'
          : ` ${RENEWAL_TRIES - refusals === 1 ? 'Un tentativo' : `${RENEWAL_TRIES - refusals} tentativi`} per trattare.`}
      </p>
      {reply && (
        <p
          role="status"
          className={`text-[0.8125rem] italic ${reply.kind === 'accept' ? 'font-semibold' : reply.kind === 'final' || reply.lowball ? BAD : ''}`}
        >
          {answerText(reply)}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {counter && (
          <Button
            disabled={busy}
            onClick={() => void send({ kind: 'renew_offer', player_id: player.id, ...counter })}
          >
            Accetta: {termsText(counter)}
          </Button>
        )}
        <Button
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void run(
              { kind: 'renew', player_id: player.id },
              `Rinnovo di ${name} alla sua richiesta: si firma alla chiusura del turno.`,
            )
          }
        >
          Accetta la richiesta
        </Button>
      </div>
      {!closed && (
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (first !== null)
              void send({
                kind: 'renew_offer',
                player_id: player.id,
                salary: first,
                years,
                option: years > 1 ? option : null,
              });
          }}
        >
          <label className="block">
            <span className={FIELD_LABEL}>Primo anno (milioni)</span>
            <input
              inputMode="decimal"
              className={`mt-1 block w-28 ${FIELD}`}
              value={salary}
              onChange={(e) => setSalary(e.target.value)}
            />
          </label>
          <label className="block">
            <span className={FIELD_LABEL}>Anni</span>
            <select
              className={`mt-1 block ${FIELD}`}
              value={years}
              onChange={(e) => setYears(Number(e.target.value))}
            >
              {[1, 2, 3, 4, 5].map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className={FIELD_LABEL}>Opzione sull’ultimo anno</span>
            <select
              className={`mt-1 block ${FIELD}`}
              value={years > 1 ? (option ?? '') : ''}
              disabled={years === 1}
              onChange={(e) => setOption((e.target.value || null) as ContractOptionKind)}
            >
              <option value="">Nessuna</option>
              <option value="player">Del giocatore</option>
              <option value="team">Della squadra</option>
            </select>
          </label>
          <Button type="submit" variant="secondary" disabled={busy || first === null}>
            Offri
          </Button>
          <p className={`basis-full ${first === null ? `text-[0.8125rem] italic ${BAD}` : META}`}>
            {first === null
              ? 'Cifra non valida.'
              : `Totale ${millions(runOf.reduce((a, b) => a + b, 0))}. Anni diversi da quelli che chiede valgono meno per lui; l’opzione del giocatore lo convince di più, quella della squadra di meno.`}
          </p>
        </form>
      )}
    </div>
  );
}
