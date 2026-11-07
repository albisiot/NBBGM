// Codice invito della lega con Condividi e Copia invito: nella pagina Info lega e, subito dopo la creazione, nella
// pagina della lega. Il codice in grande, a caratteri spaziati, come un titolo.
import { useState } from 'react';
import type { LeagueDetail } from '../lib/leagues.ts';
import { Button, Card, Kicker } from './ui.tsx';

export function InviteCard({ league }: { league: Pick<LeagueDetail, 'inviteCode' | 'name' | 'teams'> }) {
  const humans = league.teams.filter((t) => t.ownerId !== null).length;
  return (
    <Card className="space-y-2 !p-3 sm:!p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Kicker muted>Codice invito</Kicker>
          <p className="font-titolo text-3xl leading-tight font-bold tracking-[0.25em]">
            {league.inviteCode}
          </p>
        </div>
        <InviteButtons code={league.inviteCode} name={league.name} />
      </div>
      <p className="text-[0.875rem] text-stampa-600 italic dark:text-stampa-300">
        {humans === 1 ? '1 manager umano' : `${humans} manager umani`} · {30 - humans} squadre guidate dai bot
      </p>
    </Card>
  );
}

function InviteButtons({ code, name }: { code: string; name: string }) {
  const [copied, setCopied] = useState(false);
  const link = `${window.location.origin}${window.location.pathname}#/entra/${code}`;
  const text = `Entra nella mia lega di NBBGM "${name}" con il codice ${code}: ${link}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="flex flex-wrap gap-2">
      {typeof navigator.share === 'function' && (
        <Button onClick={() => void navigator.share({ title: 'NBBGM', text }).catch(() => {})}>
          Condividi
        </Button>
      )}
      <Button variant="secondary" onClick={() => void copy()}>
        {copied ? 'Copiato' : 'Copia invito'}
      </Button>
      {/* "Copiato" si annuncia anche ai lettori di schermo */}
      <span role="status" className="sr-only">
        {copied ? 'Invito copiato negli appunti.' : ''}
      </span>
    </div>
  );
}
