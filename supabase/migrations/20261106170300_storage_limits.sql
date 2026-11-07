-- NBBGM: spazio del database, seconda analisi (server).
--
--   - La cronaca delle partite (games.play_by_play, circa 20 KB a partita, 25 MB a stagione per lega) resta solo
--     per la stagione in corso: era quasi tutto il peso di una lega. Durante l'offseason la stagione in corso è
--     ancora quella appena finita, quindi le sue cronache restano fino alla stagione nuova. Punteggi, parziali e
--     box score restano sempre.
--   - Ogni notte la pulizia misura il database: da 400 MB (su 500 del piano Free) avvisa i commissari di tutte le
--     leghe con un avviso informativo (storage), uno solo finché non lo leggono.
--   - Sopra quella soglia non si creano leghe nuove, e in tutto se ne creano al massimo 30: con 5 leghe a testa
--     una ventina di account bastava a riempire il database.

-- Stagioni di cronaca conservate: solo quella in corso
create or replace function private.play_by_play_seasons() returns integer
language sql immutable set search_path = ''
as $$
  select 1
$$;

-- Soglia dello spazio, in MB: avviso ai commissari e niente leghe nuove
create function private.storage_warning_mb() returns integer
language sql immutable set search_path = ''
as $$
  select 400
$$;

-- Leghe in tutto il database
create function private.max_leagues_total() returns integer
language sql immutable set search_path = ''
as $$
  select 30
$$;

-- Dimensione del database in MB
create function private.database_mb() returns numeric
language sql stable security definer set search_path = ''
as $$
  select round(pg_catalog.pg_database_size(pg_catalog.current_database()) / 1048576.0, 1)
$$;

/*
  Pulizia del database, ogni notte con pg_cron (si può chiamare anche a mano dalla console SQL). Restituisce
  { cron_runs, play_by_play, database_mb, warned }: righe tolte, dimensione dopo la pulizia e commissari avvisati.
*/
create or replace function private.daily_cleanup() returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_runs bigint := 0;
  v_plays bigint := 0;
  v_mb numeric;
  v_warned bigint := 0;
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
  v_mb := private.database_mb();
  if v_mb >= private.storage_warning_mb() then
    insert into public.alerts (league_id, team_id, kind, blocking, payload, round_id)
    select l.id, t.id, 'storage', false, jsonb_build_object('mb', v_mb, 'limit_mb', 500), l.current_round_id
    from public.leagues l
    join public.teams t on t.league_id = l.id and t.owner_id = l.commissioner_id
    where not exists (
      select 1 from public.alerts a where a.team_id = t.id and a.kind = 'storage' and a.status = 'open'
    );
    get diagnostics v_warned = row_count;
  end if;
  return jsonb_build_object('cron_runs', v_runs, 'play_by_play', v_plays, 'database_mb', v_mb,
    'warned', v_warned);
end;
$$;

-- Come dopo la Fase 13 (5 leghe create per utente), più il limite di tutto il database e quello dello spazio
create or replace function private.check_league_limit() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  -- Le leghe nuove passano una alla volta: i limiti valgono anche con più richieste insieme
  perform pg_advisory_xact_lock(hashtextextended('nbbgm-leghe', 0));
  if (select count(*) from public.leagues where commissioner_id = new.commissioner_id)
     >= private.max_leagues_per_user() then
    raise exception 'Hai già creato % leghe: eliminane una per crearne un''altra', private.max_leagues_per_user()
      using errcode = 'P0001', hint = 'league_limit';
  end if;
  if (select count(*) from public.leagues) >= private.max_leagues_total() then
    raise exception 'Il server ha già % leghe: per ora non se ne possono creare altre', private.max_leagues_total()
      using errcode = 'P0001', hint = 'league_limit_total';
  end if;
  if private.database_mb() >= private.storage_warning_mb() then
    raise exception 'Il database è quasi pieno: per ora non si possono creare leghe nuove'
      using errcode = 'P0001', hint = 'storage_full';
  end if;
  return new;
end;
$$;

revoke execute on function private.storage_warning_mb(), private.max_leagues_total(), private.database_mb()
from public, anon, authenticated;
