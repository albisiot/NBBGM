-- NBBGM: creazione delle leghe e ingresso con il codice invito (Fase 6).
--
-- La lega nasce nella Edge Function create-league: il motore prepara rose, calendario e scelte dai dati di
-- partenza e insert_league scrive tutto in una sola transazione. Per entrare in una lega il manager vede le
-- squadre libere con league_preview e ne prende una con join_league; le altre restano ai bot.

-- Codice invito di 6 caratteri, senza quelli che si confondono (0 e O, 1, I e L)
create function private.new_invite_code() returns text
language plpgsql volatile set search_path = ''
as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  v_bytes bytea;
  v_code text;
begin
  loop
    v_bytes := uuid_send(gen_random_uuid());
    select string_agg(substr(v_alphabet, 1 + get_byte(v_bytes, i) % length(v_alphabet), 1), '' order by i)
      into v_code
    from generate_series(0, 5) as i;
    exit when not exists (select 1 from public.leagues where invite_code = v_code);
  end loop;
  return v_code;
end;
$$;

create function private.normalize_code(p_code text) returns text
language sql immutable set search_path = ''
as $$
  select upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'))
$$;

/*
  Scrive una lega nuova. p_league ha le sezioni league, season, round (righe), members, teams, players,
  player_hidden, injuries, contracts, dead_money, draft_picks, games, team_settings (righe con i nomi delle
  colonne; gli id li assegna chi chiama). league.invite_code facoltativo: se manca se ne genera uno.
  Il commissario entra nella lega e deve guidare una delle squadre. Restituisce { league_id, invite_code }.
*/
create function public.insert_league(p_league jsonb) returns jsonb
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

  update public.leagues set current_season_id = v_season, current_round_id = v_round where id = v_league;
  return jsonb_build_object('league_id', v_league, 'invite_code', v_code);
end;
$$;

-- Cosa vede chi ha un codice invito prima di entrare: nome della lega e squadre libere
create function public.league_preview(p_code text) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_league public.leagues%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Devi accedere per entrare in una lega' using errcode = '42501';
  end if;
  select * into v_league from public.leagues where invite_code = private.normalize_code(p_code);
  if not found then
    raise exception 'Codice invito non valido';
  end if;
  return jsonb_build_object(
    'league_id', v_league.id,
    'name', v_league.name,
    'commissioner', (select display_name from public.profiles where id = v_league.commissioner_id),
    'already_member', exists (
      select 1 from public.league_members m where m.league_id = v_league.id and m.user_id = (select auth.uid())
    ),
    'teams', (
      select jsonb_agg(
        jsonb_build_object(
          'code', t.code, 'full_name', t.full_name, 'conference', t.conference, 'division', t.division,
          'taken', t.owner_id is not null
        )
        order by t.conference, t.division, t.full_name
      )
      from public.teams t where t.league_id = v_league.id
    )
  );
end;
$$;

-- Entra nella lega del codice con una squadra libera (guidata finora da un bot). Restituisce l'id della lega.
create function public.join_league(p_code text, p_team_code text) returns uuid
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
  if exists (select 1 from public.league_members where league_id = v_league and user_id = v_user) then
    raise exception 'Sei già in questa lega';
  end if;
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

revoke execute on function private.new_invite_code(), private.normalize_code(text), public.insert_league(jsonb),
  public.league_preview(text), public.join_league(text, text)
from public, anon, authenticated;
grant execute on function public.league_preview(text), public.join_league(text, text) to authenticated;
grant execute on function public.insert_league(jsonb) to service_role;
