-- NBBGM: strumenti del commissario e uscita dalla lega (dopo la Fase 13).
--
-- In una lega chi è membro guida una squadra, e viceversa: liberare una squadra vuol dire anche togliere il
-- manager dalla lega.
--   free_team       il commissario libera la squadra di un manager: torna al bot, il manager esce dalla lega e
--                   può rientrare con il codice invito, prendendo una squadra libera (anche la sua, se lo è)
--   expel_manager   come free_team, ma il manager non può più rientrare (league_bans)
--   leave_league    un manager (non il commissario, che può eliminare la lega) esce dalla lega
-- La squadra liberata riparte pulita per il bot: Pronto, allenatore, avvisi aperti, offerte agli svincolati,
-- tagli e rinnovi richiesti, proposte di scambio in sospeso (anche quelle già accettate da entrambi) e
-- preferiti del draft si chiudono; quintetto e tattiche salvati restano (il bot gioca con le sue scelte).
-- Non mentre il turno si sta simulando.
--
-- Se si cancella l'account del commissario, la lega passa al membro entrato per primo (o sparisce, se non c'è
-- nessun altro): prima leagues.commissioner_id bloccava la cancellazione dell'utente.

-- ---------------------------------------------------------------- esclusi

create table public.league_bans (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (league_id, user_id)
);
create index league_bans_user_id_idx on public.league_bans (user_id);
alter table public.league_bans enable row level security;
-- Nessun accesso dal client: lo controlla join_league
revoke all on public.league_bans from anon, authenticated;
grant all on public.league_bans to service_role;

-- ---------------------------------------------------------------- squadra al bot

/*
  La squadra torna al bot e si chiude tutto quello che il manager aveva in sospeso (vedi sopra). Restituisce il
  manager che la guidava, null se era già del bot. Non controlla chi la chiama né lo stato del turno: lo fanno le
  funzioni qui sotto.
*/
create function private.release_team(p_team uuid) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_owner uuid;
  v_league uuid;
begin
  select owner_id, league_id into v_owner, v_league from public.teams where id = p_team for update;
  if v_owner is null then
    return null;
  end if;
  update public.teams set owner_id = null where id = p_team;
  delete from public.ready_flags f
  using public.leagues l
  where f.team_id = p_team and l.id = v_league and f.round_id = l.current_round_id;
  delete from public.coach_delegations where team_id = p_team;
  delete from public.draft_lists where team_id = p_team;
  delete from public.initial_draft_lists where team_id = p_team;
  update public.alerts set status = 'expired' where team_id = p_team and status = 'open';
  update public.free_agent_bids set status = 'withdrawn' where team_id = p_team and status = 'pending';
  update public.roster_requests set status = 'withdrawn' where team_id = p_team and status = 'pending';
  -- Le proposte di scambio in sospeso decadono, e con loro gli avvisi dell'altra squadra
  with offers as (
    update public.trade_offers
    set status = 'withdrawn', responded_at = coalesce(responded_at, now())
    where (from_team_id = p_team or to_team_id = p_team) and status in ('pending', 'accepted')
    returning id
  )
  update public.alerts a
  set status = 'expired'
  from offers o
  where a.league_id = v_league and a.kind = 'trade_offer' and a.status = 'open'
    and a.payload ->> 'trade_id' = o.id::text;
  return v_owner;
end;
$$;

-- Le modifiche alle squadre non si fanno mentre il turno si simula (apply_turn sta scrivendo le stesse righe)
create function private.lock_open_round(p_league uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_state text;
begin
  select r.state into v_state
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if v_state = 'closing' then
    raise exception 'Il turno si sta simulando: riprova tra un minuto';
  end if;
end;
$$;

-- Dopo un'uscita può darsi che tutti i rimasti siano pronti: il turno parte
create function private.kick_if_due(p_league uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if private.round_due((select current_round_id from public.leagues where id = p_league)) is not null then
    perform private.kick('advance-turn', jsonb_build_object('league_id', p_league));
  end if;
end;
$$;

-- Squadra di un manager della lega, per il commissario (non la propria)
create function private.managed_team(p_team uuid) returns public.teams
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams%rowtype;
begin
  select * into v_team from public.teams where id = p_team;
  if not found or not private.is_commissioner(v_team.league_id) then
    raise exception 'Solo il commissario può liberare le squadre' using errcode = '42501';
  end if;
  if v_team.owner_id is null then
    raise exception 'La squadra è già guidata dal bot';
  end if;
  if v_team.owner_id = (select auth.uid()) then
    raise exception 'Il commissario non può liberare la propria squadra: può eliminare la lega';
  end if;
  return v_team;
end;
$$;

-- ---------------------------------------------------------------- azioni

-- Il commissario libera la squadra di un manager: torna al bot e il manager esce (può rientrare con il codice)
create function public.free_team(p_team uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams%rowtype := private.managed_team(p_team);
begin
  perform private.lock_open_round(v_team.league_id);
  perform private.release_team(p_team);
  delete from public.league_members where league_id = v_team.league_id and user_id = v_team.owner_id;
  perform private.kick_if_due(v_team.league_id);
end;
$$;

-- Il commissario espelle un manager: come free_team, e non può più rientrare
create function public.expel_manager(p_team uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_team public.teams%rowtype := private.managed_team(p_team);
begin
  perform private.lock_open_round(v_team.league_id);
  perform private.release_team(p_team);
  delete from public.league_members where league_id = v_team.league_id and user_id = v_team.owner_id;
  insert into public.league_bans (league_id, user_id) values (v_team.league_id, v_team.owner_id)
  on conflict do nothing;
  perform private.kick_if_due(v_team.league_id);
end;
$$;

-- Un manager esce dalla lega: la sua squadra torna al bot
create function public.leave_league(p_league uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_team uuid;
begin
  if not private.is_member(p_league) then
    raise exception 'Non fai parte di questa lega' using errcode = '42501';
  end if;
  if private.is_commissioner(p_league) then
    raise exception 'Il commissario non può lasciare la lega: può eliminarla';
  end if;
  perform private.lock_open_round(p_league);
  select id into v_team from public.teams where league_id = p_league and owner_id = v_user;
  if v_team is not null then
    perform private.release_team(v_team);
  end if;
  delete from public.league_members where league_id = p_league and user_id = v_user;
  perform private.kick_if_due(p_league);
end;
$$;

-- Come nella Fase 6, ma chi è stato espulso non rientra
create or replace function public.join_league(p_code text, p_team_code text) returns uuid
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_league uuid;
  v_team uuid;
begin
  if v_user is null then
    raise exception 'Devi accedere per entrare in una lega' using errcode = '42501';
  end if;
  select id into v_league from public.leagues where invite_code = private.normalize_code(p_code);
  if v_league is null then
    raise exception 'Codice invito non valido';
  end if;
  if exists (select 1 from public.league_bans where league_id = v_league and user_id = v_user) then
    raise exception 'Il commissario ti ha escluso da questa lega';
  end if;
  if exists (select 1 from public.league_members where league_id = v_league and user_id = v_user) then
    raise exception 'Sei già in questa lega';
  end if;
  -- La prima richiesta vince: chi arriva dopo trova la squadra già presa
  update public.teams
  set owner_id = v_user
  where league_id = v_league and code = upper(trim(p_team_code)) and owner_id is null
  returning id into v_team;
  if v_team is null then
    raise exception 'Questa squadra non è libera: scegline un''altra';
  end if;
  insert into public.league_members (league_id, user_id, role) values (v_league, v_user, 'manager');
  return v_league;
end;
$$;

-- ---------------------------------------------------------------- account cancellato

-- Prima di cancellare un profilo (con l'account): le sue leghe passano al membro entrato per primo, o
-- spariscono se non resta nessuno; le sue squadre tornano al bot
create function private.before_profile_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_next uuid;
begin
  for v in select id from public.leagues where commissioner_id = old.id loop
    select m.user_id into v_next
    from public.league_members m
    where m.league_id = v.id and m.user_id <> old.id
    order by m.joined_at, m.user_id
    limit 1;
    if v_next is null then
      delete from public.leagues where id = v.id;
    else
      update public.leagues set commissioner_id = v_next where id = v.id;
      update public.league_members set role = 'commissioner' where league_id = v.id and user_id = v_next;
    end if;
  end loop;
  for v in select id from public.teams where owner_id = old.id loop
    perform private.release_team(v.id);
  end loop;
  return old;
end;
$$;

create trigger profiles_before_delete before delete on public.profiles
  for each row execute function private.before_profile_delete();

-- ---------------------------------------------------------------- permessi

revoke execute on function private.release_team(uuid), private.lock_open_round(uuid), private.kick_if_due(uuid),
  private.managed_team(uuid), public.free_team(uuid), public.expel_manager(uuid), public.leave_league(uuid),
  private.before_profile_delete()
from public, anon, authenticated;

grant execute on function public.free_team(uuid), public.expel_manager(uuid), public.leave_league(uuid)
  to authenticated;
