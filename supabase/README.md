# Supabase

Database di NBBGM: tabelle, sicurezza, funzioni dei turni e delle leghe, Edge Functions e impostazioni di accesso.

## Progetto

- **NBBGM** (`sojimrnmsrbntgfsgxmj`), regione Central EU (Frankfurt), piano Free.
- Impostazioni scelte alla creazione: Data API attiva, "Automatically expose new tables" spento (i permessi li danno le migrazioni), "Enable automatic RLS" attivo come rete di sicurezza.
- Le migrazioni sono applicate e le tabelle `base_*` contengono i giocatori reali 2026-27.
- La CLI va usata con l'account Owner (mondiali2014): con il ruolo Developer non si cambiano le impostazioni Auth.

## CLI

Si usa la CLI 3.0.0 con npx. In PowerShell `npx` è bloccato dalla politica di esecuzione degli script: si usa `npx.cmd`.

```
npx.cmd --yes supabase@3.0.0 login
npx.cmd --yes supabase@3.0.0 link --project-ref sojimrnmsrbntgfsgxmj
npx.cmd --yes supabase@3.0.0 db push --remote --dry-run
npx.cmd --yes supabase@3.0.0 db push --remote
npx.cmd --yes supabase@3.0.0 db advisors --remote --type all
npx.cmd --yes supabase@3.0.0 db query --remote -f data/base.sql
npx.cmd --yes supabase@3.0.0 functions deploy create-league draft advance-turn market --use-api
```

Senza `--remote` i comandi `db` puntano al database locale di Docker.

## Migrazioni

| File                                     | Contenuto                                                                                                                                                                                                        |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261105090000_schema.sql`              | Le tabelle del modello dati (CLAUDE.md, Modello dati essenziale), più `league_members` e `dead_money`.                                                                                                           |
| `20261105090100_security.sql`            | RLS su ogni tabella, permessi minimi, `player_hidden` e `base_*` chiuse al client, controllo di quintetto e minuti, profilo per ogni nuovo utente.                                                               |
| `20261105090200_turns.sql`               | `set_ready`, `round_all_ready`, `close_round`, `reclaim_round` e `apply_turn`.                                                                                                                                   |
| `20261105100000_private_helpers.sql`     | Le funzioni delle policy passano nello schema `private`, che l'API non espone; `coach_ready` e `round_all_ready` solo per il server.                                                                             |
| `20261105100100_foreign_key_indexes.sql` | Un indice per ogni chiave esterna.                                                                                                                                                                               |
| `20261105110000_leagues.sql`             | `insert_league` (solo server), `league_preview` e `join_league` per entrare con il codice invito.                                                                                                                |
| `20261105120000_initial_draft.sql`       | Draft iniziale: tabelle, liste dei preferiti (solo del manager), `draft_snapshot` e `apply_draft_picks` (solo server), `insert_league` esteso.                                                                   |
| `20261105130000_roster.sql`              | `league_state` (solo server: lo stato della lega per il motore) e `player_scouting` (stime dei valori nascosti per la scheda giocatore).                                                                         |
| `20261105140000_advance.sql`             | Avanzamento dei turni: `try_close_round`, `force_round`, `answer_alert`, `set_ready` che chiama advance-turn, pg_net, pg_cron, tempo reale.                                                                      |
| `20261105140100_pause_deadline.sql`      | La pausa ferma anche la scadenza: alla ripresa la scadenza del turno aperto riparte da adesso.                                                                                                                   |
| `20261105150000_postseason.sql`          | Play-in e playoff: si gioca anche lì, conta solo chi ha una partita nel turno, `league_state` con le serie; `leagues.seed` non più leggibile dal client.                                                         |
| `20261105160000_market.sql`              | Mercato: `market_write` (solo server, a turno aperto), `apply_round`, `roster_requests`, protezioni negli scambi, `team_balance`; niente scritture dirette su offerte e scambi, saldo non leggibile dagli altri. |
| `20261105170000_offseason.sql`           | Offseason a turni: `rounds.stage`, prospetti (`players.draft_prospect`), `draft_order`, `draft_lists` (del manager), `apply_round` con draft e stagione nuova, l'offseason si gioca.                             |

`supabase db advisors` lascia solo avvisi voluti:

- `set_ready`, `answer_alert`, `force_round`, `league_preview`, `join_league` e `player_scouting` sono security definer e chiamabili dal manager: sono le sue azioni dall'API e controllano da sé chi chiama.
- `player_hidden` e `base_*` hanno la RLS senza policy: sono chiuse al client.
- La protezione delle password compromesse non serve: non si usano password.
- Gli indici risultano non usati finché il database è quasi vuoto.

## Chi può fare cosa

- **Manager** (utente autenticato): legge le leghe di cui fa parte; cambia solo impostazioni e allenatore della propria squadra, e solo a turno aperto; preme Pronto con `set_ready`, risponde agli avvisi con `answer_alert` e legge il proprio saldo con `team_balance`. Offerte agli svincolati, scambi, tagli e rinnovi passano dalla Edge Function market: il client non scrive direttamente `free_agent_bids`, `trade_offers` e `roster_requests`. Le offerte agli svincolati le vede solo chi le fa; scambi e avvisi solo le squadre coinvolte; il bilancio la propria squadra (il commissario tutte).
- **Commissario:** in più cambia nome, scadenza, ritmo e pausa della lega e forza l'avanzamento (`force_round`).
- **Senza login:** niente.
- **Server** (`service_role`, Edge Functions): tutto il resto. Solo lui chiude il turno (`try_close_round`) e scrive il risultato (`apply_turn`), e solo lui legge `player_hidden` e i dati di partenza.

## Edge Functions

- **create-league** (`functions/create-league/index.ts`): `POST { name, team, settings }` con il JWT dell'utente. Controlla l'utente con `auth.getUser`, legge i dati di partenza, crea la lega con il motore e la scrive con `insert_league`. `verify_jwt` è spento in `config.toml` perché il controllo lo fa la funzione. Il motore viene caricato da `packages/engine` insieme alla funzione (`--use-api`, senza Docker).
- **draft** (`functions/draft/index.ts`): `POST { league_id, action, player_id? }` con `action` tra `start` (commissario), `pick` (il manager di turno, dal vivo), `tick` (tempo scaduto) e `to-list` (commissario: chiude con le liste). Legge lo stato con `draft_snapshot`, fa decidere al motore (`planDraft`) e scrive con `apply_draft_picks`.
- **advance-turn** (`functions/advance-turn/index.ts`): `POST { league_id }`, senza utente. La chiamano il database con pg_net (ultimo Pronto, risposta all'ultimo avviso, avanzamento forzato) e pg_cron. Non si fida di chi chiama: `try_close_round` decide nel database se il turno va chiuso e lascia passare solo la prima chiamata; poi `league_state`, il motore (`serverTurn`) e `apply_turn`. Risponde `{ advanced: false }` se non c'è niente da fare.
- **market** (`functions/market/index.ts`): `POST { league_id, action }` con il JWT dell'utente. Azioni: `bid`, `withdraw_bid`, `propose_trade`, `respond_trade`, `withdraw_trade`, `release`, `renew`, `withdraw_request`. Legge lo stato con `league_state`, controlla l'azione con il motore (`checkMarketAction` in `_shared/market.ts`: rosa, cap, bilancio, trade deadline, regola Stepien, protezioni, swap, richieste degli svincolati) e la scrive con `market_write`, che la accetta solo se il turno è ancora quello aperto. Tutto si esegue alla chiusura del turno: advance-turn passa il risultato ad `apply_round`, che scrive le sezioni del mercato e chiama `apply_turn`.
- Il `tick` di **draft** si può chiamare anche senza utente (lo fa pg_cron): sceglie solo se il tempo della chiamata è scaduto.
- Il codice comune a funzioni e script sta in `functions/_shared/`: `league.ts`, `draft.ts`, `state.ts` (stato della lega dal database al motore) e `turn.ts` (un turno: dal motore alle sezioni di `apply_turn`).

## Accesso (Auth)

- Codice di 6 cifre via email (niente link magico) e Google. Le email partono dallo SMTP di Gmail configurato nella dashboard; il modello è `templates/codice.html`.
- Impostazioni applicate al progetto: Site URL `https://albisiot.github.io/NBBGM/` (l'app pubblicata), Redirect URLs `https://albisiot.github.io/NBBGM/**`, `http://localhost:5173/**` e `http://192.168.1.51:5173/**`, `otp_length = 6`, modelli `magic_link` e `confirmation` con oggetto "Il tuo codice NBBGM". Per cambiarle si usa `config push --workdir <cartella>` con un `config.toml` che dichiara solo quei valori: i valori non dichiarati restano com'erano. Il `config.toml` di questa cartella è per il database locale e non va spinto per intero.
- Google: provider attivo (client OAuth del progetto Google Cloud `NBBGM-pro`, redirect `https://sojimrnmsrbntgfsgxmj.supabase.co/auth/v1/callback`). L'app Google è in Test: entra solo chi è tra gli utenti di prova.
- App Google ancora in Test: per pubblicarla, in Google Auth Platform servono home page `https://albisiot.github.io/NBBGM/` e informativa privacy `https://albisiot.github.io/NBBGM/privacy.html`, con il dominio verificato in Google Search Console.

## GitHub Actions

- `.github/workflows/supabase.yml` pubblica migrazioni ed Edge Functions quando cambiano su `main` (o a mano, da Actions). Servono i segreti del repository `SUPABASE_ACCESS_TOKEN` (token personale, da supabase.com > Account > Access Tokens) e `SUPABASE_DB_PASSWORD`, e la variabile `SUPABASE_PROJECT_REF`. Senza i segreti il job avvisa e non pubblica nulla: si continua con la CLI da qui.

## Turni, pg_net e pg_cron

- Il turno si chiude quando `private.round_due` dà un motivo: `forced` (il commissario), `deadline` (scadenza passata, solo se la lega ne ha una), `ready` (tutti pronti e almeno un Pronto premuto) o `coach` (tutti con l'allenatore, passato il ritmo massimo dall'apertura del turno). Mai con il draft iniziale in corso, con la lega in pausa (salvo `forced`) e, fino alla Fase 12, nei turni di offseason. In play-in e playoff devono essere pronte solo le squadre umane con una partita nel turno.
- pg_net chiama le Edge Functions all'indirizzo in `private.settings` (`functions_url`), che non è segreto. In un progetto nuovo va scritto una volta:

  ```sql
  insert into private.settings (key, value)
  values ('functions_url', 'https://<progetto>.supabase.co/functions/v1');
  ```

  Senza quella riga, e dove non c'è pg_net (PGlite), le chiamate non partono.

- pg_cron esegue `private.cron_tick()` ogni 15 secondi (job `nbbgm-turni`): turni da chiudere, turni fermi in chiusura da più di 5 minuti e scelte del draft dal vivo con il tempo scaduto. Le esecuzioni si vedono in `cron.job_run_details`, le risposte delle funzioni in `net._http_response`.
- Tempo reale: `rounds`, `ready_flags`, `coach_delegations` e `alerts` sono nella pubblicazione `supabase_realtime`; la RLS decide che cosa arriva a ciascuno.
- Offseason: turni `offseason` con `stage` draft, renewals, fa1-fa4, preparation. Alla chiusura della finale advance-turn fa fine stagione, lottery e ordine del draft (`draft_order`, `draft_lottery`) e scrive la classe del draft come prospetti; alla chiusura del draft fa le 60 scelte e fa scalare i contratti (chi scade resta con un contratto senza stipendi fino al turno dei rinnovi); alla chiusura della preparazione nasce la riga nuova di `seasons` con il suo calendario (`new_games` di `apply_round`). Dopo il draft `league_state` dà ancora la stagione vecchia: la configurazione della nuova la ricava il motore (`nextConfig`).
- Post-season: il tabellone non si salva come stato. advance-turn lo ricostruisce dalle partite giocate (`replayPostseason` nel motore), aggiorna `playoff_series` e mette in `games` le partite del turno successivo (senza punteggio), così tutti vedono chi gioca.

## apply_turn

La Edge Function simula il turno con il pacchetto engine e passa il risultato ad `apply_turn(turno, risultato)`, che lo scrive in una sola transazione e apre il turno successivo. Il formato delle sezioni è nel commento della funzione. Se una sezione ha righe di un'altra lega o inesistenti, o se il turno non è in chiusura, non scrive nulla: una seconda chiamata sullo stesso turno fallisce.

## Seed e dati

- `pnpm db:seed` scrive `supabase/seed.sql` (lega di prova con giocatori generati, tre utenti di test: anna, bruno e carla `@nbbgm.test`, su Boston, Lakers e Knicks) e, se c'è l'import dei file Excel, `data/base.sql` con i giocatori reali per le tabelle `base_*`. Nessuno dei due va nel repo.
- `seed.sql` serve al database locale (`supabase db reset`, con Docker): nel progetto vero non va caricato.
- `data/base.sql` si carica nel progetto con `db query --remote -f data/base.sql` e sostituisce il dataset 2026-27.

## Test

`pnpm test` prova le migrazioni su PGlite (Postgres in WebAssembly) con lo stesso seed: `scripts/test/db.test.ts`; l'avanzamento dei turni con i tre account del seed è in `scripts/test/advance.test.ts`. Non servono Docker né un progetto Supabase; `scripts/src/db/shim.sql` ricrea ruoli, `auth.users` e `auth.uid()` come in Supabase. I permessi di ogni ruolo su tabelle e funzioni sono stati confrontati con quelli del progetto vero e coincidono (169 voci, con "Automatically expose new tables" acceso o spento).
