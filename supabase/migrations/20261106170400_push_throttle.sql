-- NBBGM: notifiche più tranquille e iscrizioni che non funzionano più (seconda analisi, server).
--
--   - Proporre e ritirare uno scambio di continuo faceva vibrare il telefono dell'altro a ogni giro (market_write
--     -> avviso bloccante -> trigger alerts_push). Ora le notifiche di decisione si raggruppano per persona, turno
--     e tipo di avviso: al massimo una ogni 5 minuti (private.push_throttle). Un turno nuovo è un'altra chiave,
--     quindi i turni dell'offseason che corrono veloci avvisano ognuno. In più una squadra fa al massimo 5
--     proposte di scambio alla stessa squadra nello stesso turno (anche il Pronto dell'altro non si toglie
--     all'infinito).
--   - "Turno nuovo" non arriva a chi in play-in e playoff non gioca il turno (private.team_readiness = 'out').
--   - Dopo un cambio delle chiavi VAPID le iscrizioni vecchie fallivano per sempre (401/403) senza essere
--     cancellate. Ora la Edge Function conta i rifiuti di fila di ogni iscrizione (push_failed): al terzo
--     l'iscrizione si cancella; un invio riuscito azzera il conto. Chi riapre l'app si iscrive di nuovo da solo.

-- ---------------------------------------------------------------- raggruppamento delle decisioni

-- Ultima notifica di decisione per persona, turno e tipo di avviso (solo server: la usa enqueue_push)
create table private.push_throttle (
  user_id uuid not null references public.profiles (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  detail text not null,
  last_at timestamptz not null default now(),
  primary key (user_id, round_id, detail)
);
create index push_throttle_round on private.push_throttle (round_id);
create index push_throttle_last on private.push_throttle (last_at);
alter table private.push_throttle enable row level security;
revoke all on private.push_throttle from public, anon, authenticated;

-- Distanza minima tra due notifiche di decisione uguali (stessa persona, turno e tipo)
create function private.decision_push_gap() returns interval
language sql immutable set search_path = ''
as $$
  select interval '5 minutes'
$$;

-- Come prima, più il raggruppamento delle decisioni: una notifica di decisione uguale a una mandata da meno di
-- private.decision_push_gap() non entra in coda (l'avviso c'è comunque nell'app)
create or replace function private.enqueue_push(p_user uuid, p_league uuid, p_kind text, p_round uuid,
  p_detail text, p_pick integer) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_new boolean;
begin
  if p_user is null or not exists (select 1 from public.push_subscriptions s where s.user_id = p_user) then
    return;
  end if;
  if not coalesce((
    select case p_kind when 'turn' then n.turn when 'decision' then n.decisions else n.draft end
    from public.notification_settings n where n.user_id = p_user
  ), true) then
    return;
  end if;
  -- Una notifica non deve mai far fallire quello che la provoca (apply_turn, market_write, il draft): se qualcosa
  -- va storto qui, la notifica salta e basta
  begin
    if p_kind = 'decision' and p_round is not null then
      insert into private.push_throttle as t (user_id, round_id, detail, last_at)
      values (p_user, p_round, coalesce(p_detail, ''), now())
      on conflict (user_id, round_id, detail) do update set last_at = excluded.last_at
      where t.last_at <= now() - private.decision_push_gap()
      returning true into v_new;
      if not coalesce(v_new, false) then
        return;
      end if;
    end if;
    insert into public.push_outbox (user_id, league_id, kind, round_id, detail, pick)
    values (p_user, p_league, p_kind, p_round, p_detail, p_pick);
    if current_setting('nbbgm.push_kicked', true) is distinct from 'on' then
      perform set_config('nbbgm.push_kicked', 'on', true);
      perform private.kick('push', '{}'::jsonb);
    end if;
  exception when others then
    raise warning 'Notifica non messa in coda: %', sqlerrm;
  end;
end;
$$;

-- ---------------------------------------------------------------- turno nuovo

-- Turno nuovo: ai manager della lega che giocano il turno (in play-in e playoff chi è fuori non deve fare nulla),
-- tranne chi ha affidato la squadra all'allenatore; se serve una decisione arriva l'avviso
create or replace function private.push_round() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.current_round_id is not null and new.current_round_id is not null
     and new.current_round_id <> old.current_round_id then
    perform private.enqueue_push(t.owner_id, new.id, 'turn', new.current_round_id, null, null)
    from public.teams t
    join private.team_readiness(new.current_round_id) x on x.team_id = t.id
    where t.league_id = new.id and t.owner_id is not null and x.state <> 'out'
      and not private.coach_active(t.id, new.current_round_id);
  end if;
  return null;
end;
$$;

-- ---------------------------------------------------------------- iscrizioni che falliscono

alter table public.push_subscriptions add column failures integer not null default 0;

-- Rifiuti di fila dopo i quali un'iscrizione si cancella
create function private.max_push_failures() returns integer
language sql immutable set search_path = ''
as $$
  select 3
$$;

/*
  Esito degli invii per la Edge Function push: p_failed le iscrizioni rifiutate dal servizio push in modo
  permanente (400, 401, 403: chiavi o iscrizione non più valide), p_ok quelle con un invio riuscito dopo qualche
  rifiuto. Un'iscrizione rifiutata private.max_push_failures() volte di fila si cancella. Restituisce quante.
*/
create function public.push_failed(p_failed text[], p_ok text[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  update public.push_subscriptions set failures = 0 where endpoint = any (p_ok) and failures > 0;
  update public.push_subscriptions set failures = failures + 1 where endpoint = any (p_failed);
  delete from public.push_subscriptions
  where endpoint = any (p_failed) and failures >= private.max_push_failures();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Come prima, con i rifiuti di fila di ogni iscrizione (per azzerarli dopo un invio riuscito)
create or replace function public.push_take(p_limit integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  with taken as (
    delete from public.push_outbox o
    where o.id in (
      select x.id from public.push_outbox x order by x.id
      limit greatest(1, least(coalesce(p_limit, 500), 1000))
      for update skip locked
    )
    returning o.*
  )
  select jsonb_build_object(
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'league_id', t.league_id,
        'kind', t.kind, 'detail', t.detail, 'pick', t.pick, 'league_name', l.name, 'round_kind', r.kind,
        'round_number', r.number, 'round_stage', r.stage) order by t.id)
      from taken t
      left join public.leagues l on l.id = t.league_id
      left join public.rounds r on r.id = t.round_id
    ), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'endpoint', s.endpoint, 'p256dh', s.p256dh,
        'auth', s.auth, 'failures', s.failures) order by s.created_at, s.id)
      from public.push_subscriptions s
      where s.user_id in (select t.user_id from taken t)
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_object_agg(u.user_id, (
        select count(*) from public.alerts a join public.teams tm on tm.id = a.team_id
        where tm.owner_id = u.user_id and a.status = 'open' and a.blocking
      ))
      from (select distinct t.user_id from taken t) u
    ), '{}'::jsonb)
  ) into v;
  return v;
end;
$$;

-- Come prima, più la pulizia dei raggruppamenti scaduti
create or replace function private.push_retry() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.push_outbox where created_at < now() - interval '10 minutes';
  delete from private.push_throttle where last_at < now() - private.decision_push_gap();
  if exists (select 1 from public.push_outbox where created_at < now() - interval '30 seconds') then
    perform private.kick('push', '{}'::jsonb);
  end if;
end;
$$;

-- ---------------------------------------------------------------- proposte di scambio

-- Proposte di una squadra alla stessa squadra nello stesso turno (comprese quelle ritirate)
create function private.max_proposals_per_pair() returns integer
language sql immutable set search_path = ''
as $$
  select 5
$$;

/*
  Come nella Fase 11, più il limite delle proposte alla stessa squadra nello stesso turno: ogni proposta a un
  umano gli toglie il Pronto e gli manda un avviso.
*/
create or replace function public.market_write(p_league uuid, p_round uuid, p_team uuid, p_action jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_kind text := p_action ->> 'kind';
  v_id uuid;
  v_to uuid;
begin
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found or v_round.id <> p_round or v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura: riprova quando si apre il prossimo';
  end if;
  if not exists (select 1 from public.teams t where t.id = p_team and t.league_id = p_league) then
    raise exception 'Squadra non di questa lega';
  end if;

  case v_kind
  when 'bid' then
    insert into public.free_agent_bids as b (league_id, round_id, team_id, player_id, salaries, status)
    values (p_league, p_round, p_team, (p_action ->> 'player_id')::uuid,
      array(select (jsonb_array_elements_text(p_action -> 'salaries'))::bigint), 'pending')
    on conflict (round_id, team_id, player_id) do update set salaries = excluded.salaries, status = 'pending'
    returning id into v_id;

  when 'withdraw_bid' then
    update public.free_agent_bids set status = 'withdrawn'
    where id = (p_action ->> 'bid_id')::uuid and team_id = p_team and round_id = p_round and status = 'pending'
    returning id into v_id;

  when 'propose_trade' then
    v_to := (p_action ->> 'to_team_id')::uuid;
    if not exists (select 1 from public.teams t where t.id = v_to and t.league_id = p_league) or v_to = p_team then
      raise exception 'Squadra non valida per lo scambio';
    end if;
    if (
      select count(*) from public.trade_offers o
      where o.from_team_id = p_team and o.to_team_id = v_to and o.created_round_id = p_round
    ) >= private.max_proposals_per_pair() then
      raise exception 'Hai già fatto % proposte a questa squadra in questo turno: riprova nel prossimo',
        private.max_proposals_per_pair();
    end if;
    insert into public.trade_offers (league_id, from_team_id, to_team_id, players_from, players_to, picks_from,
      picks_to, swaps, protections, status, created_round_id)
    values (p_league, p_team, v_to,
      array(select (jsonb_array_elements_text(coalesce(p_action -> 'players_from', '[]')))::uuid),
      array(select (jsonb_array_elements_text(coalesce(p_action -> 'players_to', '[]')))::uuid),
      array(select (jsonb_array_elements_text(coalesce(p_action -> 'picks_from', '[]')))::uuid),
      array(select (jsonb_array_elements_text(coalesce(p_action -> 'picks_to', '[]')))::uuid),
      coalesce(p_action -> 'swaps', '[]'), coalesce(p_action -> 'protections', '{}'), 'pending', p_round)
    returning id into v_id;
    -- Chi la riceve, se è umano, deve rispondere: avviso bloccante e Pronto tolto, perché la veda prima che
    -- il turno si chiuda
    if exists (select 1 from public.teams t where t.id = v_to and t.owner_id is not null) then
      insert into public.alerts (league_id, team_id, kind, blocking, payload, round_id)
      values (p_league, v_to, 'trade_offer', true, jsonb_build_object('trade_id', v_id, 'from_team_id', p_team),
        p_round);
      update public.ready_flags set ready = false, updated_at = now() where round_id = p_round and team_id = v_to;
    end if;

  when 'respond_trade' then
    update public.trade_offers
    set status = case when (p_action ->> 'accept')::boolean then 'accepted' else 'rejected' end,
        responded_at = now()
    where id = (p_action ->> 'offer_id')::uuid and to_team_id = p_team and status = 'pending'
    returning id into v_id;
    if v_id is null then
      raise exception 'Proposta di scambio non trovata o già decisa';
    end if;
    update public.alerts set status = 'resolved'
    where team_id = p_team and kind = 'trade_offer' and status = 'open' and payload ->> 'trade_id' = v_id::text;

  when 'withdraw_trade' then
    update public.trade_offers set status = 'withdrawn', responded_at = coalesce(responded_at, now())
    where id = (p_action ->> 'offer_id')::uuid and from_team_id = p_team and status in ('pending', 'accepted')
    returning id into v_id;
    if v_id is null then
      raise exception 'Proposta di scambio non trovata o già chiusa';
    end if;
    update public.alerts set status = 'expired'
    where kind = 'trade_offer' and status = 'open' and payload ->> 'trade_id' = v_id::text;

  when 'release', 'renew' then
    insert into public.roster_requests (league_id, team_id, round_id, player_id, kind, payload)
    values (p_league, p_team, p_round, (p_action ->> 'player_id')::uuid, v_kind,
      case when v_kind = 'renew' then jsonb_build_object('salaries', p_action -> 'salaries') else '{}' end)
    returning id into v_id;

  when 'withdraw_request' then
    update public.roster_requests set status = 'withdrawn'
    where id = (p_action ->> 'request_id')::uuid and team_id = p_team and round_id = p_round and status = 'pending'
    returning id into v_id;

  else
    raise exception 'Azione di mercato sconosciuta: %', v_kind;
  end case;
  if v_id is null then
    raise exception 'Niente da cambiare';
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.decision_push_gap(), private.max_push_failures(),
  public.push_failed(text[], text[]), private.max_proposals_per_pair()
from public, anon, authenticated;

grant execute on function public.push_failed(text[], text[]) to service_role;
