// Profilo: il nome che vedono gli altri manager, le notifiche, il tema e l'uscita.
import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { PushSettings } from '../components/PushSettings.tsx';
import { Button, Card, Choice, ErrorText, PageTitle, SectionTitle, TextInput } from '../components/ui.tsx';
import { useAuth, useUserId } from '../lib/auth.tsx';
import { friendlyError } from '../lib/errors.ts';
import { updateDisplayName } from '../lib/leagues.ts';
import { ROW_LINK } from '../lib/linkStyles.ts';
import { disablePush } from '../lib/push.ts';
import { readTheme, saveTheme, type ThemeChoice } from '../lib/theme.ts';

const THEME_OPTIONS: { label: string; value: ThemeChoice; note: string }[] = [
  {
    label: 'Automatico',
    value: 'auto',
    note: 'Chiaro o scuro come il telefono o il computer, anche quando il sistema cambia da solo la sera.',
  },
  { label: 'Chiaro', value: 'chiaro', note: 'Carta rosa e inchiostro, sempre.' },
  { label: 'Scuro', value: 'scuro', note: 'Fondo d’inchiostro e testo chiaro, sempre.' },
];

/** Tema dell'app su questo dispositivo: si applica subito, senza salvare. */
function ThemeSettings() {
  const [theme, setTheme] = useState(readTheme);
  return (
    <Card className="space-y-3">
      <SectionTitle>Tema</SectionTitle>
      <Choice
        label="Su questo dispositivo"
        options={THEME_OPTIONS}
        value={theme}
        onChange={(v) => {
          setTheme(v);
          saveTheme(v);
        }}
      />
    </Card>
  );
}

export function ProfilePage() {
  const userId = useUserId();
  const { session, displayName, refreshProfile, signOut } = useAuth();
  const [name, setName] = useState(displayName);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setName(displayName), [displayName]);

  async function save(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await updateDisplayName(userId, name.trim());
      await refreshProfile();
      setSaved(true);
    } catch (err) {
      setError(friendlyError(err));
    }
  }

  return (
    <div className="space-y-6">
      <PageTitle sub={session?.user.email}>Profilo</PageTitle>
      <Card>
        <form onSubmit={save} className="space-y-3">
          <SectionTitle>Il tuo nome</SectionTitle>
          <TextInput
            label="Nome"
            hint="È il nome che vedono gli altri manager accanto alla tua squadra."
            required
            maxLength={40}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setSaved(false);
            }}
          />
          <ErrorText>{error}</ErrorText>
          <Button type="submit" disabled={!name.trim() || name.trim() === displayName}>
            {saved ? 'Salvato' : 'Salva'}
          </Button>
        </form>
      </Card>
      <PushSettings userId={userId} />
      <ThemeSettings />
      <p>
        <Link to="/guida" className={ROW_LINK}>
          Come si gioca
        </Link>
      </p>
      <Button
        variant="secondary"
        onClick={() =>
          // Le notifiche di questo dispositivo smettono di arrivare a chi è uscito
          void disablePush()
            .catch(() => undefined)
            .then(signOut)
        }
      >
        Esci
      </Button>
    </div>
  );
}
