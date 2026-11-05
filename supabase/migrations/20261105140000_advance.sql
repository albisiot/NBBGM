-- NBBGM: avanzamento dei turni (Fase 9).
--
-- Il turno si chiude quando tutti i manager umani sono pronti (Pronto premuto o allenatore attivo senza avvisi
-- bloccanti), quando il commissario lo forza o alla scadenza, se la lega ne ha una. Se tutti hanno
-- l'allenatore, la lega avanza da sola al ritmo massimo scelto dal commissario. La decisione la prende
-- private.round_due; try_close_round passa il turno in chiusura con un aggiornamento condizionato, così solo
-- la prima chiamata della Edge Function advance-turn simula. Chi chiama advance-turn non decide nulla: il
-- turno avanza solo se il database dice che è il momento.
--
-- pg_net (chiamate dal database alle Edge Functions) e pg_cron (controllo ogni 15 secondi di scadenze, ritmo
-- degli allenatori, riprese e timer del draft dal vivo) ci sono solo su Supabase: nei test su PGlite le
-- chiamate non partono e i test chiamano direttamente la logica della Edge Function.

-- ---------------------------------------------------------------- colonne e impostazioni

alter table public.rounds
  add column forced_at timestamptz,
  add column close_reason text check (close_reason in ('ready', 'coach', 'deadline', 'forced'));

-- Impostazioni del server (non segrete): functions_url = https://<progetto>.supabase.co/functions/v1
create table private.settings (
  key text primary key,
  value text not null
);
alter table private.settings enable row level security;
revoke all on private.settings from public, anon, authenticated;

-- ---------------------------------------------------------------- allenatore

-- Delega all'allenatore attiva per quel turno (gli avvisi bloccanti non contano: l'allenatore fa comunque
-- quintetto e minuti). La fine della fase la chiude apply_turn (coach_expired).
create function private.coach_active(p_team uuid, p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.coach_delegations d
    join public.rounds r on r.id = p_round
    where d.team_id = p_team and d.active
      and (d.until_round is null or r.number <= d.until_round)
      and (d.until_at is null or now() < d.until_at)
  )
$$;

create or replace function public.coach_ready(p_team uuid, p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select private.coach_active(p_team, p_round)
    and not exists (
      select 1 from public.alerts a where a.team_id = p_team and a.blocking and a.status = 'open'
    )
$$;

-- ---------------------------------------------------------------- quando un turno va chiuso

/*
  Motivo per chiudere il turno adesso, oppure null:
    forced    il commissario ha forzato l'avanzamento (anche con la lega in pausa)
    deadline  scadenza superata (solo nelle leghe che ne hanno una)
    ready     tutti pronti e almeno un manager ha premuto Pronto: si parte subito
    coach     tutti pronti con l'allenatore: si parte quando è passato il ritmo massimo dall'apertura
  Non si chiude finché il draft iniziale non è finito, con la lega in pausa e, fino alla Fase 10, nei turni di
  play-in e playoff.
*/
create function private.round_due(p_round uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when r.state <> 'open' or r.kind <> 'regular' then null
    when exists (
      select 1 from public.initial_drafts d where d.league_id = r.league_id and d.state <> 'done'
    ) then null
    when r.forced_at is not null then 'forced'
    when l.paused then null
    when r.deadline is not null and now() >= r.deadline then 'deadline'
    when not public.round_all_ready(r.id) then null
    when exists (
      select 1
      from public.ready_flags f
      join public.teams t on t.id = f.team_id and t.owner_id is not null
      where f.round_id = r.id and f.ready
    ) then 'ready'
    when now() >= r.created_at + make_interval(secs => l.max_pace_seconds) then 'coach'
    else null
  end
  from public.rounds r
  join public.leagues l on l.id = r.league_id
  where r.id = p_round
$$;

/*
  Chiude il turno corrente della lega se è il momento: da aperto a in chiusura con un aggiornamento
  condizionato sotto lock, quindi su due chiamate insieme vince solo la prima. Restituisce
  { round_id, number, kind, seed, reason, reclaimed } oppure null se non c'è niente da fare. Un turno rimasto
  in chiusura da più di 5 minuti (scrittura fallita) si riprende con lo stesso seed: stesso risultato.
*/
create function public.try_close_round(p_league uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_reason text;
  v_reclaimed boolean := false;
begin
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    return null;
  end if;
  if v_round.state = 'closing' then
    if v_round.closing_started_at >= now() - interval '5 minutes' then
      return null;
    end if;
    update public.rounds set closing_started_at = now() where id = v_round.id;
    v_reason := v_round.close_reason;
    v_reclaimed := true;
  else
    v_reason := private.round_due(v_round.id);
    if v_reason is null then
      return null;
    end if;
    update public.rounds
    set state = 'closing', closing_started_at = now(), seed = coalesce(seed, gen_random_uuid()::text),
        close_reason = v_reason
    where id = v_round.id
    returning * into v_round;
  end if;
  return jsonb_build_object('round_id', v_round.id, 'number', v_round.number, 'kind', v_round.kind,
    'seed', v_round.seed, 'reason', v_reason, 'reclaimed', v_reclaimed);
end;
$$;

-- ---------------------------------------------------------------- chiamate alle Edge Functions

-- POST alla Edge Function (path = advance-turn, draft): parte solo dopo il commit, e solo dove ci sono pg_net
-- e l'indirizzo delle funzioni. Le funzioni non si fidano di chi chiama: rileggono lo stato e decidono loro.
create function private.kick(p_path text, p_body jsonb) returns void
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
    headers := '{"Content-Type": "application/json"}'::jsonb,
    timeout_milliseconds := 60000
  );
end;
$$;

-- Ogni 15 secondi (pg_cron): turni scaduti, leghe con tutti gli allenatori al ritmo massimo, Pronto rimasti
-- senza chiamata, turni fermi in chiusura e scelte del draft dal vivo con il tempo scaduto.
create function private.cron_tick() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_count integer := 0;
begin
  for v in
    select l.id
    from public.leagues l
    join public.rounds r on r.id = l.current_round_id
    where (r.state = 'open' and private.round_due(r.id) is not null)
       or (r.state = 'closing' and r.closing_started_at < now() - interval '5 minutes')
  loop
    perform private.kick('advance-turn', jsonb_build_object('league_id', v.id));
    v_count := v_count + 1;
  end loop;
  for v in
    select d.league_id
    from public.initial_drafts d
    where d.state = 'running' and d.mode = 'live' and d.pick_deadline < now()
  loop
    perform private.kick('draft', jsonb_build_object('league_id', v.league_id, 'action', 'tick'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- azioni dei manager

-- Pronto (o tolto il Pronto) nel turno corrente, finché il turno è aperto. Se con questo Pronto il turno va
-- chiuso, chiama advance-turn. Restituisce true se tutte le squadre umane sono pronte.
create or replace function public.set_ready(p_team uuid, p_ready boolean default true) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
begin
  if not private.owns_team(p_team) then
    raise exception 'Non è la tua squadra' using errcode = '42501';
  end if;
  -- Il lock sul turno mette in fila i Pronto simultanei: l'ultimo vede tutti gli altri
  select r.* into v_round
  from public.teams t
  join public.leagues l on l.id = t.league_id
  join public.rounds r on r.id = l.current_round_id
  where t.id = p_team
  for update of r;
  if not found then
    raise exception 'La lega non ha un turno in corso';
  end if;
  if v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura: non si accettano modifiche';
  end if;
  insert into public.ready_flags (round_id, team_id, league_id, ready, updated_at)
  values (v_round.id, p_team, v_round.league_id, p_ready, now())
  on conflict (round_id, team_id) do update set ready = excluded.ready, updated_at = excluded.updated_at;
  if p_ready and private.round_due(v_round.id) is not null then
    perform private.kick('advance-turn', jsonb_build_object('league_id', v_round.league_id));
  end if;
  return public.round_all_ready(v_round.id);
end;
$$;

-- Il commissario forza l'avanzamento del turno corrente (anche con la lega in pausa)
create function public.force_round(p_league uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario può forzare l''avanzamento' using errcode = '42501';
  end if;
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    raise exception 'La lega non ha un turno in corso';
  end if;
  if v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura';
  end if;
  if exists (select 1 from public.initial_drafts d where d.league_id = p_league and d.state <> 'done') then
    raise exception 'Il draft iniziale non è ancora finito';
  end if;
  if v_round.kind <> 'regular' then
    raise exception 'Play-in e playoff arrivano con la Fase 10';
  end if;
  update public.rounds set forced_at = coalesce(forced_at, now()) where id = v_round.id;
  perform private.kick('advance-turn', jsonb_build_object('league_id', p_league));
end;
$$;

-- Risposta del manager a un avviso della propria squadra, finché il turno è aperto. Un avviso bloccante
-- risolto lascia ripartire l'allenatore. Restituisce true se tutte le squadre umane sono pronte.
create function public.answer_alert(p_alert uuid) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_alert public.alerts%rowtype;
  v_round public.rounds%rowtype;
begin
  select * into v_alert from public.alerts where id = p_alert;
  if not found or not private.owns_team(v_alert.team_id) then
    raise exception 'Avviso non trovato' using errcode = '42501';
  end if;
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = v_alert.league_id
  for update of r;
  if v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura: non si accettano modifiche';
  end if;
  update public.alerts
  set status = 'resolved', payload = payload || jsonb_build_object('answered_at', now())
  where id = p_alert and status = 'open';
  if private.round_due(v_round.id) is not null then
    perform private.kick('advance-turn', jsonb_build_object('league_id', v_round.league_id));
  end if;
  return public.round_all_ready(v_round.id);
end;
$$;

-- ---------------------------------------------------------------- scadenze

-- La scadenza del primo turno parte quando il draft iniziale finisce, non alla creazione della lega
create function private.deadline_after_draft() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.state = 'done' and old.state <> 'done' then
    update public.rounds r
    set deadline = case when l.deadline_minutes is null then null
                        else now() + make_interval(mins => l.deadline_minutes) end
    from public.leagues l
    where l.id = new.league_id and r.id = l.current_round_id and r.state = 'open';
  end if;
  return new;
end;
$$;

create trigger initial_draft_done
after update of state on public.initial_drafts
for each row execute function private.deadline_after_draft();

-- Se il commissario cambia la scadenza, vale subito per il turno aperto, contata da adesso
create function private.deadline_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.deadline_minutes is distinct from old.deadline_minutes then
    update public.rounds
    set deadline = case when new.deadline_minutes is null then null
                        else now() + make_interval(mins => new.deadline_minutes) end
    where id = new.current_round_id and state = 'open';
  end if;
  return new;
end;
$$;

create trigger leagues_deadline_changed
after update of deadline_minutes on public.leagues
for each row execute function private.deadline_changed();

-- ---------------------------------------------------------------- stato della lega per il motore

-- Come nella Fase 8, più il seed del turno, gli allenatori attivi, le deleghe e gli avvisi che il turno deve
-- gestire (aperti, o nati in questo turno)
create or replace function public.league_state(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'seed', l.seed, 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'seed', r.seed, 'close_reason', r.close_reason)
              from public.rounds r where r.id = l.current_round_id),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]') from public.teams t where t.league_id = l.id),
    'players', (
      select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('hidden', h.hidden) order by p.id), '[]')
      from public.players p join public.player_hidden h on h.player_id = p.id
      where p.league_id = l.id and not p.retired
    ),
    'contracts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.contracts c where c.league_id = l.id),
    'dead_money', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.dead_money d where d.league_id = l.id),
    'injuries', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.injuries i where i.league_id = l.id),
    'draft_picks', (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.draft_picks k where k.league_id = l.id),
    'draft_swaps', (select coalesce(jsonb_agg(to_jsonb(w)), '[]') from public.draft_swaps w where w.league_id = l.id),
    'team_settings', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.team_settings x where x.league_id = l.id
    ),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'round_number', g.round_number, 'kind', g.kind,
        'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id, 'home_score', g.home_score,
        'away_score', g.away_score, 'overtimes', g.overtimes) order by g.round_number, g.id), '[]')
      from public.games g where g.season_id = l.current_season_id
    ),
    'coach', (
      select coalesce(jsonb_agg(t.id), '[]')
      from public.teams t
      where t.league_id = l.id and t.owner_id is not null and private.coach_active(t.id, l.current_round_id)
    ),
    'coach_delegations', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', d.team_id, 'active', d.active,
        'until_round', d.until_round, 'until_at', d.until_at, 'until_phase_end', d.until_phase_end)), '[]')
      from public.coach_delegations d where d.league_id = l.id
    ),
    'alerts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'team_id', a.team_id, 'kind', a.kind,
        'blocking', a.blocking, 'status', a.status, 'round_id', a.round_id, 'payload', a.payload)), '[]')
      from public.alerts a
      where a.league_id = l.id and (a.status = 'open' or a.round_id = l.current_round_id)
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.coach_active(uuid, uuid), private.round_due(uuid),
  public.try_close_round(uuid), private.kick(text, jsonb), private.cron_tick(), public.force_round(uuid),
  public.answer_alert(uuid), private.deadline_after_draft(), private.deadline_changed()
from public, anon, authenticated;

grant execute on function public.force_round(uuid), public.answer_alert(uuid) to authenticated;
grant execute on function public.try_close_round(uuid) to service_role;

-- ---------------------------------------------------------------- tempo reale, pg_net e pg_cron (solo Supabase)

do $$
begin
  -- Chi è pronto, allenatori, stato del turno e avvisi arrivano alle app aperte (la RLS vale anche qui)
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime
      add table public.rounds, public.ready_flags, public.coach_delegations, public.alerts;
  end if;
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
    perform cron.schedule('nbbgm-turni', '15 seconds', 'select private.cron_tick()');
  end if;
end;
$$;
