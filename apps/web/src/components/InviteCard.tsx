// Codice invito della lega con Condividi e Copia invito: nella pagina Info lega e, subito dopo la creazione, nella
// pagina della lega.
import { useState } from 'react';
import type { LeagueDetail } from '../lib/leagues.ts';
import { Button, Card } from './ui.tsx';

export function InviteCard({ league }: { league: Pick<LeagueDetail, 'inviteCode' | 'name' | 'teams'> }) {
  const humans = league.teams.filter((t) => t.ownerId !== null).length;
  return (
    <Card className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-stampa-500 dark:text-stampa-400">Codice invito</p>
          <p className="font-mono text-2xl font-bold tracking-widest">{league.inviteCode}</p>
        </div>
        <InviteButtons code={league.inviteCode} name={league.name} />
      </div>
      <p className="text-xs text-stampa-500 dark:text-stampa-400">
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
    <div className="flex gap-2">
      {typeof navigator.share === 'function' && (
        <Button
          variant="secondary"
          onClick={() => void navigator.share({ title: 'NBBGM', text }).catch(() => {})}
        >
          Condividi
        </Button>
      )}
      <Button variant="secondary" onClick={() => void copy()}>
        {copied ? 'Copiato' : 'Copia invito'}
      </Button>
    </div>
  );
}
