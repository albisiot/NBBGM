-- NBBGM: iscrizioni solo su invito, codice invito nuovo e bandi (seconda analisi, server).
--
-- La registrazione era aperta a chiunque e ogni utente può creare 5 leghe: con una ventina di email usa e getta
-- si riempivano i 500 MB del piano Free. Ora:
--   - un hook "before user created" di Supabase Auth (public.hook_before_user_created) accetta un utente nuovo
--     solo se la sua email è stata invitata da un commissario (signup_invites) oppure se arriva con un codice
--     invito valido di una lega (l'app lo manda nei metadati dell'iscrizione con il codice via email, quando si
--     entra dal link d'invito). Chi ha già un account entra come prima: l'hook vale solo per gli account nuovi.
--     L'hook si attiva a mano nella dashboard (supabase/README.md); finché è spento non cambia nulla;
--   - con Google non si possono mandare metadati: un amico che si iscrive con Google va invitato per email;
--   - il commissario cambia il codice invito (regenerate_invite_code): il link vecchio smette di valere, anche
--     per iscriversi, e chi è uscito o è stato liberato non rientra senza il codice nuovo;
--   - il commissario vede gli esclusi della lega (league_bans_list) e toglie il bando (unban_manager).

-- ---------------------------------------------------------------- inviti per email

create table public.signup_invites (
  league_id uuid not null references public.leagues (id) on delete cascade,
  email text not null check (
    email = lower(btrim(email)) and length(email) <= 254 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  invited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (league_id, email)
);
create index signup_invites_email on public.signup_invites (email);
create index signup_invites_invited_by on public.signup_invites (invited_by);

alter table public.signup_invites enable row level security;
-- Il commissario vede gli inviti della sua lega; si scrivono solo con le funzioni qui sotto
create policy signup_invites_read on public.signup_invites for select to authenticated
  using (private.is_commissioner(league_id));
revoke all on public.signup_invites from anon, authenticated;
grant select on public.signup_invites to authenticated;
grant all on public.signup_invites to service_role;

-- Inviti per lega: abbastanza per una lega di amici, non per riempire il database di account
create function private.max_invites_per_league() returns integer
language sql immutable set search_path = ''
as $$
  select 40
$$;

-- Il commissario invita un amico per email: potrà iscriversi con quell'indirizzo (codice via email o Google)
create function public.invite_email(p_league uuid, p_email text) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario invita per email' using errcode = '42501';
  end if;
  if length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'Indirizzo email non valido';
  end if;
  -- Gli inviti della stessa lega passano uno alla volta: il limite tiene anche con due richieste insieme
  perform pg_advisory_xact_lock(hashtextextended('nbbgm-inviti:' || p_league::text, 0));
  if exists (select 1 from public.signup_invites where league_id = p_league and email = v_email) then
    return;
  end if;
  if (select count(*) from public.signup_invites where league_id = p_league) >= private.max_invites_per_league() then
    raise exception 'Hai già % inviti per email in questa lega: togline qualcuno', private.max_invites_per_league();
  end if;
  insert into public.signup_invites (league_id, email, invited_by) values (p_league, v_email, (select auth.uid()));
end;
$$;

create function public.remove_invite(p_league uuid, p_email text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario toglie gli inviti' using errcode = '42501';
  end if;
  delete from public.signup_invites where league_id = p_league and email = lower(btrim(coalesce(p_email, '')));
end;
$$;

-- Come nella Fase 5, più: chi si iscrive con un'email invitata consuma i suoi inviti
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)));
  if new.email is not null then
    delete from public.signup_invites where email = lower(btrim(new.email));
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------- hook di Supabase Auth

/*
  Hook "before user created": Supabase Auth lo chiama prima di creare un utente nuovo con
    { metadata: { ... }, user: { email, app_metadata: { provider }, user_metadata: { invite_code? }, ... } }
  e lo crea solo se la risposta non ha error. Accetta chi ha un'email invitata o un codice invito valido.
*/
create function public.hook_before_user_created(event jsonb) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_email text := lower(btrim(coalesce(event -> 'user' ->> 'email', '')));
  v_code text := private.normalize_code(event -> 'user' -> 'user_metadata' ->> 'invite_code');
begin
  if v_email <> '' and exists (select 1 from public.signup_invites where email = v_email) then
    return '{}'::jsonb;
  end if;
  if v_code <> '' and exists (select 1 from public.leagues where invite_code = v_code) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object('error', jsonb_build_object(
    'http_code', 403,
    'message', 'Iscrizione solo su invito: entra dal link della lega che ti hanno mandato, o chiedi al '
      || 'commissario di invitare la tua email'
  ));
end;
$$;

-- ---------------------------------------------------------------- codice invito e bandi

-- Il commissario cambia il codice invito: quello vecchio non vale più. Restituisce il codice nuovo.
create function public.regenerate_invite_code(p_league uuid) returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_code text;
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario cambia il codice invito' using errcode = '42501';
  end if;
  -- Un codice alla volta: due richieste insieme non generano lo stesso codice per due leghe
  perform pg_advisory_xact_lock(hashtextextended('nbbgm-codici', 0));
  v_code := private.new_invite_code();
  update public.leagues set invite_code = v_code where id = p_league;
  return v_code;
end;
$$;

-- Gli esclusi dalla lega, con il nome, per il commissario
create function public.league_bans_list(p_league uuid)
returns table (user_id uuid, display_name text, created_at timestamptz)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario vede gli esclusi' using errcode = '42501';
  end if;
  return query
    select b.user_id, p.display_name, b.created_at
    from public.league_bans b
    join public.profiles p on p.id = b.user_id
    where b.league_id = p_league
    order by b.created_at, b.user_id;
end;
$$;

-- Il commissario toglie il bando: l'escluso può rientrare con il codice invito
create function public.unban_manager(p_league uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario toglie il bando' using errcode = '42501';
  end if;
  delete from public.league_bans where league_id = p_league and user_id = p_user;
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.max_invites_per_league(), public.invite_email(uuid, text),
  public.remove_invite(uuid, text), public.handle_new_user(), public.hook_before_user_created(jsonb),
  public.regenerate_invite_code(uuid), public.league_bans_list(uuid), public.unban_manager(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.invite_email(uuid, text), public.remove_invite(uuid, text),
  public.regenerate_invite_code(uuid), public.league_bans_list(uuid), public.unban_manager(uuid, uuid)
  to authenticated;
-- Lo chiama solo Supabase Auth, che per eseguirlo deve anche poter usare lo schema public (la dashboard lo
-- concede da sola quando si attiva l'hook, config push no)
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
