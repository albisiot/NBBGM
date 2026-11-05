// Nuova lega: nome, squadra del commissario e impostazioni. Le altre 29 squadre le guidano i bot finché
// qualcuno non entra con il codice invito.
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { TeamPicker } from '../components/TeamPicker.tsx';
import { Button, Card, Choice, ErrorText, PageTitle, TextInput } from '../components/ui.tsx';
import { friendlyError } from '../lib/errors.ts';
import {
  createLeague,
  DEADLINE_OPTIONS,
  PACE_OPTIONS,
  PICK_SECONDS_OPTIONS,
  type NewLeagueSettings,
} from '../lib/leagues.ts';

export function CreateLeaguePage() {
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [team, setTeam] = useState<string | null>(null);
  const [settings, setSettings] = useState<NewLeagueSettings>({
    deadline_minutes: null,
    max_pace_seconds: 60,
    roster_mode: 'real',
    draft_mode: 'list',
    rookie_source: 'generated',
    pick_seconds: 60,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof NewLeagueSettings>(k: K, v: NewLeagueSettings[K]) =>
    setSettings((s) => ({ ...s, [k]: v }));

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!team) return setError('Scegli la squadra che guiderai.');
    setBusy(true);
    setError(null);
    try {
      const r = await createLeague({ name: name.trim(), team, settings });
      navigate(
        settings.roster_mode === 'draft' ? `/lega/${r.league_id}/draft` : `/lega/${r.league_id}?nuova=1`,
      );
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <PageTitle sub="Sarai il commissario della lega.">Crea una lega</PageTitle>
      <Card className="space-y-4">
        <TextInput
          label="Nome della lega"
          required
          maxLength={60}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Lega del giovedì"
        />
        <Choice
          label="Rose iniziali"
          value={settings.roster_mode}
          onChange={(v) => set('roster_mode', v)}
          options={[
            {
              label: 'Rose reali',
              value: 'real',
              note: 'Ogni squadra parte con la sua rosa al 4 novembre 2026.',
            },
            {
              label: 'Draft di tutti i giocatori',
              value: 'draft',
              note: '13 giri a serpentina con ordine sorteggiato. Ognuno tiene il contratto del file.',
            },
          ]}
        />
        {settings.roster_mode === 'draft' && (
          <>
            <Choice
              label="Modalità del draft"
              value={settings.draft_mode}
              onChange={(v) => set('draft_mode', v)}
              options={[
                {
                  label: 'Lista',
                  value: 'list',
                  note: 'Ognuno ordina i preferiti; all’avvio il server fa tutte le scelte in pochi secondi.',
                },
                {
                  label: 'Dal vivo',
                  value: 'live',
                  note: 'Si sceglie a turno con un tempo per scelta; puoi passare alla lista in qualsiasi momento.',
                },
              ]}
            />
            {settings.draft_mode === 'live' && (
              <Choice
                label="Tempo per scelta"
                value={settings.pick_seconds}
                onChange={(v) => set('pick_seconds', v)}
                options={PICK_SECONDS_OPTIONS}
              />
            )}
          </>
        )}
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">La tua squadra</h2>
        <TeamPicker value={team} onChange={setTeam} />
      </Card>

      <Card className="space-y-4">
        <Choice
          label="Scadenza dei turni"
          value={settings.deadline_minutes}
          onChange={(v) => set('deadline_minutes', v)}
          options={DEADLINE_OPTIONS}
        />
        <Choice
          label="Ritmo quando tutti hanno affidato la squadra all'allenatore"
          value={settings.max_pace_seconds}
          onChange={(v) => set('max_pace_seconds', v)}
          options={PACE_OPTIONS}
        />
        <Choice
          label="Rookie delle prossime stagioni"
          value={settings.rookie_source}
          onChange={(v) => set('rookie_source', v)}
          options={[
            { label: 'Generati', value: 'generated' },
            { label: 'Reali, da file', value: 'real', note: 'Il commissario carica le classi di draft.' },
          ]}
        />
      </Card>

      <ErrorText>{error}</ErrorText>
      <Button type="submit" className="w-full sm:w-auto" disabled={busy || !name.trim() || !team}>
        {busy ? 'Creo la lega…' : 'Crea la lega'}
      </Button>
    </form>
  );
}
