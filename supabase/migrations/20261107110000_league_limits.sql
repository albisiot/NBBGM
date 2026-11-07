-- NBBGM: correzioni urgenti della terza analisi, parte del database.
--
--   1. Scadenza dei turni e ritmo massimo con un minimo: almeno 15 minuti e 60 secondi, come le scelte dell'app.
--      Con una modifica fatta a mano (il commissario aggiorna leagues con la sua policy) una scadenza di un minuto, o
--      tutti con l'allenatore e il ritmo a 0, facevano 1.440 turni al giorno: circa 145 MB di database e 1.440
--      chiamate ad advance-turn al giorno per lega.
--   2. Liste del draft annuale al massimo di 100 giocatori (i prospetti sono 70): con 200.000 uuid ogni scelta
--      costava 0,37 s di CPU e il turno del draft superava il tempo delle Edge Functions.
--   3. Pausa automatica delle leghe abbandonate: dopo 3 turni di fila chiusi per scadenza senza nessuna attività
--      umana, alla scadenza del quarto la lega va in pausa invece di avanzare, con un avviso al commissario. La
--      riprende il commissario, come una pausa normale, o il primo Pronto di un manager. I turni chiusi dal ritmo
--      degli allenatori non contano (sono voluti), e con una scadenza una lega avanzava per sempre anche senza
--      nessuno: la scadenza chiude il turno anche con avvisi bloccanti aperti.

-- ---------------------------------------------------------------- 1. minimi di scadenza e ritmo

-- Le leghe in corso con valori più bassi passano al minimo (per la scadenza il trigger deadline_changed fa
-- ripartire quella del turno aperto da adesso)
update public.leagues set deadline_minutes = 15 where deadline_minutes is not null and deadline_minutes < 15;
update public.leagues set max_pace_seconds = 60 where max_pace_seconds < 60;

alter table public.leagues drop constraint leagues_deadline_minutes_check;
alter table public.leagues add constraint leagues_deadline_minutes_check
  check (deadline_minutes is null or deadline_minutes >= 15);
alter table public.leagues drop constraint leagues_max_pace_seconds_check;
alter table public.leagues add constraint leagues_max_pace_seconds_check check (max_pace_seconds >= 60);

-- ---------------------------------------------------------------- 2. liste del draft annuale

-- Le liste più lunghe già salvate si riducono ai prospetti di adesso, senza doppioni, nell'ordine della lista e al
-- massimo 100 (il draft sceglie comunque solo tra i prospetti)
update public.draft_lists d
set player_ids = array(
  select u.x
  from unnest(d.player_ids) with ordinality as u(x, i)
  where exists (select 1 from public.players p where p.id = u.x and p.draft_prospect is not null)
  group by u.x
  order by min(u.i)
  limit 100
)
where cardinality(d.player_ids) > 100;

alter table public.draft_lists add constraint draft_lists_player_ids_check check (cardinality(player_ids) <= 100);

-- ---------------------------------------------------------------- 3. pausa automatica

-- Turni di fila chiusi per scadenza senza attività umana, e quando la lega si è fermata da sola (null se è in
-- pausa per mano del commissario o non è in pausa). Le scrive solo il server; il client legge solo auto_paused_at.
alter table public.leagues
  add column idle_rounds integer not null default 0 check (idle_rounds >= 0),
  add column auto_paused_at timestamptz;
grant select (auto_paused_at) on public.leagues to authenticated;

-- Quando una squadra ha toccato l'ultima volta preferiti del draft e allenatore: l'ora la mette il server (l'app
-- manda la sua per le liste, ma l'orologio del telefono non conta)
alter table public.coach_delegations add column updated_at timestamptz not null default now();

create function private.touch_updated_at() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger draft_lists_touch before insert or update on public.draft_lists
  for each row execute function private.touch_updated_at();
create trigger coach_delegations_touch before insert or update on public.coach_delegations
  for each row execute function private.touch_updated_at();

-- Turni di fila senza nessuno dopo i quali, alla scadenza del successivo, la lega si ferma
create function private.idle_rounds_before_pause() returns integer
language sql immutable set search_path = ''
as $$ select 3 $$;

-- Nel turno qualche manager ha fatto qualcosa? Pronto (dato o tolto), proposte e risposte agli scambi, offerte agli
-- svincolati, tagli e rinnovi, quintetto e tattiche, allenatore, preferiti del draft, giocatori sul mercato,
-- risposte agli avvisi. Conta quello che è successo da quando il turno si è aperto (o è stato riaperto) a quando è
-- entrato in chiusura: le scritture del server alla chiusura del turno prima hanno l'ora d'apertura di questo, e
-- restano fuori.
create function private.round_idle(p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  with r as (
    select r.id, r.league_id, r.created_at as since, coalesce(r.closing_started_at, now()) as until
    from public.rounds r where r.id = p_round
  ),
  human as (
    select t.id from public.teams t join r on t.league_id = r.league_id where t.owner_id is not null
  )
  select not (
    exists (select 1 from public.ready_flags f join r on f.round_id = r.id where f.team_id in (select id from human))
    or exists (
      select 1 from public.trade_offers o join r on o.league_id = r.league_id
      where (o.created_round_id = r.id and o.from_team_id in (select id from human))
         or (o.responded_at > r.since and o.responded_at < r.until
             and (o.from_team_id in (select id from human) or o.to_team_id in (select id from human)))
    )
    or exists (
      select 1 from public.free_agent_bids b join r on b.round_id = r.id where b.team_id in (select id from human)
    )
    or exists (
      select 1 from public.roster_requests q join r on q.round_id = r.id where q.team_id in (select id from human)
    )
    or exists (
      select 1 from public.team_settings s join r on s.league_id = r.league_id
      where s.team_id in (select id from human) and s.updated_at > r.since and s.updated_at < r.until
    )
    or exists (
      select 1 from public.coach_delegations c join r on c.league_id = r.league_id
      where c.team_id in (select id from human) and c.updated_at > r.since and c.updated_at < r.until
    )
    or exists (
      select 1 from public.draft_lists d join r on d.league_id = r.league_id
      where d.team_id in (select id from human) and d.updated_at > r.since and d.updated_at < r.until
    )
    or exists (
      select 1 from public.trade_block b join r on b.league_id = r.league_id
      where b.team_id in (select id from human) and b.created_at > r.since and b.created_at < r.until
    )
    or exists (
      select 1 from public.alerts a join r on a.league_id = r.league_id
      where a.team_id in (select id from human) and a.payload ? 'answered_at'
        and (a.payload ->> 'answered_at')::timestamptz > r.since
        and (a.payload ->> 'answered_at')::timestamptz < r.until
    )
  )
  from r
$$;

-- La riprende il commissario togliendo la pausa: auto_paused_at torna null (e la scadenza riparte da adesso con
-- deadline_changed, come prima)
create function private.league_pause_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if not new.paused then
    new.auto_paused_at := null;
  end if;
  return new;
end;
$$;

create trigger leagues_pause_changed before update of paused on public.leagues
  for each row execute function private.league_pause_changed();

-- Come in 20261106170100_stuck_rounds_members.sql, più il conto dei turni senza nessuno quando il turno si chiude
-- per la prima volta: per scadenza senza attività umana +1, per qualunque altro motivo (o con attività) da capo.
-- Arrivati a idle_rounds_before_pause(), alla scadenza successiva senza attività la lega si ferma invece di
-- chiudere il turno, che resta aperto.
create or replace function public.try_close_round(p_league uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_paused boolean;
  v_idle integer;
  v_reason text;
  v_reclaimed boolean := false;
  v_commissioner_team uuid;
begin
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    return null;
  end if;
  select paused, idle_rounds into v_paused, v_idle from public.leagues where id = p_league;
  if v_round.state = 'closing' then
    if v_round.failed_at is not null or v_round.closing_started_at >= now() - interval '5 minutes' or v_paused then
      return null;
    end if;
    if v_round.last_error_at is null or v_round.last_error_at < v_round.closing_started_at then
      update public.rounds
      set last_error = 'Simulazione interrotta senza un errore: probabilmente ha superato il tempo o la memoria '
                       || 'della Edge Function (tentativo ' || v_round.attempts || ')',
          last_error_at = now()
      where id = v_round.id;
    end if;
    if v_round.attempts >= private.max_round_attempts() then
      update public.rounds set failed_at = now() where id = v_round.id;
      return null;
    end if;
    update public.rounds set closing_started_at = now(), attempts = attempts + 1 where id = v_round.id;
    v_reason := v_round.close_reason;
    v_reclaimed := true;
  else
    v_reason := private.round_due(v_round.id);
    if v_reason is null then
      return null;
    end if;
    if v_reason = 'deadline' and private.round_idle(v_round.id) then
      if v_idle >= private.idle_rounds_before_pause() then
        -- Lega abbandonata: si ferma qui, il turno resta aperto
        update public.leagues set paused = true, auto_paused_at = now(), idle_rounds = 0 where id = p_league;
        select t.id into v_commissioner_team
        from public.leagues l
        join public.teams t on t.league_id = l.id and t.owner_id = l.commissioner_id
        where l.id = p_league;
        if v_commissioner_team is not null then
          insert into public.alerts (league_id, team_id, kind, blocking, payload, round_id)
          values (p_league, v_commissioner_team, 'league_paused', false,
            jsonb_build_object('rounds', v_idle), v_round.id);
        end if;
        return null;
      end if;
      update public.leagues set idle_rounds = idle_rounds + 1 where id = p_league;
    elsif v_idle <> 0 then
      update public.leagues set idle_rounds = 0 where id = p_league;
    end if;
    update public.rounds
    set state = 'closing', closing_started_at = now(), seed = coalesce(seed, gen_random_uuid()::text),
        close_reason = v_reason, attempts = 1, failed_at = null
    where id = v_round.id
    returning * into v_round;
  end if;
  return jsonb_build_object('round_id', v_round.id, 'number', v_round.number, 'kind', v_round.kind,
    'seed', v_round.seed, 'reason', v_reason, 'reclaimed', v_reclaimed);
end;
$$;

-- Come in 20261106090000_ready_round.sql, più la ripresa: il Pronto di un manager riprende la lega che si è fermata
-- da sola (la scadenza riparte da adesso con deadline_changed). La pausa messa dal commissario resta.
create or replace function public.set_ready(p_team uuid, p_ready boolean default true, p_round uuid default null)
returns boolean
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
  if p_round is not null and p_round <> v_round.id then
    raise exception 'Il turno è cambiato: guarda il nuovo turno prima di confermare';
  end if;
  if v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura: non si accettano modifiche';
  end if;
  insert into public.ready_flags (round_id, team_id, league_id, ready, updated_at)
  values (v_round.id, p_team, v_round.league_id, p_ready, now())
  on conflict (round_id, team_id) do update set ready = excluded.ready, updated_at = excluded.updated_at;
  if p_ready then
    update public.leagues set paused = false
    where id = v_round.league_id and paused and auto_paused_at is not null;
  end if;
  if p_ready and private.round_due(v_round.id) is not null then
    perform private.kick('advance-turn', jsonb_build_object('league_id', v_round.league_id));
  end if;
  return public.round_all_ready(v_round.id);
end;
$$;

revoke execute on function private.touch_updated_at(), private.idle_rounds_before_pause(), private.round_idle(uuid),
  private.league_pause_changed(), public.try_close_round(uuid), public.set_ready(uuid, boolean, uuid)
from public, anon, authenticated;
grant execute on function public.try_close_round(uuid) to service_role;
grant execute on function public.set_ready(uuid, boolean, uuid) to authenticated;
