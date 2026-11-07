-- NBBGM: niente cambi di squadra mentre il turno si simula (seconda analisi, server).
--
-- join_league (un manager prende una squadra del bot) e la cancellazione di un account (le sue squadre tornano al
-- bot, le sue leghe passano a un altro) non prendevano il lock del turno: durante una simulazione la Edge Function
-- lavora con lo stato letto all'inizio, in cui quella squadra era ancora del bot (o ancora umana), e apply_turn
-- scriveva sopra il cambio. Ora entrambe passano da private.lock_open_round, come liberare, espellere e lasciare.
--
-- private.lock_open_round rifiuta solo quando una simulazione può essere davvero in corso (turno in chiusura da
-- meno di 5 minuti e non fermo), come delete_league: con il turno fermo dopo l'ultimo tentativo, o in chiusura da
-- più di 5 minuti (una Edge Function non dura tanto), nessuno sta scrivendo, e la ripresa leggerà lo stato nuovo.
-- Così, per esempio, il commissario libera la squadra di un assente anche con il turno bloccato.

create or replace function private.lock_open_round(p_league uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
begin
  -- Il lock sul turno mette in fila questa modifica e la chiusura del turno (try_close_round prende lo stesso)
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if v_round.state = 'closing' and v_round.failed_at is null
     and v_round.closing_started_at >= now() - interval '5 minutes' then
    raise exception 'Il turno si sta simulando: riprova tra un minuto';
  end if;
end;
$$;

-- Come dopo la Fase 13 (chi è stato espulso non rientra), più il lock del turno
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
  perform private.lock_open_round(v_league);
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

-- Come dopo la Fase 13 (leghe al membro entrato per primo, squadre al bot), più il lock del turno di ogni lega
-- toccata (in ordine, per non incrociarsi con un'altra cancellazione) e la ripartenza del turno se adesso i
-- rimasti sono tutti pronti. Durante una simulazione la cancellazione dell'account non riesce: si riprova dopo.
create or replace function private.before_profile_delete() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_next uuid;
begin
  for v in
    select x.league_id
    from (
      select l.id as league_id from public.leagues l where l.commissioner_id = old.id
      union
      select t.league_id from public.teams t where t.owner_id = old.id
    ) x
    order by x.league_id
  loop
    perform private.lock_open_round(v.league_id);
  end loop;
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
  for v in select id, league_id from public.teams where owner_id = old.id loop
    perform private.release_team(v.id);
    perform private.kick_if_due(v.league_id);
  end loop;
  return old;
end;
$$;
