-- NBBGM: notifiche push (dopo la Fase 13).
--
-- Web Push standard con chiavi VAPID: il browser (o la PWA installata, su iPhone da iOS 16.4) dà un'iscrizione
-- per dispositivo, che l'app salva con save_push_subscription. Il database mette in coda le notifiche
-- (push_outbox) quando:
--   turn      la lega passa al turno successivo (leagues.current_round_id cambia), se non c'è l'allenatore
--   decision  arriva un avviso bloccante alla propria squadra (proposta di scambio, rosa corta, offseason)
--   draft     nel draft iniziale dal vivo la propria scelta è vicina (entro 2 chiamate)
-- solo per chi ha almeno un'iscrizione e non ha spento quel tipo nel profilo (notification_settings). Una
-- chiamata pg_net per transazione sveglia la Edge Function push, che si prende la coda (push_take), unisce le
-- notifiche della stessa lega per la stessa persona, le cifra e le manda; le iscrizioni scadute (404/410) le
-- cancella con push_gone. Se la chiamata si perde, pg_cron riprova ogni minuto; dopo 10 minuti una notifica
-- non più mandata si butta. Senza chiavi VAPID l'app non mostra nulla, nessuno si iscrive e la coda resta vuota.

-- ---------------------------------------------------------------- tabelle

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (endpoint ~ '^https://' and length(endpoint) <= 1000),
  p256dh text not null check (length(p256dh) between 80 and 100),
  auth text not null check (length(auth) between 16 and 30),
  user_agent text,
  created_at timestamptz not null default now()
);
create index push_subscriptions_user on public.push_subscriptions (user_id);

-- Tipi di notifica scelti nel profilo; senza riga valgono tutti
create table public.notification_settings (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  turn boolean not null default true,
  decisions boolean not null default true,
  draft boolean not null default true,
  updated_at timestamptz not null default now()
);

create table public.push_outbox (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  league_id uuid references public.leagues (id) on delete cascade,
  kind text not null check (kind in ('turn', 'decision', 'draft')),
  -- turn: il turno nuovo; decision: il turno dell'avviso
  round_id uuid references public.rounds (id) on delete set null,
  -- decision: tipo di avviso; draft: 'now' (tocca a te) o 'soon' (tra poco)
  detail text,
  -- draft: numero della scelta (da 1)
  pick integer,
  created_at timestamptz not null default now()
);
create index push_outbox_user on public.push_outbox (user_id);
create index push_outbox_league on public.push_outbox (league_id);
create index push_outbox_round on public.push_outbox (round_id);
create index push_outbox_created on public.push_outbox (created_at);

alter table public.push_subscriptions enable row level security;
alter table public.notification_settings enable row level security;
alter table public.push_outbox enable row level security;

-- Ognuno vede solo le sue iscrizioni (le scrive con le funzioni qui sotto) e le sue preferenze
create policy push_subscriptions_own on public.push_subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_settings_read on public.notification_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy notification_settings_insert on public.notification_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy notification_settings_update on public.notification_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
-- push_outbox: nessuna policy, la legge solo il server

revoke all on public.push_subscriptions, public.notification_settings, public.push_outbox from anon, authenticated;
revoke all on sequence public.push_outbox_id_seq from anon, authenticated;
grant select on public.push_subscriptions to authenticated;
grant select on public.notification_settings to authenticated;
grant insert (user_id, turn, decisions, draft, updated_at) on public.notification_settings to authenticated;
-- Anche user_id: l'upsert dell'API lo riscrive (sempre uguale, la policy non lo lascia cambiare)
grant update (user_id, turn, decisions, draft, updated_at) on public.notification_settings to authenticated;
grant all on public.push_subscriptions, public.notification_settings, public.push_outbox to service_role;
grant all on sequence public.push_outbox_id_seq to service_role;

-- ---------------------------------------------------------------- iscrizioni dal client

-- Iscrizione di questo dispositivo per l'utente collegato. Lo stesso endpoint passa a chi si iscrive adesso
-- (un telefono usato da un altro account); al massimo 10 dispositivi per persona, i più vecchi escono.
create function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text, p_user_agent text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Serve il login' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or length(coalesce(p_p256dh, '')) not between 80 and 100 or length(coalesce(p_auth, '')) not between 16 and 30 then
    raise exception 'Iscrizione alle notifiche non valida';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
  delete from public.push_subscriptions s
  where s.user_id = v_user
    and s.id not in (
      select x.id from public.push_subscriptions x where x.user_id = v_user order by x.created_at desc, x.id limit 10
    );
end;
$$;

-- Toglie l'iscrizione di questo dispositivo (notifiche spente o uscita dall'account)
create function public.delete_push_subscription(p_endpoint text) returns void
language sql security definer set search_path = ''
as $$
  delete from public.push_subscriptions where endpoint = p_endpoint and user_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------- coda

-- Una notifica in coda, se la persona ha un dispositivo iscritto e quel tipo acceso; la prima della transazione
-- sveglia la Edge Function push (pg_net parte dopo il commit, quindi la funzione trova tutta la coda)
create function private.enqueue_push(p_user uuid, p_league uuid, p_kind text, p_round uuid, p_detail text,
  p_pick integer) returns void
language plpgsql security definer set search_path = ''
as $$
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

-- Turno nuovo: ai manager della lega, tranne chi ha affidato la squadra all'allenatore (non deve fare nulla, e
-- con tutti gli allenatori la lega può avanzare di un turno al minuto); se serve una decisione arriva l'avviso
create function private.push_round() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.current_round_id is not null and new.current_round_id is not null
     and new.current_round_id <> old.current_round_id then
    perform private.enqueue_push(t.owner_id, new.id, 'turn', new.current_round_id, null, null)
    from public.teams t
    where t.league_id = new.id and t.owner_id is not null
      and not private.coach_active(t.id, new.current_round_id);
  end if;
  return null;
end;
$$;

create trigger leagues_push_round after update of current_round_id on public.leagues
  for each row execute function private.push_round();

-- Avviso bloccante nuovo: al manager della squadra
create function private.push_alert() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.blocking and new.status = 'open' then
    perform private.enqueue_push(t.owner_id, new.league_id, 'decision', new.round_id, new.kind, null)
    from public.teams t
    where t.id = new.team_id and t.owner_id is not null;
  end if;
  return null;
end;
$$;

create trigger alerts_push after insert on public.alerts
  for each row execute function private.push_alert();

-- Draft iniziale dal vivo: avvisa chi ha una scelta che entra nelle prossime 3 chiamate (quella in corso e le 2
-- dopo). Le scelte dei bot sono istantanee, quindi la finestra può saltare avanti di più posizioni in una volta.
create function private.push_draft() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_from integer;
  v_to integer;
begin
  if new.mode <> 'live' or new.state <> 'running' then
    return null;
  end if;
  v_to := least(new.next_pick + 2, cardinality(new.team_order) - 1);
  v_from := case
    when old.mode = 'live' and old.state = 'running' then greatest(old.next_pick + 3, new.next_pick)
    else new.next_pick
  end;
  for i in v_from .. v_to loop
    perform private.enqueue_push(t.owner_id, new.league_id, 'draft', null,
      case when i = new.next_pick then 'now' else 'soon' end, i + 1)
    from public.teams t
    where t.id = new.team_order[i + 1] and t.owner_id is not null;
  end loop;
  return null;
end;
$$;

create trigger initial_drafts_push after update of next_pick, state, mode on public.initial_drafts
  for each row execute function private.push_draft();

-- ---------------------------------------------------------------- per la Edge Function push

/*
  Prende dalla coda al massimo p_limit notifiche (le toglie: una notifica persa non si rimanda) e restituisce
    notifications   [{ id, user_id, league_id, kind, detail, pick, league_name, round_kind, round_number,
                       round_stage }]
    subscriptions   [{ user_id, endpoint, p256dh, auth }] dei destinatari
    badges          { user_id: decisioni bloccanti aperte } per il numero sull'icona
*/
create function public.push_take(p_limit integer) returns jsonb
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
        'auth', s.auth))
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

-- Iscrizioni che il servizio push dice scadute o inesistenti (404, 410)
create function public.push_gone(p_endpoints text[]) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  delete from public.push_subscriptions where endpoint = any (p_endpoints);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

-- Ogni minuto (pg_cron): se una chiamata alla Edge Function si è persa, la coda si sveglia di nuovo; le notifiche
-- vecchie di 10 minuti non servono più
create function private.push_retry() returns void
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.push_outbox where created_at < now() - interval '10 minutes';
  if exists (select 1 from public.push_outbox where created_at < now() - interval '30 seconds') then
    perform private.kick('push', '{}'::jsonb);
  end if;
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text), private.enqueue_push(uuid, uuid, text, uuid, text, integer),
  private.push_round(), private.push_alert(), private.push_draft(), public.push_take(integer),
  public.push_gone(text[]), private.push_retry()
from public, anon, authenticated;

grant execute on function public.save_push_subscription(text, text, text, text),
  public.delete_push_subscription(text) to authenticated;
grant execute on function public.push_take(integer), public.push_gone(text[]) to service_role;

-- ---------------------------------------------------------------- pg_cron (solo Supabase)

do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    perform cron.schedule('nbbgm-notifiche', '* * * * *', 'select private.push_retry()');
  end if;
end;
$$;
