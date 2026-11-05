-- NBBGM: offseason a turni (Fase 12).
--
-- Alla chiusura della finale il server fa fine stagione (crescita, età, ritiri), lottery e ordine del draft, e
-- mette la classe del draft tra i giocatori come prospetti. Poi l'offseason procede per turni, come gli altri:
--   draft         i manager ordinano i preferiti (draft_lists); alla chiusura 60 scelte e contratti che scalano
--   renewals      rinnovi dei giocatori in scadenza (contratto senza stipendi)
--   fa1 - fa4     free agency a busta chiusa
--   preparation   rose nei limiti; alla chiusura nasce la stagione nuova con il suo calendario

-- ---------------------------------------------------------------- tabelle e colonne

alter table public.rounds
  add column stage text check (stage in ('draft', 'renewals', 'fa1', 'fa2', 'fa3', 'fa4', 'preparation'));

-- Prospetto in attesa del draft di quell'anno (solo durante l'offseason)
alter table public.players add column draft_prospect integer;

-- Ordine del draft annuale dopo lottery, protezioni e swap, e chi è stato scelto
create table public.draft_order (
  league_id uuid not null references public.leagues (id) on delete cascade,
  draft_year integer not null,
  pick_no integer not null check (pick_no between 1 and 60),
  round integer not null check (round in (1, 2)),
  number integer not null check (number between 1 and 30),
  team_id uuid not null references public.teams (id) on delete cascade,
  original_team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid references public.players (id) on delete set null,
  primary key (league_id, draft_year, pick_no)
);
create index draft_order_team on public.draft_order (team_id);
create index draft_order_original on public.draft_order (original_team_id);
create index draft_order_player on public.draft_order (player_id);

-- Preferiti per il draft annuale: li vede e li cambia solo il loro manager, a turno aperto
create table public.draft_lists (
  team_id uuid primary key references public.teams (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  player_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now()
);
create index draft_lists_league on public.draft_lists (league_id);

alter table public.draft_order enable row level security;
alter table public.draft_lists enable row level security;
create policy draft_order_read on public.draft_order for select to authenticated using (private.is_member(league_id));
create policy draft_lists_own on public.draft_lists for select to authenticated using (private.owns_team(team_id));
create policy draft_lists_insert on public.draft_lists for insert to authenticated
  with check (private.can_edit_team(team_id, league_id));
create policy draft_lists_update on public.draft_lists for update to authenticated
  using (private.can_edit_team(team_id, league_id)) with check (private.can_edit_team(team_id, league_id));
grant select on public.draft_order to authenticated;
grant select, insert, update on public.draft_lists to authenticated;
grant all on public.draft_order, public.draft_lists to service_role;

-- ---------------------------------------------------------------- l'offseason si gioca

create or replace function private.round_due(p_round uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when r.state <> 'open' then null
    when exists (
      select 1 from public.initial_drafts d where d.league_id = r.league_id and d.state <> 'done'
    ) then null
    when r.forced_at is not null then 'forced'
    when l.paused then null
    when r.deadline is not null and now() >= r.deadline then 'deadline'
    when not public.round_all_ready(r.id) then null
    when exists (
      select 1
      from public.ready_flags f
      join public.teams t on t.id = f.team_id and t.owner_id is not null
      where f.round_id = r.id and f.ready
    ) then 'ready'
    when now() >= r.created_at + make_interval(secs => l.max_pace_seconds) then 'coach'
    else null
  end
  from public.rounds r
  join public.leagues l on l.id = r.league_id
  where r.id = p_round
$$;

create or replace function public.force_round(p_league uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario può forzare l''avanzamento' using errcode = '42501';
  end if;
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    raise exception 'La lega non ha un turno in corso';
  end if;
  if v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura';
  end if;
  if exists (select 1 from public.initial_drafts d where d.league_id = p_league and d.state <> 'done') then
    raise exception 'Il draft iniziale non è ancora finito';
  end if;
  update public.rounds set forced_at = coalesce(forced_at, now()) where id = v_round.id;
  perform private.kick('advance-turn', jsonb_build_object('league_id', p_league));
end;
$$;

-- ---------------------------------------------------------------- risultato del turno

/*
  apply_turn più le sezioni del mercato e dell'offseason, nella stessa transazione:
    requests         [{ id, status }] esito di tagli e rinnovi
    new_trades       righe intere di trade_offers: proposte dei bot per il turno che si apre
    draft_order      righe intere di draft_order (ordine del draft annuale e scelte fatte)
    draft_prospects  [{ id, draft_prospect }] prospetti del draft (null: scelto o diventato svincolato)
    new_games        righe di games della stagione nuova (calendario), scritte dopo che apply_turn l'ha aperta
  next_round può avere stage (turni di offseason). Il resto passa ad apply_turn. Restituisce il turno aperto.
*/
create or replace function public.apply_round(p_round uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_league uuid;
  v_next uuid;
  v_season uuid;
  v_count bigint;
begin
  select league_id into v_league from public.rounds where id = p_round;
  v_next := public.apply_turn(p_round,
    p_payload - 'requests' - 'new_trades' - 'draft_order' - 'draft_prospects' - 'new_games');
  update public.rounds set stage = p_payload -> 'next_round' ->> 'stage' where id = v_next;
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
  if p_payload ? 'new_games' then
    insert into public.games (id, league_id, season_id, round_number, kind, home_team_id, away_team_id)
    select x.id, v_league, v_season, x.round_number, coalesce(x.kind, 'regular'), x.home_team_id, x.away_team_id
    from jsonb_populate_recordset(null::public.games, p_payload -> 'new_games') x
    where exists (select 1 from public.teams t where t.id = x.home_team_id and t.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.away_team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('new_games', v_count, p_payload -> 'new_games');
  end if;
  return v_next;
end;
$$;

-- ---------------------------------------------------------------- stato della lega per il motore

-- Come nella Fase 11, più lo stage del turno, l'ordine del draft annuale e le liste dei preferiti; le scelte già
-- usate e gli swap già decisi restano nel database per lo storico ma non tornano al motore
create or replace function public.league_state(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'seed', l.seed, 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'seed', r.seed, 'close_reason', r.close_reason, 'stage', r.stage)
              from public.rounds r where r.id = l.current_round_id),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]') from public.teams t where t.league_id = l.id),
    'players', (
      select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('hidden', h.hidden) order by p.id), '[]')
      from public.players p join public.player_hidden h on h.player_id = p.id
      where p.league_id = l.id and not p.retired
    ),
    'contracts', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from public.contracts c where c.league_id = l.id),
    'dead_money', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from public.dead_money d where d.league_id = l.id),
    'injuries', (select coalesce(jsonb_agg(to_jsonb(i)), '[]') from public.injuries i where i.league_id = l.id),
    'draft_picks', (
      select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.draft_picks k
      where k.league_id = l.id and k.position is null
    ),
    'draft_swaps', (
      select coalesce(jsonb_agg(to_jsonb(w)), '[]') from public.draft_swaps w
      where w.league_id = l.id and w.result is null
    ),
    'team_settings', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.team_settings x where x.league_id = l.id
    ),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'round_number', g.round_number, 'kind', g.kind,
        'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id, 'home_score', g.home_score,
        'away_score', g.away_score, 'overtimes', g.overtimes, 'series_id', g.series_id)
        order by g.round_number, g.id), '[]')
      from public.games g where g.season_id = l.current_season_id
    ),
    'playoff_series', (
      select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.playoff_series x where x.season_id = l.current_season_id
    ),
    'coach', (
      select coalesce(jsonb_agg(t.id), '[]')
      from public.teams t
      where t.league_id = l.id and t.owner_id is not null and private.coach_active(t.id, l.current_round_id)
    ),
    'coach_delegations', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', d.team_id, 'active', d.active,
        'until_round', d.until_round, 'until_at', d.until_at, 'until_phase_end', d.until_phase_end)), '[]')
      from public.coach_delegations d where d.league_id = l.id
    ),
    'alerts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'team_id', a.team_id, 'kind', a.kind,
        'blocking', a.blocking, 'status', a.status, 'round_id', a.round_id, 'payload', a.payload)), '[]')
      from public.alerts a
      where a.league_id = l.id and (a.status = 'open' or a.round_id = l.current_round_id)
    ),
    'trade_offers', (
      select coalesce(jsonb_agg(to_jsonb(o) order by coalesce(o.responded_at, o.created_at)), '[]')
      from public.trade_offers o where o.league_id = l.id and o.status in ('pending', 'accepted')
    ),
    'bids', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at), '[]')
      from public.free_agent_bids b where b.league_id = l.id and b.status = 'pending'
    ),
    'requests', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at), '[]')
      from public.roster_requests q where q.league_id = l.id and q.status = 'pending'
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
      select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.draft_lists x where x.league_id = l.id
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;
