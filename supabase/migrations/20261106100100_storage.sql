-- NBBGM: spazio del database sul piano Free, 500 MB (dopo la Fase 13).
--
--   - Pulizia ogni notte (pg_cron, job nbbgm-pulizia): lo storico delle esecuzioni di pg_cron
--     (cron.job_run_details) cresceva di circa 1,2 MB al giorno con il job ogni 15 secondi; restano gli ultimi
--     3 giorni. La cronaca delle partite (circa 20 KB a partita) resta per la stagione in corso e per quella
--     prima; delle più vecchie restano punteggi, parziali e box score.
--   - Al massimo 5 leghe create per utente (i dati di una lega nuova pesano 2-4 MB, una stagione giocata
--     25-30 MB): per crearne un'altra il commissario ne elimina una.
--   - Il commissario elimina la lega (delete_league): con lei tutte le righe collegate.

-- ---------------------------------------------------------------- pulizia notturna

-- Stagioni di cronaca conservate: quella in corso e quella prima
create function private.play_by_play_seasons() returns integer
language sql immutable set search_path = ''
as $$
  select 2
$$;

/*
  Pulizia del database, ogni notte con pg_cron (si può chiamare anche a mano dalla console SQL). Restituisce
  quante righe ha toccato: { cron_runs, play_by_play }.
*/
create function private.daily_cleanup() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_runs bigint := 0;
  v_plays bigint := 0;
begin
  -- Lo storico di pg_cron c'è solo su Supabase
  if to_regclass('cron.job_run_details') is not null then
    execute 'delete from cron.job_run_details where end_time < now() - interval ''3 days''';
    get diagnostics v_runs = row_count;
  end if;
  update public.games g
  set play_by_play = null
  from public.seasons s
  join public.leagues l on l.id = s.league_id
  join public.seasons cur on cur.id = l.current_season_id
  where g.season_id = s.id
    and g.play_by_play is not null
    and s.year <= cur.year - private.play_by_play_seasons();
  get diagnostics v_plays = row_count;
  return jsonb_build_object('cron_runs', v_runs, 'play_by_play', v_plays);
end;
$$;

-- ---------------------------------------------------------------- leghe per utente

create function private.max_leagues_per_user() returns integer
language sql immutable set search_path = ''
as $$
  select 5
$$;

-- Le leghe le crea solo il server (insert_league): il limite vale anche se due richieste arrivano insieme
create function private.check_league_limit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Le richieste dello stesso utente passano una alla volta
  perform pg_advisory_xact_lock(hashtextextended('nbbgm-leghe:' || new.commissioner_id::text, 0));
  if (select count(*) from public.leagues where commissioner_id = new.commissioner_id)
     >= private.max_leagues_per_user() then
    raise exception 'Hai già creato % leghe: eliminane una per crearne un''altra', private.max_leagues_per_user()
      using errcode = 'P0001', hint = 'league_limit';
  end if;
  return new;
end;
$$;

create trigger leagues_limit before insert on public.leagues
  for each row execute function private.check_league_limit();

-- ---------------------------------------------------------------- eliminare una lega

/*
  Il commissario elimina la lega e tutto quello che contiene (squadre, giocatori, partite, statistiche, bilanci,
  storico): le tabelle della lega hanno tutte on delete cascade. Per conferma va ripetuto il nome della lega.
  Non durante una simulazione in corso: apply_turn sta scrivendo proprio quelle righe.
*/
create function public.delete_league(p_league uuid, p_name text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_league public.leagues%rowtype;
  v_round public.rounds%rowtype;
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario può eliminare la lega' using errcode = '42501';
  end if;
  select * into v_league from public.leagues where id = p_league for update;
  if lower(trim(coalesce(p_name, ''))) <> lower(trim(v_league.name)) then
    raise exception 'Per eliminare la lega scrivi il suo nome esatto';
  end if;
  select * into v_round from public.rounds where id = v_league.current_round_id;
  if v_round.state = 'closing' and v_round.failed_at is null
     and v_round.closing_started_at >= now() - interval '5 minutes' then
    raise exception 'Il turno si sta simulando: riprova tra un minuto';
  end if;
  delete from public.leagues where id = p_league;
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.play_by_play_seasons(), private.daily_cleanup(),
  private.max_leagues_per_user(), private.check_league_limit(), public.delete_league(uuid, text)
from public, anon, authenticated;

grant execute on function public.delete_league(uuid, text) to authenticated;

-- ---------------------------------------------------------------- pg_cron (solo Supabase)

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    -- Alle 3:23 UTC, fuori dalle ore di gioco; con lo stesso nome il job si aggiorna
    perform cron.schedule('nbbgm-pulizia', '23 3 * * *', 'select private.daily_cleanup()');
  end if;
end;
$$;
