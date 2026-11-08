-- Limite di tempo delle istruzioni per il server (Edge Functions).
--
-- Le Edge Functions chiamano il database con la chiave del server attraverso PostgREST, che si collega come
-- authenticator (statement_timeout 8 secondi) e passa al ruolo service_role, che non ne aveva uno suo: valeva quello di
-- authenticator. Nella prova in produzione dell'offseason nuova (8 novembre 2026), con i turni forzati uno dopo
-- l'altro, apply_round e league_state duravano in media 1,2-1,5 secondi ma con punte oltre gli 8: 8 turni su circa
-- 210 si sono fermati al primo tentativo e li ha rigiocati la ripresa dopo 5 minuti. Il turno che chiude il draft
-- riscrive tutti i giocatori e i contratti e rischia di superare gli 8 secondi a ogni tentativo, fino a fermare la lega.
-- Con 60 secondi il server ha margine; app e utenti (anon, authenticated) restano ai loro limiti. PostgREST applica le
-- impostazioni del ruolo che impersona: si rilegge la configurazione.
alter role service_role set statement_timeout = '60s';
notify pgrst, 'reload config';
