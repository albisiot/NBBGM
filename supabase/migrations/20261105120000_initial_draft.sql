-- NBBGM: draft iniziale di tutti i giocatori (Fase 7).
--
-- 13 giri a serpentina con ordine sorteggiato, sui giocatori con contratto standard: i two-way e i non scelti
-- restano svincolati, e ogni squadra chiude con 13 contratti standard. Le scelte le decide il motore nella Edge
-- Function draft (modalità lista: tutte di fila dalle liste dei manager; dal vivo: a mano o allo scadere del
-- tempo) e apply_draft_picks le scrive in una sola transazione, solo se il draft è ancora alla chiamata attesa.

create table public.initial_drafts (
  league_id uuid primary key references public.leagues (id) on delete cascade,
  mode text not null default 'list' check (mode in ('list', 'live')),
  state text not null default 'waiting' check (state in ('waiting', 'running', 'done')),
  pick_seconds integer not null default 60 check (pick_seconds between 10 and 600),
  -- Squadra di ogni chiamata, nell'ordine (indice 1 = prima scelta)
  team_order uuid[] not null,
  -- Prossima chiamata, contando da 0
  next_pick integer not null default 0,
  pick_deadline timestamptz,
  started_at timestamptz,
  finished_at timestamptz
);

-- Giocatori in palio, con l'overall e il contratto che firmano con chi li sceglie (quello del file o il minimo)
create table public.initial_draft_pool (
  player_id uuid primary key references public.players (id) on delete cascade,
  league_id uuid not null references public.initial_drafts (league_id) on delete cascade,
  overall numeric not null,
  contract_type text not null check (contract_type in ('standard', 'rookie', 'ten-day', 'minimum', 'unknown')),
  salaries bigint[] not null default '{}',
  options text[] not null default '{}',
  guaranteed bigint
);
create index initial_draft_pool_league_id_idx on public.initial_draft_pool (league_id);

create table public.initial_draft_picks (
  league_id uuid not null references public.initial_drafts (league_id) on delete cascade,
  pick_no integer not null check (pick_no >= 0),
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  -- Scelta fatta dal server (bot, modalità lista, tempo scaduto)
  auto boolean not null default false,
  made_at timestamptz not null default now(),
  primary key (league_id, pick_no),
  unique (league_id, player_id)
);
create index initial_draft_picks_team_id_idx on public.initial_draft_picks (team_id);
create index initial_draft_picks_player_id_idx on public.initial_draft_picks (player_id);

-- Preferiti di ogni manager, in ordine: li vede solo lui
create table public.initial_draft_lists (
  team_id uuid primary key references public.teams (id) on delete cascade,
  league_id uuid not null references public.initial_drafts (league_id) on delete cascade,
  player_ids uuid[] not null default '{}' check (cardinality(player_ids) <= 600),
  updated_at timestamptz not null default now()
);
create index initial_draft_lists_league_id_idx on public.initial_draft_lists (league_id);

-- ---------------------------------------------------------------- sicurezza

alter table public.initial_drafts enable row level security;
alter table public.initial_draft_pool enable row level security;
alter table public.initial_draft_picks enable row level security;
alter table public.initial_draft_lists enable row level security;

grant select on public.initial_drafts, public.initial_draft_pool, public.initial_draft_picks,
  public.initial_draft_lists to authenticated;
grant insert, update, delete on public.initial_draft_lists to authenticated;
grant all on public.initial_drafts, public.initial_draft_pool, public.initial_draft_picks,
  public.initial_draft_lists to service_role;

-- La lista si cambia finché il draft non è finito, e solo per la propria squadra
create function private.can_edit_draft_list(p_team uuid, p_league uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.teams t
    join public.initial_drafts d on d.league_id = t.league_id
    where t.id = p_team and t.league_id = p_league and t.owner_id = (select auth.uid()) and d.state <> 'done'
  )
$$;

create policy drafts_read on public.initial_drafts for select to authenticated using (private.is_member(league_id));
create policy pool_read on public.initial_draft_pool for select to authenticated using (private.is_member(league_id));
create policy draft_picks_read on public.initial_draft_picks for select to authenticated
  using (private.is_member(league_id));
create policy lists_read on public.initial_draft_lists for select to authenticated using (private.owns_team(team_id));
create policy lists_insert on public.initial_draft_lists for insert to authenticated
  with check (private.can_edit_draft_list(team_id, league_id));
create policy lists_update on public.initial_draft_lists for update to authenticated
  using (private.can_edit_draft_list(team_id, league_id)) with check (private.can_edit_draft_list(team_id, league_id));
create policy lists_delete on public.initial_draft_lists for delete to authenticated
  using (private.can_edit_draft_list(team_id, league_id));

-- ---------------------------------------------------------------- stato e scrittura (solo server)

-- Tutto quello che serve al motore per decidere le prossime scelte
create function public.draft_snapshot(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'mode', d.mode,
    'state', d.state,
    'order', to_jsonb(d.team_order),
    'next', d.next_pick,
    'deadline', d.pick_deadline,
    'pick_seconds', d.pick_seconds,
    'commissioner_id', l.commissioner_id,
    'owners', (select jsonb_object_agg(t.id, t.owner_id) from public.teams t where t.league_id = d.league_id),
    'pool', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'role', p.role, 'secondary_role', p.secondary_role,
        'overall', q.overall) order by p.id), '[]')
      from public.initial_draft_pool q join public.players p on p.id = q.player_id
      where q.league_id = d.league_id
    ),
    'made', (
      select coalesce(jsonb_agg(jsonb_build_object('pick', k.pick_no, 'team_id', k.team_id, 'player_id', k.player_id)
        order by k.pick_no), '[]')
      from public.initial_draft_picks k where k.league_id = d.league_id
    ),
    'lists', (
      select coalesce(jsonb_object_agg(x.team_id, to_jsonb(x.player_ids)), '{}')
      from public.initial_draft_lists x where x.league_id = d.league_id
    )
  )
  from public.initial_drafts d join public.leagues l on l.id = d.league_id
  where d.league_id = p_league
$$;

/*
  Registra le scelte decise dal motore a partire dalla chiamata p_from, che deve essere quella attesa: se nel
  frattempo un'altra richiesta ha fatto avanzare il draft, non scrive nulla. Ogni scelta deve andare alla
  squadra di turno con un giocatore in palio non ancora scelto. Il giocatore passa alla squadra con il contratto
  del pool. p_begin avvia il draft, p_mode cambia la modalità, p_deadline è la scadenza della chiamata dopo.
  Restituisce la prossima chiamata.
*/
create function public.apply_draft_picks(p_league uuid, p_from integer, p_picks jsonb, p_deadline timestamptz,
  p_begin boolean default false, p_mode text default null) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_draft public.initial_drafts%rowtype;
  v_count integer := coalesce(jsonb_array_length(p_picks), 0);
  v_total integer;
  v_next integer;
begin
  select * into v_draft from public.initial_drafts where league_id = p_league for update;
  if not found then
    raise exception 'Questa lega non ha un draft iniziale';
  end if;
  if p_begin then
    if v_draft.state <> 'waiting' then
      raise exception 'Il draft è già partito';
    end if;
    update public.initial_drafts set state = 'running', started_at = now() where league_id = p_league;
    v_draft.state := 'running';
  end if;
  if v_draft.state <> 'running' then
    raise exception 'Il draft non è in corso';
  end if;
  if v_draft.next_pick <> p_from then
    raise exception 'Il draft è andato avanti: aggiorna la pagina';
  end if;
  if p_mode is not null then
    update public.initial_drafts set mode = p_mode where league_id = p_league;
    update public.leagues set draft_mode = p_mode where id = p_league;
  end if;

  v_total := cardinality(v_draft.team_order);
  if p_from + v_count > v_total then
    raise exception 'apply_draft_picks: più scelte di quelle in calendario';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_picks) with ordinality as x(p, i)
    where (x.p ->> 'pick')::integer <> p_from + x.i - 1
      or (x.p ->> 'team_id')::uuid is distinct from v_draft.team_order[p_from + x.i]
      or not exists (
        select 1 from public.initial_draft_pool q
        where q.league_id = p_league and q.player_id = (x.p ->> 'player_id')::uuid
      )
  ) then
    raise exception 'apply_draft_picks: scelte fuori turno o giocatori non in palio';
  end if;

  -- Un giocatore già scelto lo ferma il vincolo unico (league_id, player_id)
  insert into public.initial_draft_picks (league_id, pick_no, team_id, player_id, auto)
  select p_league, (x.p ->> 'pick')::integer, (x.p ->> 'team_id')::uuid, (x.p ->> 'player_id')::uuid,
    coalesce((x.p ->> 'auto')::boolean, false)
  from jsonb_array_elements(p_picks) as x(p);

  update public.players p
  set team_id = k.team_id
  from public.initial_draft_picks k
  where k.league_id = p_league and k.pick_no >= p_from and k.pick_no < p_from + v_count and p.id = k.player_id;

  insert into public.contracts (player_id, league_id, team_id, type, salaries, options, guaranteed)
  select k.player_id, p_league, k.team_id, q.contract_type, q.salaries, q.options, q.guaranteed
  from public.initial_draft_picks k
  join public.initial_draft_pool q on q.player_id = k.player_id
  where k.league_id = p_league and k.pick_no >= p_from and k.pick_no < p_from + v_count;

  v_next := p_from + v_count;
  update public.initial_drafts
  set next_pick = v_next,
      pick_deadline = case when v_next >= v_total then null else p_deadline end,
      state = case when v_next >= v_total then 'done' else 'running' end,
      finished_at = case when v_next >= v_total then now() end
  where league_id = p_league;

  if v_next >= v_total then
    insert into public.transactions (league_id, season_year, round_number, type, text)
    select p_league, s.year, null, 'draft', format('Draft iniziale concluso: %s scelte', v_total)
    from public.leagues l join public.seasons s on s.id = l.current_season_id
    where l.id = p_league;
  end if;
  return v_next;
end;
$$;

-- insert_league scrive anche il draft iniziale, se la lega nasce in modalità draft
create or replace function public.insert_league(p_league jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_league uuid := (p_league -> 'league' ->> 'id')::uuid;
  v_commissioner uuid := (p_league -> 'league' ->> 'commissioner_id')::uuid;
  v_code text := coalesce(
    nullif(private.normalize_code(p_league -> 'league' ->> 'invite_code'), ''),
    private.new_invite_code()
  );
  v_season uuid := (p_league -> 'season' ->> 'id')::uuid;
  v_round uuid := (p_league -> 'round' ->> 'id')::uuid;
begin
  if v_league is null or v_commissioner is null or v_season is null or v_round is null then
    raise exception 'insert_league: mancano gli id di lega, commissario, stagione o turno';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_league -> 'teams') t where (t ->> 'owner_id')::uuid = v_commissioner
  ) then
    raise exception 'insert_league: il commissario deve guidare una squadra';
  end if;

  insert into public.leagues (id, name, invite_code, commissioner_id, deadline_minutes, max_pace_seconds,
    roster_mode, draft_mode, rookie_source, seed, talent_reference)
  select v_league, x.name, v_code, v_commissioner, x.deadline_minutes, coalesce(x.max_pace_seconds, 60),
    coalesce(x.roster_mode, 'real'), coalesce(x.draft_mode, 'list'), coalesce(x.rookie_source, 'generated'),
    x.seed, coalesce(x.talent_reference, 0)
  from jsonb_populate_record(null::public.leagues, p_league -> 'league') x;

  insert into public.league_members (league_id, user_id, role)
  select v_league, v_commissioner, 'commissioner'
  union
  select v_league, x.user_id, 'manager'
  from jsonb_populate_recordset(null::public.league_members, coalesce(p_league -> 'members', '[]')) x
  where x.user_id <> v_commissioner;

  insert into public.seasons (id, league_id, year, phase, salary_cap, luxury_tax, first_apron, second_apron,
    minimum_team_salary, minimum_salary, rookie_scale, revenue, growth)
  select v_season, v_league, x.year, coalesce(x.phase, 'regular'), x.salary_cap, x.luxury_tax, x.first_apron,
    x.second_apron, x.minimum_team_salary, x.minimum_salary, x.rookie_scale, x.revenue, x.growth
  from jsonb_populate_record(null::public.seasons, p_league -> 'season') x;

  insert into public.teams (id, league_id, code, city, name, full_name, conference, division, owner_id, balance,
    strategy, tax_history)
  select x.id, v_league, x.code, x.city, x.name, x.full_name, x.conference, x.division, x.owner_id,
    coalesce(x.balance, 0), coalesce(x.strategy, 'middle'), coalesce(x.tax_history, '{}')
  from jsonb_populate_recordset(null::public.teams, p_league -> 'teams') x;

  insert into public.players (id, league_id, slug, team_id, first_name, last_name, nationality, role,
    secondary_role, hand, archetype, age, height_cm, wingspan_cm, weight_kg, years_in_league, ratings,
    tendencies, energy, morale, scouted_potential, two_way_games, season_stats, retired)
  select x.id, v_league, x.slug, x.team_id, x.first_name, x.last_name, x.nationality, x.role,
    x.secondary_role, x.hand, x.archetype, x.age, x.height_cm, x.wingspan_cm, x.weight_kg, x.years_in_league,
    x.ratings, x.tendencies, x.energy, x.morale, x.scouted_potential, coalesce(x.two_way_games, 0),
    coalesce(x.season_stats, '{}'), false
  from jsonb_populate_recordset(null::public.players, p_league -> 'players') x;

  insert into public.player_hidden (player_id, league_id, hidden)
  select x.player_id, v_league, x.hidden
  from jsonb_populate_recordset(null::public.player_hidden, coalesce(p_league -> 'player_hidden', '[]')) x;

  insert into public.injuries (player_id, league_id, body_part, severity, games_remaining)
  select x.player_id, v_league, x.body_part, x.severity, x.games_remaining
  from jsonb_populate_recordset(null::public.injuries, coalesce(p_league -> 'injuries', '[]')) x;

  insert into public.contracts (player_id, league_id, team_id, type, salaries, options, guaranteed)
  select x.player_id, v_league, x.team_id, x.type, x.salaries, x.options, x.guaranteed
  from jsonb_populate_recordset(null::public.contracts, coalesce(p_league -> 'contracts', '[]')) x;

  insert into public.dead_money (id, league_id, team_id, player_name, salaries)
  select coalesce(x.id, gen_random_uuid()), v_league, x.team_id, x.player_name, x.salaries
  from jsonb_populate_recordset(null::public.dead_money, coalesce(p_league -> 'dead_money', '[]')) x;

  insert into public.draft_picks (id, league_id, draft_year, round, original_team_id, owner_team_id, protection,
    deferrals)
  select x.id, v_league, x.draft_year, x.round, x.original_team_id, x.owner_team_id, x.protection,
    coalesce(x.deferrals, 0)
  from jsonb_populate_recordset(null::public.draft_picks, coalesce(p_league -> 'draft_picks', '[]')) x;

  insert into public.rounds (id, league_id, season_id, number, kind, deadline)
  select v_round, v_league, v_season, coalesce(x.number, 0), coalesce(x.kind, 'regular'),
    case when l.deadline_minutes is null then null else now() + make_interval(mins => l.deadline_minutes) end
  from jsonb_populate_record(null::public.rounds, p_league -> 'round') x
  join public.leagues l on l.id = v_league;

  insert into public.games (id, league_id, season_id, round_number, kind, home_team_id, away_team_id)
  select x.id, v_league, v_season, x.round_number, coalesce(x.kind, 'regular'), x.home_team_id, x.away_team_id
  from jsonb_populate_recordset(null::public.games, coalesce(p_league -> 'games', '[]')) x;

  insert into public.team_settings (team_id, league_id, starters, minutes, tactics)
  select x.team_id, v_league, x.starters, x.minutes, x.tactics
  from jsonb_populate_recordset(null::public.team_settings, coalesce(p_league -> 'team_settings', '[]')) x;

  -- Draft iniziale (rose iniziali in modalità draft): ordine delle chiamate e giocatori in palio
  if p_league ? 'initial_draft' then
    insert into public.initial_drafts (league_id, mode, pick_seconds, team_order)
    select v_league, coalesce(x.mode, 'list'), coalesce(x.pick_seconds, 60), x.team_order
    from jsonb_populate_record(null::public.initial_drafts, p_league -> 'initial_draft') x;
    insert into public.initial_draft_pool (player_id, league_id, overall, contract_type, salaries, options,
      guaranteed)
    select x.player_id, v_league, x.overall, x.contract_type, coalesce(x.salaries, '{}'),
      coalesce(x.options, '{}'), x.guaranteed
    from jsonb_populate_recordset(null::public.initial_draft_pool, p_league -> 'initial_draft' -> 'pool') x;
  end if;

  update public.leagues set current_season_id = v_season, current_round_id = v_round where id = v_league;
  return jsonb_build_object('league_id', v_league, 'invite_code', v_code);
end;
$$;

revoke execute on function private.can_edit_draft_list(uuid, uuid), public.draft_snapshot(uuid),
  public.apply_draft_picks(uuid, integer, jsonb, timestamptz, boolean, text)
from public, anon, authenticated;
grant execute on function private.can_edit_draft_list(uuid, uuid) to authenticated, service_role;
grant execute on function public.draft_snapshot(uuid),
  public.apply_draft_picks(uuid, integer, jsonb, timestamptz, boolean, text) to service_role;
