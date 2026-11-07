-- NBBGM: segreto condiviso tra il database e le Edge Functions che chiama (seconda analisi, server).
--
-- advance-turn, push e il tick del draft dal vivo hanno verify_jwt spento (le chiamano pg_net e pg_cron, senza
-- utente) e fino a qui accettavano chiunque: non decidono nulla da sole, ma chiunque conoscesse l'indirizzo poteva
-- consumare le 500.000 chiamate al mese del piano Free. Ora il database manda con ogni chiamata l'intestazione
-- x-nbbgm-secret con il segreto scritto in private.settings (chiave functions_secret, che nessun client legge);
-- le funzioni la confrontano con il loro segreto NBBGM_FUNCTIONS_SECRET e rifiutano le chiamate senza.
--
-- Pubblicazione sicura: senza la riga in private.settings l'intestazione non parte, e le funzioni senza il loro
-- segreto accettano tutto come prima. Si attiva a mano (supabase/README.md), prima la riga nel database e poi il
-- segreto delle funzioni: così nessuna chiamata resta senza intestazione.

-- Intestazioni delle chiamate alle Edge Functions: il segreto solo se è configurato
create function private.function_headers() returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('Content-Type', 'application/json')
    || coalesce((
      select jsonb_build_object('x-nbbgm-secret', s.value)
      from private.settings s
      where s.key = 'functions_secret' and length(s.value) >= 32
    ), '{}'::jsonb)
$$;

-- Come nella Fase 9, con le intestazioni qui sopra
create or replace function private.kick(p_path text, p_body jsonb) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_url text;
begin
  select value into v_url from private.settings where key = 'functions_url';
  if v_url is null or not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_net') then
    return;
  end if;
  perform net.http_post(
    url := v_url || '/' || p_path,
    body := p_body,
    headers := private.function_headers(),
    timeout_milliseconds := 60000
  );
end;
$$;

revoke execute on function private.function_headers(), private.kick(text, jsonb) from public, anon, authenticated;
