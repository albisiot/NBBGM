# NBBGM

Il manageriale di basket a turni da giocare con gli amici: ognuno guida una squadra NBA e la lega avanza di un
turno quando tutti sono pronti.

## 🏀 Gioca: [albisiot.github.io/NBBGM](https://albisiot.github.io/NBBGM/)

Si entra con il codice che arriva per email (o con Google). Per crearsi una lega: **Crea una lega**; per entrare in
quella di un amico: **Entra con un codice**, con il codice invito che ti manda.

### Installarla sul telefono

- **iPhone:** apri il link in Safari, tocca **Condividi** e poi **Aggiungi alla schermata Home**.
- **Android:** apri il link in Chrome, menu **⋮** e poi **Installa app** (o **Aggiungi a schermata Home**).

Dall'icona si apre a tutto schermo, come un'app. Su iPhone, nell'app installata, conviene entrare con il codice via
email.

[Informativa privacy](https://albisiot.github.io/NBBGM/privacy.html) · gioco privato tra amici, senza pubblicità.

## Per chi sviluppa

Monorepo pnpm in TypeScript: l'app (`apps/web`, React e Vite), il motore del gioco (`packages/engine`, senza
dipendenze), il database e le Edge Functions di Supabase (`supabase/`) e gli script (`scripts/`).

```
pnpm install
pnpm dev
pnpm test
```

Regole, motore, economia, modello dati e scelte prese fase per fase sono in [CLAUDE.md](CLAUDE.md); database,
sicurezza e pubblicazione in [supabase/README.md](supabase/README.md). A ogni push su `main` GitHub Actions fa i
controlli e, solo se passano, pubblica l'app su GitHub Pages e migrazioni ed Edge Functions su Supabase.
