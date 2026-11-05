-- NBBGM: sicurezza. Un utente legge le leghe di cui fa parte e modifica solo la propria squadra.
-- La RLS filtra le righe, non le colonne: i valori nascosti stanno in player_hidden e base_players,
-- senza nessuna policy di lettura. Tutte le scritture di gioco passano dal server (service_role).

-- ---------------------------------------------------------------- funzioni di controllo
-- security definer: leggono league_members e teams senza ricadere nelle loro stesse policy.

create function public.is_member(p_league uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.league_members m where m.league_id = p_league and m.user_id = (select auth.uid())
  )
$$;

create function public.is_commissioner(p_league uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.leagues l where l.id = p_league and l.commissioner_id = (select auth.uid())
  )
$$;

create function public.owns_team(p_team uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.teams t where t.id = p_team and t.owner_id = (select auth.uid())
  )
$$;

-- Il turno è quello corrente della sua lega ed è aperto
create function public.is_current_round(p_round uuid, p_league uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.rounds r join public.leagues l on l.current_round_id = r.id
    where r.id = p_round and r.league_id = p_league and l.id = p_league and r.state = 'open'
  )
$$;

-- Il manager può toccare la propria squadra: è sua, appartiene a quella lega e il turno corrente è aperto
create function public.can_edit_team(p_team uuid, p_league uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.teams t
    join public.leagues l on l.id = t.league_id
    join public.rounds r on r.id = l.current_round_id
    where t.id = p_team and t.league_id = p_league and t.owner_id = (select auth.uid()) and r.state = 'open'
  )
$$;

-- ---------------------------------------------------------------- permessi di base
-- Supabase dà a anon e authenticated tutti i permessi sulle tabelle di public: qui si parte da zero
-- e si concedono solo letture e le poche scritture che fa il manager.

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;

grant select on
  public.profiles, public.leagues, public.league_members, public.seasons, public.teams, public.players,
  public.contracts, public.dead_money, public.injuries, public.rounds, public.ready_flags, public.playoff_series,
  public.games, public.player_game_stats, public.team_settings, public.coach_delegations, public.alerts,
  public.draft_lottery, public.draft_picks, public.draft_swaps, public.free_agent_bids, public.trade_offers,
  public.ledger, public.transactions
to authenticated;

-- Le sole scritture dirette del manager
grant update (display_name) on public.profiles to authenticated;
grant update (name, deadline_minutes, max_pace_seconds, paused) on public.leagues to authenticated;
grant insert, update, delete on public.team_settings, public.coach_delegations, public.free_agent_bids to authenticated;
grant insert on public.trade_offers to authenticated;

-- ---------------------------------------------------------------- RLS ovunque

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_members enable row level security;
alter table public.seasons enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.player_hidden enable row level security;
alter table public.contracts enable row level security;
alter table public.dead_money enable row level security;
alter table public.injuries enable row level security;
alter table public.base_teams enable row level security;
alter table public.base_players enable row level security;
alter table public.base_contracts enable row level security;
alter table public.base_dead_money enable row level security;
alter table public.rounds enable row level security;
alter table public.ready_flags enable row level security;
alter table public.playoff_series enable row level security;
alter table public.games enable row level security;
alter table public.player_game_stats enable row level security;
alter table public.team_settings enable row level security;
alter table public.coach_delegations enable row level security;
alter table public.alerts enable row level security;
alter table public.draft_lottery enable row level security;
alter table public.draft_picks enable row level security;
alter table public.draft_swaps enable row level security;
alter table public.free_agent_bids enable row level security;
alter table public.trade_offers enable row level security;
alter table public.ledger enable row level security;
alter table public.transactions enable row level security;

-- player_hidden e base_*: RLS attiva, nessuna policy, nessun permesso. Solo il server li legge.

-- ---------------------------------------------------------------- policy

create policy profiles_read on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or exists (
      select 1 from public.league_members a join public.league_members b on a.league_id = b.league_id
      where a.user_id = (select auth.uid()) and b.user_id = profiles.id
    )
  );
create policy profiles_update on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy leagues_read on public.leagues for select to authenticated using (public.is_member(id));
create policy leagues_update on public.leagues for update to authenticated
  using (public.is_commissioner(id)) with check (public.is_commissioner(id));

-- Letture per i membri della lega
create policy members_read on public.league_members for select to authenticated using (public.is_member(league_id));
create policy seasons_read on public.seasons for select to authenticated using (public.is_member(league_id));
create policy teams_read on public.teams for select to authenticated using (public.is_member(league_id));
create policy players_read on public.players for select to authenticated using (public.is_member(league_id));
create policy contracts_read on public.contracts for select to authenticated using (public.is_member(league_id));
create policy dead_money_read on public.dead_money for select to authenticated using (public.is_member(league_id));
create policy injuries_read on public.injuries for select to authenticated using (public.is_member(league_id));
create policy rounds_read on public.rounds for select to authenticated using (public.is_member(league_id));
-- Chi è pronto si vede in tempo reale, le scelte no
create policy ready_read on public.ready_flags for select to authenticated using (public.is_member(league_id));
create policy series_read on public.playoff_series for select to authenticated using (public.is_member(league_id));
create policy games_read on public.games for select to authenticated using (public.is_member(league_id));
create policy stats_read on public.player_game_stats for select to authenticated using (public.is_member(league_id));
create policy lottery_read on public.draft_lottery for select to authenticated using (public.is_member(league_id));
create policy picks_read on public.draft_picks for select to authenticated using (public.is_member(league_id));
create policy swaps_read on public.draft_swaps for select to authenticated using (public.is_member(league_id));
create policy transactions_read on public.transactions for select to authenticated using (public.is_member(league_id));

-- Solo la propria squadra: impostazioni, avvisi, offerte agli svincolati. Le modifiche valgono solo
-- a turno aperto: in chiusura e durante la simulazione non si accetta nulla.
create policy settings_read on public.team_settings for select to authenticated using (public.owns_team(team_id));
create policy settings_insert on public.team_settings for insert to authenticated
  with check (public.can_edit_team(team_id, league_id));
create policy settings_update on public.team_settings for update to authenticated
  using (public.can_edit_team(team_id, league_id)) with check (public.can_edit_team(team_id, league_id));
create policy settings_delete on public.team_settings for delete to authenticated
  using (public.can_edit_team(team_id, league_id));

-- Chi ha l'allenatore attivo lo vedono tutti; lo attiva o lo toglie solo il manager della squadra
create policy coach_read on public.coach_delegations for select to authenticated using (public.is_member(league_id));
create policy coach_insert on public.coach_delegations for insert to authenticated
  with check (public.can_edit_team(team_id, league_id));
create policy coach_update on public.coach_delegations for update to authenticated
  using (public.can_edit_team(team_id, league_id)) with check (public.can_edit_team(team_id, league_id));
create policy coach_delete on public.coach_delegations for delete to authenticated
  using (public.can_edit_team(team_id, league_id));

create policy alerts_own on public.alerts for select to authenticated using (public.owns_team(team_id));

create policy bids_read on public.free_agent_bids for select to authenticated using (public.owns_team(team_id));
create policy bids_insert on public.free_agent_bids for insert to authenticated
  with check (
    public.can_edit_team(team_id, league_id) and status = 'pending' and public.is_current_round(round_id, league_id)
    and exists (
      select 1 from public.players p where p.id = player_id and p.league_id = free_agent_bids.league_id and p.team_id is null
    )
  );
create policy bids_update on public.free_agent_bids for update to authenticated
  using (public.can_edit_team(team_id, league_id) and public.is_current_round(round_id, league_id))
  with check (public.can_edit_team(team_id, league_id) and status in ('pending', 'withdrawn') and public.is_current_round(round_id, league_id));
create policy bids_delete on public.free_agent_bids for delete to authenticated
  using (public.can_edit_team(team_id, league_id) and public.is_current_round(round_id, league_id));

-- Scambi: li vedono le due squadre coinvolte; li propone la propria squadra
create policy trades_read on public.trade_offers for select to authenticated
  using (public.owns_team(from_team_id) or public.owns_team(to_team_id));
create policy trades_propose on public.trade_offers for insert to authenticated
  with check (
    public.can_edit_team(from_team_id, league_id) and status = 'pending'
    and league_id = (select t.league_id from public.teams t where t.id = to_team_id)
  );

-- Bilancio: la propria squadra; il commissario vede tutte
create policy ledger_read on public.ledger for select to authenticated
  using (public.owns_team(team_id) or public.is_commissioner(league_id));

-- ---------------------------------------------------------------- controlli sulle impostazioni

-- Quintetto e minuti devono riguardare giocatori della squadra, con la somma dei minuti a 240
create function public.check_team_settings() returns trigger
language plpgsql security definer set search_path = ''
as $$
declare
  v_total numeric;
  v_foreign integer;
begin
  select count(*) into v_foreign
  from unnest(new.starters) as s(id)
  where not exists (select 1 from public.players p where p.id = s.id and p.team_id = new.team_id);
  if v_foreign > 0 then
    raise exception 'Il quintetto contiene giocatori che non sono della squadra';
  end if;
  if (select count(distinct s) from unnest(new.starters) as s) <> 5 then
    raise exception 'Il quintetto deve avere 5 giocatori diversi';
  end if;
  select count(*) into v_foreign
  from jsonb_object_keys(new.minutes) as k(id)
  where not exists (select 1 from public.players p where p.id::text = k.id and p.team_id = new.team_id);
  if v_foreign > 0 then
    raise exception 'I minuti riguardano giocatori che non sono della squadra';
  end if;
  if exists (
    select 1 from jsonb_each(new.minutes) as m(k, v)
    where case when jsonb_typeof(m.v) = 'number' then m.v::numeric not between 0 and 48 else true end
  ) then
    raise exception 'I minuti di ogni giocatore vanno da 0 a 48';
  end if;
  select coalesce(sum(value::numeric), 0) into v_total from jsonb_each_text(new.minutes);
  if v_total <> 240 then
    raise exception 'La somma dei minuti deve fare 240 (ora %)', v_total;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger team_settings_check before insert or update on public.team_settings
  for each row execute function public.check_team_settings();

-- ---------------------------------------------------------------- profilo per ogni nuovo utente

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(coalesce(new.email, ''), '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- Postgres dà EXECUTE a tutti su ogni funzione nuova (e Supabase anche ad anon e authenticated): ogni
-- funzione va chiusa qui sotto o nella sua migrazione, e aperta solo a chi deve chiamarla.
-- Le funzioni di controllo non devono essere chiamate da chi non è autenticato
revoke execute on function public.is_member(uuid), public.is_commissioner(uuid), public.owns_team(uuid),
  public.is_current_round(uuid, uuid), public.can_edit_team(uuid, uuid) from public, anon;
grant execute on function public.is_member(uuid), public.is_commissioner(uuid), public.owns_team(uuid),
  public.is_current_round(uuid, uuid), public.can_edit_team(uuid, uuid) to authenticated, service_role;
revoke execute on function public.check_team_settings(), public.handle_new_user() from public, anon, authenticated;
