# Supabase

Database di NBBGM: tabelle, sicurezza e funzioni dei turni.

## Migrazioni

| File                          | Contenuto                                                                                                                                          |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `20261105090000_schema.sql`   | Le tabelle del modello dati (CLAUDE.md, Modello dati essenziale), più `league_members` e `dead_money`.                                             |
| `20261105090100_security.sql` | RLS su ogni tabella, permessi minimi, `player_hidden` e `base_*` chiuse al client, controllo di quintetto e minuti, profilo per ogni nuovo utente. |
| `20261105090200_turns.sql`    | `set_ready`, `round_all_ready`, `close_round`, `reclaim_round` e `apply_turn`.                                                                     |

## Chi può fare cosa

- **Manager** (utente autenticato): legge le leghe di cui fa parte; cambia solo impostazioni, allenatore e offerte agli svincolati della propria squadra, e solo a turno aperto; propone scambi; preme Pronto con `set_ready`. Le offerte agli svincolati le vede solo chi le fa; scambi e avvisi solo le squadre coinvolte; il bilancio la propria squadra (il commissario tutte).
- **Commissario:** in più cambia nome, scadenza, ritmo e pausa della lega.
- **Senza login:** niente.
- **Server** (`service_role`, Edge Functions): tutto il resto. Solo lui chiude il turno (`close_round`) e scrive il risultato (`apply_turn`), e solo lui legge `player_hidden` e i dati di partenza.

## apply_turn

La Edge Function simula il turno con il pacchetto engine e passa il risultato ad `apply_turn(turno, risultato)`, che lo scrive in una sola transazione e apre il turno successivo. Il formato delle sezioni è nel commento della funzione. Se una sezione ha righe di un'altra lega o inesistenti, o se il turno non è in chiusura, non scrive nulla: una seconda chiamata sullo stesso turno fallisce.

## Seed e dati

- `pnpm db:seed` scrive `supabase/seed.sql` (lega di prova con giocatori generati, tre utenti di test: anna, bruno e carla `@nbbgm.test`, su Boston, Lakers e Knicks) e, se c'è l'import dei file Excel, `data/base.sql` con i giocatori reali per le tabelle `base_*`. Nessuno dei due va nel repo.
- `supabase db reset` (con Docker) applica le migrazioni e carica `seed.sql`.

## Test

`pnpm test` prova le migrazioni su PGlite (Postgres in WebAssembly) con lo stesso seed: `scripts/test/db.test.ts`. Non servono Docker né un progetto Supabase; `scripts/src/db/shim.sql` ricrea ruoli, `auth.users` e `auth.uid()` come in Supabase.
