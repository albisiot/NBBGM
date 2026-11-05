-- NBBGM: correzioni dopo i controlli di Supabase (supabase db advisors) sul progetto vero.
--
-- Le funzioni di controllo usate dalle policy erano chiamabili anche direttamente dall'API (/rest/v1/rpc).
-- Passano nello schema private, che la Data API non espone: le policy continuano a usarle (le legano per
-- oid, non per nome), il client non può più chiamarle. Al client resta solo set_ready.

create schema private;
grant usage on schema private to authenticated, service_role;

alter function public.is_member(uuid) set schema private;
alter function public.is_commissioner(uuid) set schema private;
alter function public.owns_team(uuid) set schema private;
alter function public.is_current_round(uuid, uuid) set schema private;
alter function public.can_edit_team(uuid, uuid) set schema private;

-- set_ready chiamava owns_team per nome: va riscritta con il nuovo schema
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
  return public.round_all_ready(v_round.id);
end;
$$;

-- coach_ready rivelava se un'altra squadra ha un avviso bloccante aperto: solo il server. set_ready
-- restituisce già al manager se il turno è completo.
revoke execute on function public.coach_ready(uuid, uuid), public.round_all_ready(uuid) from authenticated;

-- Con "Enable automatic RLS" Supabase crea public.rls_auto_enable() (trigger di evento, security definer):
-- non deve essere chiamabile dall'API. Nei database senza quel flag (test, sviluppo locale) non esiste.
do $$
begin
  if exists (
    select 1 from pg_proc where proname = 'rls_auto_enable' and pronamespace = 'public'::regnamespace
  ) then
    execute 'revoke execute on function public.rls_auto_enable() from public, anon, authenticated';
  end if;
end;
$$;
