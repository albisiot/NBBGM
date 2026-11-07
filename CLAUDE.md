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

- Fasi 1-13 completate: l'app è pubblicata e installata dal telefono, e in produzione una lega ha giocato i suoi turni (con il Pronto e con l'allenatore). Dopo la Fase 13 sono stati corretti sette bug trovati analizzando l'app e rinforzati server e app: turni bloccati, spazio del database, strumenti del commissario, service worker, pubblicazione dopo i controlli; poi sistemati motore e regole di gioco: finali, rimonte, tiri da vicino, regola Stepien, stipendi massimi, rose corte; poi i dettagli dell'app: esito del mercato, invito con Google, uscita solo dal dispositivo, stato delle squadre nel turno dal server, uso da telefono; poi le prestazioni: pagine a pezzi, partite in memoria per turno, mercato più leggero, motore più veloce con gli stessi risultati; infine le funzioni nuove: barra del turno su ogni pagina, cronaca della lega, pagine delle squadre, ricerca nel mercato, scadenza e ritmo per il commissario, storico delle stagioni con i premi, guida iniziale e notifiche push. Una seconda analisi ha portato le correzioni urgenti: Pronto con gli avvisi, uscita da Squadra con modifiche non salvate, valore di infortunati, scelte e tassa per i bot, notifiche solo verso i servizi push e riallineate, campi a 16 px; poi l'economia: stipendi come quelli veri, ricavi a metà tra cap e tassa, saldo di partenza, firme in rosso fino al monte minimo, niente rifirme di chi si è tagliato, energia e minuti lunghi, scelte protette, strategie e offerte dei bot; poi server e pubblicazione: si pubblica solo la punta di `main`, segreto tra database e Edge Functions, turni bloccati riaperti anche senza commissario, iscrizioni su invito, spazio del database, notifiche raggruppate, codice invito nuovo e bandi, stato della lega in ordine fisso, niente cambi di squadra durante una simulazione; poi i dettagli dell'app: numero sull'icona sempre aggiornato, pagine che si rileggono al cambio di turno, barra del turno legata alla lega aperta, cronaca a pagine per chiave, barra e scheda del turno dalla stessa fase, icona delle notifiche per Android, conferme a tempo e annunciate, avvisi chiudibili, tema scuro del browser, squadra in 4 quando un infortunato non ha sostituti; poi le prestazioni: lettura leggera per il mercato, stato del turno in una lettura e un canale, scelte della squadra filtrate, classifica dalle sole partite giocate, Storico in memoria, service worker che scarica solo i file cambiati; infine le funzioni nuove: elenco delle leghe con lo stato dal vivo, riepilogo del turno da condividere, partita dal vivo e risultati senza spoiler, anteprima dello scambio e giocatori sul mercato, menu in basso su telefono, cerimonia di fine stagione con l'MVP delle Finali, confronto tra giocatori e bisogni della squadra (vedi "Scelte prese dopo la Fase 13"). Una terza analisi ha portato le correzioni urgenti: scambi con elementi ripetuti, swap venduti su scelte che non si hanno o a più squadre, anno e giro degli swap interi e forma delle proposte controllata, minimi di scadenza e ritmo con la pausa automatica delle leghe abbandonate, liste del draft annuale limitate, scelte già usate fuori dal mercato; poi la riorganizzazione delle pagine: decisioni in cima alla pagina della lega, Info lega, Campionato con risultati, classifica e playoff, menu a 5 voci. Poi lo stile Edicola, scelto dall'utente: primo passo colori, caratteri, testata e menu, secondo passo tutte le pagine, con la formazione sul campo e la pagina della lega come prima pagina (vedi "Stile Edicola, passo 1" e "passo 2"). Il segreto delle funzioni, l'hook delle iscrizioni e l'environment `supabase` vanno attivati a mano (passaggi in `supabase/README.md`). Le notifiche sono attive in produzione: chiavi VAPID nei segreti delle Edge Functions di Supabase e nella variabile `VAPID_PUBLIC_KEY` del repository, provate da iPhone il 6 novembre 2026 (passaggi in `supabase/README.md`). Si lavora su `main`; `fasi-1-3` è il ramo storico delle fasi. La logica di stagione sta in `packages/engine/src/season/`; database e sicurezza in `supabase/migrations/` (vedi `supabase/README.md`).
- App: `pnpm dev` (o `pnpm dev:lan` per provarla dal telefono sulla stessa Wi-Fi). Legge URL e chiave publishable da `apps/web/.env.local` (modello in `.env.example`).
- Pubblicata su **GitHub Pages**: `https://albisiot.github.io/NBBGM/` (repository pubblico `albisiot/NBBGM`, ramo `main`). Workflow in `.github/workflows/`: `ci.yml` (controlli), e dopo i controlli riusciti su `main` `pages.yml` (app, con le variabili `SUPABASE_URL` e `SUPABASE_PUBLISHABLE_KEY`) e `supabase.yml` (migrazioni e funzioni, con il segreto `SUPABASE_ACCESS_TOKEN`). Icone della PWA con `pnpm icons`.
- Edge Functions `create-league`, `draft`, `advance-turn`, `market` e `push` in `supabase/functions/`; il codice comune a Edge Function e script sta in `supabase/functions/_shared/`: `league.ts` (dati di partenza <-> motore, righe per `insert_league`), `draft.ts` (draft iniziale), `state.ts` (stato della lega dal database al motore, con `league_state`) `turn.ts` (un turno: dal motore alle sezioni di `apply_turn`) `market.ts` (controllo delle azioni di mercato), `push.ts` (notifiche: dalla coda ai messaggi), `webpush.ts` (Web Push con WebCrypto) e `secret.ts` (segreto delle chiamate dal database). Si pubblicano con `npx.cmd --yes supabase@3.0.0 functions deploy create-league draft advance-turn market push --use-api`. `pnpm push:keys` crea le chiavi VAPID delle notifiche.
- `pnpm db:seed` scrive `supabase/seed.sql` (lega di prova generata, utenti anna, bruno e carla `@nbbgm.test`) e `data/base.sql` (giocatori reali per le tabelle `base_*`); nessuno dei due va nel repo. I test del database girano su PGlite (`scripts/test/db.test.ts`), senza Docker.
- Progetto Supabase **NBBGM** (`sojimrnmsrbntgfsgxmj`, Francoforte): migrazioni applicate, giocatori reali caricati nelle tabelle `base_*`. Si lavora con la CLI (`npx.cmd --yes supabase@3.0.0 ...`, comandi in `supabase/README.md`), non con il connettore.
- `pnpm data:import` legge `NBA_2026-27_valutazioni_v2.xlsx` e `NBA_2026-27_contratti.xlsx` dalla radice e scrive `data/league-2026-27.json` e `data/import-report.md`; aggiorna `packages/engine/src/archetype-profiles.ts`.
- `pnpm sim:calibrate [partite]` gioca 1.000 partite (o il numero dato) e confronta le medie con gli intervalli della sezione Calibrazione. I parametri del motore stanno in `packages/engine/src/game/params.ts`.
- `pnpm sim:seasons [stagioni] [--veloce] [--ricavi=180] [--seme=x]` gioca 10 stagioni complete e controlla le metriche di lungo periodo (economia compresa); con `--veloce` usa una partita finta (2 secondi a stagione) per provare crescita ed economia, con `--ricavi` prova altri ricavi 2026-27 in milioni, con `--seme` un altro seed (le metriche economiche cambiano un po' da un seed all'altro).

## Scelte prese nella Fase 4 (non erano nel documento)

- **Livello della lega costante:** a ogni offseason, dopo crescita e draft, le abilità di tutti si spostano di poco perché la media dell'overall dei migliori 150 torni a quella di partenza (`normalizeTalent`). L'ordine tra i giocatori non cambia. Resistenza, Grinta, Freddezza e Leadership non si spostano: non entrano nell'overall.
- **Potenziale del file:** riportato sulla scala dell'overall con una retta ricavata dai giocatori tra 28 e 33 anni, che sono al loro massimo (`calibratePotential`).
- **Energia tra i turni:** recupero di 12 punti a Resistenza 50 (`ENERGY_RECOVERY`), o il 40% di quella che manca se è di più (`ENERGY_RECOVERY_SHARE`, dalla seconda analisi), cambio per stanchezza sotto 50: un titolare a 35 minuti resta sopra 85 a inizio gara, uno a 42 scende sotto 75.
- **Curva di crescita:** picco a 27 anni, calo dal 28° (`ageCurve`).
- **Bot in rosso:** se sono sopra la tassa provano a cedere un contratto pesante a chi ha spazio sotto il cap, aggiungendo se serve una scelta (`botSalaryDump`).
- **Two-way:** contratti di un anno, rinnovati di stagione in stagione con i giovani svincolati.
- **Scala rookie:** ricavata dai contratti reali dei rookie 2026 (`CONFIG_2026_27.rookieScale`); minimi per anzianità dalla tabella 2026-27.
- **Rose iniziali:** alla creazione della lega le rose oltre 15 standard o 3 two-way si tagliano come in offseason.
- **Niente dinastie a forza di scambi:** negli scambi tra bot le due squadre più forti non comprano veterani.
- **Ricavi:** 182,7 milioni di $ nel 2026-27, a metà tra il cap e la soglia della tassa (dalla seconda analisi; prima 170, il 3% sopra il cap, e all'inizio pari alla soglia della tassa, con cui i saldi crescevano di centinaia di milioni). Crescono del 7% l'anno con il resto. Perché: vedi "Economia" in "Scelte prese dopo la Fase 13".

## Scelte prese nella Fase 5 (non erano nel documento)

- **Tabelle in più:** `league_members` (chi fa parte di una lega, base di tutta la RLS) e `dead_money` (stipendi residui dei tagliati). I giocatori ritirati restano in `players` con `retired` per lo storico delle statistiche.
- **Scritture del client:** solo impostazioni, allenatore e offerte agli svincolati della propria squadra, proposte di scambio, nome del profilo e impostazioni della lega per il commissario (dalla Fase 11 offerte e scambi passano dalla funzione `market`; dalle funzioni nuove della seconda analisi anche i giocatori sul mercato, `trade_block`). Tutto il resto passa dal server. A turno in chiusura nessuna modifica è accettata.
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
- **Svincolati in stagione:** chiedono quanto all'ultimo turno di free agency (`IN_SEASON_ASK_ROUND`, `askingSalaryFor`); un'offerta sotto la richiesta è rifiutata subito. Chi una squadra ha tagliato non lo rifirma fino alla stagione dopo (seconda analisi). Lo stipendio cresce del 5% l'anno, da 1 a 5 anni. In stagione i bot non fanno offerte: firmano solo al minimo per restare a 13.
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
  - Una prima scelta protetta "top N", con la protezione già messa o quella dello scambio (`t.protections`), vale `1 − 0,7 × P(cade nella fascia)` (`protectedShare`). P dipende da N e dalla posizione attesa, ed è più incerta per i draft lontani. (Cambiato con la seconda analisi: vedi "Scelte protette" in "Economia della seconda analisi".)
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

Motore e regole di gioco.

- **Finale di partita** (`endgame` in `params.ts`; ultimi 2 minuti del quarto periodo e dei supplementari):
  - chi è sotto e non ha la palla fa fallo quando restano meno di 24 secondi per ogni possesso che gli serve: sotto di 1-3 punti a 24 secondi, di 4-6 a 48, di 7-9 a 72;
  - chi è avanti fa scorrere il cronometro;
  - in parità, o sotto di un possesso, sotto i 24 secondi si gioca per l'ultimo tiro; in parità prima si gioca con calma;
  - sotto di 3 sull'ultimo tiro si cerca quasi sempre la tripla, sotto di 2 il canestro del pareggio;
  - un possesso che parte con 3-5 secondi alla fine di un periodo perde 8 punti di percentuale, con 1-2 secondi 25 (quasi una preghiera); l'ultimo tiro preparato ne perde 3.
- **Rimonte:** chi è avanti si rilassa un po' e chi è sotto spinge.
  - La probabilità di canestro si sposta di 0,22 punti percentuali per ogni punto di scarto, fino a 20 punti (`comebackPerPoint`).
  - Negli ultimi 5 minuti, con scarto da 1 a 8, si sposta di altri 2,5 punti (`comebackClose`).
  - Senza, lo scarto finale aveva una deviazione standard di quasi 20 punti (nella NBA circa 14-15), il 2% di partite ai supplementari e il 12% decise di 3 punti o meno. Ora: circa 14,5 punti, 4,5-5% e 16,5%.
  - Chi è avanti di 5 a 5 minuti dalla fine vince circa tre volte su quattro. Spingere di più per arrivare al 6% di supplementari della NBA renderebbe troppo fragili i vantaggi.
- **Calibrazione:** `pnpm sim:calibrate` controlla anche le partite ai supplementari (4-7%) e quelle decise di 3 punti o meno (14-20%). Il fattore campo sale a 2,1 punti percentuali (era 1,5), perché le vittorie in casa restino tra il 55 e il 58%.
- **Tiri da vicino:** dal 10 al 17% dei tiri (NBA circa 18%), con più floater sulle penetrazioni (`floaterShare` 0,7), più gioco in post (`postWeight` 1,5) e meno tiri dalla media (`midWeight` 0,45); floater, gancio e fadeaway sono un po' più precisi. Zone: al ferro 31% dei tiri con il 66%, da vicino 17% con il 44%, dalla media 10% con il 41%, da tre 43% con il 37%.
- **Rimbalzo offensivo di squadra** (palla fuori): si rimette in gioco, senza il tap-in di un giocatore preso a caso.
- **Regola Stepien:** uno scambio è vietato solo se apre un buco nuovo (due draft consecutivi senza prima scelta). Chi è già in difetto senza colpa, per esempio dopo il rinvio di una scelta protetta, può fare scambi che non peggiorano. Una scelta protetta che torna alla squadra d'origine perde protezione e rinvii.
- **Stipendio massimo:** le richieste degli svincolati e dei rinnovi non superano il massimo per anzianità. Un rinnovo sopra il massimo lo rifiutano la funzione `market` e la chiusura del turno (`renewalMax`).
- **Rose cortissime** (`gamePlayers`): va a referto solo chi può giocare, anche se sono 5, 6 o 7 (prima, sotto 8, giocavano tutti, infortunati compresi). Solo sotto 5 si completa con chi è fuori per le regole dei two-way, poi con chi ha l'infortunio più breve.
- **Two-way:** uno scambio non porta una squadra oltre 3 two-way; in offseason un two-way non si firma con la rosa già a 21.
- **Svincolati infortunati:** guariscono un turno alla volta anche senza squadra.
- **Draft dei bot:** il rumore nella valutazione di un prospetto si estrae una volta sola (prima si riestraeva a ogni confronto).

Dettagli dell'app.

- **Stato delle squadre nel turno dato dal server** (`round_readiness`, per i membri della lega):
  - pronta (Pronto premuto), con l'allenatore, in attesa di una decisione (allenatore attivo ma un avviso bloccante aperto), non pronta, oppure fuori dal turno in play-in e playoff;
  - lo calcola `private.team_readiness`, la stessa funzione su cui ora poggia `round_all_ready` (e quindi `private.round_due`): la scheda del turno e la chiusura non possono più dire cose diverse (prima l'app contava pronta una squadra con l'allenatore fermo da un avviso, e diceva che la lega avanzava da sola);
  - ai membri dice solo che c'è una decisione in sospeso, non quale (`coach_ready` resta chiusa al client). La scheda mostra "Deve decidere" e da chi si aspetta una decisione;
  - gli avvisi degli altri non arrivano in tempo reale (RLS): il cambio si vede alla rilettura, al più tardi dopo 30 secondi. Senza la funzione (app pubblicata prima delle migrazioni) l'app ricava lo stato dalle tabelle come prima, con gli avvisi della sola propria squadra.
- **Esito delle azioni del mercato** in un avviso fisso in basso (`Toast`), visibile anche in fondo a una lista lunga: le conferme spariscono dopo 6 secondi, gli errori dopo 15 o quando si chiudono (seconda analisi). Accettare uno scambio ricevuto chiede conferma (`ConfirmButton`: secondo tocco entro 5 secondi).
- **Login con Google e invito:** Google torna all'indirizzo senza la parte `#/...`; la pagina (per esempio `#/entra/CODICE`) si salva in `sessionStorage` prima di andare e si rimette al ritorno, prima del router (`lib/returnTo.ts`). Con il codice via email la pagina resta nell'indirizzo.
- **Esci** chiude la sessione solo sul dispositivo (`signOut({ scope: 'local' })`): uscire dal computer non fa più uscire l'app sul telefono.
- **Dati legati ai parametri** (`useAsync`): cambiando lega (o squadra nella proposta di scambio) la pagina non mostra i dati di prima mentre carica i nuovi; con `reload()` restano visibili. L'elenco delle leghe nell'intestazione usa `keep`.
- **Liste del draft** (iniziale e annuale) salvate in fila: uno alla volta e, dei tocchi arrivati nel frattempo, solo l'ultimo (`latestSaver`), così non può arrivare per ultimo un salvataggio vecchio.
- **Contratti nella scheda giocatore:** dopo il draft dell'offseason le stagioni partono da quella che arriva (`contractFirstYear`), perché i contratti sono già scalati.
- **Draft dal vivo e lettori di schermo:** il conto alla rovescia non è più una regione `aria-live`; si annunciano solo il proprio turno, gli ultimi 10 secondi e la scadenza (`draftAnnouncement`).
- **Da telefono:**
  - nelle tabelle larghe (classifica, statistiche, box score) posizione e nome restano fissi a sinistra quando la tabella scorre; il segno dei posti playoff e play-in era un'ombra interna, perché il bordo di una cella fissa in una tabella con i bordi collassati non la segue (con lo stile Edicola le tabelle hanno i bordi separati e i filetti sulle celle: vedi "Stile Edicola, passo 2"). Nelle statistiche su telefono il ruolo si vede solo nella scheda, per lasciare spazio al nome;
  - margini `env(safe-area-inset-*)` per intestazione, pagina, barra Salva della squadra e avviso in basso (c'è `viewport-fit=cover`);
  - bersagli di tocco di almeno 44 px (± dei minuti, intestazioni ordinabili, `Segmented`, pulsanti del draft, menu e selettori);
  - grigi del testo almeno `slate-500` su fondo chiaro e `slate-400` su fondo scuro (con lo stile Edicola `stampa-500` e `stampa-400`);
  - la colonna delle partite nelle statistiche si chiama "G" (PG era anche il ruolo).

Prestazioni.

- **Pagine a pezzi:**
  - tutte le pagine tranne l'accesso si caricano con `React.lazy` (`lib/lazyPage.ts`); nel `Layout` un `Suspense` mostra "Caricamento…" sotto l'intestazione;
  - all'avvio 474 KB di JavaScript, 141 KB compressi (prima un file unico da 650 KB, 185 KB compressi);
  - il service worker mette in cache tutti i file della build, pezzi compresi: l'app si apre anche senza rete, su qualunque pagina;
  - se un pezzo manca perché nel frattempo è uscita una versione nuova (il service worker nuovo toglie i file della vecchia), la pagina si ricarica una volta da sola; se manca ancora entro un minuto, decide il manager con Ricarica (`ErrorBoundary`).
- **Niente Storage di Supabase nella build:** l'app non lo usa. Un alias in `vite.config.ts` mette al posto di `@supabase/storage-js` (con iceberg-js) un modulo vuoto con gli stessi nomi (`lib/noStorage.ts`): 28 KB in meno. Se una versione nuova di supabase-js chiedesse un altro nome a storage-js, la build si ferma (export mancante).
- **Partite in memoria per lega e turno** (`useSeason`, `KeyedCache` in `lib/cache.ts`):
  - Risultati, Classifica e Playoff riusano le partite e le serie lette con la stessa stagione e lo stesso turno (`leagueDetail` dà ora anche `roundId`);
  - al cambio di turno la chiave cambia e si rileggono; i dettagli della lega si leggono a ogni visita;
  - le pagine di `games` (1.000 righe l'una) si chiedono due alla volta, in parallelo (`allPages`), e mai con la cronaca;
  - in memoria al massimo 3 leghe; una lettura fallita non resta in cache.
- **Mercato:**
  - dopo un'azione si rileggono solo offerte agli svincolati, proposte di scambio e richieste. Rosa, svincolati, scelte e bilancio cambiano solo alla chiusura del turno, e si rileggono al cambio di turno;
  - non scarica più tutti i giocatori della lega con le abilità (con la lega di prova 342 KB, 59 KB compressi). Dei giocatori citati da offerte e scambi si chiedono solo quelli che non sono nella propria rosa o tra gli svincolati (`missingPlayerIds`, `playersLite`), a pezzi di 100 id;
  - degli svincolati solo le colonne per overall e richiesta (`FreeAgent`), senza tendenze, statistiche, contratti (uno svincolato non ne ha) e infortuni. Prima i contratti e gli infortuni si chiedevano con `.in('player_id', ids)` su tutti gli svincolati: con le rose reali crescono da 5 a circa 270 in sei stagioni, e oltre circa 200 id l'indirizzo supera gli 8 KB, oltre i quali molti server rifiutano la richiesta (414);
  - il draft annuale chiede solo i giocatori già scelti che non sono più tra i prospetti.
- **Motore più veloce, stessi risultati bit per bit:**
  - in partita i valori fissi di ogni giocatore si calcolano una volta: adattamento ai 5 slot, morale, forma del giorno, resistenza, rischi di infortunio per distretto ed età;
  - efficacia (fatica, morale, ruolo, forma) e peso nella scelta di chi gioca la palla restano in cache finché energia e slot non cambiano;
  - `roleDistance` usa una tabella invece di `indexOf`; `overallRaw` i pesi già in elenco, nello stesso ordine;
  - `autoSetup` salta i rami del quintetto che non possono superare il migliore trovato (margine di 1e-6, quindi lo stesso quintetto della ricerca completa);
  - con i giocatori reali (`tsx`, mediana di 3 prove): partita calda da 7,6 a 3,9 ms, fredda da 37 a 29 ms, `strengthRanking` da 14 a 4,7 ms, turno di regular season da 183 a 102 ms; `pnpm sim:calibrate 1000` da 8,6 a 4,6 ms a partita, con le medie identiche;
  - il test golden (`packages/engine/test/golden.test.ts`) tiene le impronte sha-256 di 36 partite, 5 finali, impostazioni automatiche, valutazioni e scambi dei bot, 4 turni veri e una stagione con l'offseason. Un'impronta cambia solo con un cambio di regole o di calibrazione voluto: allora si aggiorna, sapendo che cambiano le partite delle leghe in corso.

Funzioni nuove.

- **Barra del turno su ogni pagina della lega** (`TurnBar` nel `Layout`, tranne nella pagina della lega che ha la scheda completa):
  - turno, stato della propria squadra dato dal server (`round_readiness`: pronto, allenatore, da decidere, non pronto, non gioca), pulsante Pronto con il turno visto (`set_ready(..., p_round)`) e il numero delle decisioni bloccanti aperte, con il link alla pagina della lega;
  - poche letture, in tempo reale come la scheda del turno, senza il motore nel pezzo iniziale (`STAGE_LABEL` e `roundTitle` stanno in `turns.ts`); dalla seconda analisi lo stato è quello condiviso con la scheda (`barFromTurn`, vedi "Prestazioni della seconda analisi");
  - non ferma: su telefono sta in cima alla pagina, su due righe (turno; decisioni e Pronto).
- **Cronaca della lega** (pagina Cronaca, `transactions`):
  - dalla più recente, filtri per tipo e per squadra nell'indirizzo (`?tipi=trade,signing&squadra=BOS`), 30 righe per pagina con "Mostra altri"; le sigle nel testo portano alla pagina della squadra;
  - le squadre citate le ricava un trigger dal testo (`transactions.team_codes`, sigle come parole intere): vale per ogni scrittura senza cambiare il formato dei dati; le righe già scritte sono state aggiornate dalla migrazione;
  - gli infortuni da 4 partite in su (medi e gravi) entrano nella cronaca per tutte le squadre (`INJURY_NEWS_GAMES` in `turn.ts`); quelli leggeri no;
  - "Ultime notizie" nella pagina della lega: le ultime 5, senza draft e opzioni (arrivano a centinaia insieme).
- **Pagina di ogni squadra** (`#/lega/<id>/squadre/<sigla>`): record e posto in conference, rosa con overall, ruoli, età, infortuni e contratti (stipendio e anni, opzione sull'ultimo anno), monte stipendi con i residui dei tagliati, spazio sotto il cap o distanza dalla tassa, scelte possedute e cedute con le protezioni, swap da decidere, strategia dei bot. Il saldo resta riservato. Ci si arriva da classifica, box score, elenco delle squadre e cronaca; "Proponi uno scambio" apre il mercato con la squadra già scelta (`?con=<id>`) e porta la proposta in vista.
- **Ricerca nel mercato** (`filterFreeAgents`):
  - svincolati per nome (senza accenti né maiuscole, più parole), ruolo principale o secondario, età (fino a 24, 25-30, da 31), richiesta (al minimo, minimo + 2 o + 5 milioni, dentro lo spazio sotto il cap: sopra il cap vale solo il minimo);
  - ordinamento per overall, potenziale stimato, età o richiesta, a parità overall e nome; 30 alla volta con "Mostra altri" al posto del limite fisso di 60;
  - nella scelta dei giocatori di uno scambio le rose si ordinano per overall, stipendio o età.
- **Scadenza dei turni e ritmo massimo** si cambiano dopo la creazione, nella gestione della lega del commissario (il server lo permetteva già: `update` su `leagues` con la policy del commissario). Cambiare la scadenza la fa ripartire da adesso per il turno aperto.
- **Storico delle stagioni** (pagina Storico):
  - albo d'oro (campione e finalista da `playoff_series`), e per la stagione scelta premi, migliori 5 per punti, rimbalzi e assist a partita, classifica finale di regular season;
  - alla chiusura della giornata 82 advance-turn salva le statistiche di regular season di ogni giocatore con almeno una presenza (`player_seasons`: statistiche, squadra di quel momento, primo anno nella lega), nella sezione `player_seasons` di `apply_round`; le leggono i membri. Le regular season finite prima si sono ricostruite dai box score con le stesse regole (`private.rebuild_player_seasons`), con il primo anno noto solo per la stagione in corso;
  - la pagina Statistiche ha la scelta della stagione (`?stagione=2026`): le passate dalle righe salvate (ritirati compresi), quella in corso dai giocatori;
  - per la stagione in corso, in regular season, i premi sono "provvisori".
- **Premi di fine stagione** (`seasonAwards` in `packages/engine/src/season/awards.ts`), calcolati dall'app con formule fisse, senza caso; servono almeno metà delle partite del più presente (41 su 82):
  - valutazione (VAL) a partita = (punti + rimbalzi + assist + rubate + stoppate − tiri sbagliati − liberi sbagliati − palle perse) / partite;
  - MVP: VAL × (0,8 + 0,4 × percentuale di vittorie della squadra);
  - miglior difensore: (2 × rubate + 2 × stoppate + rimbalzi difensivi) a partita × (0,9 + 0,2 × percentuale di vittorie);
  - rookie dell'anno: VAL più alta tra chi è al primo anno nella lega; sesto uomo: VAL più alta tra chi è partito titolare in meno di metà delle sue partite;
  - a parità vince chi ha più partite, poi l'id più piccolo. Le formule si leggono anche nella pagina ("Come si calcolano").
- **Guida iniziale:**
  - pagina "Come si gioca" (`#/guida`), dal profilo, dall'elenco delle leghe e dai primi passi;
  - primi passi nella pagina della lega la prima volta che la si apre con una propria squadra (`WelcomeCard`, si chiude e non torna: memoria del browser);
  - suggerimento per installare l'app nell'elenco delle leghe (`InstallHint`): su iPhone e iPad le istruzioni (Condividi → Aggiungi alla schermata Home; da Chrome o da un'altra app prima Safari), dove il browser lo permette il pulsante Installa con `beforeinstallprompt` (preso all'avvio in `main.tsx`); niente nell'app installata;
  - nell'app installata su iPhone la pagina di accesso consiglia il codice via email (`preferEmailCode`).
- **Notifiche push** (Web Push standard con chiavi VAPID, senza librerie: `supabase/functions/_shared/webpush.ts` con WebCrypto, aes128gcm e JWT ES256):
  - iscrizioni per utente e dispositivo in `push_subscriptions` (ognuno vede solo le sue; si scrivono con `save_push_subscription` e `delete_push_subscription`; al massimo 10 dispositivi, lo stesso endpoint passa a chi si iscrive adesso); preferenze in `notification_settings` (turno nuovo, decisioni, draft dal vivo; senza riga tutte accese);
  - la coda `push_outbox` (solo server) la riempiono i trigger: turno nuovo (`leagues.current_round_id`, non a chi ha l'allenatore attivo: con tutti gli allenatori la lega può avanzare di un turno al minuto), avviso bloccante nuovo, draft iniziale dal vivo (la propria scelta entra nelle prossime 3 chiamate). Solo per chi ha un dispositivo iscritto e quel tipo acceso;
  - la prima notifica di una transazione chiama con pg_net la Edge Function `push` (dopo il commit, quindi trova tutta la coda); pg_cron riprova ogni minuto (`nbbgm-notifiche`) e dopo 10 minuti una notifica non mandata si butta. Una notifica che non si riesce a mettere in coda salta senza far fallire turno, mercato o draft;
  - `push` prende la coda (`push_take`), fa un messaggio per persona e lega (il più urgente dà pagina e durata: draft, decisione, turno; turno e decisioni insieme nello stesso testo), lo cifra per ogni dispositivo e cancella le iscrizioni scadute (404, 410: `push_gone`). Senza chiavi VAPID svuota la coda e non manda nulla;
  - il service worker mostra la notifica (una per lega: `tag`, quella del turno nuovo sostituisce in silenzio), mette il numero delle decisioni aperte sull'icona e, toccata, apre la pagina giusta nella finestra dell'app (solo pagine dell'app). L'app aggiorna lo stesso numero (`navigator.setAppBadge`) all'avvio, al ritorno in primo piano e quando cambiano le decisioni;
  - nel profilo si attivano su questo dispositivo, dopo un tocco (su iPhone solo nell'app installata, da iOS 16.4), e si scelgono i tipi; "Esci" toglie l'iscrizione del dispositivo;
  - senza la chiave pubblica nella build (`VITE_VAPID_PUBLIC_KEY`, variabile `VAPID_PUBLIC_KEY` del repository per Pages) l'app non parla di notifiche. Le chiavi si creano con `pnpm push:keys`; i passaggi per attivarle in produzione sono in `supabase/README.md`.

Correzioni urgenti della seconda analisi.

- **Pronto con gli avvisi** (`readyWarnings` in `lib/turns.ts`, `ReadyConfirm`):
  - prima di segnarsi pronti, dalla barra del turno o dalla scheda del turno, l'app dice che cosa succede se il turno si chiude con decisioni aperte: lo scambio ricevuto è rifiutato, il rinnovo non fatto lascia andare il giocatore (con l'allenatore decide lui), la rosa corta la completa il server, al draft sceglie la lista, in free agency valgono solo le offerte fatte, in preparazione il server taglia e firma;
  - con modifiche non salvate in Squadra propone "Salva e sono pronto";
  - senza decisioni né modifiche il Pronto parte subito, come prima.
- **Uscita da Squadra con modifiche non salvate:**
  - il router è un data router (`createHashRouter` con `RouterProvider`, creato al primo disegno, dopo `restorePage`), così la pagina usa `useBlocker`: uscire chiede "Salva ed esci" (solo con impostazioni valide), "Esci senza salvare" o "Resta";
  - chiudere o ricaricare la scheda chiede conferma al browser (`beforeunload`; Safari su iPhone non la mostra);
  - contano solo le modifiche fatte dal manager, non le impostazioni mai salvate o sistemate dal bot, che il motore rifà uguali alla partita. La pagina le condivide con la barra del turno in `lib/unsaved.ts`;
  - un errore nel disegno di una pagina lo prende il router (`errorElement`) e mostra lo stesso `ErrorScreen` dell'`ErrorBoundary`.
- **Valore di un infortunato per i bot** (`playerTalent`, `injurySeasons`):
  - il talento di un giocatore riassume circa tre stagioni (`VALUE_YEARS`): un infortunio toglie, per ogni stagione toccata, la quota che il giocatore salta di un anno di valore;
  - in stagione conta la quota delle partite che restano; se lo stop va oltre la regular season conta anche la stagione dopo, con la guarigione dell'offseason (fino a 30 partite si guarisce, oltre se ne scontano 20: `gamesAfterOffseason`). In offseason la guarigione c'è già stata;
  - una stella ferma fino a fine stagione perde un terzo del valore (prima fino al 70%, anche a fine stagione). Con i giocatori reali nessun bot cede più il migliore, fermo per 60 partite, per Ron Harper Jr. (prima 10 su 29).
- **Classifica attesa per il valore delle scelte** (`draftRanking`):
  - vittorie già fatte più quelle attese nelle partite che restano, dalla forza della squadra rispetto alla media (+5 di overall vince circa il 67%, `WIN_SCALE`); in offseason solo la forza, dopo la regular season il record;
  - nella forza contano anche gli infortunati che saltano meno di metà delle partite che restano: la prima 2027 di Boston con Tatum fuori una partita resta 5,0 (prima saliva a 20,6);
  - `strengthRanking` (forza di adesso) resta per le due squadre più forti che non comprano; le strategie dei bot ora usano `draftRanking` (vedi "Economia della seconda analisi").
- **Luxury tax negli scambi dei bot:**
  - nel turno del draft i contratti non sono ancora scalati: conta la tassa della stagione che arriva (secondo anno dei contratti, `payroll(..., 1)`, soglie di `nextConfig`), non quella già pagata (`taxSeason`). Prima 14 bot su 14 sopra la tassa regalavano un giocatore (Embiid, Adebayo, Towns, Wagner, Gobert); ora regalano solo contratti che per loro valgono meno di zero, cosa che dipende dalla calibrazione di `marketValue`, rimasta fuori da queste correzioni;
  - per chi è in corsa il risparmio sulla tassa conta al massimo per un quarto del talento che cede (`CONTEND_TAX_SAVING_SHARE`); il costo della tassa in più conta intero. Philadelphia non cede più Jaylen Brown per due ventenni da 58;
  - con `pnpm sim:seasons 10` (partite vere) gli scambi tra bot passano da 4,7 a 5,7 a stagione, le squadre in rosso in media da 12,3 a 12,2, il saldo mediano da 0,49 a 0,52 stagioni di ricavi; nessuna metrica che rispettava l'obiettivo ne esce (l'energia era già fuori). La calibrazione delle partite non cambia; nel test golden cambia solo l'impronta della stagione intera.
  - i casi con i giocatori reali stanno in `scripts/test/botCases.test.ts`, che senza `data/league-2026-27.json` si salta.
- **Notifiche solo verso i servizi push:**
  - indirizzi ammessi: `fcm.googleapis.com`, `android.googleapis.com`, `jmt17.google.com` (Chrome e Chromium), `*.push.services.mozilla.com` (Firefox), `*.notify.windows.com` (Edge), `*.push.apple.com` (Safari), solo https, senza porta né credenziali (elenco di pushpad/known-push-services, senza gli host di prova di Mozilla);
  - li controllano il database (`private.push_endpoint_ok`, vincolo su `push_subscriptions`, messaggio di `save_push_subscription`) e la Edge Function (`PUSH_HOSTS`, `pushEndpointAllowed`): le due liste vanno tenute uguali, e un test lo verifica;
  - la migrazione `20261106150000_push_hosts.sql` cancella le iscrizioni già salvate verso altri indirizzi; la funzione non manda a quelle che trova e le cancella;
  - l'invio (`fetchSend`) non segue i reindirizzamenti (`redirect: 'manual'`: un 3xx conta come errore) e si ferma dopo 10 secondi.
- **Iscrizione riallineata con il server** (`syncPush`, `lib/pushWatch.ts`):
  - all'avvio dell'app (con il permesso già concesso), all'apertura del profilo e quando avvisa il service worker, l'iscrizione del browser si salva di nuovo sul server; se è fatta con un'altra chiave VAPID si rifà e la vecchia si toglie dal server;
  - l'iscrizione fatta da un altro account sullo stesso dispositivo non si prende senza un tocco (memoria del browser `nbbgm:notifiche-utente`);
  - il service worker gestisce `pushsubscriptionchange`: rifà l'iscrizione con la chiave della build (scritta in `sw.js` da `vite.config.ts`; senza, quella vecchia) e avvisa le finestre aperte, che la salvano. Senza finestre aperte la salva l'app al prossimo avvio.
- **Campi a 16 px su telefono:** su iPhone toccare un campo con il testo più piccolo fa ingrandire la pagina, che resta ingrandita. Una regola di `index.css`, fuori dai layer di Tailwind, porta a 16 px ogni `input` (non caselle e scelte), `select` e `textarea` sotto `sm`, qualunque classe abbiano; da `sm` in su valgono le classi.

Economia della seconda analisi.

- **Stipendi come quelli veri** (`marketValue` in `finance.ts`):
  - dal minimo al massimo per anzianità in linea retta tra livello 55,5 e 85 (`MARKET_FLOOR_LEVEL`, `MARKET_MAX_LEVEL`); il livello è l'overall meno un punto per anno oltre i 31. Il potenziale non conta più: i giovani fuori dal contratto da rookie guadagnano meno, non di più;
  - curva ricavata dai 316 contratti reali 2026-27 non da rookie, minimi compresi: senza i minimi la parte bassa usciva troppo alta (un 58 di overall a 10,5 milioni contro 6,9 veri), da 63 in su i due modi danno la stessa curva. Per fascia di overall valore medio contro stipendio medio vero: 60-64 11,7 contro 11,1 milioni, 65-69 18,8 contro 17,2, 70-74 28,1 contro 29,4, 75-79 35,0 contro 41,7, 80-84 41,5 contro 38,8. Una rosa vale 207 milioni contro 195 veri (prima 111);
  - con la curva salgono richieste degli svincolati e dei rinnovi, opzioni e valutazioni dei bot. I casi con i giocatori reali in `scripts/test/botCases.test.ts` lo controllano fascia per fascia.
- **Ricavi a metà tra cap e tassa** (182,7 milioni nel 2026-27, l'11% sopra il cap; `CONFIG_2026_27.revenue`):
  - con stipendi come quelli veri e saldi stabili, il monte medio è circa i ricavi meno tasse e two-way: con 170 milioni (il 3% sopra il cap) la mediana stava sotto il cap quasi ogni stagione e in media 22 squadre su 30 erano in rosso;
  - chi resta al cap guadagna circa 18 milioni l'anno, chi arriva alla tassa ne perde altrettanti, chi la supera molto di più.
- **Saldo di partenza** di un quinto dei ricavi della prima stagione (`STARTING_BALANCE_SHARE`, 36,5 milioni): i monti veri del 2026-27 (mediana circa 200 milioni) superano i ricavi, e da zero quasi tutte le squadre finivano in rosso già al primo anno. Vale per le leghe nuove; il saldo resta il saldo di partenza più la somma dei movimenti.
- **In rosso si firma fino al monte stipendi minimo** (`canSign`): la differenza si pagherebbe comunque a fine regular season; oltre, solo minimi per restare a 13. Prima chi andava in rosso scendeva sotto il minimo e pagava la differenza senza averne i giocatori. Il bot in rosso rinnova caro chi è fuori dai suoi primi 4 solo se resta sotto il monte minimo (`botWantsRenewal`).
- **Offerte dei bot in free agency** (`botOffers`):
  - per ogni svincolato il talento per la strategia del bot, per il ruolo (`roleNeed`: 1,15 se il ruolo principale è scoperto rispetto a 3 PG, 3 SG, 3 SF, 2 PF, 2 C; 0,8 se ne ha già di più), confrontato con il sostituto (il migliore che firmerebbe al minimo); il bot spende lo spazio sotto il cap (in rosso fino al monte minimo) sui migliori che può pagare, al massimo 3 offerte a turno (`BOT_OFFERS_PER_ROUND`). Prima sceglieva il valore per dollaro e restava sotto il cap;
  - sotto il monte minimo, in offseason, prende un giocatore anche con 15 contratti standard (alla preparazione si taglia il peggiore e il residuo resta nel monte) e alza l'offerta fino al minimo.
- **Forza della squadra per gli svincolati** (`teamAppeal`, nel punteggio dell'offerta): metà overall della rotazione (da 60 a 75), metà percentuale di vittorie da 10 partite di regular season in su (`APPEAL_MIN_GAMES`; in offseason quella della stagione finita).
- **Strategie dei bot** (`updateStrategies`): dalla classifica attesa (`draftRanking`: vittorie fatte più quelle attese), dall'età della rotazione e dal monte stipendi. In corsa le prime 10, in ricostruzione le ultime 10 o le vecchie fuori dalle prime 15; chi è sopra la tassa e in rosso è in corsa solo tra le prime 6 e ricostruisce fuori dalle prime 12.
- **Un solo scambio tra bot per turno:** in regular season la cessione di un contratto pesante (`botSalaryDump`) si tenta solo se nel turno non c'è già stato uno scambio tra bot; nel turno dei rinnovi i tentativi si fermano alla prima cessione riuscita.
- **Cessioni dei contratti pesanti che convengono anche a chi cede** (`botSalaryDump`): come gli altri scambi dei bot, passano `tradeGainOk` per chi cede, con il risparmio sulla tassa tra i guadagni. Prima contava solo il compratore: con la nuova economia, nei primi anni pieni di squadre in rosso sopra la tassa, Philadelphia regalava Malik Ashford (21 anni, 78 di overall, poi 92) per una seconda scelta e Miami Adebayo, e Dallas vinceva 6 titoli in 10 stagioni.
- **Scelte protette** (`pickValue`, `protectionChance`):
  - una prima protetta vale `(1 − P) × la scelta libera + P × la seconda scelta che diventa` dopo i rinvii che restano (tre in tutto, `MAX_DEFERRALS`), con lo sconto per gli anni: con la protezione quasi certa vale come quella seconda scelta. Prima il caso protetto valeva sempre il 30% della prima: la prima 2028 della diciannovesima squadra, protetta top 20, valeva 6,5 per chi ricostruisce contro 1,9 di una seconda scelta; ora 3,8;
  - P tiene conto della lottery (`lotteryPositionOdds`, probabilità esatte delle 24.024 estrazioni): la peggiore ha la prima scelta solo nel 14% dei casi, quindi una sua top 1 vale ancora quasi come una scelta libera.
- **Niente rifirme di chi si è tagliato** (`LeagueState.releases`, `releasedBy`):
  - in stagione uno svincolato chiede quanto all'ultimo turno di free agency (il 64% del valore, `IN_SEASON_ASK_ROUND`): tagliare un giocatore all'ultimo anno e rifirmarlo subito costava meno che rinnovarlo (Herro 18,6 milioni invece di 31,1). Ora una squadra non firma chi ha tagliato fino alla stagione dopo, nemmeno con le firme automatiche al minimo o i two-way dei bot; le altre squadre sì;
  - nel motore i tagli si contano dalla prima giornata alla fine della preparazione (`startNewSeason` li azzera; quelli della creazione della lega non contano). Sul server `league_state` li dà dalle richieste di taglio eseguite (`roster_requests` 'release' fatte) nei turni della stagione corrente, offseason compresa (migrazione `20261106160000_release_ban.sql`); la funzione `market` rifiuta subito l'offerta ("Lo hai tagliato in questa stagione") e la chiusura del turno la scarta;
  - la richiesta in stagione resta al 64%: chi è rimasto svincolato non ha trovato squadra a quel prezzo alla fine della free agency, e chiedere di più dopo non avrebbe senso. Con i tagli chiusi, a quel prezzo resta solo chi nessuno ha voluto.
- **Chi chiede più di 36 minuti li gioca** (`params.ts`, `checkSubs`, `pullLongMinutes`):
  - la soglia per uscire per stanchezza scende di 3,5 punti di energia per minuto oltre 36 (da 50 fino a 30, stanchezza estrema: `longSubOutStep`, `subEnergyFloor`), quella per rientrare dalla panchina di 3 (da 72 fino a 54: `longSubInStep`, `returnEnergyFloor`);
  - chi è indietro di più di 2,5 minuti sul suo obiettivo rientra subito, nello slot dove sostituire conviene di più, senza aspettare che qualcuno voglia uscire. Prima un giocatore da 42 minuti restava in panchina anche dieci minuti e ne giocava circa 35,6; ora circa 41 nelle partite senza problemi di falli (con 4 o più falli ne gioca meno);
  - i bot non superano mai 36 minuti: le loro partite sono identiche bit per bit (lo dice il test golden, dove cambiano solo valutazioni, turni e stagione).
- **Energia tra i turni** (`recoverEnergy`): il più alto tra 12 punti (`ENERGY_RECOVERY`) e il 40% dell'energia che manca (`ENERGY_RECOVERY_SHARE`), entrambi da 0,7 a 1,3 volte con la Resistenza, una volta e mezza per chi non ha giocato. Con i soli 12 punti chi giocava sempre 42 minuti non si stabilizzava; con la sola quota il titolare da 35 minuti restava troppo vicino a 85.
- **Metriche di lungo periodo** (`pnpm sim:seasons`): in più monte stipendi mediano tra il cap (con il 2% di tolleranza: senza eccezioni tipo mid-level chi ha spazio si ferma al cap) e la tassa, dalla seconda stagione (la prima sono i contratti veri, con la mediana proprio alla soglia della tassa); al più 3 squadre in media sotto il monte minimo; almeno una squadra sopra la tassa ogni stagione; bot in rosso a fine simulazione tra 2 e 18, ricchi (più di una stagione di ricavi da parte) al massimo 9; minuti giocati da chi ne chiede 42 nelle partite senza problemi di falli (al massimo 3), senza infortuni e senza supplementari, almeno 40. L'esperimento sull'energia usa tutte le 30 squadre.
- **Risultati** con `pnpm sim:seasons 10` (partite vere, seed di default), prima e dopo: monte stipendi mediano dalla seconda stagione 1,04 volte il cap (prima 0,69: nel 2035 173 milioni con il cap a 303); squadre sotto il monte minimo in media 2,5 (prima 22,3, tutte e 30 dal 2031); sopra la tassa almeno 2 ogni stagione (prima nessuna dal 2028); in rosso in media 13,2 (prima 12,2), alla fine 9 bot in rosso e nessuno ricco; energia a inizio gara 89,1 a 35 minuti e 72,4 a 42 (prima 83,0 e 74,1), 40,9 minuti giocati su 42 (prima circa 35,6); scambi tra bot 3,4 a stagione (prima 5,7); al massimo 4 titoli per squadra. `pnpm sim:calibrate 1000` dà gli stessi numeri di prima. Con altri seed le metriche economiche ballano un po' intorno ai limiti (con `--seme=prova-b` 15,2 squadre in rosso in media contro un massimo di 15); anche il motore di prima arrivava a 4 titoli per la stessa squadra con alcuni seed.
- **Leghe già in corso:** con le Edge Functions cambiano subito richieste degli svincolati e dei rinnovi (più alte), valutazioni e offerte dei bot, scelte protette, strategie, firme in rosso fino al monte minimo, recupero dell'energia, minuti oltre 36 e il divieto di rifirmare chi si è tagliato (che vale anche per i tagli già fatti in questa stagione). Contratti firmati, saldi e ricavi della stagione in corso restano com'erano: le leghe già create continuano con i loro ricavi (170 milioni nel 2026-27, poi +7% l'anno), perché i ricavi stanno nella riga di `seasons`.

Server e pubblicazione della seconda analisi.

- **Si pubblica solo la punta di `main`:** `pages.yml` e `supabase.yml` controllano con `git ls-remote origin refs/heads/main` che il commit provato dai Controlli sia ancora la punta di `main`. Se non lo è (un controllo vecchio rilanciato, due push i cui controlli finiscono in ordine inverso) il run lo scrive nel log e non pubblica: ci pensa il run del commit più recente. L'avvio a mano (`workflow_dispatch`) vale solo da `refs/heads/main`. Il job Supabase usa l'environment `supabase` (GitHub lo crea al primo run): gli si limitano i rami a `main` e gli si sposta il segreto `SUPABASE_ACCESS_TOKEN`, così nessun altro workflow lo legge.
- **Segreto tra database ed Edge Functions:**
  - advance-turn, push e il `tick` del draft senza utente (`verify_jwt` spento, li chiamano pg_net e pg_cron) accettavano chiunque. Ora il database manda l'intestazione `x-nbbgm-secret` con il valore di `private.settings` (`functions_secret`, almeno 32 caratteri; `private.function_headers`, usata da `private.kick`) e le funzioni la confrontano a tempo costante con il loro segreto `NBBGM_FUNCTIONS_SECRET` (`_shared/secret.ts`): senza, rispondono 401 prima di toccare il database;
  - si è scelto `private.settings` e non Vault: lo legge solo il proprietario del database (RLS senza policy, nessun permesso ai ruoli dell'API), come `functions_url`, e funziona anche su PGlite;
  - pubblicazione sicura: senza la riga nel database l'intestazione non parte, e una funzione senza il suo segreto accetta tutto come prima. Si attiva prima la riga nel database, poi il segreto delle funzioni (`supabase/README.md`): nessuna chiamata resta senza intestazione;
  - una chiamata rifiutata conta comunque come invocazione del piano Free: il segreto impedisce a chi non è il database di far girare turni e notifiche e di caricare il database, non di consumare chiamate. `verify_jwt` non aiuterebbe: la chiave publishable è nell'app.
- **Turni bloccati senza commissario:**
  - il commissario passa il ruolo a un altro manager della lega (`transfer_commissioner`, "Passa il ruolo di commissario" nella gestione della lega); lui resta in lega come manager;
  - un turno fermo dopo l'ultimo tentativo (`failed_at`) lo riapre qualsiasi membro 6 ore dopo il blocco (`private.member_reopen_hours`, `MEMBER_REOPEN_HOURS` nell'app): abbastanza perché il commissario se ne accorga, non tanto da fermare la lega per giorni. Prima delle 6 ore la scheda dice da che ora si potrà; l'errore resta visibile solo al commissario;
  - la riapertura fa ripartire anche l'orologio del ritmo degli allenatori: `reopen_round` rimette `rounds.created_at` ad adesso (lo usa solo `private.round_due`). Prima, con tutti gli allenatori, il turno riaperto si richiudeva entro 15 secondi con gli stessi dati;
  - `reopen_round(lega, seed nuovo, ritira il mercato)`: con la terza scelta si ritirano offerte agli svincolati, tagli e rinnovi chiesti e proposte di scambio in attesa o accettate di tutta la lega, con gli avvisi delle proposte, se è il mercato a far fallire la simulazione. Nell'app è una casella sopra i pulsanti di riapertura;
  - un tentativo che non salva errori (Edge Function fermata per tempo o memoria) lo scrive la ripresa successiva: `rounds.last_error_at` (solo server) dice quando advance-turn ha salvato l'ultimo errore; se è prima dell'inizio del tentativo, `try_close_round` scrive "Simulazione interrotta senza un errore: probabilmente ha superato il tempo o la memoria della Edge Function".
- **Niente cambi di squadra durante una simulazione:**
  - `join_league` e la cancellazione di un account (`before_profile_delete`, che prende il lock di ogni lega toccata, in ordine, e alla fine fa partire il turno se i rimasti sono tutti pronti) passano da `private.lock_open_round` come liberare, espellere e lasciare. Un account non si cancella mentre una sua lega simula: si riprova dopo;
  - `private.lock_open_round` rifiuta solo quando una simulazione può essere in corso (in chiusura da meno di 5 minuti e non fermo), come `delete_league`. Con il turno fermo nessuno scrive e la ripresa legge lo stato nuovo: il commissario libera la squadra di un assente anche con il turno bloccato.
- **Iscrizioni su invito:**
  - hook "before user created" di Supabase Auth (`public.hook_before_user_created`, lo esegue solo `supabase_auth_admin`): un account nuovo entra se la sua email è tra gli inviti (`signup_invites`) o se l'iscrizione porta nei metadati un codice invito valido (`invite_code`, scritto in qualunque modo); altrimenti 403 "Iscrizione solo su invito...". Chi ha già un account entra come prima. L'hook si attiva a mano dalla dashboard (`supabase/README.md`): finché è spento non cambia nulla;
  - l'app manda il codice della pagina d'invito (`#/entra/CODICE`, `inviteCodeFromHash`) quando chiede il codice via email; se il server rifiuta, la pagina di accesso chiede il codice invito. Il rifiuto di Google torna nell'indirizzo e la pagina lo mostra (`oauthError`);
  - con Google non si mandano metadati: chi si iscrive con Google va invitato per email. Il commissario invita dalla gestione della lega (`invite_email`, `remove_invite`, al massimo 40 inviti per lega: `private.max_invites_per_league`); gli inviti li legge solo lui e si consumano all'iscrizione (`handle_new_user`).
- **Codice invito nuovo e bandi:** il commissario cambia il codice (`regenerate_invite_code`): il link vecchio smette di valere, anche per iscriversi. Vede gli esclusi (`league_bans_list`) e toglie il bando (`unban_manager`). Non c'è un bando per chi è già uscito: nessuno tiene traccia degli usciti, con il codice nuovo non rientra e, se rientra, lo si espelle.
- **Spazio del database:**
  - la cronaca delle partite resta solo per la stagione in corso (`private.play_by_play_seasons` = 1; prima anche quella prima): con circa 25 MB a stagione per lega era quasi tutto il peso. In offseason resta quella della stagione appena finita;
  - la pulizia notturna misura il database (`private.database_mb`): da 400 MB (`private.storage_warning_mb`, su 500 del piano Free) manda ai commissari di tutte le leghe un avviso informativo `storage`, uno solo finché non lo leggono, e `check_league_limit` non crea leghe nuove (`hint` `storage_full`);
  - al massimo 30 leghe in tutto il database (`private.max_leagues_total`, `hint` `league_limit_total`), oltre alle 5 per utente: con la registrazione aperta non c'era un tetto. Una lega nuova pesa 2-4 MB; la soglia dello spazio fa da secondo freno per le leghe che giocano. create-league mostra i due messaggi così come sono.
- **Notifiche:**
  - le notifiche di decisione si raggruppano per persona, turno e tipo di avviso: al massimo una ogni 5 minuti (`private.push_throttle`, `private.decision_push_gap`; `push_retry` toglie i raggruppamenti scaduti). Un turno nuovo è un'altra chiave, così i turni dell'offseason che corrono veloci avvisano ognuno;
  - una squadra fa al massimo 5 proposte di scambio alla stessa squadra nello stesso turno, ritirate comprese (`private.max_proposals_per_pair` in `market_write`): ogni proposta a un umano gli toglie anche il Pronto;
  - "Turno nuovo" non arriva a chi in play-in e playoff non gioca il turno (`private.team_readiness` diverso da `out` in `push_round`);
  - un'iscrizione rifiutata 3 volte di fila dal servizio push con 400, 401 o 403 si cancella (`push_subscriptions.failures`, `push_failed`; `PERMANENT_FAILURES` in `_shared/push.ts`); un invio riuscito azzera il conto, 429 e 5xx non contano. Dopo un cambio delle chiavi VAPID le iscrizioni vecchie spariscono così, e chi riapre l'app si iscrive di nuovo da solo (`syncPush`). Si è scelto il conto invece di salvare la chiave con ogni iscrizione: non cambia l'app e vale anche per le iscrizioni già salvate.
- **Stesso seed, stesso turno:** `league_state` dà ogni lista in un ordine fisso, con l'id come ultimo criterio (migrazione `20261106170500_league_state_order.sql`, partita dalla versione con `releases`); `leagueStateFromRows` rimette comunque in ordine squadre (sigla), giocatori, contratti, residui, scelte e swap, le liste dove nel motore a parità di valore vince chi viene prima (`buildVeteranTrade`, `resolveDraft`). Un test dà al motore le stesse righe in ordine inverso e controlla che il turno sia identico. Nelle leghe in corso cambia l'ordine di contratti, scelte e swap che il motore vede: qualche scambio tra bot può andare diversamente, le partite no (il test golden non passa da `state.ts`).
- **Traffico del mercato, lasciato com'è** (poi ridotto con `market_state`: vedi "Prestazioni della seconda analisi"): la funzione `market` leggeva tutto `league_state` a ogni azione (1,3 MB nella lega di prova: giocatori 58%, partite 24%, scelte 9%, contratti 8%). I giocatori con abilità e tendenze servono ai controlli (richieste degli svincolati, valutazione degli scambi); togliere partite e serie farebbe risparmiare circa un quarto, ma il turno, la trade deadline e le classifiche del motore vengono dalle partite, e il controllo dell'azione e la chiusura del turno vedrebbero stati diversi.

Dettagli dell'app della seconda analisi.

- **Numero sull'icona dell'app** (`badgeRefresher` in `lib/appBadge.ts`): gli aggiornamenti vanno in fila, una lettura alla volta, e una richiesta arrivata durante una lettura ne fa partire un'altra subito dopo (prima si scartava e il numero poteva restare vecchio). Si aggiorna, oltre che all'avvio e al ritorno in primo piano, quando cambiano le decisioni aperte nella barra del turno e nella scheda del turno (la pagina della lega, dove la barra non c'è) e dopo ogni risposta a un avviso.
- **Pagine al cambio di turno:** si rileggono anche Statistiche e Draft annuale (`useRoundChange`); nello Storico la stagione in corso (corsa ai premi, classifica attuale) dipende anche dal turno (`leagueDetail.roundId`), le passate no. Nel Draft annuale, chiuso il turno del draft, la lista non si modifica più.
- **Barra del turno legata alla lega** (`barFor`, `BarStatus.leagueId`): cambiando lega restano i dati di prima mentre arrivano i nuovi (`keep`), ma la barra li usa solo se sono della lega aperta; intanto mostra un segnaposto della stessa altezza, senza pulsanti. Toccando la notifica di un'altra lega non compare più il turno vecchio e "Sono pronto" non va alla lega sbagliata.
- **Cronaca a pagine per chiave** (`afterCursor`, `ChronicleCursor`): "Mostra altri" riparte dall'ultima riga letta, con il filtro `created_at < x or (created_at = x and id < y)` (la data così come arriva dal database, microsecondi compresi), non dalla posizione. Le transazioni che arrivano nel frattempo (draft iniziale dal vivo, senza cambio di turno) non fanno più ripetere righe; le righe aggiunte in fondo non hanno comunque doppioni (`appendEntries`). Senza la colonna `team_codes` il filtro per squadra si fa sulla pagina letta e il cursore resta l'ultima riga letta.
- **Barra e scheda del turno dalla stessa fase** (`roundPhase`, `PHASE_LABEL`, `readyAction` in `lib/turns.ts`): draft iniziale in corso, turno bloccato dopo l'ultimo tentativo, simulazione in ritardo (più di 5 minuti), simulazione in corso, lega in pausa, aperto. Prima la barra mostrava "Simulazione…" per sempre con il turno bloccato (ora legge anche `closing_started_at`, tentativi e `failed_at`), e con il draft iniziale in corso la scheda offriva il Pronto e la barra no: ora nessuna delle due, perché il server non chiude il primo turno prima della fine del draft.
- **Icona delle notifiche nella barra di stato di Android** (`badge` della notifica): `icons/badge-96.png`, la palla bianca su fondo trasparente con le cuciture vuote, disegnata da `pnpm icons` (`renderBadge`, PNG RGBA). Android usa solo la trasparenza del badge: con `icon-192.png`, opaca, disegnava un quadrato bianco. Le altre icone escono identiche byte per byte; il badge è tra i file in cache del service worker.
- **Conferme:** tutte le azioni da confermare usano `ConfirmButton` (secondo tocco entro 5 secondi, poi torna com'era): libera, espelli, lascia la lega, passa il ruolo di commissario (la conferma riparte se si sceglie un altro manager), cambia il codice invito, togli il bando, forza l'avanzamento, riapri il turno (con lo stesso seed o nuovo), taglia nella scheda giocatore. Prima molte restavano su "Confermi?" per sempre. La richiesta di conferma si annuncia ai lettori di schermo con una regione `status` nascosta, sempre presente (`confirmAnnouncement`).
- **Messaggi in basso** (`Toast`): due regioni sempre presenti, `status` per le conferme e `alert` per gli errori, che così si annunciano subito. Gli errori si chiudono da soli dopo 15 secondi (`TOAST_ERROR_MS`; le conferme dopo 6), per non coprire per sempre il fondo della pagina.
- **Avviso di una versione nuova** (`UpdateBanner`): sta nell'intestazione, sotto il menu della lega, con i margini delle aree sicure dell'intestazione; resta in vista quando la pagina scorre ma non copre più menu e selettore delle leghe. Si chiude con ✕ fino alla prossima apertura dell'app. Fuori dalle pagine con l'intestazione (accesso, errori) non c'è: lì si ricarica a mano o con il pulsante dell'errore.
- **Tema scuro del browser:** `theme-color` arancione nel tema chiaro e slate-900 (il colore dell'intestazione) nello scuro, `color-scheme: light dark` per campi, barre di scorrimento e fondo. Con lo stile Edicola carta rosa e inchiostro.
- **Menu della lega:** su telefono scorre in orizzontale; la voce della pagina aperta si porta in vista spostando solo il menu, non la pagina (`navScrollDelta`).
- **Suggerimento d'installazione nell'app installata:** era già nascosto (`installAdvice` con `display-mode: standalone` e `navigator.standalone`). I primi passi della lega (`WelcomeCard`) ricompaiono invece una volta nell'app installata su iPhone, che ha una memoria del browser diversa da Safari: non c'è un modo semplice per saperlo senza salvarlo sul server, e si è lasciato così.
- **Infortunati con la rosa cortissima** (motore, `checkSubs`): chi si infortuna senza nessuno in panchina che possa sostituirlo (sano e senza 6 falli) esce lo stesso e la squadra resta in 4, o meno, finché in campo ne restano almeno 2 (`MIN_PRESENT`, come il minimo della FIBA): dal quarto infortunio di una squadra da 5 l'infortunato continua. L'assente (`absent`) resta nel suo slot ma non gioca minuti, non si stanca, non tira, non passa, non prende rimbalzi, non ruba, non stoppa, non fa falli e non ha il più/meno; sul suo uomo arriva il migliore degli altri, e una squadra in meno di 5 difende all'85% (`SHORTHANDED_DEFENSE`). Chi ha 6 falli senza sostituti invece resta in campo, come nella NBA. Con gli infortuni moltiplicati per 8 e 5 sani escono 1.168 infortunati su 1.178, in 1.200 partite (nella prova dell'analisi ne restavano in campo 294 su 298, a giocare infortunati); i 10 rimasti sono il caso dei 2 in campo.
- **Infortunio nuovo di un infortunato** (`applyGameToPlayers`): chi gioca già infortunato (sotto i 5 sani, `gamePlayers`) e si fa di nuovo male tiene lo stop più lungo; prima un infortunio leggero poteva accorciare quello di prima.
- **Stessi risultati:** nelle partite normali nessuno è assente, e ogni controllo nuovo dà gli stessi pesi e le stesse estrazioni: il test golden passa senza cambiare impronte e `pnpm sim:calibrate 1000` dà gli stessi numeri. Cambiano solo le partite con un infortunio senza sostituti.

Prestazioni della seconda analisi.

- **Lettura leggera per le azioni di mercato** (`public.market_state(lega, giocatore)`, migrazione `20261107090000_market_state.sql`, solo per il server):
  - la funzione `market` leggeva tutto `league_state` a ogni azione (1.315 KB nella lega di prova, 175 compressi); ora 307 KB (47 compressi). Il controllo (`checkMarketAction`) è lo stesso, sullo stato che il motore riceve da `leagueStateFromRows`;
  - niente partite (in regular season la trade deadline guarda il numero del turno, e la fase della stagione è `regular` solo nei turni di regular season), infortuni, impostazioni, allenatori, avvisi, offerte, preferiti del draft; dei giocatori solo squadra, nome, ruoli, età, anzianità, morale e potenziale stimato, e solo quelli con una squadra più il giocatore dell'azione; di contratti, residui, scelte e swap le colonne che il motore legge; il seed della lega vuoto;
  - le abilità solo al giocatore dell'azione (`actionPlayer`: offerta, taglio, rinnovo; un id che non è un uuid non arriva al database). A un giocatore senza abilità il motore non calcola l'overall e la funzione si ferma con un errore, non con un risultato sbagliato;
  - nei test ogni azione si controlla con le due letture e devono dare lo stesso esito (`checkedMarketAction` in `scripts/src/db/marketCheck.ts`, usata da `market.test.ts` e `offseason.test.ts`): se un controllo nuovo usasse dati che `market_state` non dà, i test lo direbbero;
  - il turno legge ancora tutto `league_state` (gli serve) e scrive circa 538 KB (cronaca 301, statistiche 118, giocatori 109): lasciato com'è. Si potrebbe togliere ancora qualcosa dal mercato (le scelte quando l'azione non è uno scambio, i giocatori delle squadre che non c'entrano), ma la lettura saprebbe sempre di più del controllo: per ora no.
- **Stato del turno in una lettura** (`public.turn_status(lega)`, migrazione `20261107090100_turn_status.sql`, `security invoker`: legge con la RLS di chi chiama, per chi non è nella lega dà null):
  - turno (con tentativi e blocco), pausa, draft iniziale, Pronto, allenatori, propri avvisi aperti, ultima partita della propria squadra, stato delle squadre (`round_readiness`), squadre in campo in play-in e playoff, campione: circa 0,7 KB;
  - la barra faceva 4 richieste in 2 viaggi, la scheda da 6 a 9 in 2-3; ora una. Tipi e conversione (`turnFromServer`) stanno in `lib/turnStatus.ts`, modulo puro che usa anche il test sul database (`scripts/test/turnStatus.test.ts`); senza la funzione (app pubblicata prima delle migrazioni) `loadTurn` legge dalle tabelle come prima.
- **Un solo stato del turno per lega** (`lib/turnStore.ts` su `lib/sharedStore.ts`): barra, scheda e `useRoundChange` leggono lo stesso negozio (chiave lega e utente), con un solo canale in tempo reale (turni, Pronto, allenatori, avvisi), un solo timer di 30 secondi e un solo ascolto del ritorno in primo piano:
  - i segnali a raffica valgono come uno (300 ms), le letture vanno in fila (una alla volta, una sola in più se ne arrivano durante una lettura), una lettura fallita lascia i dati di prima;
  - lasciata l'ultima pagina che lo usa, l'ascolto resta 5 secondi: passando dalla scheda alla barra i dati restano e non si rileggono;
  - prima ogni pagina con `useRoundChange` apriva un altro canale sui turni e leggeva il turno corrente: ora guarda il negozio (`roundChangeWatcher`). Nella prova: passando dalla pagina della lega a Squadra 8 richieste invece di 13 e un canale con 4 ascolti invece di due con 5; al ritorno in primo piano 2 richieste invece di 6;
  - la barra mostra un segnaposto della stessa altezza mentre arrivano i dati; la scheda rilegge quando cambia la propria squadra (lasciata o liberata).
- **Pagina di una squadra:**
  - scelte e swap si chiedono solo per la squadra (`involving`: `owner_team_id` o `original_team_id`, `holder_team_id` o `other_team_id`): nella lega di prova 3 KB invece di 91;
  - record e posto in conference vengono dalla classifica (`currentStandings` in `useSeason.ts`): dalle partite in memoria se Risultati, Classifica o Playoff le hanno già lette (`KeyedCache.has`), altrimenti dalle sole partite di regular season giocate con le colonne della classifica (`regularSeasonRecords`, `STANDINGS_COLUMNS`), in memoria per turno. Alla giornata 7 14 KB invece di 310; a fine stagione circa 190.
- **Storico:** una stagione passata non cambia più: statistiche salvate e classifica finale (dalle partite di regular season con le colonne della classifica, 194 KB invece di 310) si leggono una volta per sessione (`pastSeason`, `KeyedCache` per stagione, fino a 6). Tornando a una stagione già vista nessuna richiesta. La stagione in corso usa `currentStandings` come la pagina squadra.
- **Classifica e Playoff:** la classifica si calcola con `useMemo` sui dati della stagione, non a ogni disegno.
- **Service worker: a una pubblicazione si scaricano solo i file cambiati** (`precachePlan` in `src/pwa/serviceWorker.ts`):
  - l'elenco dei file in `sw.js` ha per ognuno l'impronta del contenuto (`ShellEntry`): i file con l'hash nel nome (`assets/`, `isHashedAsset`) non ne hanno bisogno (stesso nome, stesso file), quelli di `public/` hanno lo sha-256 del contenuto, la pagina `./` cambia a ogni versione (punta ai file nuovi);
  - all'installazione i file uguali si copiano dalle cache delle versioni di prima, gli altri si scaricano senza la cache HTTP; le impronte si salvano nella cache (`./nbbgm-impronte.json`). Dalla cache del service worker di prima, che non ha impronte, si riusano i soli file con l'hash nel nome. Se un file non arriva l'installazione fallisce e resta la versione di prima, intera; all'attivazione le cache vecchie si cancellano come prima;
  - **pezzi della build che non si trascinano** (`codeSplitting` in `vite.config.ts`): l'hash di un pezzo dipende anche dai nomi dei pezzi che importa, e le pagine importavano dal pezzo d'ingresso, che contiene l'elenco delle pagine: cambiando una pagina cambiavano i nomi di 37 file su 49. Ora React, router e Supabase stanno in pezzi propri, il codice dell'avvio nel pezzo `avvio` e nel pezzo d'ingresso restano solo `index.html`, `main.tsx`, `App.tsx`, `Layout.tsx` e `pushWatch.ts` (gli unici con gli `import()`, `ENTRY_MODULES`), che nessuno importa. `LAST_LEAGUE_KEY` è passato da `Layout.tsx` a `lib/leagues.ts` per questo;
  - a una pubblicazione si riscaricano: una pagina cambiata 3 file, 5,7 KB compressi; una modifica a una libreria comune delle pagine (`turns.ts`) 21 file, 57 KB; una al codice dell'avvio (`errors.ts`) 35 file, 89 KB. Prima sempre tutti: 48 file, 285 KB. Provato nel browser: pubblicazione simulata con 3 file scaricati e 49 riusati, la cache vecchia cancellata e l'app aperta senza rete nella versione nuova, anche nelle pagine con i pezzi riusati.
- **Avvio:** 164 KB compressi, come prima (8 file invece di 5): React DOM 66, Supabase 47, router 30, codice dell'app 13 (avvio 9,4, ingresso 3,1) e CSS 7. Niente di semplice da togliere: in Supabase pesano l'auth con l'API admin e WebAuthn (non usate, ma il client le crea sempre: toglierle vorrebbe dire sostituire file interni del pacchetto, come per lo Storage ma più fragile), il router dati serve a `useBlocker`, e la pagina di accesso a pezzi farebbe aspettare chi entra la prima volta per risparmiare 3 KB agli altri. Cambiare libreria non ne vale la pena.
- **Misure** con la lega di prova (giornata 7) e il client finto, sulle build di produzione, byte delle risposte in JSON senza intestazioni HTTP:

  | Misura                                                              | Prima                                        | Dopo                  |
  | ------------------------------------------------------------------- | -------------------------------------------- | --------------------- |
  | KB all'avvio (compressi)                                            | 163,5 (5 file)                               | 163,9 (8 file)        |
  | KB riscaricati a una pubblicazione (una pagina cambiata, compressi) | 285 (48 file)                                | 5,7 (3 file)          |
  | Pagina della lega, aperta da zero                                   | 15 richieste, 8,3 KB                         | 10 richieste, 8,5 KB  |
  | Squadra di un'altra squadra, aperta da zero                         | 22 richieste, 430 KB                         | 17 richieste, 47 KB   |
  | Storico (stagione passata), aperto da zero                          | 16 richieste, 453 KB                         | 12 richieste, 341 KB  |
  | Storico, di nuovo una stagione già vista                            | 3 richieste, 446 KB                          | nessuna               |
  | Stato del turno ogni 30 secondi e a ogni Pronto                     | barra 4 richieste in 2 viaggi, scheda 6 in 2 | 1 richiesta           |
  | Ritorno in primo piano (in Squadra)                                 | 6 richieste                                  | 2 richieste           |
  | Letti dal server per un'azione di mercato                           | 1.315 KB (175 compressi)                     | 307 KB (47 compressi) |
  | Letti e scritti dal server per un turno                             | 1.315 + 538 KB                               | uguale                |

Funzioni nuove della seconda analisi.

- **Elenco delle leghe dal vivo** (`lib/leaguesLive.ts`, `public.my_leagues_status()`, migrazione `20261107100000_leagues_status.sql`):
  - per ogni lega "Tocca a te" (propria squadra non pronta o con l'allenatore fermo da un avviso), "Pronti 3/5" (umani pronti o con l'allenatore, sul totale di chi gioca il turno), le decisioni bloccanti aperte e lo stato della lega con le etichette di barra e scheda (`roundPhase`: draft in corso, turno bloccato, simulazione in corso o in ritardo, pausa);
  - una sola lettura per tutte le leghe, `security invoker` come `turn_status`, con lo stato delle squadre da `round_readiness` (quindi `private.team_readiness`): circa 0,3 KB per lega;
  - si rilegge al ritorno in primo piano e ogni minuto con la pagina visibile (`LIVE_REFRESH_MS`); nessun canale in tempo reale. Senza la funzione (app pubblicata prima delle migrazioni) l'elenco resta com'era;
  - i colori delle etichette stanno in `TONE_CLASS` (`lib/turns.ts`), condivisi con la barra del turno.
- **Riepilogo del turno da condividere** (`lib/summary.ts`, `components/ShareTurn.tsx`, nella scheda del turno dopo la prima partita):
  - una riga per argomento: risultato della propria partita, posto in conference e record (solo con almeno una partita), infortuni della squadra, svincolati firmati con le offerte vinte nel turno appena chiuso, prossima partita, link alla pagina della lega (`appLink`);
  - solo dati che i membri vedono già, più le proprie offerte vinte: nessun valore nascosto. I dati si leggono solo al tocco (4-5 letture piccole), e `summary.ts` arriva a pezzi;
  - in due tocchi: "Riepilogo da condividere" legge e mostra il testo, poi "Condividi" apre il pannello del sistema (`navigator.share`) e "Copia" lo mette negli appunti, con la conferma in basso (`Toast`). Safari su iPhone apre il pannello solo subito dopo un tocco, non alla fine di un caricamento. Se il pannello non è permesso si copia; se il manager lo chiude non si copia (`shareText`, `lib/share.ts`).
- **Partita dal vivo** (`lib/replay.ts`, `components/LiveGame.tsx`, vista "Dal vivo" della pagina della partita, `?vista=dal-vivo`):
  - la cronaca salvata (formato di `compactPlayByPlay`) si rigioca con punteggio e cronometro che scorrono: il tempo è in secondi dall'inizio (quarti da 12 minuti, supplementari da 5), il punteggio è quello dell'ultima azione già avvenuta; avvia e pausa, velocità ×10, ×30 (un minuto e mezzo a partita) e ×90, vai alla fine, rivedi; le ultime 12 azioni sotto il tabellone. Ai lettori di schermo si annuncia solo il finale;
  - la cronaca (circa 20 KB) non si legge più con il box score: `gameDetail` non la chiede, `gamePlays` la legge solo aprendo Cronaca o Dal vivo. Per le partite delle stagioni passate (`private.play_by_play_seasons` = 1) un messaggio dice che non si può rivedere;
  - **senza spoiler** (memoria del browser `nbbgm:senza-spoiler`, interruttore nei Risultati): punteggi nascosti, serie dei playoff solo "Gara N", "Guarda dal vivo" al posto di "Box score e cronaca"; nella partita dal vivo titolo e parziali restano nascosti finché il replay non finisce o il manager non apre box score o cronaca (per ogni partita: la pagina resta montata passando dall'una all'altra). Anche la scheda del turno nasconde il punteggio dell'ultima partita e porta ai Risultati.
- **Anteprima dello scambio** (`lib/tradePreview.ts`, `PreviewCard` in `components/TradeBlock.tsx`):
  - prima di inviare una proposta, per le due squadre prima e dopo: monte stipendi, spazio sotto il cap o distanza dalla tassa, luxury tax stimata, rosa standard e two-way contro i limiti (in offseason 21 in tutto), buchi nuovi della regola Stepien, vincolo del saldo in rosso; sotto, i motivi per cui il server la rifiuterebbe;
  - i motivi sono quelli di `validateTrade` del motore su uno stato ridotto alle due squadre, con le sigle come id (come sul server): stesse frasi della funzione `market`. Un test confronta i risultati con `validateTrade` sullo stato intero di una lega generata;
  - sugli stessi dati che il mercato ha già letto (rosa, bilancio, scelte della lega), più all'apertura della squadra dell'altra parte rosa, residui dei tagliati e strategia (`teamExtra`) e gli swap aperti della propria squadra. Nessuna chiamata alla Edge Function: decide sempre il server;
  - il saldo e la storia della tassa dell'altra squadra sono riservati: per lei il vincolo del saldo è "riservato: lo controlla il server" e la tassa si stima con le aliquote normali.
- **Giocatori sul mercato** (`public.trade_block`, migrazione `20261107100100_trade_block.sql`, `lib/tradeBlock.ts`):
  - **scrittura nuova del client**: il manager segna e toglie i propri giocatori (inserisce e cancella righe di `trade_block`). RLS: lettura per i membri della lega, scrittura con `private.can_edit_team` (la propria squadra, a turno aperto: niente scritture a turno in chiusura) e solo giocatori della squadra. Permessi espliciti (`select, insert, delete` ai manager, tutto al server); il test sui permessi elenca la scrittura nuova;
  - le righe spariscono da sole: un trigger su `players` toglie il giocatore che cambia squadra (scambio, taglio), uno su `teams` svuota la lista quando la squadra cambia manager (liberata, lasciata, presa da un altro); le funzioni dei trigger sono chiuse a `public`, `anon` e `authenticated`;
  - si vedono nella pagina della squadra (sezione "Sul mercato", con "Proponi") e nel mercato: "Sul mercato nella lega" con le liste dei manager e "Proponi" (apre la nuova proposta con `?con=<squadra>&prendi=<giocatore>`), "I tuoi giocatori sul mercato" con le caselle, e nella nuova proposta i giocatori sul mercato dell'altra squadra in cima, segnati;
  - **bot** (`botTradeBlock`, scelto dall'utente): una lista indicativa dalla strategia, al massimo 4 contratti standard: in ricostruzione i veterani da 29 anni, in corsa i giovani fino a 24 anni fuori dagli 8 della rotazione, a metà strada i contratti in scadenza fuori dai primi 5. Si vede nella pagina della squadra e scegliendo il bot nella proposta; nel riquadro della lega no, perché servirebbero le rose intere dei bot. La valutazione degli scambi dei bot non cambia.
- **Menu della lega in basso su telefono** (`components/BottomNav.tsx`, sotto `sm`):
  - Lega, Squadra, Mercato, Risultati (le pagine di ogni turno, scelte dall'utente) e Altro, che apre sopra la barra Classifica, Playoff, Statistiche, Cronaca e Storico (dalla riorganizzazione delle pagine Risultati è diventata Campionato: vedi "Organizzazione delle pagine dopo la terza analisi"); icone disegnate in linea, voci alte 56 px. Il pannello si chiude cambiando pagina, con Esc (il fuoco torna su Altro) e toccando fuori; aperto, sta sopra i messaggi in basso. Da `sm` in su resta il menu in alto, che sotto `sm` è nascosto;
  - convivenza: nelle pagine della lega (`has-bottom-nav` nel `Layout`) una regola di `index.css`, fuori dai layer di Tailwind, dà alla pagina lo spazio della barra (`main-above-nav`) e appoggia sopra la barra quello che è fisso in basso (`dock-above-nav`: barra Salva di Squadra e `Toast`); l'area sicura in basso la tiene la barra. Barra del turno e avviso di versione nuova stanno in alto;
  - la barra non ha `backdrop-blur`: un filtro la renderebbe il riferimento dei figli `fixed` e il velo che chiude il pannello non coprirebbe lo schermo. È nell'avvio (si vede subito): circa 1 KB compresso.
- **Cerimonia di fine stagione** (`lib/ceremony.ts`, `components/CeremonyCard.tsx`):
  - campione e risultato della finale, MVP delle Finali, premi di `seasonAwards` (MVP, miglior difensore, rookie, sesto uomo), "Come si calcolano", Condividi (come il riepilogo, con il link allo Storico della stagione);
  - nella pagina della lega compare dopo la finale (turno di offseason) finché il manager non la chiude, una volta per stagione (memoria del browser `nbbgm:cerimonia:<lega>:<anno>`); arriva a pezzi con il motore. Nello Storico ogni stagione conclusa ha il pulsante "Cerimonia della stagione";
  - **MVP delle Finali** (`finalsMvp` in `packages/engine/src/season/finals.ts`, scelto dall'utente): tra i giocatori della squadra campione entrati in campo in almeno metà delle partite della finale, la valutazione (VAL, come in `awards.ts`) a partita più alta sulla somma delle partite della serie; a parità più partite, poi più punti, poi l'id più piccolo. Dai box score della serie (una decina di partite al massimo), nessun caso.
- **Confronto tra giocatori** (`pages/ComparePage.tsx`, `#/lega/<id>/confronta?g=a,b,c`, `lib/compare.ts`):
  - fino a 3 giocatori: scheda (squadra, ruolo, età, altezza, overall, potenziale stimato, costanza, etica del lavoro, distretti a rischio: le stime di `player_scouting`, mai i valori nascosti), contratto, statistiche a partita della stagione e tutte le abilità visibili; il migliore di ogni riga in verde (con il testo per i lettori di schermo). Su telefono la tabella scorre nella scheda con la colonna delle voci fissa;
  - ci si arriva da "Confronta" nella scheda giocatore e tra gli svincolati del mercato: il giocatore si aggiunge al confronto aperto nella sessione (`sessionStorage`, il quarto fa uscire il primo); nella pagina si aggiunge cercando per nome o cognome (almeno 2 lettere, 8 risultati, con la squadra) e si toglie con ✕. La ricerca toglie i caratteri dei filtri PostgREST (`searchText`) e tiene gli accenti: "doncic" non trova "Dončić".
- **Bisogni della squadra** (`components/TeamNeedsCard.tsx`, `lib/teamNeeds.ts`, `lib/skills.ts`, sopra gli svincolati del mercato):
  - ruoli scoperti rispetto a 3 PG, 3 SG, 3 SF, 2 PF e 2 C come ruolo principale (`INITIAL_DRAFT_ROLE_TARGET`, come `roleNeed`); un tocco filtra gli svincolati per quel ruolo;
  - punti deboli della rotazione: 9 gruppi di abilità visibili (tiro da 3, dalla media, al ferro, post, regia, difesa sul perimetro, protezione del ferro, rimbalzi, atletismo); la rotazione sono gli 8 contratti non two-way con la media dei gruppi più alta. Un gruppo è debole 2 punti o più sotto la media della lega (`WEAK_GAP`), al massimo 3; un tocco ordina gli svincolati per quel gruppo (ordinamenti nuovi `skill:<gruppo>` di `filterFreeAgents`, con il valore nella riga);
  - la media della lega la dà `public.league_skill_profile(lega)` (migrazione `20261107100200_skill_profile.sql`, `security invoker`): le stesse regole di `skills.ts` in SQL, una decina di numeri invece delle rose delle 30 squadre (circa 300 KB). Un test sul database la confronta con il calcolo dell'app.
- **Avvio:** 165 KB compressi (prima 164): nel pezzo d'avvio entra solo la barra in basso. Pagine e pezzi nuovi arrivano quando servono (`lazyPage`, `lazyPart`, `import()`); nessuna libreria nuova. Test golden e `sim:calibrate` invariati: queste funzioni non toccano le partite.
- **Non provato:** il pannello di condivisione vero e la copia negli appunti (il riquadro del browser della prova non ha `navigator.share` e nega gli appunti; la conferma e l'errore in basso sì); le funzioni SQL nuove girano su PGlite, non ancora sul progetto Supabase (le applica il workflow dopo il push).

Correzioni urgenti della terza analisi.

- **Scambi con elementi ripetuti** (`validateTrade`): un giocatore o una scelta che compare più di una volta (anche da tutte e due le parti) rende lo scambio non valido. Prima il bot contava ogni copia (`tradeBalance`: NYK rifiutava Brunson per Hauser e lo accettava per due Hauser), i conteggi di rosa e stipendi sbagliavano (BOS a 14 finiva a 16) e si aggirava il vincolo del saldo, mentre `executeTrade` sposta il giocatore una volta sola. Non c'è una funzione `normalizeTrade` a parte: `validateTrade` è già il controllo di tutti (funzione `market` prima di salvare, chiusura del turno, anteprima nell'app, bot), e gira anche sulle proposte già salvate. Un test a caso (`tradeRules.test.ts`) fa 600 scambi e controlla dopo ognuno rose nei limiti, contratti unici e legati alla squadra del giocatore, swap risolvibili.
- **Swap e proprietà delle scelte** (`validateTrade`, `picks.ts`):
  - uno swap è valido solo se, per quel draft e giro, le due squadre possiedono ancora la propria scelta (`swapLive`), non la cedono nello stesso scambio e nessun altro swap aperto (salvato o nello stesso scambio) tocca una delle due scelte (`swapTouches`). Prima BKN poteva vendere lo swap su una prima già ceduta (28 bot su 29 lo pagavano con una loro prima) o lo stesso swap a CHI, IND e MIL, e al draft valeva solo il primo;
  - regola scelta: una scelta legata a uno swap aperto, ancora in mano alla sua squadra, **non si cede finché lo swap è aperto** (`pickInSwap`). Lo swap non segue la scelta: nel motore uno swap è tra due squadre e le loro scelte proprie, e al draft si fa solo se le due squadre le hanno ancora;
  - rinvii delle scelte protette (`deferralYears`): una prima protetta in mano ad altri che cade nella fascia passa l'obbligo alla prima dell'anno dopo, fino a tre rinvii. Non si fa uno swap su una prima che un rinvio potrebbe portare via, né si mette una protezione che renderebbe possibile un rinvio su una prima già in uno swap aperto e valido (gli swap salvati prima che lo erano già non bloccano gli scambi che non c'entrano);
  - `swapValue` vale 0 se una delle due squadre non ha più la sua scelta; i bot non mettono nei loro pacchetti (scambi tra bot, proposte agli umani, cessioni dei contratti pesanti) le scelte legate a uno swap;
  - swap già salvati che non rispettano la regola: restano. Al draft (`resolveDraft`) uno swap che non si può fare (una delle due squadre non ha più la sua scelta, anche perché un altro swap sulla stessa scelta si è appena fatto) decade con una nota nella cronaca del draft ("Swap 2027 tra CHI e ATL decaduto: ATL non ha più la sua prima scelta"); prima decadeva in silenzio. Una proposta salvata che non rispetta più le regole salta alla chiusura del turno come le altre (`void`).
- **Anno e giro degli swap interi; forma delle proposte** (`validateTrade`, `tradeShape` in `_shared/market.ts`):
  - `validateTrade` vuole anno e giro interi (`Number.isInteger`): uno swap con anno 2028.5 era salvato, e dopo l'accettazione la chiusura del turno falliva su `draft_swaps.draft_year integer` fino a fermare il turno dopo 3 tentativi; NaN passava allo stesso modo;
  - la funzione `market` controlla la forma della proposta prima di tutto: liste di uuid, protezioni `{ uuid: intero }`, swap con anno e giro numeri interi e holder `from` o `to`, al più 30 elementi per lista (`MAX_TRADE_ITEMS`). Altrimenti risponde 400 con "Proposta non valida: ..." o "Troppi elementi nello scambio", invece di un 500 o di un errore del database. Anche gli id di offerte, proposte e richieste da ritirare devono essere uuid ("... non trovata");
  - le proposte già salvate con doppioni o swap non interi saltano alla chiusura del turno senza fermarlo (test su PGlite).
- **Scadenza e ritmo con un minimo** (migrazione `20261107110000_league_limits.sql`): vincoli `deadline_minutes >= 15` e `max_pace_seconds >= 60` su `leagues`, gli stessi minimi in `readSettings` di create-league (spostata in `_shared/league.ts`, `MIN_DEADLINE_MINUTES`, `MIN_PACE_SECONDS`, `SettingsError`, così si prova nei test). Con una PATCH a mano una scadenza di un minuto, o tutti con l'allenatore e il ritmo a 0, facevano 1.440 turni al giorno (circa 145 MB e 1.440 chiamate ad advance-turn al giorno per lega). La migrazione porta prima al minimo le leghe in corso con valori più bassi (per la scadenza il turno aperto riparte da adesso).
- **Pausa automatica delle leghe abbandonate** (scelta dall'utente: dopo 3 turni, ripresa del commissario o del primo Pronto):
  - quando un turno si chiude per scadenza senza nessuna attività umana il conto `leagues.idle_rounds` sale di uno; ogni altra chiusura (tutti pronti, allenatori, avanzamento forzato) o un turno con attività lo rimette a zero. Con 3 turni di fila senza nessuno (`private.idle_rounds_before_pause()`), alla scadenza successiva senza attività `try_close_round` non chiude il turno: la lega va in pausa (`paused`, `auto_paused_at`), il turno resta aperto e il commissario riceve l'avviso informativo `league_paused`. Con 15 minuti di scadenza basta circa un'ora senza nessuno;
  - attività umana (`private.round_idle`): Pronto dato o tolto, proposte di scambio fatte e risposte, offerte agli svincolati, tagli e rinnovi, quintetto e tattiche, allenatore attivato o cambiato, preferiti del draft, giocatori sul mercato, risposte agli avvisi; conta quello che succede tra l'apertura del turno (o la riapertura) e l'inizio della chiusura, così le scritture del server alla chiusura del turno prima (con l'ora d'apertura di questo) restano fuori. L'ora dell'ultima modifica di preferiti del draft e allenatore la mette il server (`private.touch_updated_at`; `coach_delegations.updated_at` è una colonna nuova): l'app mandava la sua;
  - i turni chiusi dal ritmo degli allenatori sono voluti e non cambiano. La scadenza chiude il turno anche con avvisi bloccanti aperti: era il caso della lega abbandonata che avanzava per sempre;
  - la riprende il commissario togliendo la pausa, come prima, oppure il primo manager che preme Pronto (`set_ready`, solo se la pausa è automatica: quella del commissario resta). In tutti e due i casi la scadenza riparte da adesso e `auto_paused_at` torna null (trigger `leagues_pause_changed`). I membri leggono `auto_paused_at`; il client non scrive né il conto né l'ora;
  - nell'app: testo dell'avviso (`alertText`), una riga nella scheda del turno con la lega in pausa (`PAUSED_NOTE`) e una nella guida.
- **Liste del draft annuale**: al massimo 100 giocatori (vincolo su `draft_lists`; i prospetti sono 70, le liste del draft iniziale restano a 600). La migrazione riduce le liste più lunghe già salvate ai prospetti di adesso, senza doppioni e nell'ordine della lista. Nel motore (`runAnnualDraft`) la lista di ogni squadra si riduce una volta ai prospetti, senza doppioni, invece di scorrerla intera a ogni chiamata: stesso primo disponibile, test golden invariato (con 200.000 uuid ogni scelta costava 0,37 s e il turno del draft superava il tempo delle Edge Functions). L'app salva solo i prospetti di quest'anno, senza doppioni e al più 100 (`annualListToSave`): la lista resta da una stagione all'altra e i giocatori già scelti negli anni prima si sarebbero sommati fino al limite.
- **Scelte già usate fuori dal mercato** (`leaguePicks`): le scelte future sono quelle senza posizione (`position is null`, come `league_state`), non quelle con il giocatore null: il turno salva le scelte usate con la posizione e il giocatore null. Prima dopo il primo draft annuale il mercato offriva 60 scelte già usate ("Una scelta dello scambio non esiste"), la pagina della squadra le contava tra le possedute e l'anteprima ci calcolava la regola Stepien. Il mercato legge ora solo le scelte della propria squadra all'apertura e quelle dell'altra parte quando la si sceglie (`involving`, circa 90 KB in meno a ogni visita); le scelte citate dalle proposte che mancano si leggono per id, anche già usate (`picksByIds`, `missingPickIds`). L'anteprima riceve anche i rinvii delle scelte (`PickInfo.deferrals`) e gli swap aperti delle due squadre, per dire gli stessi problemi del server.
- **Leghe in corso:** le proposte in attesa o accettate con elementi ripetuti, swap su scelte che non si hanno, swap su una scelta già in un altro swap o con anno e giro non interi saltano alla chiusura del turno (`void`); gli swap già venduti restano e al draft decadono con una nota se non si possono fare; le leghe con scadenza sotto 15 minuti o ritmo sotto 60 secondi passano al minimo; le liste del draft oltre 100 si accorciano; il conto dei turni senza nessuno parte da zero alla pubblicazione.
- **Stessi risultati:** test golden e `pnpm sim:calibrate` invariati; `pnpm sim:seasons 10` dà gli stessi numeri di prima (in rosso 13,2 in media, 3,4 scambi tra bot a stagione, tutte le metriche negli obiettivi). Le regole nuove cambiano qualcosa solo con gli swap, che i bot non creano.

Organizzazione delle pagine dopo la terza analisi.

- **Pagina della lega, prima quello che c'è da fare** (`pages/LeaguePage.tsx`): primi passi e cerimonia quando servono, poi il riquadro "Da fare" con le decisioni aperte (avvisi bloccanti) e i loro pulsanti, la scheda del turno con il Pronto, gli avvisi da leggere ("Da leggere": infortuni, esiti del mercato), le ultime notizie e il draft iniziale finché non è finito. Prima la pagina cominciava dal codice invito e gli avvisi stavano sotto il Pronto, mentre si decide prima e si conferma dopo:
  - `TurnAlerts` (in `components/TurnCard.tsx`, `group` `todo` o `read`) legge lo stesso stato del turno della scheda e della barra (`useTurn`): nessuna lettura in più. `alertGroups` (`lib/turns.ts`) mette le decisioni per tipo, dalle più care senza risposta (proposta di scambio rifiutata, giocatore in scadenza perso: poi rosa corta, draft, free agency, preparazione, tipi nuovi) e a parità dalla più vecchia; gli avvisi da leggere dal più recente;
  - la scheda del turno non ha più i link a Risultati, Classifica, Tabellone e Mercato, che stanno nel menu: resta Draft in offseason, perché il draft annuale non è nel menu. Tolta anche la card "Gestisci la squadra", che ripeteva il menu.
- **Info lega** (`#/lega/<id>/info`, `pages/LeagueInfoPage.tsx`): codice invito con Condividi e Copia invito (`components/InviteCard.tsx`), le 30 squadre con i manager, impostazioni (con il link al draft iniziale finito) e gestione della lega (`LeagueAdmin`). Codice e gestione stanno insieme perché il commissario che cambia il codice lo vede subito. Nella pagina della lega restano un link in fondo e, subito dopo la creazione (`?nuova=1`), il codice invito.
- **Menu a 5 voci** (`lib/leagueNav.ts`: `LEAGUE_LINKS`, `MAIN_LINKS`, `activeLink`):
  - su telefono Lega, Squadra, Mercato, Campionato e Altro (Statistiche, Cronaca, Storico, Confronta, Info lega); da `sm` in su le stesse voci in linea. L'icona di Campionato è una coppa disegnata in linea come le altre;
  - la voce attiva si calcola dall'indirizzo, non con `NavLink`: Campionato è accesa su risultati, classifica, playoff e partite; squadre degli altri, giocatori e draft non accendono voci. Il menu in alto porta in vista la voce attiva (`aria-current`, `navScrollDelta`) come prima.
- **Campionato** (`components/ChampionshipLayout.tsx`, a pezzi come le pagine):
  - schede Risultati, Classifica e Playoff sopra le tre pagine, che restano alle rotte di prima (`risultati`, `risultati/<turno>`, `classifica`, `playoff`) dentro una rotta di layout senza indirizzo: notifiche, riepilogo condiviso e link già salvati continuano a funzionare. La voce del menu porta a `risultati`;
  - le schede restano mentre la pagina arriva a pezzi (un `Suspense` dentro il layout); dati e memoria delle pagine non cambiano (`useSeason`, `KeyedCache`, `useRoundChange`, Risultati senza spoiler);
  - Playoff si vede fuori dalla regular season (play-in, playoff e offseason, con il tabellone della stagione finita), come prima il "Tabellone" della scheda del turno, o quando è la pagina aperta (`championshipTabs`): in regular season la classifica dice già chi va ai playoff e al play-in. Il tipo del turno viene dallo stato condiviso con la barra del turno.
- Guida (sezione "Le pagine"), primi passi e conferma del Pronto ("Vedi le decisioni") parlano delle pagine nuove.
- Nessuna lettura nuova dal server, nessuna migrazione: cambiano solo l'app e i test (`lib/leagueNav.test.ts`, `alertGroups` in `lib/turns.test.ts`).
- **Non provato:** le pagine nel browser (serve il login sul progetto vero; l'utente ha scelto di saltare la prova). Controllati test, tipi, lint, formattazione e build.

Stile Edicola, passo 1: colori, caratteri e menu.

- **Scelta dell'utente** tra 9 direzioni disegnate nel canvas "Stili di NBBGM" (pagina Edicola: https://claude.ai/artifact/SnJhoQpxAJNaWBoTVKuAHx): carta rosa e inchiostro come un giornale sportivo, titoli Oswald in maiuscolo, testo Source Serif 4, filetti; formazione sul campo (quintetto disposto su mezzo campo) e menu in basso staccato e arrotondato. In questo passo cambiano tema, caratteri, testata, menu e pezzi comuni; le pagine una per una e la formazione sul campo arrivano dopo.
- **Colori** (`@theme` in `index.css`):
  - le scale `slate` e `orange` di Tailwind non ci sono più (`--color-slate-*: initial`): al loro posto `stampa`, dalla carta (25 i riquadri, 50 il fondo) all'inchiostro (900), e `rosso`. Tutte le classi delle pagine sono state rinominate (slate → stampa, orange → rosso, `bg-white` → `bg-stampa-25`), così il tema chiaro e lo scuro restano quelli di prima con i colori nuovi; un test controlla che non restino classi vecchie;
  - grigi del testo almeno `stampa-500` sul chiaro (4,5:1 anche sulla carta) e `stampa-400` sullo scuro (4,5:1 anche sui riquadri `stampa-800`);
  - il rosso segna gli avvisi e l'azione principale della pagina: `Button` ha la variante `accent` (rossa, per Sono pronto); `primary` è d'inchiostro, `danger` rosso scuro, `secondary` a filo, `ghost` un link in corsivo sottolineato;
  - etichette di stato (`TONE_CLASS`, stati della scheda del turno): pronto e aperto d'inchiostro, allenatore a filo, da decidere e bloccato in rosso, in chiusura in rosa. I verdi, gialli e azzurri delle singole pagine restano per ora;
  - angoli vivi (`--radius-*` a 1-4 px, le pillole restano tonde) e niente ombre leggere sotto i riquadri.
- **Caratteri nella build, non da Google Fonts:** Oswald e Source Serif 4 variabili, presi dai pacchetti `@fontsource-variable/oswald` 5.3.0 e `@fontsource-variable/source-serif-4` 5.3.1 e copiati in `src/assets/fonts` (licenza SIL OFL 1.1, testi accanto ai file; nessuna dipendenza nuova), solo alfabeto latino ed esteso, con `unicode-range`: il browser scarica l'esteso solo per nomi come Dončić. Con l'alfabeto latino si scaricano circa 130 KB (Oswald 28, Source Serif 51 più 52 il corsivo), una volta; il service worker tiene in cache tutti e 6 i file (241 KB) con la build, così l'app si apre anche senza rete. Testo in Source Serif (`--default-font-family`), titoli `h1`-`h3` in Oswald (`font-titolo`), `h1` e `h2` in maiuscolo, numeri incolonnati nelle tabelle.
- **Testata** (`Layout`): intera nell'elenco delle leghe e nella pagina della lega (NBBGM grande al centro, doppio filetto, data e lega come sotto il nome di un giornale), su una riga sola e fissa in alto nelle altre pagine, con il doppio filetto sotto. La lega si cambia da un `select` senza bordi; il profilo è un riquadro con le iniziali (`lib/masthead.ts`).
- **Menu in alto** (da `sm`): le sezioni del giornale, in maiuscolo stretto, la pagina aperta in rosso con il filetto sotto.
- **Menu in basso** (sotto `sm`): barra d'inchiostro staccata dai bordi (0,75rem dai lati, 0,625rem dal fondo, più le aree sicure), angoli da 22 px, voce aperta in una pillola rossa; alta 4,25rem, quindi la pagina lascia sotto `4,875rem` più l'area sicura e 1,5rem, e quello che sta fisso in basso si appoggia a `4,875rem` (`index.css`). Il pannello Altro è un riquadro con il filetto d'inchiostro.
- **Barra del browser:** `theme-color` carta rosa nel chiaro e inchiostro nello scuro; nel manifest `theme_color` carta e `background_color` inchiostro. Le icone dell'app (`pnpm icons`) non sono cambiate.
- **Provato nel browser** (pannello dell'app, account dell'utente, solo lettura): elenco delle leghe, pagina della lega, Squadra, menu in basso e pannello Altro, menu in alto da computer, tema scuro; caratteri caricati (solo l'alfabeto latino), nessun elemento fuori dallo schermo, nessun errore in console. Gli screenshot del pannello nascosto erano tagliati: le misure sono state lette dalla pagina.

Stile Edicola, passo 2: tutte le pagine.

- **Pezzi comuni** (`components/ui.tsx`): `Kicker` (occhiello in maiuscolo stretto, rosso o grigio), `SectionTitle` (titolo di sezione con il filetto pieno sotto e un'aggiunta a destra), `Tag` (etichetta d'inchiostro, rossa, a filo o tenue), `Leader` (voce, puntini, valore), `Sheet` (pannello dal basso: `role="dialog"`, Esc chiude, il fuoco torna dov'era). Le classi di pulsanti e link stanno in un posto solo, `lib/linkStyles.ts` (`buttonClass`, `LINK_BUTTON`, `GHOST_LINK`, `TEXT_LINK`, `ROW_LINK`, `FIELD_LABEL`): le usano `Button` e i link che hanno l'aspetto dei pulsanti. `components/inkParts.tsx` (mercato, scheda giocatore, pagina squadra, confronto: voto nel quadratino, tabellino `Strip`, pagella `GradeRow`, filtri a filo) e `lib/tabellino.ts` (tabelle di risultati, classifiche, box score e statistiche) le riusano.
- **Squadra con la formazione sul campo** (`pages/RosterPage.tsx`, `components/Court.tsx`, `components/LineupSheets.tsx`, regole in `lib/court.ts`): il quintetto disposto su mezzo campo, un riquadro per posto con il cognome, i minuti e la barra dell'energia (rossa sotto 75); il rosso solo per i problemi (pieno l'infortunio, tratteggiato il fuori ruolo). Toccando un titolare o uno della panchina sotto il campo compare il suo riquadro con i minuti (− e +), il cambio e la scheda; il cambio di un titolare e le tattiche con l'allenatore sono pannelli dal basso (`Sheet`). Le regole non cambiano: chi è già in campo si scambia di posto, gli infortunati non si scelgono, i minuti fanno 240, la delega all'allenatore si salva subito.
- **Barra "Da salvare"** (`components/SaveBar.tsx`): con modifiche non salvate in Squadra la barra del turno mostra, al posto del turno e del Pronto, i minuti (in rosso se non fanno 240, o il problema che impedisce di salvare), Annulla e Salva, in un riquadro d'inchiostro pieno. Il Pronto torna dopo il salvataggio: "Salva e sono pronto" della conferma del Pronto non si vede più dalla barra (resta nel codice della scheda del turno, dove Squadra non è aperta). `lib/unsaved.ts` dà anche minuti, problema e `discard`.
- **Pagina della lega come prima pagina** (`pages/LeaguePage.tsx`, testi in `lib/frontPage.ts`): occhiello e titolo sull'ultima partita della propria squadra (senza partite il nome della lega), poi primi passi e cerimonia, le decisioni ("Da decidere prima del turno"), il turno con chi è pronto e la scadenza, gli avvisi da leggere e le ultime notizie. Su telefono una colonna; da `lg` tre colonne separate da filetti (decisioni e turno, articolo, notizie) e la pagina è più larga (`max-w-6xl`, con testata e menu). La conferma del Pronto (`ReadyConfirm`) è un pannello dal basso.
- **Elenco delle leghe** (`lib/leagueList.ts`): per ogni lega una riga con un'etichetta solo quando serve (tocca a te e turno bloccato in rosso, simulazione d'inchiostro, draft a filo), turno, pronti e decisioni; la lega in pausa in corsivo. `liveBadges` di `lib/leaguesLive.ts` non c'è più, e nemmeno il riquadro `LatestNews` (la pagina della lega ha le sue notizie).
- **Mercato, scheda giocatore, pagina squadra, confronto** (testi in `lib/marketView.ts`): cifre in milioni con un decimale, voto in un quadratino d'inchiostro, abilità come una pagella con i puntini; l'anteprima dello scambio è una tabella prima → dopo con i valori che peggiorano in rosso. Il mercato ha una sezione in più, **Sul mercato** (`?tab=sul-mercato`), con i giocatori sul mercato della lega e i propri.
- **Campionato, partita, statistiche, cronaca, storico, draft** (`lib/tabellino.ts`): tabelle come i tabellini (filetto pieno sotto l'intestazione, righe sottili, filetti pieni o a puntini dove la classifica cambia zona), vincitore in grassetto, parziali in riga. Le tabelle sono a bordi separati (`border-separate border-spacing-0`, filetti sulle celle) invece che collassati: così i filetti della colonna fissa la seguono quando la tabella scorre e non serve più l'ombra interna per i posti playoff.
- **Riquadri che scorrono in orizzontale sempre `relative`** (un test lo controlla): le etichette `sr-only` delle intestazioni sono `position: absolute`, e senza un antenato posizionato si appoggiavano alla pagina invece che al riquadro: su telefono il box score allargava la pagina a 682 px.
- **Niente verdi, gialli e azzurri:** i colori delle singole pagine sono passati a inchiostro, rosso e stampa; `TONE_CLASS` resta per le etichette.
- **Icone dell'app** ridisegnate con i colori del giornale (`pnpm icons`: palla rossa con le cuciture d'inchiostro su carta rosa; il badge delle notifiche resta identico); nel manifest anche `background_color` è la carta.
- **Provato nel browser** (pannello dell'app, account dell'utente, solo lettura, a 375 px; la pagina della lega anche a 1024 px, con le tre colonne): tutte le pagine della lega, partita (box score, dal vivo, cronaca), pagina squadra, scheda giocatore, elenco leghe, profilo, guida, entra con un codice; nessuna pagina più larga dello schermo, nessun errore in console, contrasto del testo almeno 4,5:1 (3:1 per i titoli grandi) misurato dalla pagina: nel tema scuro in tutte queste pagine, nel chiaro nelle principali (lega, Squadra, Mercato, Campionato, partita, pagina squadra, Info lega, Cronaca). Non provati la pagina di accesso (serve uscire) e i pannelli che cambiano dati (Pronto, offerte, cambio di titolare: l'account è vero).

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
- I ricavi sono 182,7 milioni di $ nel 2026-27, a metà tra il cap e la soglia della tassa (erano 170, poco sopra il cap: vedi "Economia della seconda analisi"): chi resta vicino al cap accumula, chi spende fino alla soglia della tassa va in perdita, chi la supera perde molto. Ogni squadra parte con un quinto dei ricavi da parte.
- Con saldo negativo si firmano svincolati solo fino al monte stipendi minimo (oltre, solo quelli al minimo necessari per restare a 13) e non si fanno scambi che aumentano il monte stipendi. I rinnovi restano possibili.
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

Non restano decisioni aperte sulle regole. Dopo la prima versione: allenamenti, allenatori con abilità e stipendio, finanze del presidente (biglietti, sponsor, palazzetto, ricavi diversi per città), regole NBA complete (apron, eccezioni, bilanciamento degli stipendi negli scambi), settore giovanile, premi votati o più ricchi (quintetti ideali, miglior allenatore), chat di lega. Premi stagionali semplici, MVP delle Finali, partita rivista dal vivo dalla cronaca e notifiche push sono fatti (vedi "Scelte prese dopo la Fase 13").
