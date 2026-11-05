// Ingresso con il codice invito: si vedono le squadre libere e se ne prende una (finora guidata da un bot).
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { TeamPicker } from '../components/TeamPicker.tsx';
import { Button, Card, ErrorText, PageTitle, TextInput } from '../components/ui.tsx';
import { friendlyError, normalizeInviteCode } from '../lib/errors.ts';
import { joinLeague, previewLeague, type LeaguePreview } from '../lib/leagues.ts';

export function JoinLeaguePage() {
  const params = useParams();
  const navigate = useNavigate();
  const [code, setCode] = useState(normalizeInviteCode(params.code ?? ''));
  const [preview, setPreview] = useState<LeaguePreview | null>(null);
  const [team, setTeam] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function look(c = code) {
    setBusy(true);
    setError(null);
    setPreview(null);
    setTeam(null);
    try {
      setPreview(await previewLeague(c));
    } catch (e) {
      setError(friendlyError(e));
    }
    setBusy(false);
  }

  // Con il link d'invito (#/entra/CODICE) la lega si cerca subito
  useEffect(() => {
    if (params.code) void look(normalizeInviteCode(params.code));
  }, [params.code]);

  async function join(e: FormEvent) {
    e.preventDefault();
    if (!preview || !team) return;
    setBusy(true);
    setError(null);
    try {
      const id = await joinLeague(code, team);
      navigate(`/lega/${id}`);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
      // La squadra potrebbe essere stata appena presa da un altro: si aggiorna l'elenco
      void look();
    }
  }

  return (
    <div className="space-y-4">
      <PageTitle sub="Il codice te lo dà chi ha creato la lega.">Entra con un codice</PageTitle>
      <Card>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void look();
          }}
          className="flex items-end gap-2"
        >
          <div className="flex-1">
            <TextInput
              label="Codice invito"
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              required
              value={code}
              maxLength={12}
              onChange={(e) => setCode(normalizeInviteCode(e.target.value))}
              placeholder="AB3K7Q"
              className="font-mono tracking-widest uppercase"
            />
          </div>
          <Button type="submit" disabled={busy || code.length < 6}>
            Cerca
          </Button>
        </form>
      </Card>
      <ErrorText>{error}</ErrorText>

      {preview && preview.already_member && (
        <Card>
          <p className="text-sm">
            Sei già in <strong>{preview.name}</strong>.{' '}
            <Link className="font-semibold text-orange-600 underline" to={`/lega/${preview.league_id}`}>
              Vai alla lega
            </Link>
          </p>
        </Card>
      )}

      {preview && !preview.already_member && (
        <form onSubmit={join} className="space-y-4">
          <Card>
            <h2 className="text-lg font-semibold">{preview.name}</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Commissario: {preview.commissioner || '—'} · {preview.teams.filter((t) => !t.taken).length}{' '}
              squadre libere
            </p>
            <h3 className="mt-4 mb-3 text-sm font-medium text-slate-700 dark:text-slate-200">
              Scegli la tua squadra
            </h3>
            <TeamPicker
              value={team}
              onChange={setTeam}
              taken={preview.teams.filter((t) => t.taken).map((t) => t.code)}
            />
          </Card>
          <Button type="submit" className="w-full sm:w-auto" disabled={busy || !team}>
            {busy ? 'Entro…' : 'Entra nella lega'}
          </Button>
        </form>
      )}
    </div>
  );
}
