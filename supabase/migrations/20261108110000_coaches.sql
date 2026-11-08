-- NBBGM: allenatori e proprietari dei bot (fase 2: server e database).
--
-- coaches         capo allenatori della lega, in panchina (team_id) e liberi (team_id null): idea di gioco,
--                 carattere, qualità e contratto. Li leggono i membri della lega; li scrive solo il server (creazione
--                 della lega e turni: esoneri, assunzioni, rinnovi, invecchiamento, ritiri, allenatori nuovi).
-- coach_buyouts   stipendi degli allenatori esonerati ancora a carico della squadra (fuori dal cap): li leggono i
--                 membri, come i residui dei giocatori tagliati.
-- coach_requests  cambio di allenatore chiesto da un manager nel turno (funzione market, market_write): una per
--                 squadra e turno, eseguita alla chiusura. La legge solo la squadra che l'ha chiesta.
-- teams           owner_profile (proprietario e GM: obiettivo e carattere, conta solo per i bot) ed expected_wins
--                 (vittorie attese nella stagione, il metro del proprietario), leggibili dai membri.
-- ledger          movimento 'coach': allenatore ed esonerati, partita per partita come gli stipendi.
-- transactions    voce 'coach' della cronaca: esoneri, assunzioni, rinnovi e ritiri degli allenatori.
--
-- Le leghe create prima restano senza allenatori e senza proprietari (nessuna riga, owner_profile null): il motore
-- le gioca come prima.

-- ---------------------------------------------------------------- tabelle

alter table public.teams
  add column owner_profile jsonb check (owner_profile is null or jsonb_typeof(owner_profile) = 'object'),
  add column expected_wins integer;
grant select (owner_profile, expected_wins) on public.teams to authenticated;

alter table public.ledger drop constraint ledger_kind_check;
alter table public.ledger add constraint ledger_kind_check
  check (kind in ('revenue', 'salary', 'two-way', 'coach', 'tax', 'minimum-shortfall', 'other'));

alter table public.transactions drop constraint transactions_type_check;
alter table public.transactions add constraint transactions_type_check
  check (type in ('signing', 'renewal', 'trade', 'release', 'retirement', 'draft', 'option', 'injury', 'coach'));

create table public.coaches (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  -- null = libero
  team_id uuid references public.teams (id) on delete set null,
  first_name text not null,
  last_name text not null,
  nationality text not null,
  age integer not null,
  philosophy text not null
    check (philosophy in ('run', 'space', 'grit', 'inside', 'motion', 'balanced')),
  -- { rotation, trust, rest, flexible }
  traits jsonb not null check (jsonb_typeof(traits) = 'object'),
  -- { tactics, development, motivation } da 0 a 100
  ratings jsonb not null check (jsonb_typeof(ratings) = 'object'),
  -- Stipendio di ogni stagione del contratto, dalla corrente (vuoto se libero)
  salaries bigint[] not null default '{}',
  -- Stagione in cui la squadra di adesso lo ha assunto
  since integer,
  -- Insoddisfazione del proprietario (vittorie sotto le attese, pesate)
  pressure double precision not null default 0,
  idle_seasons integer not null default 0,
  -- Un allenatore per squadra; i liberi (null) non contano. Controllato a fine transazione: in un turno uno lascia
  -- la panchina e un altro la prende
  constraint coaches_one_per_team unique (team_id) deferrable initially deferred
);
create index coaches_league_id_idx on public.coaches (league_id);

create table public.coach_buyouts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  -- L'allenatore esonerato (senza vincolo: può ritirarsi mentre la squadra lo paga ancora)
  coach_id uuid not null,
  coach_name text not null,
  salaries bigint[] not null
);
create index coach_buyouts_league_id_idx on public.coach_buyouts (league_id);
create index coach_buyouts_team_id_idx on public.coach_buyouts (team_id);

create table public.coach_requests (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  coach_id uuid not null references public.coaches (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'done', 'invalid', 'withdrawn')),
  created_at timestamptz not null default now()
);
-- Una richiesta in attesa per squadra e turno: la nuova sostituisce quella di prima (market_write)
create unique index coach_requests_pending on public.coach_requests (round_id, team_id) where status = 'pending';
create index coach_requests_league_id_idx on public.coach_requests (league_id);
create index coach_requests_team_id_idx on public.coach_requests (team_id);
create index coach_requests_round_id_idx on public.coach_requests (round_id);
create index coach_requests_coach_id_idx on public.coach_requests (coach_id);

alter table public.coaches enable row level security;
alter table public.coach_buyouts enable row level security;
alter table public.coach_requests enable row level security;
create policy coaches_read on public.coaches for select to authenticated using (private.is_member(league_id));
create policy coach_buyouts_read on public.coach_buyouts for select to authenticated
  using (private.is_member(league_id));
create policy coach_requests_own on public.coach_requests for select to authenticated
  using (private.owns_team(team_id));
grant select on public.coaches, public.coach_buyouts, public.coach_requests to authenticated;
grant all on public.coaches, public.coach_buyouts, public.coach_requests to service_role;

-- Una squadra che cambia manager (liberata, lasciata, presa da un altro) ritira il cambio di allenatore chiesto
create function private.coach_requests_owner_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  update public.coach_requests set status = 'withdrawn' where team_id = new.id and status = 'pending';
  return null;
end;
$$;

create trigger teams_coach_requests after update of owner_id on public.teams
  for each row when (old.owner_id is distinct from new.owner_id)
  execute function private.coach_requests_owner_changed();

-- ---------------------------------------------------------------- creazione della lega

-- Come in 20261108100000_player_draft.sql, con proprietari, attese, allenatori ed esoneri
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
    strategy, tax_history, owner_profile, expected_wins)
  select x.id, v_league, x.code, x.city, x.name, x.full_name, x.conference, x.division, x.owner_id,
    coalesce(x.balance, 0), coalesce(x.strategy, 'middle'), coalesce(x.tax_history, '{}'), x.owner_profile,
    x.expected_wins
  from jsonb_populate_recordset(null::public.teams, p_league -> 'teams') x;

  insert into public.players (id, league_id, slug, team_id, first_name, last_name, nationality, role,
    secondary_role, hand, archetype, age, height_cm, wingspan_cm, weight_kg, years_in_league, draft, ratings,
    tendencies, energy, morale, scouted_potential, two_way_games, season_stats, retired)
  select x.id, v_league, x.slug, x.team_id, x.first_name, x.last_name, x.nationality, x.role,
    x.secondary_role, x.hand, x.archetype, x.age, x.height_cm, x.wingspan_cm, x.weight_kg, x.years_in_league,
    x.draft, x.ratings, x.tendencies, x.energy, x.morale, x.scouted_potential, coalesce(x.two_way_games, 0),
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

  insert into public.coaches (id, league_id, team_id, first_name, last_name, nationality, age, philosophy, traits,
    ratings, salaries, since, pressure, idle_seasons)
  select x.id, v_league, x.team_id, x.first_name, x.last_name, x.nationality, x.age, x.philosophy, x.traits,
    x.ratings, coalesce(x.salaries, '{}'), x.since, coalesce(x.pressure, 0), coalesce(x.idle_seasons, 0)
  from jsonb_populate_recordset(null::public.coaches, coalesce(p_league -> 'coaches', '[]')) x;

  insert into public.coach_buyouts (id, league_id, team_id, coach_id, coach_name, salaries)
  select coalesce(x.id, gen_random_uuid()), v_league, x.team_id, x.coach_id, x.coach_name, x.salaries
  from jsonb_populate_recordset(null::public.coach_buyouts, coalesce(p_league -> 'coach_buyouts', '[]')) x;

  insert into public.draft_picks (id, league_id, draft_year, round, original_team_id, owner_team_id, protection,
    deferrals)
  select x.id, v_league, x.draft_year, x.round, x.original_team_id, x.owner_team_id, x.protection,
    coalesce(x.deferrals, 0)
  from jsonb_populate_recordset(null::public.draft_picks, coalesce(p_league -> 'draft_picks', '[]')) x;

  insert into public.rounds (id, league_id, season_id, number, kind, day, deadline)
  select v_round, v_league, v_season, coalesce(x.number, 0), coalesce(x.kind, 'regular'), x.day,
    case when l.deadline_minutes is null then null else now() + make_interval(mins => l.deadline_minutes) end
  from jsonb_populate_record(null::public.rounds, p_league -> 'round') x
  join public.leagues l on l.id = v_league;

  insert into public.games (id, league_id, season_id, round_number, day, kind, home_team_id, away_team_id)
  select x.id, v_league, v_season, x.round_number, x.day, coalesce(x.kind, 'regular'), x.home_team_id,
    x.away_team_id
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
  perform private.auto_ready(v_round);
  return jsonb_build_object('league_id', v_league, 'invite_code', v_code);
end;
$$;

-- ---------------------------------------------------------------- scrittura del turno

/*
  Come in 20261108100000_player_draft.sql, più:
    coaches            righe intere degli allenatori cambiati o nuovi (upsert)
    coaches_removed    id degli allenatori ritirati (si cancellano)
    coach_buyouts      tutti gli esoneri ancora da pagare della lega (sostituiscono quelli di prima)
    coach_requests     esito dei cambi di allenatore chiesti nel turno ({ id, status })
    team_expectations  vittorie attese nella stagione che comincia ({ id, expected_wins })
*/
create or replace function public.apply_round(p_round uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_league uuid;
  v_round_season uuid;
  v_next uuid;
  v_season uuid;
  v_count bigint;
begin
  select league_id, season_id into v_league, v_round_season from public.rounds where id = p_round;
  v_next := public.apply_turn(p_round,
    p_payload - 'requests' - 'new_trades' - 'draft_order' - 'draft_prospects' - 'player_drafts' -
    'player_seasons' - 'coaches' - 'coaches_removed' - 'coach_buyouts' - 'coach_requests' - 'team_expectations');
  select current_season_id into v_season from public.leagues where id = v_league;

  if p_payload ? 'requests' then
    update public.roster_requests q
    set status = x.status
    from jsonb_populate_recordset(null::public.roster_requests, p_payload -> 'requests') x
    where q.id = x.id and q.league_id = v_league and q.status = 'pending';
    get diagnostics v_count = row_count;
    perform public.expect_rows('requests', v_count, p_payload -> 'requests');
  end if;
  if p_payload ? 'new_trades' then
    insert into public.trade_offers (id, league_id, from_team_id, to_team_id, players_from, players_to, picks_from,
      picks_to, swaps, protections, status, created_round_id)
    select x.id, v_league, x.from_team_id, x.to_team_id, x.players_from, x.players_to, x.picks_from, x.picks_to,
      coalesce(x.swaps, '[]'), coalesce(x.protections, '{}'), 'pending', v_next
    from jsonb_populate_recordset(null::public.trade_offers, p_payload -> 'new_trades') x
    where exists (select 1 from public.teams t where t.id = x.from_team_id and t.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.to_team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('new_trades', v_count, p_payload -> 'new_trades');
  end if;
  if p_payload ? 'draft_order' then
    insert into public.draft_order as d (league_id, draft_year, pick_no, round, number, team_id, original_team_id,
      player_id)
    select v_league, x.draft_year, x.pick_no, x.round, x.number, x.team_id, x.original_team_id, x.player_id
    from jsonb_populate_recordset(null::public.draft_order, p_payload -> 'draft_order') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league)
    on conflict (league_id, draft_year, pick_no) do update set
      team_id = excluded.team_id, original_team_id = excluded.original_team_id, player_id = excluded.player_id;
    get diagnostics v_count = row_count;
    perform public.expect_rows('draft_order', v_count, p_payload -> 'draft_order');
  end if;
  if p_payload ? 'draft_prospects' then
    update public.players p
    set draft_prospect = x.draft_prospect
    from jsonb_populate_recordset(null::public.players, p_payload -> 'draft_prospects') x
    where p.id = x.id and p.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('draft_prospects', v_count, p_payload -> 'draft_prospects');
  end if;
  -- Draft annuale: anno, giro e scelta dei prospetti scelti; i non scelti con il solo anno
  if p_payload ? 'player_drafts' then
    update public.players p
    set draft = x.draft
    from jsonb_populate_recordset(null::public.players, p_payload -> 'player_drafts') x
    where p.id = x.id and p.league_id = v_league and jsonb_typeof(x.draft) = 'object';
    get diagnostics v_count = row_count;
    perform public.expect_rows('player_drafts', v_count, p_payload -> 'player_drafts');
  end if;
  if p_payload ? 'player_seasons' then
    insert into public.player_seasons as s (season_id, league_id, player_id, team_id, rookie, stats)
    select v_round_season, v_league, x.player_id, x.team_id, x.rookie, x.stats
    from jsonb_populate_recordset(null::public.player_seasons, p_payload -> 'player_seasons') x
    where exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league)
      and (x.team_id is null
        or exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league))
      and jsonb_typeof(x.stats) = 'object'
    on conflict (season_id, player_id) do update set
      team_id = excluded.team_id, rookie = excluded.rookie, stats = excluded.stats;
    get diagnostics v_count = row_count;
    perform public.expect_rows('player_seasons', v_count, p_payload -> 'player_seasons');
  end if;

  -- Allenatori: prima l'esito dei cambi chiesti (un allenatore appena preso può ritirarsi nello stesso turno, e con
  -- lui sparisce la richiesta), poi i ritirati, poi quelli cambiati o nuovi
  if p_payload ? 'coach_requests' then
    update public.coach_requests q
    set status = x.status
    from jsonb_populate_recordset(null::public.coach_requests, p_payload -> 'coach_requests') x
    where q.id = x.id and q.league_id = v_league and q.status = 'pending';
    get diagnostics v_count = row_count;
    perform public.expect_rows('coach_requests', v_count, p_payload -> 'coach_requests');
  end if;
  if p_payload ? 'coaches_removed' then
    delete from public.coaches c
    where c.league_id = v_league
      and c.id in (select (jsonb_array_elements_text(p_payload -> 'coaches_removed'))::uuid);
    get diagnostics v_count = row_count;
    perform public.expect_rows('coaches_removed', v_count, p_payload -> 'coaches_removed');
  end if;
  if p_payload ? 'coaches' then
    insert into public.coaches as c (id, league_id, team_id, first_name, last_name, nationality, age, philosophy,
      traits, ratings, salaries, since, pressure, idle_seasons)
    select x.id, v_league, x.team_id, x.first_name, x.last_name, x.nationality, x.age, x.philosophy, x.traits,
      x.ratings, coalesce(x.salaries, '{}'), x.since, coalesce(x.pressure, 0), coalesce(x.idle_seasons, 0)
    from jsonb_populate_recordset(null::public.coaches, p_payload -> 'coaches') x
    where x.team_id is null
      or exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league)
    on conflict (id) do update set
      team_id = excluded.team_id, first_name = excluded.first_name, last_name = excluded.last_name,
      nationality = excluded.nationality, age = excluded.age, philosophy = excluded.philosophy,
      traits = excluded.traits, ratings = excluded.ratings, salaries = excluded.salaries, since = excluded.since,
      pressure = excluded.pressure, idle_seasons = excluded.idle_seasons
    where c.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('coaches', v_count, p_payload -> 'coaches');
  end if;
  if p_payload ? 'coach_buyouts' then
    delete from public.coach_buyouts where league_id = v_league;
    insert into public.coach_buyouts (league_id, team_id, coach_id, coach_name, salaries)
    select v_league, x.team_id, x.coach_id, x.coach_name, x.salaries
    from jsonb_populate_recordset(null::public.coach_buyouts, p_payload -> 'coach_buyouts') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('coach_buyouts', v_count, p_payload -> 'coach_buyouts');
  end if;
  if p_payload ? 'team_expectations' then
    update public.teams t
    set expected_wins = x.expected_wins
    from jsonb_populate_recordset(null::public.teams, p_payload -> 'team_expectations') x
    where t.id = x.id and t.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('team_expectations', v_count, p_payload -> 'team_expectations');
  end if;
  return v_next;
end;
$$;

-- ---------------------------------------------------------------- letture del server

-- Come in 20261108090000_turn_days.sql, con allenatori, esoneri e cambi di allenatore chiesti
create or replace function public.league_state(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'seed', l.seed, 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'seed', r.seed, 'close_reason', r.close_reason, 'stage', r.stage, 'day', r.day)
              from public.rounds r where r.id = l.current_round_id),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]') from public.teams t where t.league_id = l.id),
    'players', (
      select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('hidden', h.hidden) order by p.id), '[]')
      from public.players p join public.player_hidden h on h.player_id = p.id
      where p.league_id = l.id and not p.retired
    ),
    'contracts', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.player_id), '[]')
      from public.contracts c where c.league_id = l.id
    ),
    'dead_money', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]')
      from public.dead_money d where d.league_id = l.id
    ),
    'injuries', (
      select coalesce(jsonb_agg(to_jsonb(i) order by i.player_id), '[]')
      from public.injuries i where i.league_id = l.id
    ),
    'draft_picks', (
      select coalesce(jsonb_agg(to_jsonb(k) order by k.id), '[]') from public.draft_picks k
      where k.league_id = l.id and k.position is null
    ),
    'draft_swaps', (
      select coalesce(jsonb_agg(to_jsonb(w) order by w.id), '[]') from public.draft_swaps w
      where w.league_id = l.id and w.result is null
    ),
    'team_settings', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.team_id), '[]')
      from public.team_settings x where x.league_id = l.id
    ),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'round_number', g.round_number, 'kind', g.kind,
        'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id, 'home_score', g.home_score,
        'away_score', g.away_score, 'overtimes', g.overtimes, 'series_id', g.series_id, 'day', g.day)
        order by g.round_number, g.id), '[]')
      from public.games g where g.season_id = l.current_season_id
    ),
    'playoff_series', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.round, x.conference nulls last, x.id), '[]')
      from public.playoff_series x where x.season_id = l.current_season_id
    ),
    'coach', (
      select coalesce(jsonb_agg(t.id order by t.id), '[]')
      from public.teams t
      where t.league_id = l.id and t.owner_id is not null and private.coach_active(t.id, l.current_round_id)
    ),
    'coach_delegations', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', d.team_id, 'active', d.active,
        'until_round', d.until_round, 'until_at', d.until_at, 'until_phase_end', d.until_phase_end)
        order by d.team_id), '[]')
      from public.coach_delegations d where d.league_id = l.id
    ),
    'alerts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'team_id', a.team_id, 'kind', a.kind,
        'blocking', a.blocking, 'status', a.status, 'round_id', a.round_id, 'payload', a.payload)
        order by a.created_at, a.id), '[]')
      from public.alerts a
      where a.league_id = l.id and (a.status = 'open' or a.round_id = l.current_round_id)
    ),
    'trade_offers', (
      select coalesce(jsonb_agg(to_jsonb(o) order by coalesce(o.responded_at, o.created_at), o.id), '[]')
      from public.trade_offers o where o.league_id = l.id and o.status in ('pending', 'accepted')
    ),
    'bids', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at, b.id), '[]')
      from public.free_agent_bids b where b.league_id = l.id and b.status = 'pending'
    ),
    'requests', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at, q.id), '[]')
      from public.roster_requests q where q.league_id = l.id and q.status = 'pending'
    ),
    'releases', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', q.player_id, 'team_id', q.team_id)
        order by q.created_at, q.id), '[]')
      from public.roster_requests q
      join public.rounds r on r.id = q.round_id and r.season_id = l.current_season_id
      where q.league_id = l.id and q.kind = 'release' and q.status = 'done'
    ),
    'bot_proposals', (
      select coalesce(jsonb_object_agg(x.to_team_id, x.last), '{}')
      from (
        select o.to_team_id, max(r.number) as last
        from public.trade_offers o
        join public.rounds r on r.id = o.created_round_id and r.season_id = l.current_season_id
        join public.teams f on f.id = o.from_team_id and f.owner_id is null
        where o.league_id = l.id
        group by o.to_team_id
      ) x
    ),
    'draft_order', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.pick_no), '[]')
      from public.draft_order d where d.league_id = l.id and d.draft_year = s.year + 1
    ),
    'draft_lists', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.team_id), '[]')
      from public.draft_lists x where x.league_id = l.id
    ),
    'coaches', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]') from public.coaches c where c.league_id = l.id
    ),
    'coach_buyouts', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]')
      from public.coach_buyouts b where b.league_id = l.id
    ),
    'coach_requests', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at, q.id), '[]')
      from public.coach_requests q where q.league_id = l.id and q.status = 'pending'
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- Come in 20261108090000_turn_days.sql, con gli allenatori (per il controllo dei cambi di allenatore)
create or replace function public.market_state(p_league uuid, p_player uuid default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    -- Il seed della lega non serve ai controlli
    'league', jsonb_build_object('id', l.id, 'seed', '', 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'stage', r.stage, 'day', r.day)
              from public.rounds r where r.id = l.current_round_id),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]') from public.teams t where t.league_id = l.id),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'team_id', p.team_id,
        'draft_prospect', p.draft_prospect, 'first_name', p.first_name, 'last_name', p.last_name, 'role', p.role,
        'secondary_role', p.secondary_role, 'age', p.age, 'years_in_league', p.years_in_league,
        'morale', p.morale, 'scouted_potential', p.scouted_potential,
        'ratings', case when p.id = p_player then p.ratings end) order by p.id), '[]')
      from public.players p
      where p.league_id = l.id and not p.retired and (p.team_id is not null or p.id = p_player)
    ),
    'contracts', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', c.player_id, 'team_id', c.team_id, 'type', c.type,
        'salaries', c.salaries, 'options', c.options, 'guaranteed', c.guaranteed) order by c.player_id), '[]')
      from public.contracts c where c.league_id = l.id
    ),
    'dead_money', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', d.team_id, 'player_name', d.player_name,
        'salaries', d.salaries) order by d.id), '[]')
      from public.dead_money d where d.league_id = l.id
    ),
    'injuries', '[]'::jsonb,
    'draft_picks', (
      select coalesce(jsonb_agg(jsonb_build_object('id', k.id, 'draft_year', k.draft_year, 'round', k.round,
        'original_team_id', k.original_team_id, 'owner_team_id', k.owner_team_id, 'protection', k.protection,
        'deferrals', k.deferrals) order by k.id), '[]')
      from public.draft_picks k
      where k.league_id = l.id and k.position is null
    ),
    'draft_swaps', (
      select coalesce(jsonb_agg(jsonb_build_object('id', w.id, 'draft_year', w.draft_year, 'round', w.round,
        'holder_team_id', w.holder_team_id, 'other_team_id', w.other_team_id) order by w.id), '[]')
      from public.draft_swaps w
      where w.league_id = l.id and w.result is null
    ),
    'team_settings', '[]'::jsonb,
    'games', '[]'::jsonb,
    'trade_offers', (
      select coalesce(jsonb_agg(to_jsonb(o) order by coalesce(o.responded_at, o.created_at), o.id), '[]')
      from public.trade_offers o where o.league_id = l.id and o.status in ('pending', 'accepted')
    ),
    'releases', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', q.player_id, 'team_id', q.team_id)
        order by q.created_at, q.id), '[]')
      from public.roster_requests q
      join public.rounds r on r.id = q.round_id and r.season_id = l.current_season_id
      where q.league_id = l.id and q.kind = 'release' and q.status = 'done'
    ),
    'coaches', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]') from public.coaches c where c.league_id = l.id
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- ---------------------------------------------------------------- mercato

-- Come in 20261106170400_push_throttle.sql, con il cambio di allenatore (hire_coach, withdraw_coach)
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

  -- Cambio di allenatore: uno per squadra e turno, il nuovo sostituisce quello chiesto prima
  when 'hire_coach' then
    if not exists (
      select 1 from public.coaches c
      where c.id = (p_action ->> 'coach_id')::uuid and c.league_id = p_league and c.team_id is null
    ) then
      raise exception 'Allenatore non trovato o non più libero';
    end if;
    update public.coach_requests set status = 'withdrawn'
    where team_id = p_team and round_id = p_round and status = 'pending';
    insert into public.coach_requests (league_id, team_id, round_id, coach_id)
    values (p_league, p_team, p_round, (p_action ->> 'coach_id')::uuid)
    returning id into v_id;

  when 'withdraw_coach' then
    update public.coach_requests set status = 'withdrawn'
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

-- ---------------------------------------------------------------- turni

-- Come in 20261108090000_turn_days.sql: anche un cambio di allenatore chiesto è attività del manager
create or replace function private.round_idle(p_round uuid) returns boolean
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
    exists (
      select 1 from public.ready_flags f join r on f.round_id = r.id
      where f.team_id in (select id from human) and not f.auto
    )
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
      select 1 from public.coach_requests q join r on q.round_id = r.id where q.team_id in (select id from human)
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

-- Come in 20261108090000_turn_days.sql: ritirando il mercato si ritirano anche i cambi di allenatore
create or replace function public.reopen_round(p_league uuid, p_new_seed boolean default false,
  p_withdraw_market boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_minutes integer;
begin
  if not private.is_member(p_league) then
    raise exception 'Non fai parte di questa lega' using errcode = '42501';
  end if;
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    raise exception 'La lega non ha un turno in corso';
  end if;
  if not private.is_commissioner(p_league)
     and (v_round.state <> 'closing' or v_round.failed_at is null
          or v_round.failed_at > now() - make_interval(hours => private.member_reopen_hours())) then
    raise exception 'Solo il commissario può sbloccare il turno, o qualsiasi membro % ore dopo il blocco',
      private.member_reopen_hours() using errcode = '42501';
  end if;
  select deadline_minutes into v_minutes from public.leagues where id = p_league;
  if v_round.state <> 'closing' then
    raise exception 'Il turno non è bloccato';
  end if;
  if v_round.failed_at is null and v_round.closing_started_at >= now() - interval '5 minutes' then
    raise exception 'La simulazione è in corso: se non finisce, si può sbloccare dopo 5 minuti';
  end if;
  update public.rounds
  set state = 'open', closing_started_at = null, close_reason = null, forced_at = null, attempts = 0,
      failed_at = null, last_error = null, last_error_at = null, created_at = now(),
      seed = case when p_new_seed then null else seed end,
      deadline = case when v_minutes is null then null else now() + make_interval(mins => v_minutes) end
  where id = v_round.id;
  delete from public.ready_flags where round_id = v_round.id;
  perform private.auto_ready(v_round.id);
  if p_withdraw_market then
    update public.free_agent_bids set status = 'withdrawn' where league_id = p_league and status = 'pending';
    update public.roster_requests set status = 'withdrawn' where league_id = p_league and status = 'pending';
    update public.coach_requests set status = 'withdrawn' where league_id = p_league and status = 'pending';
    -- Con le proposte di scambio decadono gli avvisi di chi le ha ricevute
    with offers as (
      update public.trade_offers
      set status = 'withdrawn', responded_at = coalesce(responded_at, now())
      where league_id = p_league and status in ('pending', 'accepted')
      returning id
    )
    update public.alerts a
    set status = 'expired'
    from offers o
    where a.league_id = p_league and a.kind = 'trade_offer' and a.status = 'open'
      and a.payload ->> 'trade_id' = o.id::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.coach_requests_owner_changed() from public, anon, authenticated;
