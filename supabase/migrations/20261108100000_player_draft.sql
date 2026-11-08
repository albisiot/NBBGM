-- Draft NBA di ogni giocatore: anno e, se è stato scelto, giro e scelta assoluta.
--
-- players.draft e base_players.draft: {"year": 2018, "round": 1, "pick": 3}; chi non è stato scelto ha giro e
-- scelta null (e l'anno solo se noto, come i prospetti non scelti al draft annuale della lega); null = non noto
-- (giocatori generati fuori dal draft). I giocatori reali lo prendono da base_players alla creazione della lega;
-- i prospetti al draft annuale (sezione player_drafts di apply_round). Lo leggono i membri come il resto della
-- scheda (permesso di lettura su tutta la tabella players).

alter table public.players
  add column draft jsonb check (draft is null or jsonb_typeof(draft) = 'object');
alter table public.base_players
  add column draft jsonb check (draft is null or jsonb_typeof(draft) = 'object');

-- Prospetti già scelti nei draft annuali delle leghe in corso, dall'ordine del draft
update public.players p
set draft = jsonb_build_object('year', o.draft_year, 'round', o.round, 'pick', o.pick_no)
from public.draft_order o
where o.player_id = p.id and o.league_id = p.league_id and p.draft is null;

-- Come in 20261108090000_turn_days.sql, con la sezione player_drafts
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
    'player_seasons');
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
  return v_next;
end;
$$;

-- Come in 20261108090000_turn_days.sql, con il draft dei giocatori
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
