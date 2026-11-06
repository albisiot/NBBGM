# CLAUDE.md — NBBGM

Riassunto del documento di design (versione 2.4, 4 novembre 2026). È la fonte delle regole del gioco, del motore, dell'economia, del modello dati e delle fasi di lavoro. Lavora una fase alla volta e non iniziare la fase successiva senza l'ok dell'utente.

## Regole per il codice

- TypeScript strict ovunque. Il pacchetto `packages/engine` non ha dipendenze ed è puro: stesso input e stesso seed, stesso output.
- Negli import interni di `packages/engine` usa l'estensione `.ts`: lo stesso sorgente deve girare anche su Deno (Edge Functions).
- I file dati con i giocatori reali (`*.xlsx`) e i documenti (`*.docx`) restano fuori dal repo; i dati generati vanno in `data/`, anch'essa esclusa.
- Scrivi i test prima di dichiarare finita una parte. Comandi: `pnpm test`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`.
- Testi dell'interfaccia e commenti in italiano.
- Nel motore non usare globali di Node o del browser (es. `structuredClone`): la build usa solo la libreria standard.

## Stato del lavoro

- Fasi 1-13 completate: l'app è pubblicata e installata dal telefono, e in produzione una lega ha giocato i suoi turni (con il Pronto e con l'allenatore). Dopo la Fase 13 sono stati corretti sette bug trovati analizzando l'app e rinforzati server e app: turni bloccati, spazio del database, strumenti del commissario, service worker, pubblicazione dopo i controlli (vedi "Scelte prese dopo la Fase 13"). Si lavora su `main`; `fasi-1-3` è il ramo storico delle fasi. La logica di stagione sta in `packages/engine/src/season/`; database e sicurezza in `supabase/migrations/` (vedi `supabase/README.md`).
- App: `pnpm dev` (o `pnpm dev:lan` per provarla dal telefono sulla stessa Wi-Fi). Legge URL e chiave publishable da `apps/web/.env.local` (modello in `.env.example`).
- Pubblicata su **GitHub Pages**: `https://albisiot.github.io/NBBGM/` (repository pubblico `albisiot/NBBGM`, ramo `main`). Workflow in `.github/workflows/`: `ci.yml` (controlli), e dopo i controlli riusciti su `main` `pages.yml` (app, con le variabili `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`) e `supabase.yml` (migrazioni e funzioni, con il segreto `SUPABASE_ACCESS_TOKEN`). Icone della PWA con `pnpm icons`.
- Edge Functions `create-league`, `draft`, `advance-turn` e `market` in `supabase/functions/`; il codice comune a Edge Function e script sta in `supabase/functions/_shared/`: `league.ts` (dati di partenza <-> motore, righe per `insert_league`), `draft.ts` (draft iniziale), `state.ts` (stato della lega dal database al motore, con `league_state`) `turn.ts` (un turno: dal motore alle sezioni di `apply_turn`) e `market.ts` (controllo delle azioni di mercato). Si pubblicano con `npx.cmd --yes supabase@3.0.0 functions deploy create-league draft advance-turn market --use-api`.
- `pnpm db:seed` scrive `supabase/seed.sql` (lega di prova generata, utenti anna, bruno e carla `@nbbgm.test`) e `data/base.sql` (giocatori reali per le tabelle `base_*`); nessuno dei due va nel repo. I test del database girano su PGlite (`scripts/test/db.test.ts`), senza Docker.
- Progetto Supabase **NBBGM** (`sojimrnmsrbntgfsgxmj`, Francoforte): migrazioni applicate, giocatori reali caricati nelle tabelle `base_*`. Si lavora con la CLI (`npx.cmd --yes supabase@3.0.0 ...`, comandi in `supabase/README.md`), non con il connettore.
- `pnpm data:import` legge `NBA_2026-27_valutazioni_v2.xlsx` e `NBA_2026-27_contratti.xlsx` dalla radice e scrive `data/league-2026-27.json` e `data/import-report.md`; aggiorna `packages/engine/src/archetype-profiles.ts`.
- `pnpm sim:calibrate [partite]` gioca 1.000 partite (o il numero dato) e confronta le medie con gli intervalli della sezione Calibrazione. I parametri del motore stanno in `packages/engine/src/game/params.ts`.
- `pnpm sim:seasons [stagioni] [--veloce]` gioca 10 stagioni complete e controlla le metriche di lungo periodo; con `--veloce` usa una partita finta (2 secondi a stagione) per provare crescita ed economia.

## Scelte prese nella Fase 4 (non erano nel documento)

- **Livello della lega costante:** a ogni offseason, dopo crescita e draft, le abilità di tutti si spostano di poco perché la media dell'overall dei migliori 150 torni a quella di partenza (`normalizeTalent`). L'ordine tra i giocatori non cambia. Resistenza, Grinta, Freddezza e Leadership non si spostano: non entrano nell'overall.
- **Potenziale del file:** riportato sulla scala dell'overall con una retta ricavata dai giocatori tra 28 e 33 anni, che sono al loro massimo (`calibratePotential`).
- **Energia tra i turni:** recupero di 12 punti a Resistenza 50 (`ENERGY_RECOVERY`), cambio per stanchezza sotto 50: un titolare a 35 minuti resta sopra 85 a inizio gara, uno a 42 scende sotto 75.
- **Curva di crescita:** picco a 27 anni, calo dal 28° (`ageCurve`).
- **Bot in rosso:** se sono sopra la tassa provano a cedere un contratto pesante a chi ha spazio sotto il cap, aggiungendo se serve una scelta (`botSalaryDump`).
- **Two-way:** contratti di un anno, rinnovati di stagione in stagione con i giovani svincolati.
- **Scala rookie:** ricavata dai contratti reali dei rookie 2026 (`CONFIG_2026_27.rookieScale`); minimi per anzianità dalla tabella 2026-27.
- **Rose iniziali:** alla creazione della lega le rose oltre 15 standard o 3 two-way si tagliano come in offseason.
- **Niente dinastie a forza di scambi:** negli scambi tra bot le due squadre più forti non comprano veterani.
- **Ricavi:** 170 milioni di $ nel 2026-27 (il 3% sopra il cap), non più pari alla soglia della tassa: con quel valore i saldi crescevano di centinaia di milioni e il bilancio smetteva di contare. Crescono del 7% l'anno con il resto.

## Scelte prese nella Fase 5 (non erano nel documento)

- **Tabelle in più:** `league_members` (chi fa parte di una lega, base di tutta la RLS) e `dead_money` (stipendi residui dei tagliati). I giocatori ritirati restano in `players` con `retired` per lo storico delle statistiche.
- **Scritture del client:** solo impostazioni, allenatore e offerte agli svincolati della propria squadra, proposte di scambio, nome del profilo e impostazioni della lega per il commissario. Tutto il resto passa dal server. A turno in chiusura nessuna modifica è accettata.
- **Visibilità:** chi ha l'allenatore attivo lo vedono tutti; le offerte agli svincolati solo chi le fa; scambi e avvisi le squadre coinvolte; il bilancio la propria squadra, il commissario tutte.
- **Seed della simulazione:** nasce in `close_round` e resta nel turno; `reclaim_round` riprende un turno fermo in chiusura da più di 5 minuti con lo stesso seed.
- **apply_turn:** riceve righe con i nomi delle colonne, sezione per sezione; rifiuta sezioni sconosciute, righe di altre leghe e partite già giocate, e non scrive nulla se qualcosa non torna.
- **Funzioni delle policy nello schema `private`:** non sono chiamabili dall'API. Dal client si chiama solo `set_ready`. Ogni funzione nuova va chiusa (`revoke execute ... from public, anon, authenticated`) e aperta solo a chi serve.
- **Permessi espliciti:** il progetto ha "Automatically expose new tables" spento; le migrazioni danno i permessi a ogni ruolo, server compreso, e i test controllano che siano gli stessi con il flag acceso o spento.

## Scelte prese nella Fase 6 (non erano nel documento)

- **Creazione della lega:** la fa la Edge Function `create-league` con il motore (circa 70 ms) e la scrive `insert_league` in una sola transazione. Per ora solo rose reali: il draft iniziale è visibile ma disattivato fino alla Fase 7.
- **Codice invito:** 6 caratteri senza 0, O, 1, I e L; si scrive in qualunque modo (minuscole, spazi, trattini). Con il codice si vedono nome della lega e squadre libere (`league_preview`); `join_league` dà la squadra al primo che la chiede.
- **Una squadra per lega:** chi entra prende una squadra libera, finora del bot; non c'è ancora un modo per cambiarla o lasciare la lega.
- **Email con il codice:** 6 cifre, mandate da Gmail (SMTP del progetto, mittente NBBGM `<mondiali2014@gmail.com>`, 30 email all'ora). Il modello sta in `supabase/templates/codice.html`. Sul piano Free i modelli si cambiano solo con uno SMTP personalizzato.
- **Impostazioni Auth del progetto:** si applicano con `config push` da una cartella temporanea con un `config.toml` minimo, che dichiara solo i valori da cambiare (Site URL, Redirect URLs, lunghezza del codice, modelli). Serve il login della CLI come Owner (mondiali2014). Il `config.toml` del repo è per il database locale: non va spinto per intero sul progetto.
- **Login con Google:** attivo, con un client OAuth del progetto Google Cloud `NBBGM-pro` (redirect `https://sojimrnmsrbntgfsgxmj.supabase.co/auth/v1/callback`). L'app Google è in stato Test: entra con Google solo chi è tra gli utenti di prova (fino a 100, si aggiungono in Google Auth Platform → Pubblico); gli altri usano il codice via email. Per pubblicarla Google chiede home page e informativa privacy su un dominio nostro: si potrà fare con GitHub Pages (Fase 13). Chi entra con Google e con il codice usando la stessa email ritrova lo stesso account.
- **Dopo il login con Google** il client usa il flusso PKCE: il codice torna come `?code=...` e non si scontra con l'HashRouter.

## Scelte prese nella Fase 7 (non erano nel documento)

- **Draft iniziale:** 13 giri a serpentina con il primo giro sorteggiato (`snakeOrder`), 390 scelte. In palio ci sono i giocatori con contratto standard: i two-way restano fuori e partono svincolati con i non scelti, così ogni squadra chiude con 13 contratti standard e nessun two-way.
- **Contratti:** chi viene scelto firma il contratto del file con la squadra che lo prende; chi non ha contratto (o ha stipendi sconosciuti) firma il minimo per un anno. In una lega draft non ci sono stipendi residui di giocatori tagliati.
- **Scelta automatica** (bot, modalità lista, tempo scaduto): il primo disponibile della lista del manager; senza lista, il migliore del ruolo più scoperto rispetto a 3 PG, 3 SG, 3 SF, 2 PF e 2 C (`autoDraftPick`).
- **Chi decide:** il motore (`planDraft`) nella Edge Function `draft`; `apply_draft_picks` scrive le scelte solo se il draft è ancora alla chiamata attesa, quindi due richieste insieme non scelgono due volte.
- **Avvio:** lo decide il commissario. In modalità lista il server fa tutte le scelte subito; dal vivo i bot scelgono all'istante e il tempo corre per gli umani. Il commissario può chiudere con le liste in qualsiasi momento.
- **Tempo dal vivo:** lo fanno rispettare le app aperte, che allo scadere chiedono al server di scegliere. Se nessuno ha l'app aperta il draft aspetta; il controllo ogni minuto dal server arriva con pg_cron nella Fase 9.
- **Liste:** le vede solo il loro manager e si cambiano fino alla fine del draft; si salvano a ogni modifica.

## Scelte prese nella Fase 8 (non erano nel documento)

- **Impostazioni salvate nella simulazione:** le squadre umane giocano con `team_settings` (`setupFromSettings` nel motore). Se manca qualcuno (ceduto, tagliato, infortunato) il bot sostituisce solo lui: nello slot da titolare il migliore per quel ruolo, che ne eredita i minuti; i minuti di chi manca dalla panchina vanno agli altri della rotazione, fino a 48. A referto al massimo 13, prima chi ha minuti.
- **Chi non ha mai salvato** gioca con le scelte del bot (`autoSetup`), come le squadre senza manager.
- **Stato dal database:** `league_state` (solo server) dà in una lettura tutto quello che serve al motore; `leagueStateFromRows` lo trasforma in `LeagueState`. Nel motore le squadre hanno per id la sigla, i giocatori il loro uuid. Play-in e playoff non sono ancora salvati (Fase 10).
- **Stime della scheda giocatore** (`player_scouting`): costanza in attacco e in difesa ed etica del lavoro in 5 livelli per i propri giocatori e in 3 per gli altri; distretti a rischio sotto 70 di durabilità per i propri, sotto 55 per gli altri. Il potenziale è la stima che vedono anche i bot. I numeri dei valori nascosti non arrivano mai al client.
- **Pulsante Auto** e overall sono calcolati nell'app con il motore, dalle sole abilità visibili.
- **Allenatore:** si attiva dalla schermata roster (fino al prossimo turno, a fine fase, a una data o senza limite); cosa fa al passaggio di turno arriva con la Fase 9.

## Scelte prese nella Fase 9 (non erano nel documento)

- **Chi decide la chiusura:** il database (`private.round_due`). advance-turn non ha login e non si fida di chi la chiama: `try_close_round` chiude il turno solo se è il momento e solo per la prima chiamata. La chiamano pg_net (ultimo Pronto, risposta all'ultimo avviso, avanzamento forzato) e pg_cron ogni 15 secondi (scadenze, ritmo degli allenatori, riprese dopo 5 minuti, timer del draft dal vivo). L'indirizzo delle funzioni sta in `private.settings` (vedi `supabase/README.md`).
- **Ritmo massimo:** vale solo quando tutti sono pronti con l'allenatore, senza nessun Pronto premuto; si conta dall'apertura del turno. Se l'ultimo a essere pronto preme Pronto, si parte subito.
- **Pausa:** ferma tutto tranne l'avanzamento forzato; alla ripresa la scadenza del turno aperto riparte da adesso. Anche cambiare la scadenza la fa ripartire. La scadenza del primo turno parte a fine draft iniziale.
- **Allenatore:** fa quintetto e minuti come il pulsante Auto, con le tattiche salvate dal manager; le impostazioni salvate restano com'erano. Con un avviso bloccante aperto la squadra non è più pronta da sola, ma in campo la guida comunque l'allenatore. La delega fino a un turno vale per quel turno compreso.
- **Rosa sotto 13** (anche per le squadre umane): alla chiusura del turno arriva l'avviso bloccante `roster_minimum`; se alla chiusura del turno dopo la rosa è ancora corta, il server firma al minimo per un anno i migliori svincolati dei ruoli più scoperti (`fillRosterAtMinimum`), che il manager abbia risposto o no. Gli altri avvisi bloccanti senza risposta si chiudono come scaduti.
- **Avvisi informativi:** per ora solo gli infortuni dei propri giocatori; restano finché il manager non li legge.
- **Bilancio:** a ogni turno tre movimenti per squadra (ricavi, stipendi, two-way) arrotondati al dollaro, più tassa e monte minimo a fine regular season; il saldo è sempre il saldo di partenza più la somma dei movimenti.
- **Cronaca salvata compatta** (`compactPlayByPlay`): ogni azione è `[periodo, secondi alla fine, squadra h/a, testo, punti casa, punti trasferta]`, circa 20 KB a partita, per stare nei 500 MB del piano Free.
- **Seed del turno:** tutto il caso del turno (partite e mercato dei bot) viene dal seed del turno, non da quello della lega.
- **Fine regular season:** dopo la giornata 82 si apre il turno di play-in, che per ora non si gioca (Fase 10).
- **Lega "ciao" in pausa:** all'avvio della Fase 9 la sua scadenza di 15 minuti era passata da ore; per non farla avanzare da sola ogni 15 minuti è stata messa in pausa. La riprende il commissario dalla pagina della lega.

## Scelte prese nella Fase 10 (non erano nel documento)

- **Tabellone ricostruito dalle partite:** play-in e playoff non hanno uno stato salvato; `replayPostseason` rifà il tabellone dalle prime 10 di ogni conference e dalle partite di post-season giocate, turno per turno. Le serie stanno in `playoff_series` (una serie è riconosciuta da giro, conference e squadre); le partite del turno successivo si scrivono in `games` senza punteggio appena il turno prima finisce.
- **Chi deve essere pronto in post-season:** solo le squadre umane con una partita nel turno; le altre risultano "Non gioca". Se nessun umano gioca, la lega avanza da sola al ritmo massimo.
- **Spareggi in classifica con un seed pubblico** (`standingsSeed(id della lega, anno)`, `LeagueState.publicSeed`): l'app rifà con il motore la stessa classifica che il server usa per il tabellone. L'ordine delle squadre conta per il sorteggio: si passano ordinate per sigla, come le legge il server.
- **`leagues.seed` chiuso al client:** con il motore nel bundle, dal seed della lega si ricavavano il rumore delle stime del potenziale (quindi il potenziale vero), la crescita e le classi del draft. Il client legge tutte le altre colonne.
- **Classifica:** calcolata nell'app (`standingsTable` nel motore) dalle partite di regular season: V, P, %, distacco, casa, trasferta, ultime 10, serie, differenza punti; per conference (1-6 playoff, 7-10 play-in) o per division.
- **Statistiche individuali:** solo regular season, medie per partita da `players.season_stats`; per le classifiche della lega servono almeno metà delle partite del più presente. Le statistiche dei playoff restano nei box score (`player_game_stats`).
- **Post-season senza movimenti di bilancio** e senza firme dei bot: ricavi e stipendi si contano solo nelle 82 giornate.
- **Dopo la finale** si apre il turno di offseason, che per ora non si gioca (Fase 12): la pagina della lega mostra il campione.

## Scelte prese nella Fase 11 (non erano nel documento)

- **Azioni di mercato solo dalla Edge Function `market`** (cambia la scelta della Fase 5): offerte agli svincolati, proposte e risposte agli scambi, tagli e rinnovi le controlla il motore (`checkMarketAction`) e le scrive `market_write` sotto il lock del turno aperto. Il client non scrive più `free_agent_bids` e `trade_offers`; tagli e rinnovi sono richieste in `roster_requests`. Alla chiusura del turno `runMarket` esegue, ricontrollando tutto: scambi (nell'ordine in cui sono stati accettati), tagli, rinnovi, firme. Quello che non vale più salta.
- **Scambi:** verso un umano serve la sua risposta nel turno (avviso bloccante, e il suo Pronto si toglie perché la veda); senza risposta alla chiusura è rifiutato. Verso un bot decide il bot alla chiusura, con il margine del 10%. Al massimo 10 proposte in attesa per squadra.
- **Protezioni:** chi cede mette la protezione (top 1-20) solo su una propria prima scelta non ancora protetta (`Trade.protections`). **Swap** tra le due squadre dello scambio, per uno dei prossimi 7 draft, uno per coppia, draft e giro.
- **Svincolati in stagione:** chiedono quanto all'ultimo turno di free agency (`IN_SEASON_ASK_ROUND`, `askingSalaryFor`); un'offerta sotto la richiesta è rifiutata subito. Lo stipendio cresce del 5% l'anno, da 1 a 5 anni. In stagione i bot non fanno offerte: firmano solo al minimo per restare a 13.
- **Rinnovi in stagione:** all'ultimo anno di contratto, con morale almeno 30; la richiesta (`renewalSalaries`) è ai prezzi della stagione successiva e il contratto si allunga da quella stagione. In stagione non è un avviso bloccante: lo diventa nel turno dei rinnovi dell'offseason (Fase 12).
- **Proposte dei bot ai manager:** dopo ogni turno di regular season, per ogni squadra umana il 15% di probabilità, al massimo una ogni 5 turni (`botProposals`), come avviso bloccante.
- **Bilancio riservato:** `teams.balance` e `tax_history` non sono più leggibili da tutti i membri; il saldo si legge con `team_balance` (propria squadra, o tutte per il commissario).
- **Stagione intera nei test:** `serverTurn` accetta una partita finta (`playGame`) e si possono spegnere le proposte dei bot (`botProposals: false`), così su PGlite una stagione da 82 giornate dura pochi secondi.

## Scelte prese nella Fase 12 (non erano nel documento)

- **Offseason in 7 turni** (`rounds.stage`): draft, renewals (rinnovi), fa1-fa4 (free agency), preparation. Fine stagione, lottery, ordine del draft e classe del draft si fanno già alla chiusura della finale, così nel turno del draft si vedono ordine e prospetti. Nel motore ogni passo è una funzione (`startOffseason`, `runAnnualDraft`, `scaleContracts`, `closeRenewals`, free agency con `runMarket`, `startNewSeason`); `runOffseason` li esegue di fila per le simulazioni offline.
- **Draft annuale in modalità lista:** ogni manager ordina i preferiti (`draft_lists`, si salvano a ogni modifica) e alla chiusura del turno il server fa le 60 scelte: il primo disponibile della lista, senza lista la logica del bot. Il draft annuale dal vivo non c'è.
- **Classe del draft generata:** 70 prospetti (`players.draft_prospect`), visibili con le stime come gli altri giocatori; i non scelti diventano svincolati. Le classi reali da file non si possono ancora caricare: anche con "rookie reali" si genera.
- **Contratti in scadenza:** alla chiusura del draft i contratti scalano; chi scade resta in squadra con un contratto senza stipendi fino al turno dei rinnovi, dove il manager lo rinnova alla sua richiesta (prezzi della stagione che arriva) o lo lascia andare. Le opzioni della squadra le decide la logica del bot anche per le squadre umane.
- **Senza risposta nei turni dell'offseason:** il draft sceglie comunque; i rinnovi non fatti lasciano andare il giocatore, salvo con l'allenatore attivo e l'avviso aperto (decide la logica del bot); in free agency l'allenatore non fa offerte. Ogni turno dell'offseason che chiede decisioni è un avviso bloccante.
- **Configurazione della stagione nuova:** dopo il draft il server lavora con `nextConfig` della stagione corrente (contratti già scalati); la riga nuova di `seasons` nasce alla fine della preparazione, con il calendario. La stagione vecchia resta in offseason.
- **Preparazione per tutte le squadre:** alla chiusura si tagliano gli esuberi oltre 15 standard e 3 two-way (overall più basso) e chi è sotto 13 firma al minimo, umani compresi. I two-way per le squadre umane non si firmano ancora dall'app.
- **Storico:** le scelte usate restano in `draft_picks` con la loro posizione, gli swap decisi con `result`; `league_state` non li dà più al motore. I ritirati restano in `players` con `retired`.

## Scelte prese nella Fase 13 (non erano nel documento)

- **PWA senza dipendenze nuove:** `manifest.webmanifest`, icone disegnate da `pnpm icons` (palla da basket su fondo scuro: normale, maskable per Android, apple-touch-icon per iPhone) e un service worker generato in build da un plugin in `apps/web/vite.config.ts`, con l'elenco dei file e una versione che cambia a ogni pubblicazione. L'app installata si apre anche senza rete; i dati arrivano sempre da Supabase, mai dalla cache.
- **iPhone:** meta `apple-mobile-web-app-*` e `viewport-fit=cover`; il codice via email resta l'accesso sicuro nella PWA installata (il login Google su iPhone si apre nel browser).
- **Repository pubblico** `albisiot/NBBGM` (Pages gratis): restano fuori file Excel, `data/`, `seed.sql`, `.env.local`; i giocatori veri stanno solo nel database, dietro la RLS.
- **Informativa privacy** in `apps/web/public/privacy.html`, con contatto mondiali2014@gmail.com; il link è nella pagina di accesso.
- **Rami:** `main` è il ramo principale (creato da `fasi-1-3`); Pages pubblica da `main`.

## Scelte prese dopo la Fase 13 (non erano nel documento)

Correzioni dei bug trovati analizzando l'app pubblicata.

- **Offerte agli svincolati:** l'app mostra le richieste in milioni con due decimali (arrotondate ai 10.000 $), ma i minimi non sono cifre tonde. Un'offerta che dista dalla richiesta al massimo 5.000 $ vale come la richiesta esatta (`snapToAsk`), nell'app e nel server: chi offre la cifra che vede firma, e un minimo resta un minimo (sopra il cap è l'unica firma possibile).
- **Impostazioni con giocatori usciti:** la pagina Squadra le sistema al caricamento come fa il motore alla partita (`settingsForRoster`, con `setupFromSettings`): il titolare uscito lo sostituisce il migliore per lo slot, i minuti tornano a 240, gli infortunati restano al loro posto. Poi chiede di salvare. Il server non riscrive `team_settings`: alla partita il motore corregge comunque gli slot mancanti.
- **Pronto legato al turno visto:** `set_ready(p_team, p_ready, p_round)`. Se `p_round` non è il turno corrente il server rifiuta ("Il turno è cambiato"). Senza `p_round` (le app già installate) funziona come prima.
- **Pagine aggiornate al cambio di turno:** Squadra, Mercato, Risultati, Classifica e Playoff si rileggono quando la lega passa al turno successivo (`useRoundChange`), in tempo reale o al ritorno in primo piano. La scheda del turno si rilegge anche al ritorno in primo piano. In Squadra, con modifiche non salvate, l'app chiede prima di ricaricare.
- **Seed di turni e partite solo al server:** `rounds.seed` e `games.seed` sono chiusi al client come `leagues.seed`. Il tempo reale su `rounds` arriva lo stesso, senza la colonna seed (servono i permessi sulla chiave primaria `id`).
- **Valutazione degli scambi dei bot:**
  - Il valore di un giocatore non ha più il minimo a 0,1: un contratto sopra il valore di mercato lo porta sotto zero.
  - Anche chi è in corsa sconta i veterani, di 1,5 punti per anno oltre i 32.
  - Un infortunato perde la parte di stagione che salta (`gamesRemaining / 82`, al massimo il 70%).
  - Una prima scelta protetta "top N", con la protezione già messa o quella dello scambio (`t.protections`), vale `1 − 0,7 × P(cade nella fascia)` (`protectedShare`). P dipende da N e dalla posizione attesa, ed è più incerta per i draft lontani.
  - Uno swap vale, per chi ha il diritto, la differenza attesa tra le due scelte se l'altra è migliore, più il 15% della peggiore come opzione (`swapValue`). Chi lo concede perde lo stesso valore.
  - La luxury tax in più per il bot conta tra i costi (mezzo punto per milione), il risparmio tra i guadagni.
  - Il bot accetta solo con un guadagno netto di almeno 1 punto e di almeno il 10% di quanto cede, in valore assoluto (`tradeGainOk`). Le proposte dei bot, agli umani e tra bot, passano lo stesso controllo per la parte del bot.
  - Con i giocatori reali Paul George regalato (36 anni, 54 milioni) non lo prende più nessun bot (prima 16 su 29), uno swap regalato nessuno (prima 29 su 29). Gli scambi tra bot restano 5,3 a stagione.
- **Rimbalzo offensivo sui liberi:** dopo l'ultimo libero sbagliato, con il rimbalzo offensivo il possesso continua con 14 secondi, come dopo un tiro sbagliato. Nei falli sistematici del finale chi è sotto fa di nuovo fallo.
- **Firme automatiche al minimo** (bot e `fillRosterAtMinimum`):
  - Solo svincolati sani che chiedono al massimo il 20% sopra il minimo (`minimumSigningPool`), con la richiesta dell'ultimo turno di free agency. Chi chiede di più va preso sul mercato.
  - Se non c'è nessuno così, si firma quello che chiede meno rispetto al suo minimo.

Robustezza e piano Free di Supabase.

- **Turni bloccati in chiusura:**
  - Ogni simulazione conta un tentativo (`rounds.attempts`) e l'Edge Function salva l'errore (`record_round_error`, solo server).
  - La ripresa automatica dopo 5 minuti non parte con la lega in pausa.
  - Dopo 3 tentativi falliti il turno si ferma (`rounds.failed_at`): la pagina della lega lo mostra a tutti, l'errore solo al commissario (`round_error`).
  - Il commissario lo riapre (`reopen_round`), con lo stesso seed o con uno nuovo. Il turno torna aperto con i Pronto da rifare, senza avanzamento forzato e con la scadenza, se c'è, contata da adesso.
  - Nulla resta a metà: apply_turn scrive tutto o niente e accetta solo turni in chiusura, quindi una simulazione arrivata dopo la riapertura non scrive.
- **Pulizia notturna** (`private.daily_cleanup`, job pg_cron `nbbgm-pulizia` alle 3:23 UTC):
  - lo storico di pg_cron (`cron.job_run_details`) tiene gli ultimi 3 giorni;
  - la cronaca delle partite (`games.play_by_play`) resta per la stagione in corso e per quella prima; nelle più vecchie diventa null, mentre punteggi, parziali e box score restano.
- **Leghe per utente:** al massimo 5 create (trigger su `leagues`; `MAX_LEAGUES_PER_USER` in `_shared/league.ts`). Per crearne un'altra se ne elimina una.
- **Eliminare la lega:** solo il commissario, ripetendo il nome (`delete_league`), e non durante una simulazione. Spariscono tutte le righe della lega (on delete cascade).
- **Membri e squadre:** in una lega chi è membro guida una squadra, e viceversa.
  - Il commissario libera la squadra di un manager (`free_team`): torna al bot, il manager esce dalla lega e può rientrare con il codice invito.
  - Oppure lo espelle (`expel_manager`): come sopra, ma non può più rientrare (`league_bans`, letta solo dal server).
  - Un manager che non è il commissario lascia la lega (`leave_league`). Il commissario non libera la propria squadra e non lascia la lega: la elimina.
  - Nessuna di queste azioni durante una simulazione.
- **Squadra liberata:**
  - Si chiudono il Pronto del turno, la delega all'allenatore e i preferiti del draft.
  - Gli avvisi aperti scadono; offerte agli svincolati, tagli e rinnovi richiesti si ritirano.
  - Le proposte di scambio in sospeso o già accettate si ritirano, e scade l'avviso dell'altra squadra.
  - Quintetto e tattiche salvati restano: il bot gioca con le sue scelte e con le tattiche salvate.
  - Se dopo l'uscita i rimasti sono tutti pronti, il turno parte.
- **Account cancellato:** le leghe del commissario passano al membro entrato per primo, o spariscono se non c'è nessun altro; le sue squadre tornano al bot come sopra. Prima `leagues.commissioner_id` bloccava la cancellazione.
- **Service worker:**
  - chiede la pagina senza cache HTTP;
  - salva come pagina dell'app solo l'`index.html` vero, riconosciuto da `<meta name="application-name" content="NBBGM">`;
  - all'installazione scarica i file senza cache HTTP;
  - la versione cambia anche con i file di `public/`.
- **Aggiornamenti e errori nell'app:** l'app cerca aggiornamenti al ritorno in primo piano e ogni ora, e mostra "Nuova versione" con Ricarica. Un errore nel disegno di una pagina mostra un messaggio con Ricarica (`ErrorBoundary`), non più lo schermo bianco.
- **Pubblicazione dopo i controlli:** `pages.yml` e `supabase.yml` partono con `workflow_run` solo dopo i Controlli riusciti su un push a `main`, sullo stesso commit. Supabase pubblica a ogni push: migrazioni già applicate e funzioni uguali non cambiano nulla.
- **create-league:** dalla Fase 7 aveva una variabile dichiarata due volte, che impedisce alla funzione di partire. Ora un test controlla che ogni Edge Function, tolti i tipi, sia JavaScript valido (`scripts/test/functions.test.ts`).

## Visione

Un manageriale di basket a turni sincronizzati: ogni utente è presidente e direttore generale di una squadra NBA, e la lega avanza di un turno solo quando tutti hanno confermato le proprie scelte o hanno affidato la squadra all'allenatore. La prima versione ruota attorno a quattro cose: un motore partita credibile, la gestione del roster, un mercato con regole salariali NBA semplificate e una lega che dura più stagioni.

- **Nome:** NBBGM.
- **Formato:** web app installabile (PWA), usabile da telefono e da computer.
- **Lega:** le 30 squadre NBA, divise in 2 conference e 6 division. Le squadre senza manager umano sono guidate da un bot. Un utente può partecipare a più leghe, con una squadra per lega.
- **Stagione:** 82 partite di regular season, una per turno, poi play-in e playoff NBA. La lega continua per più stagioni, con un'offseason tra l'una e l'altra.
- **Regole:** NBA, 4 quarti da 12 minuti, supplementari da 5, cronometro dei 24 secondi, 6 falli personali per l'espulsione.
- **Giocatori:** i 525 giocatori reali delle 30 squadre (roster al 4 novembre 2026), con i nomi veri di giocatori e squadre, caricati dal file Excel dei giocatori. Il gioco è pensato per uso privato tra amici: con nomi e marchi veri non va pubblicato apertamente. I rookie delle stagioni successive possono essere reali (da file) o generati.
- **Ritmo:** un turno può durare pochi minuti (amici online insieme) o giorni (lega lenta): avanza quando tutti sono pronti. Una stagione conta circa 110–120 turni.

## Ciclo di gioco

Il turno si chiude quando tutti i manager umani sono pronti (o hanno affidato la squadra all'allenatore). Non c'è una scadenza predefinita: il commissario può impostarne una per la lega, se vuole, e può sempre forzare l'avanzamento perché un giocatore assente non blocchi tutti. Chi non conferma gioca con le ultime impostazioni salvate (o con quelle del bot, se non ne ha mai salvate). Se le impostazioni salvate non sono più valide, per esempio per un giocatore ceduto, tagliato o infortunato, il bot corregge solo gli slot mancanti.

Ogni turno attraversa quattro stati:

- **Aperto** — i manager sistemano quintetto, minutaggi e tattiche, fanno offerte agli svincolati e propongono scambi. Tutto è modificabile.
- **In chiusura** — si attiva quando l'ultimo manager è pronto, quando il commissario forza l'avanzamento o, se impostata, alla scadenza. Nessuna modifica accettata.
- **Simulazione** — il server, in quest'ordine: esegue scambi accettati, tagli, rinnovi e firme di mercato; gioca le partite del turno; aggiorna classifica, energia, morale, infortuni e bilancio.
- **Risultati** — si apre subito il turno successivo; i manager vedono punteggi, box score e cronaca.

Ciclo di un turno: Aperto → In chiusura (ultimo Pronto, avanzamento forzato o scadenza se impostata) → Simulazione (mercato, partite, aggiornamenti) → Risultati → si apre il turno successivo.

### Tipi di turno

| Fase           | Turni     | Cosa si gioca                                                                |
| -------------- | --------- | ---------------------------------------------------------------------------- |
| Regular season | 82        | una partita per ogni squadra a turno (15 partite)                            |
| Play-in        | 2         | 7ª–8ª e 9ª–10ª di ogni conference, poi lo spareggio per l'ottavo posto       |
| Playoff        | fino a 28 | una partita per ogni serie ancora aperta; chi ha già chiuso la serie aspetta |
| Offseason      | circa 7   | draft, rinnovi, free agency e preparazione (vedi Stagioni e offseason)       |

### Allenatore delegato

Un manager può affidare la squadra all'allenatore per un periodo a sua scelta: fino a un turno preciso, fino a una data, fino alla fine della fase in corso o finché non la riprende.

- L'allenatore gestisce quintetto, minuti e tattiche con la stessa logica del pulsante Auto, partendo dalle tattiche impostate dal manager.
- La squadra risulta pronta in automatico a ogni turno. Se tutti i manager umani hanno l'allenatore attivo, la lega avanza da sola un turno dopo l'altro, al ritmo massimo scelto dal commissario (es. un turno al minuto).
- L'allenatore non fa mercato. Quando arriva un avviso bloccante, la squadra smette di essere pronta in automatico finché il manager non risponde.
- **Avvisi bloccanti:** offerta di scambio ricevuta, contratto in scadenza da decidere, rosa sotto il minimo, scelta al draft, turni dell'offseason che chiedono decisioni (rinnovi, free agency).
- **Avvisi informativi** (non fermano l'allenatore): infortuni, risultati, offerte agli svincolati vinte o perse.
- Se il turno si chiude senza una risposta (alla scadenza, se c'è, o perché il commissario forza l'avanzamento), decide l'allenatore con la logica del bot; le offerte di scambio ricevute invece vengono rifiutate.
- Nella prima versione l'allenatore è gratuito e senza abilità; allenatori con caratteristiche e stipendio sono uno sviluppo futuro.

### Commissario e manager inattivi

- Il commissario (chi crea la lega) può impostare una scadenza dei turni (es. 15 minuti, 12 ore, 24 ore; di default nessuna) e sceglie il ritmo massimo con gli allenatori attivi; può forzare l'avanzamento, mettere in pausa, liberare una squadra (che torna al bot) ed espellere un manager.
- Per ora non c'è un pilota automatico: chi non gioca continua con le ultime impostazioni salvate (il bot corregge solo gli slot mancanti) e non fa mercato. Le decisioni non prese prima che il turno si chiuda non vengono prese: un rinnovo non fatto lascia andare il giocatore, un'offerta non fatta non c'è. Se la rosa scende sotto 13, il server firma al minimo gli svincolati migliori per i ruoli scoperti. Il commissario può sempre liberare la squadra a mano.
- Un nuovo utente può entrare anche a stagione iniziata, prendendo una squadra guidata da un bot.
- Gli altri vedono chi è già pronto o ha l'allenatore attivo, in tempo reale, ma non le sue scelte.
- Togliere il “Pronto” è possibile finché il turno non entra in chiusura.

## Giocatori e attributi

I giocatori arrivano dal file `NBA_2026-27_valutazioni_v2.xlsx`: la base di `NBA_2026-27_valutazioni_revisionate.xlsx` con la revisione sulle statistiche 2025-26 (vedi sotto). Sono 527 giocatori, 525 nelle 30 squadre (roster al 4 novembre 2026) e 2 svincolati, con 70 campi ciascuno. I campi numerici vanno da 0 a 100 e sono di tre tipi: le **abilità** dicono quanto un giocatore è bravo in una cosa, le **tendenze** quanto spesso sceglie una giocata, i **valori nascosti** governano crescita, costanza, infortuni e carattere. Il motore usa solo questi numeri, più ruolo, fisico, energia, morale e stato fisico.

| Gruppo                   | Campi                                                                                                                                                                                                             | Cosa influenzano nel motore                                                                           |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Conclusioni (8)          | Tiro ravvicinato, Layup, Schiacciata in penetrazione, Schiacciata da fermo, Gioco in post, Gancio, Fadeaway in post, Subire falli                                                                                 | Riuscita dei tiri vicino a canestro e in post; falli subiti                                           |
| Tiro (4)                 | Media distanza, Tiro da 3, Tiro dal palleggio, Tiri liberi                                                                                                                                                        | Riuscita dei tiri da fuori, su ricezione e dal palleggio; liberi                                      |
| Gioco (5)                | Palleggio, Velocità con palla, Precisione nei passaggi, Visione di gioco, Mani                                                                                                                                    | Palle perse, assist, penetrazioni, ricezione                                                          |
| Difesa (6)               | Difesa sul perimetro, Difesa interna, Rubate, Stoppate, Difesa d'aiuto, Lettura delle linee di passaggio                                                                                                          | Percentuali concesse, aiuti sulle penetrazioni, recuperi, stoppate                                    |
| Rimbalzi (2)             | Rimbalzo offensivo, Rimbalzo difensivo                                                                                                                                                                            | Sfida a rimbalzo                                                                                      |
| Fisico atletico (6)      | Velocità, Agilità, Forza, Elevazione, Resistenza, Grinta                                                                                                                                                          | Penetrazioni e contropiede, post e rimbalzi, schiacciate e stoppate, calo di energia, palloni vaganti |
| Mentale (4)              | QI offensivo, QI difensivo, Freddezza, Leadership                                                                                                                                                                 | Scelta del tiro, aiuti e falli evitabili, finali punto a punto, morale della squadra                  |
| Tendenze in attacco (10) | Tiro da 3, Tiro dalla media, Penetrazione, Gioco in post, Isolamento, Pick and roll da palleggiatore, Taglio senza palla, Schiacciata invece del layup, Tiro dal palleggio invece del passaggio, Cercare il fallo | Quale giocata sceglie il giocatore e quanto spesso                                                    |
| Tendenze in difesa (4)   | Tentare la rubata, Tentare la stoppata, Contestare il tiro, Fallo duro per evitare il canestro                                                                                                                    | Rischio difensivo: più recuperi e stoppate, ma più falli e canestri concessi                          |
| Valori nascosti (10)     | Potenziale, Etica del lavoro, Costanza offensiva, Costanza difensiva, Durabilità di schiena, ginocchia, caviglie, piedi e spalle, Carattere                                                                       | Crescita, forma partita per partita, infortuni per distretto, morale                                  |

**Dati di scheda:** nome, nazionalità, età, altezza, apertura alare (stimata), peso, ruolo principale e secondario tra PG, SG, SF, PF e C, mano dominante, archetipo (14 tipi, es. Regista, Protettore del ferro), contratto, energia (0–100, cala giocando e risale a riposo), morale (0–100), stato fisico. Altezza e apertura alare entrano nel motore per rimbalzi, stoppate e contestazioni; mano dominante e archetipo servono alla cronaca, ai bot e al generatore.

I **valori nascosti** non escono mai dal server: il manager vede solo stime (es. potenziale “alto”, “a rischio ginocchia”), più precise per i giocatori della propria squadra.

L'overall è una media pesata per ruolo (per un playmaker contano di più palleggio, passaggi, visione e tiro dal palleggio; per un centro conclusioni vicino a canestro, rimbalzi, difesa interna e stoppate), riportata su una scala con poche stelle (80+), un nucleo di titolari (65–79) e molte riserve. Serve come riassunto per il manager e per i bot; il motore usa i campi singoli. Il Potenziale del file va letto sulla stessa scala dell'overall, come tetto di crescita.

### File dati dei giocatori

Lo script di import legge direttamente il foglio GIOCATORI dell'Excel (gruppi alla riga 1, nomi dei campi alla riga 2): non serve esportarlo in CSV. Le note delle celle, con fonti e criteri delle stime, restano nel file e non vengono importate. Lo stesso formato serve per le classi di draft reali delle stagioni successive.

I contratti stanno in un secondo file, `NBA_2026-27_contratti.xlsx`, collegato al primo per squadra, nome e cognome:

- **CONTRATTI:** per ognuno dei 527 giocatori tipo di contratto (standard, rookie stimato, two-way, 10 giorni, svincolato), anni nella lega, stipendio di ogni stagione dal 2026-27 al 2031-32, opzioni del giocatore o della squadra e importo garantito.
- **PARAMETRI:** cap, soglia della tassa, apron e monte stipendi minimo 2026-27.
- **TAGLIATI:** gli stipendi residui a carico delle squadre che hanno tagliato un giocatore, emersi dalle verifiche.
- **RIEPILOGO_SQUADRE:** contratti standard, two-way, monte stipendi (residui compresi), spazio sotto il cap e distanza dalla tassa di ogni squadra, calcolati con formule.
- **DA_VERIFICARE:** i casi dubbi con l'esito della verifica.

Stipendi, anni e opzioni vengono dalla tabella dei contratti di Basketball-Reference; anni nella lega e two-way dalle pagine roster 2026-27 delle 30 squadre; i casi dubbi sono stati verificati sulle transazioni 2026-27. Tutto è stato letto il 4 novembre 2026. La NBA non pubblica gli stipendi dei singoli giocatori: le cifre sono quelle riportate dalla stampa. Copertura: 430 contratti standard o da rookie con stipendio, 89 two-way, 1 di 10 giorni, 1 al minimo non garantito, 2 svincolati, 4 senza contratto noto. Il monte stipendi 2026-27, residui compresi, va da 134 a 224 milioni di $ per squadra: 14 squadre sono sopra la luxury tax e Memphis è sotto il monte stipendi minimo. Restano da definire i contratti al minimo (si distinguono una volta caricate le tabelle dei minimi) e i residui dei giocatori tagliati prima della stagione, che il file contiene solo in parte.

Il resto lo ricava lo script: un id stabile da nome e cognome (oggi non ci sono omonimi), e sigla, conference e division delle 30 squadre da una tabella fissa.

- Lo script rifiuta il file se un valore è fuori da 0–100 o se un ruolo non è valido. Segnala le squadre con più di 15 contratti standard o più di 3 two-way (prima della prima giornata si taglia come in offseason) e quelle sopra la luxury tax.
- Produce anche un **report di qualità**: per ogni campo minimo, massimo, media e dispersione, la quota di valori neutri, quanto le tendenze ricalcano le abilità e un confronto con il prezzo Dunkest come controllo di buon senso.
- Il file dati non va nel repo (che per GitHub Pages gratuito è pubblico): lo script lo importa direttamente in Supabase.

### Stato del file dati e revisione (4 novembre 2026)

La prima analisi del file aveva trovato dati completi e puliti (nessun valore mancante o fuori scala, nessun omonimo, valori coerenti con il ruolo), ma con cinque problemi: poca differenza tra giocatori dello stesso ruolo, campi quasi piatti, difesa poco individuale, tendenze che ricalcavano le abilità, valori nascosti quasi tutti neutri. La revisione automatica li ha affrontati con le statistiche 2025-26 di Basketball-Reference; il metodo completo è nel foglio REVISIONE_NBBGM del file v2.

| Misura                                                             | Prima | Dopo  |
| ------------------------------------------------------------------ | ----- | ----- |
| Dispersione media delle abilità dentro il ruolo                    | 4,3   | 6,3   |
| Correlazione Tiri liberi / TL% reale                               | 0,45  | 0,65  |
| Correlazione Difesa sul perimetro / plus-minus difensivo (esterni) | 0,26  | 0,57  |
| Correlazione Stoppate / BLK% reale                                 | 0,66  | 0,74  |
| Correlazione tendenza Tiro da 3 / quota reale di tiri da 3         | 0,50  | 0,72  |
| Correlazione abilità / tendenza Tiro da 3 (dentro il ruolo)        | 0,50  | 0,35  |
| Durabilità ancora al valore neutro 80                              | 2.486 | 1.681 |

- **Cosa è cambiato:** 21.686 valori, in media di 3 punti; i valori cambiati hanno il testo arancione e il foglio MODIFICHE dice prima, dopo e motivo di ognuno. I fuoriclasse restano in cima (Curry 99 nel tiro da 3, Jokic 98 in visione di gioco).
- **Rose aggiornate:** AK Okereke (tagliato dai Lakers) e Dylan Cardwell sono svincolati; sono stati aggiunti 7 giocatori presenti nei roster ma assenti dal file (Ajayi, Diop, Tomlin, Batum, Nick Smith Jr., Freeman, Hayes), con valori provvisori presi dalla mediana del ruolo e corretti con le statistiche dove ci sono.
- **Da rivedere a mano:** il foglio DA_RIVEDERE elenca circa 500 variazioni di almeno 10 punti, i giocatori aggiunti e gli svincolati. Restano scelte tue Leadership, Freddezza, Etica del lavoro, Carattere, Potenziale, costanze, mano dominante e archetipo.
- **Non coperti dalle statistiche:** rookie e giocatori sotto i 300 minuti nel 2025-26 (132) cambiano solo per l'allargamento delle scale; Contestare il tiro, Gioco in post (abilità), Fadeaway, Schiacciata da fermo e Layup non hanno una statistica adatta.
- **Rose ancora fuori misura:** Clippers (17 standard) e Lakers (16) superano i 15 contratti standard anche nei roster di Basketball-Reference; all'import scatta il taglio di inizio stagione.
- **La media semplice non è un overall:** con la media di tutte le abilità Gilgeous-Alexander risulta solo decimo, perché la media penalizza le guardie su post e stoppate. Serve l'overall pesato per ruolo.

### Generatore

Il generatore serve per le classi di draft generate, per completare una lega se il file non basta e per i test. Usa i 14 archetipi del file come modelli: per ogni archetipo ricava dai giocatori reali medie e correlazioni dei campi, così i giocatori generati somigliano a quelli veri (un 2,10 m avrà raramente un palleggio alto). La lega generata ha poche stelle, un nucleo di titolari e molte riserve; i rookie partono più bassi, ma con un potenziale più alto e più incerto.

## Stagioni e offseason

### Calendario

- 82 partite: 4 contro ciascuna delle altre 4 squadre della division (16), 4 contro 6 squadre della stessa conference e 3 contro le altre 4 (36), 2 contro ognuna delle 15 squadre dell'altra conference (30). 41 in casa e 41 in trasferta.
- A ogni turno ogni squadra gioca esattamente una partita. Il calendario si genera a inizio stagione con un seed, con una ricerca che riparte finché tutti i vincoli tornano; si evita la stessa sfida in due turni consecutivi.
- Quali squadre della conference si affrontano 4 volte e quali 3 ruota di stagione in stagione.
- Classifica per percentuale di vittorie; a parità contano gli scontri diretti, poi la differenza punti, poi un sorteggio con seed.

### Play-in e playoff

- Le prime 6 di ogni conference vanno direttamente ai playoff.
- **Play-in**, partite secche in casa della meglio classificata: la vincente di 7ª contro 8ª è settima; la perdente di 9ª contro 10ª è eliminata; la perdente di 7–8 sfida la vincente di 9–10 per l'ottavo posto.
- **Playoff** a 16 squadre, 8 per conference, con tabellone fisso (1–8, 4–5, 3–6, 2–7). Quattro turni di serie al meglio di 7, con fattore campo 2-2-1-1-1 per la meglio classificata. Finale tra le vincenti delle due conference.

### Offseason

Dopo la finale l'offseason procede in questi passi; quelli che chiedono decisioni sono turni come gli altri, che si chiudono quando tutti sono pronti.

1. **Fine stagione** (automatico) — crescita e calo degli attributi, un anno di età in più, ritiri, contratti che scalano di un anno.
2. **Lottery** (automatica) — le 14 squadre fuori dai playoff, eliminate al play-in comprese, con le probabilità NBA per la prima scelta: 14%, 14%, 14%, 12,5%, 10,5%, 9%, 7,5%, 6%, 4,5%, 3%, 2%, 1,5%, 1%, 0,5%. Si estraggono le prime 4 scelte; le altre seguono l'ordine inverso di classifica.
3. **Draft** — 2 giri, 60 scelte, in modalità lista o dal vivo come il draft iniziale. Prima di ogni draft il commissario sceglie se la classe è generata o reale (da file). Le scelte del primo giro firmano 4 anni a stipendio fisso per posizione (scala rookie), quelle del secondo 2 anni al minimo.
4. **Rinnovi** — ultimo turno per rinnovare i propri giocatori in scadenza; chi non viene rinnovato diventa svincolato.
5. **Free agency** — 4 turni di offerte a busta chiusa; a ogni turno ogni svincolato sceglie l'offerta migliore oppure aspetta, e le sue richieste scendono turno dopo turno.
6. **Preparazione** — rose da riportare a 13–15 giocatori, quintetti e tattiche; cap e soglie si aggiornano alla nuova stagione. Poi riparte la regular season.

In offseason la rosa può salire fino a 21 giocatori, two-way compresi, come nella NBA. Se all'inizio della stagione una squadra ha ancora più di 15 contratti standard o più di 3 two-way, il server taglia i giocatori con l'overall più basso.

### Crescita e calo

- A fine stagione ogni attributo cambia in base a età e potenziale: crescita fino a circa 27 anni (più rapida da giovani e per chi è lontano dal suo potenziale), stabilità fino a circa 30, calo dopo i 31, più marcato sugli attributi fisici. Con Etica del lavoro alta la crescita è più rapida e il calo più lento.
- Una componente casuale con seed evita che la crescita sia prevedibile.
- I giocatori sopra i 34 anni, o con overall basso e senza contratto, possono ritirarsi.
- Gli allenamenti scelti dal manager sono uno sviluppo futuro.

## Gestione roster

I giocatori arrivano alle squadre in cinque modi — rose iniziali, draft annuale, svincolati, scambi e rinnovi — e ogni movimento si esegue solo al passaggio di turno, così nessuno è avvantaggiato dall'essere online prima degli altri.

### Vincoli del roster

| Regola                | Valore proposto                                                                                                           |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Giocatori in rosa     | in stagione da 13 a 15 con contratto standard, più fino a 3 two-way; in offseason fino a 21 in tutto                      |
| A referto per partita | 13; gli infortunati non possono andare a referto, i two-way al massimo per 50 partite di regular season e mai nei playoff |
| Contratti             | da 1 a 5 anni, con lo stipendio di ogni anno; minimi e massimi NBA per anzianità (massimi al 25, 30 o 35% del cap)        |
| Ricavi                | uguali per tutte le squadre, a ogni stagione                                                                              |

### Valori economici di partenza (NBA 2026-27)

La lega parte dai valori ufficiali NBA della stagione 2026-27 (comunicato NBA del 30 giugno 2026) e dagli stipendi ufficiali dei giocatori. Dalla stagione successiva i valori crescono di una percentuale configurabile (proposta +7%, simile all'aumento del 2026-27).

| Valore                         | 2026-27                                                                                    |
| ------------------------------ | ------------------------------------------------------------------------------------------ |
| Salary cap                     | 164,961 milioni di $                                                                       |
| Soglia della luxury tax        | 200,428 milioni di $                                                                       |
| Monte stipendi minimo          | 148,465 milioni di $                                                                       |
| Primo e secondo apron          | 209,015 e 221,686 milioni di $ (salvati, non usati nella prima versione)                   |
| Mid-level exception            | 15,044 / 6,064 / 9,366 milioni di $ (salvate, non usate nella prima versione)              |
| Stipendio massimo              | 25%, 30% o 35% del cap secondo gli anni nella lega (41,240 / 49,488 / 57,736 milioni di $) |
| Stipendi minimi e scala rookie | tabelle NBA ufficiali per anzianità e posizione al draft, in un file di configurazione     |

### Regole salariali (NBA semplificato)

- Sotto il cap si firma qualunque svincolato fino a esaurire lo spazio salariale; sopra il cap si firmano svincolati solo al minimo.
- **Two-way:** fino a 3 per squadra, con stipendio fisso pari a metà del minimo per i rookie, fuori dal cap e dal calcolo della tassa; al massimo 50 partite a referto in regular season, mai nei playoff.
- **Monte stipendi minimo:** chi a fine regular season è sotto il minimo paga la differenza, come nella NBA.
- **Luxury tax:** aliquote NBA a scaglioni sopra la soglia: 1,50 $ per ogni dollaro nei primi 5 milioni, 1,75 da 5 a 10, 2,50 da 10 a 15, 3,25 da 15 a 20, poi +0,50 ogni 5 milioni. Chi l'ha pagata in 3 delle 4 stagioni precedenti paga le aliquote maggiorate (2,50, 2,75, 3,50, 4,25, poi +0,50).
- I propri giocatori si possono sempre rinnovare, anche sopra il cap (versione semplice dei Bird rights).
- Negli scambi non ci sono regole di bilanciamento degli stipendi: contano solo i limiti di rosa e di bilancio.
- Niente apron, mid-level exception e altre eccezioni: sono uno sviluppo futuro.
- La luxury tax si calcola sul monte stipendi alla fine della regular season.

### Bilancio

- Ogni squadra incassa a ogni stagione la stessa cifra, accreditata giornata per giornata sulle 82 di regular season; gli stipendi si pagano allo stesso modo, la tassa a fine regular season. Il saldo passa alla stagione successiva.
- I ricavi sono 170 milioni di $ nel 2026-27, poco sopra il cap: chi resta vicino al cap accumula poco, chi spende fino alla soglia della tassa va in perdita, chi la supera perde molto.
- Con saldo negativo non si firmano svincolati, salvo quelli al minimo necessari per restare a 13, e non si fanno scambi che aumentano il monte stipendi. I rinnovi restano possibili.
- Biglietti, sponsor, palazzetto e ricavi diversi per città sono uno sviluppo futuro.

### Assegnazione dei giocatori

- **Rose iniziali** — il commissario sceglie la modalità alla creazione della lega:
  - **Rose reali:** ogni squadra parte con la rosa del file e ogni manager sceglie quale squadra guidare.
  - **Draft di tutti i giocatori:** a serpentina (1→30, poi 30→1) con ordine sorteggiato, circa 13 giri, quindi circa 390 scelte. In modalità lista ogni manager ordina i preferiti e il server esegue il draft in pochi secondi; dal vivo c'è un timer per scelta (es. 30–60 secondi) e il commissario può passare alla modalità lista in qualsiasi momento. Chi non sceglie in tempo riceve il primo disponibile della sua lista o, senza lista, il migliore per il ruolo più scoperto. I giocatori tengono il contratto del file: il draft non controlla il cap, ma le scelte costose pesano sul bilancio.
- **Draft annuale** — vedi Offseason.
- **Svincolati** — offerte a busta chiusa (stipendio e anni), in stagione a ogni turno e nell'offseason nei turni di free agency. Ogni svincolato ha una richiesta minima che dipende dal suo valore e scende con il passare dei turni. Tra le offerte sopra la richiesta sceglie quella con il punteggio più alto (vedi sotto); a parità vince la squadra peggio classificata.
- **Rinnovi** — un giocatore all'ultimo anno di contratto mostra una richiesta (stipendio e anni) che dipende da valore, età e morale. Il manager la può accettare in qualsiasi momento della stagione o nel turno dei rinnovi dell'offseason; altrimenti il giocatore diventa svincolato. Con morale sotto 30 il giocatore rifiuta di rinnovare.
- **Scambi** — proposta tra due squadre che può comprendere giocatori e scelte al draft, valida se entrambe restano nei limiti di rosa e di bilancio. Se accettata, si esegue alla chiusura del turno; se un giocatore compare in più scambi accettati nello stesso turno vale il primo accettato e gli altri decadono. Dopo la trade deadline (circa la 55ª giornata, 2/3 della regular season) gli scambi sono bloccati fino alla fine dei playoff.
- **Taglio** — un giocatore tagliato torna svincolato; lo stipendio residuo resta a carico della squadra, sul cap e sul bilancio, fino alla scadenza del contratto, per intero come nella NBA.

Punteggio di un'offerta per uno svincolato (pesi da calibrare):

```
punteggio = 0,55 × soldi + 0,25 × minuti attesi + 0,20 × forza della squadra
```

- **Soldi:** stipendio annuo rispetto alla richiesta; dopo i 30 anni conta di più la durata del contratto.
- **Minuti attesi:** il posto che il giocatore avrebbe nella rotazione del suo ruolo.
- **Forza della squadra:** classifica attuale e overall dei primi 8 giocatori.

### Scelte al draft

- Si scambiano le scelte di primo e secondo giro delle prossime 7 stagioni, come nella NBA.
- **Regola Stepien:** una squadra non può restare senza prima scelta in due draft futuri consecutivi.
- La posizione di una scelta ceduta dipende dalla classifica e dalla lottery della squadra d'origine; la usa chi la possiede al momento del draft.
- **Protezioni:** una prima scelta si può cedere protetta (“top N”, con N da 1 a 20). Se dopo la lottery cade nella fascia protetta resta alla squadra d'origine e l'obbligo passa al draft successivo con la stessa protezione; dopo tre rinvii si trasforma nella seconda scelta di quell'anno. Ai fini della regola Stepien una scelta protetta conta come ceduta.
- **Swap:** il diritto di scambiare la propria scelta con quella di un'altra squadra in un certo draft e giro. Dopo la lottery chi ha il diritto prende la migliore delle due; gli swap non hanno protezioni.
- Per i bot una scelta protetta vale meno di una libera, uno swap vale la differenza attesa tra le due scelte.

### Bot

Le squadre senza manager usano questa logica:

- **Formazione** — quintetto e minuti in base a overall, ruolo, energia e infortuni. È anche la logica del pulsante Auto e dell'allenatore.
- **Draft** — il migliore disponibile, pesando il ruolo più scoperto e, per i rookie, il potenziale stimato.
- **Rinnovi** — rinnova se il giocatore vale la richiesta e il bilancio lo permette.
- **Svincolati** — firma per coprire i ruoli scoperti e restare almeno a 13, nei limiti di cap e bilancio.
- **Strategia** — ogni bot è in corsa, a metà strada o in ricostruzione, in base a classifica, età della rosa e monte stipendi. La strategia cambia il valore che dà a veterani, giovani e scelte.
- **Scambi** — ogni giocatore e ogni scelta ha un valore di mercato (per i giocatori overall, età, potenziale stimato e contratto; per le scelte posizione attesa e distanza nel tempo), corretto dalla strategia. Il bot accetta solo se riceve almeno il 10% in più di quanto cede (margine configurabile).
- **Scambi con gli umani** — ogni tanto il bot ne propone uno, al massimo uno ogni qualche turno per squadra.
- **Scambi tra bot** — un bot in corsa cede giovani e scelte per un veterano, uno in ricostruzione fa il contrario; lo scambio si fa solo se conviene a entrambi secondo la propria strategia. Per non stravolgere la lega, al massimo uno scambio tra bot per turno e nessuno dopo la trade deadline; ogni scambio compare nello storico della lega.
- I bot vedono solo le stime che vede anche un umano, non i valori nascosti: altrimenti dal loro comportamento si potrebbe indovinare il potenziale vero.

### Schermata roster

- **Quintetto:** 5 titolari, uno per slot di ruolo, con avviso e penalità se un giocatore gioca fuori ruolo.
- **Rotazione:** minuti obiettivo per ogni giocatore; la somma deve fare 240 (5 × 48). Il motore li rispetta compatibilmente con falli, energia e infortuni.
- **Tattiche di squadra:** ritmo (lento, normale, veloce), focus offensivo (perimetro, equilibrato, interno), difesa (a uomo, a zona), intensità difensiva (bassa, media, alta: più recuperi ma più falli e fatica).
- **Pulsante “Auto”:** il bot propone quintetto e minuti, modificabili a mano.
- **Pulsante “Affida all'allenatore”**, con la durata della delega.
- **Scheda giocatore:** attributi, stime di potenziale e costanza, contratto, energia, morale, infortuni, statistiche.

## Motore partita

Il motore simula la partita possesso per possesso: è abbastanza dettagliato da produrre box score e cronaca credibili, ma resta una funzione pura e veloce che gira sul server. Obiettivo: meno di 30 ms a partita, perché un turno ne gioca 15 dentro una Edge Function.

### Input e output

- **Input:** le due squadre (giocatori con abilità, tendenze, valori nascosti, ruoli, fisico, energia, morale e stato fisico), le impostazioni di ciascuna (quintetto, minuti, tattiche), il fattore campo e un seed casuale.
- **Output:** punteggio per quarto, box score per giocatore (minuti, punti, tiri da 2 e da 3, liberi, rimbalzi offensivi e difensivi, assist, rubate, stoppate, perse, falli, +/-), la cronaca azione per azione, l'energia finale di ogni giocatore e gli infortuni avvenuti in partita.
- Stesso input + stesso seed = stessa partita: serve per i test e per rigiocare una partita contestata.

### Un possesso

- **Durata:** estratta da una distribuzione con media di circa 14,5 secondi, più corta con ritmo veloce, in modo che escano circa 96–102 possessi per squadra. Un rimbalzo offensivo non apre un nuovo possesso: lo stesso continua con il cronometro a 14 secondi, come si contano i possessi nella NBA.
- **Contropiede:** dopo un recupero o un rimbalzo difensivo, soprattutto con ritmo veloce, una parte dei possessi è un contropiede: contano Velocità e Velocità con palla, e il tiro è quasi sempre vicino a canestro.
- **Palla persa?** Probabilità base circa 13%; aumenta con Palleggio, Mani, Precisione nei passaggi e QI offensivo bassi dell'attaccante, con Rubate, Lettura delle linee di passaggio e la tendenza Tentare la rubata dei difensori, e con intensità difensiva alta. Chi ruba è scelto in base a Rubate e Lettura delle linee di passaggio.
- **Fallo non sul tiro?** Piccola probabilità per possesso, più alta con intensità difensiva alta e con le tendenze Tentare la rubata e Fallo duro dei difensori; conta per il bonus di squadra.
- **Chi gioca e quale giocata?** Scelta pesata tra i 5 in campo e tra le giocate: tiro da 3, tiro dalla media, penetrazione, gioco in post, isolamento, pick and roll da palleggiatore, taglio senza palla. Pesano le tendenze del giocatore, il ruolo, il focus offensivo della squadra e la difesa avversaria (la zona sposta verso il tiro da fuori). Il QI offensivo corregge le scelte peggiori: un giocatore intelligente insiste meno dove rende poco.
- **Che tiro ne esce?** Dipende dalla giocata: su ricezione Tiro da 3 o Media distanza; dal palleggio Tiro dal palleggio (più spesso con la tendenza Tiro dal palleggio invece del passaggio); in penetrazione Layup, Tiro ravvicinato o Schiacciata in penetrazione (con la tendenza Schiacciata invece del layup ed Elevazione alta); in post Gioco in post, Gancio o Fadeaway, con la Forza; su tagli e pick and roll per il rollante Schiacciata da fermo o Tiro ravvicinato.
- **Fallo sul tiro?** Probabilità legata a Subire falli e alla tendenza Cercare il fallo dell'attaccante, e alla tendenza Fallo duro del difensore: 2 o 3 liberi (o canestro + 1), ognuno riuscito con probabilità legata a Tiri liberi.
- **Segna?** Probabilità calcolata come sotto. Se segna, c'è una probabilità di assist, alta su tagli, tiri su ricezione e pick and roll, bassa su isolamenti; il passatore è scelto tra i 4 compagni in base a Precisione nei passaggi e Visione di gioco.
- **Stoppata:** una parte degli errori vicino a canestro e in post è una stoppata, con probabilità legata a Stoppate, Elevazione, apertura alare e tendenza Tentare la stoppata del difensore o di chi aiuta; chi tenta tante stoppate fa anche più falli. La palla stoppata va a rimbalzo.
- **Rimbalzo:** se sbaglia, sfida tra Rimbalzo offensivo dei 5 attaccanti e Rimbalzo difensivo dei 5 difensori, con Forza, Elevazione, altezza e apertura alare; la Grinta aiuta sui palloni vaganti. I difensori partono avvantaggiati, circa 75% dei rimbalzi in difesa.

### Marcature e ruoli

- **A uomo:** ogni giocatore marca chi occupa lo stesso slot di ruolo; il difensore nella formula è il suo marcatore. Sulle penetrazioni può intervenire un aiuto (il lungo in campo con la Difesa d'aiuto migliore): rende il tiro più difficile o lo stoppa, ma lascia libero un compagno, quindi più scarichi e tiri aperti.
- **A zona:** non c'è un marcatore fisso. Per i tiri da fuori conta la media della Difesa sul perimetro degli esterni, per quelli vicino a canestro la Difesa interna dei lunghi; la zona protegge meglio l'area e concede più tiri da 3.
- **QI difensivo** migliora gli aiuti e riduce i falli evitabili; la tendenza **Contestare il tiro** aumenta il peso del difensore sul tiro.
- **Fuori ruolo:** ruolo principale e secondario senza penalità; con i ruoli in fila (PG, SG, SF, PF, C), un ruolo di distanza costa −3%, due ruoli −8%, tre o più −15% sulle abilità di gioco e di difesa (valori da calibrare).

### Probabilità di canestro

```
P(canestro) = P_base(tipo) + k × (A_tiro − D) / 100 + Δ_campo + Δ_finale
```

- **P base per tipo** (da calibrare): schiacciata 85%, layup e tiro ravvicinato 60%, post (gancio e fadeaway) 45%, media distanza su ricezione 42%, dal palleggio 39%, da 3 su ricezione 37%, da 3 dal palleggio 33%.
- **A tiro** = l'abilità di quella conclusione (Layup, Gancio, Tiro dal palleggio...). **D** = l'abilità difensiva del marcatore (Difesa sul perimetro per i tiri da fuori, Difesa interna vicino a canestro e in post), pesata con la sua tendenza Contestare il tiro, più l'eventuale aiuto.
- **k** ≈ 0,30 da calibrare; fattore campo circa +1,5 punti percentuali.
- **Δ finale:** negli ultimi 5 minuti con scarto entro 5 punti, la Freddezza sposta la probabilità fino a ±3 punti, anche ai tiri liberi.
- Fatica, morale e fuori ruolo non sono termini a parte: moltiplicano le abilità del giocatore prima della formula. Sotto 70 di energia il giocatore perde fino al 15% di efficacia; il morale vale da −3% (morale 0) a +3% (morale 100), zero a 50.
- Il risultato si limita fra 5% e 95%.
- **Forma del giorno:** la costanza non aggiunge rumore a ogni tiro. A inizio partita si estrae con il seed la forma di ogni giocatore, separata per attacco (Costanza offensiva) e difesa (Costanza difensiva): con costanza bassa la forma oscilla di più e sposta di qualche punto tutti i suoi tiri o tutta la sua difesa di quella partita.

### Energia, infortuni e morale

- **Energia in partita:** ogni minuto in campo scende (più in fretta con Resistenza bassa e intensità alta), in panchina risale.
- **Energia tra un turno e l'altro:** ogni giocatore recupera una parte dell'energia, di più con Resistenza alta, fino a 100. Chi gioca sempre tanti minuti arriva stanco, quindi la rotazione conta su tutta la stagione. Obiettivo di calibrazione: un titolare a 34–36 minuti si stabilizza sopra 85 a inizio gara, uno a 40 e più scende sotto 75.
- **Infortuni:** a ogni minuto in campo c'è una piccola probabilità, che sale con energia bassa ed età sopra i 30. Il distretto (schiena, ginocchia, caviglie, piedi, spalle) si sceglie in base alle durabilità: più è bassa, più quel distretto si infortuna e più l'infortunio tende a essere grave. Gravità leggera (1–3 partite), media (4–15) o grave (16–60), con probabilità decrescente. L'infortunato esce subito dalla partita e non va a referto finché non guarisce. Obiettivo indicativo: 2–4 infortuni medi o gravi per squadra a stagione.
- **Morale (0–100):** sale con le vittorie e con minuti pari o superiori alle attese per il suo ruolo in squadra, scende con le sconfitte e con pochi minuti. Il Carattere lo rende più stabile; la Leadership dei compagni attenua i cali dopo le sconfitte. Conta poco in campo (±3%) e di più su rinnovi e scelta degli svincolati.

### Cambi, falli, finale

- Il motore fa i cambi per avvicinarsi ai minuti obiettivo, togliendo prima chi è sotto 60 di energia o rischia di uscire per falli (es. 2 falli nel primo quarto, 4 nel terzo); al 6° fallo il giocatore esce, e chi si infortuna esce subito.
- Bonus NBA: dal 5° fallo di squadra nel quarto ogni fallo manda in lunetta; negli ultimi 2 minuti del quarto basta il 2° fallo di squadra di quel periodo.
- Negli ultimi 2 minuti con scarto sotto i 6 punti: chi è sotto fa falli sistematici e accelera; chi è sopra gestisce il cronometro.
- Parità a fine tempo: supplementari da 5 minuti fino a un vincitore.

### Calibrazione

Uno script simula 1.000 partite tra le squadre del file (o generate) e confronta le medie con i valori NBA recenti. Il motore si considera pronto quando tutti i valori rientrano negli intervalli, la squadra di casa vince circa il 55–58% delle volte e la squadra con overall più alto di 5 punti vince circa il 65–70%.

| Statistica (per squadra) | Intervallo                    |
| ------------------------ | ----------------------------- |
| Punti                    | 110–118                       |
| Possessi                 | 96–102                        |
| Tiri da 2                | 52–56%                        |
| Tiri da 3                | 35–37%, con 34–39 tentativi   |
| Tiri liberi              | 76–80%, con 20–24 tentativi   |
| Rimbalzi                 | 42–46, circa il 25% offensivi |
| Assist                   | 24–28                         |
| Rubate                   | 7–9                           |
| Stoppate                 | 4–6                           |
| Palle perse              | 13–15                         |

Un secondo script simula 10 stagioni complete (calendario, playoff, offseason, bot) e controlla che gli overall non si gonfino né si sgonfino nel tempo, che nessuna squadra bot domini per anni, che i bilanci dei bot non finiscano tutti in rosso e che energia e infortuni restino negli obiettivi.

## Architettura tecnica

Stesso stack di O-MEGA: frontend statico su GitHub Pages, Supabase per database, login, tempo reale e logica server. La regola d'oro: il client chiede, il server decide — partite, mercato e offseason si calcolano solo sul server.

### Stack

- **Frontend:** React + Vite + TypeScript, PWA installabile, Tailwind per lo stile. Su GitHub Pages il routing usa HashRouter (o il redirect da 404.html), perché Pages non gestisce le rotte di una single page app.
- **Motore e logica di lega:** pacchetto TypeScript separato (packages/engine), senza dipendenze: motore partita, calendario, playoff, lottery, crescita, contratti e bot. Lo usano le Edge Functions, i test e gli script di simulazione; va compilato in un modulo ESM importabile da Deno, su cui girano le Edge Functions.
- **Backend:** Supabase — Postgres, Auth, Realtime (chi è pronto, avvisi), Edge Functions (avanzamento turno, draft, offseason), pg_cron (controllo scadenze ogni minuto), pg_net (chiamate dal database alle Edge Functions).
- **Accesso:** Google oppure codice di 6 cifre via email. Niente link magico: su iPhone si apre in Safari e non nella PWA installata. Il login Google dentro la PWA installata su iPhone va verificato presto; se dà problemi resta il codice via email.
- **Repo e deploy:** GitHub, con GitHub Actions che pubblica il frontend su Pages e le funzioni su Supabase.

### Avanzamento del turno sul server

- Quando un manager preme Pronto, una funzione Postgres controlla se mancano altri umani; le squadre con allenatore attivo e senza avvisi bloccanti contano come pronte. Se è l'ultimo, chiama la Edge Function advance-turn tramite pg_net.
- pg_cron chiama la stessa funzione per i turni con una scadenza superata (nelle leghe che l'hanno impostata) e, quando tutte le squadre umane hanno l'allenatore, per far avanzare la lega al ritmo massimo scelto dal commissario.
- Per evitare doppie simulazioni, la funzione passa il turno da aperto a in_chiusura con un aggiornamento condizionato: solo la prima chiamata vince, le altre escono.
- La Edge Function legge lo stato, calcola partite e mercato con il pacchetto engine, poi passa tutto il risultato a una sola funzione Postgres (apply_turn) che scrive risultati, statistiche, mercato e bilanci e apre il turno successivo in un'unica transazione: o si salva tutto o niente. Le chiamate separate al database da una Edge Function non sarebbero una transazione unica.
- Se la scrittura fallisce, il turno resta in chiusura: un turno fermo in chiusura da più di 5 minuti viene ripreso da pg_cron, e il seed salvato garantisce lo stesso risultato.

### Modello dati essenziale

| Tabella                  | Contenuto                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| profiles                 | utente, nome visualizzato                                                                                                                                               |
| leagues                  | nome, codice invito, commissario, impostazioni (scadenza facoltativa, ritmo massimo, rose iniziali, modalità draft, rookie reali o generati), stagione e turno correnti |
| seasons                  | lega, anno, fase (regular season, play-in, playoff, offseason), cap, soglia della tassa, apron, monte stipendi minimo, ricavi                                           |
| teams                    | lega, proprietario (o bot), sigla, città, nome, conference, division, saldo, strategia del bot                                                                          |
| players                  | lega, dati di scheda, ruoli, archetipo, abilità e tendenze, energia, morale, squadra (o svincolato)                                                                     |
| player_hidden            | potenziale, etica del lavoro, costanza offensiva e difensiva, durabilità per distretto, carattere — nessun accesso dal client                                           |
| base_players, base_teams | i dati importati dal file, da cui si copiano le leghe nuove (solo server)                                                                                               |
| contracts                | giocatore, squadra, stipendio di ogni anno, tipo (standard, rookie, minimo, two-way), opzioni, tagliato                                                                 |
| injuries                 | giocatore, distretto, gravità, partite rimaste                                                                                                                          |
| team_settings            | quintetto, minuti, tattiche per squadra                                                                                                                                 |
| coach_delegations        | squadra, fino a quando, attiva                                                                                                                                          |
| alerts                   | squadra, tipo, bloccante, stato, scadenza                                                                                                                               |
| rounds                   | stagione, numero, tipo (regular season, play-in, playoff, offseason), stato, scadenza (se c'è), data di simulazione                                                     |
| ready_flags              | squadra pronta per il turno                                                                                                                                             |
| games                    | turno, casa, trasferta, punteggi, seed, tipo, serie, cronaca (JSON)                                                                                                     |
| playoff_series           | stagione, turno, squadre, vittorie                                                                                                                                      |
| player_game_stats        | una riga per giocatore per partita                                                                                                                                      |
| draft_lottery            | estrazione della lottery per stagione                                                                                                                                   |
| draft_picks              | squadra d'origine, proprietario attuale, stagione, giro, protezione, rinvii, posizione, giocatore scelto; anche le scelte future scambiabili                            |
| draft_swaps              | stagione, giro, squadra che ha il diritto, squadra che lo concede, esito                                                                                                |
| free_agent_bids          | offerte a busta chiusa                                                                                                                                                  |
| trade_offers             | proposte di scambio (giocatori e scelte) e stato                                                                                                                        |
| ledger                   | movimenti di bilancio: ricavi, stipendi, tassa, tagli                                                                                                                   |
| transactions             | storico di firme, scambi, tagli, rinnovi e ritiri                                                                                                                       |

### Sicurezza

- Row Level Security su ogni tabella: un utente legge le sue leghe e modifica solo la sua squadra in ciascuna.
- La RLS filtra righe, non colonne: per questo i valori nascosti stanno in player_hidden (e in base_players), senza nessuna policy di lettura. Il client vede solo le stime calcolate dal server.
- Le azioni di mercato passano da funzioni server che controllano rosa, cap, bilancio e trade deadline.
- I seed delle partite si generano solo al momento della simulazione.

## Piano per Claude Code

Si parte dai dati e dal motore, da soli e testati, perché sono la parte più difficile da sistemare dopo; poi la logica di stagione offline, poi database, poi interfaccia. Ogni fase si chiude solo quando i criteri di accettazione sono verificati: conviene dare a Claude Code una fase per sessione e fargli fare un commit alla fine di ognuna.

### Fasi

1. **Setup del progetto**
   - Monorepo pnpm: apps/web, packages/engine, supabase/, scripts/. TypeScript strict, Vitest, ESLint, Prettier.
   - File CLAUDE.md con il riassunto di questo documento (vedi sotto).
   - **Fatto quando:** pnpm test e pnpm build passano su un repo vuoto.
2. **Dati dei giocatori (packages/engine e scripts/)**
   - Tipi Player (i 70 campi del file), Team, Contract, DraftPick; tabella fissa delle 30 squadre; script di import dei due file Excel (giocatori e contratti) con validazione e report di qualità; RNG con seed; generatore basato sugli archetipi per giocatori, squadre e classi di draft.
   - **Fatto quando:** il file Excel si importa senza errori e produce il report di qualità, un file con errori viene rifiutato con messaggi chiari e il generatore produce una lega di 30 squadre valida.
3. **Motore partita (packages/engine)**
   - simulateGame(home, away, seed) come da sezione Motore partita: giocate scelte dalle tendenze, conclusioni specifiche, aiuti, box score, cronaca, forma del giorno, fuori ruolo, energia, morale, infortuni per distretto.
   - Script pnpm sim:calibrate che gioca 1.000 partite e stampa le medie.
   - **Fatto quando:** test verdi (stesso seed = stessa partita, minuti totali = 240 per squadra nei tempi regolamentari, punti = somma dei canestri, nessun infortunato in campo), medie dentro gli intervalli di calibrazione.
4. **Stagione offline (packages/engine)**
   - Calendario NBA da 82 partite, classifica e spareggi, play-in, playoff, lottery, draft con scelte scambiabili, protezioni e swap, crescita e ritiri, contratti e two-way, regole salariali e luxury tax a scaglioni, bilancio e bot (strategia, formazione, draft, rinnovi, svincolati, scambi con gli umani e tra bot).
   - Script pnpm sim:seasons che gioca 10 stagioni di fila.
   - **Fatto quando:** il calendario è valido (82 partite, 41 in casa, conteggi NBA, una partita per squadra a turno), lottery e playoff sono coperti da test e 10 stagioni girano senza errori con le metriche di lungo periodo negli obiettivi.
5. **Database Supabase**
   - Migrazioni per tutte le tabelle del modello dati, RLS, player_hidden senza accesso dal client, funzione apply_turn transazionale, seed di sviluppo con una lega di prova.
   - **Fatto quando:** un utente di test non riesce a modificare la squadra di un altro né a leggere player_hidden (test SQL o script).
6. **Login e leghe**
   - Accesso con Google e con codice via email, creazione lega con le impostazioni, ingresso con codice invito, scelta della squadra, riempimento con bot, più leghe per utente con un selettore.
   - **Fatto quando:** due account entrano nella stessa lega da due browser, uno dei due è anche in una seconda lega, e il login con codice funziona da iPhone.
7. **Rose iniziali**
   - Rose reali con scelta della squadra, oppure draft di tutti i giocatori in modalità lista o dal vivo con timer (e passaggio alla lista), scelte automatiche per bot e ritardatari.
   - **Fatto quando:** un draft da 30 squadre si completa senza errori in entrambe le modalità e ogni rosa rispetta i limiti.
8. **Schermata roster**
   - Quintetto, minuti con controllo della somma a 240, tattiche, pulsante Auto, avvisi di fuori ruolo, scheda giocatore.
   - **Fatto quando:** le impostazioni salvate vengono lette dal motore nella simulazione.
9. **Avanzamento dei turni**
   - Pronto con stato in tempo reale; Edge Function advance-turn con blocco anti-doppia esecuzione e apply_turn; pg_cron per scadenze e riprese; allenatore delegato con avvisi; firme automatiche al minimo per le rose sotto 13.
   - **Fatto quando:** con 3 account il turno avanza solo all'ultimo Pronto o quando il commissario lo forza, e da solo alla scadenza solo se il commissario ne ha impostata una; chiamare due volte advance-turn non duplica nulla; con tutti gli allenatori attivi la lega avanza da sola e si ferma al primo avviso bloccante.
10. **Risultati, classifica e playoff**

- Pagina del turno, box score, cronaca, classifiche per conference e division, tabellone di play-in e playoff, statistiche individuali di stagione.
- **Fatto quando:** i totali di classifica coincidono con le partite giocate e una post-season completa si gioca senza errori.

11. **Mercato ed economia**

- Svincolati con richieste e punteggio, scambi di giocatori, scelte protette e swap con controllo di rosa, bilancio e regola Stepien, trade deadline, tagli, rinnovi in stagione, bilancio e luxury tax, proposte dei bot; tutto risolto in advance-turn.
- **Fatto quando:** uno scambio che sfora i limiti o arriva dopo la deadline viene rifiutato dal server anche chiamando l'API a mano, e il saldo di fine stagione coincide con la somma dei movimenti.

12. **Offseason**

- Fine stagione automatica, lottery e draft annuale (classe generata o reale), turno dei rinnovi, 4 turni di free agency, preparazione e nuova stagione.
- **Fatto quando:** una lega di prova passa da una stagione alla successiva con rose valide, contratti scalati, rookie firmati e cap aggiornato.

13. **PWA e pubblicazione**

- Manifest, icone, funzionamento su iPhone, GitHub Actions per Pages e Supabase.
- **Fatto quando:** l'app si installa dalla home del telefono e una lega completa un turno in produzione.

## Decisioni aperte e sviluppi futuri

Da fare prima della Fase 2:

- [ ] Chiudere i 6 casi ancora aperti nel foglio DA_VERIFICARE del file contratti (Jahmir Young, Dylan Cardwell, Quenton Jackson, Tristan Vukcevic, Nick Smith Jr., Killian Hayes).
- [ ] Rivedere le variazioni del foglio DA_RIVEDERE nel file giocatori v2 e decidere i campi soggettivi (Leadership, Freddezza, Etica del lavoro, Carattere, Potenziale).

Non restano decisioni aperte sulle regole. Dopo la prima versione: allenamenti, allenatori con abilità e stipendio, finanze del presidente (biglietti, sponsor, palazzetto, ricavi diversi per città), regole NBA complete (apron, eccezioni, bilanciamento degli stipendi negli scambi), settore giovanile, premi stagionali, chat di lega, notifiche push (utili con l'allenatore delegato, per sapere quando serve una decisione), partita seguita “in diretta” dalla cronaca.
