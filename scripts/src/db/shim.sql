-- Quel poco di Supabase che serve per provare le migrazioni su PGlite (Postgres in WebAssembly):
-- i ruoli anon, authenticated e service_role e lo schema auth con users e uid(). I permessi di default
-- delle tabelle (flag "Automatically expose new tables") li aggiunge testdb.ts, se richiesti.

create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
grant usage on schema auth to anon, authenticated, service_role;

-- Solo le colonne che usano il seed e i test (la tabella vera ne ha molte di più)
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  instance_id uuid,
  aud varchar(255),
  role varchar(255),
  email varchar(255),
  email_confirmed_at timestamptz,
  raw_user_meta_data jsonb default '{}',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Come in Supabase: l'utente arriva dal JWT, qui da set_config('request.jwt.claims', ...)
create function auth.uid() returns uuid
language sql stable
as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;

-- Sulle funzioni nuove restano solo i permessi di Postgres (EXECUTE a tutti tramite PUBLIC): è quello che
-- si vede nel progetto NBBGM, confrontato con supabase db query.
