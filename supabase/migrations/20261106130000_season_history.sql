-- NBBGM: storico delle stagioni (dopo la Fase 13).
--
-- Le statistiche di regular season dei giocatori (players.season_stats) ripartono da zero a ogni stagione nuova
-- e i ritirati escono dall'elenco: per lo storico e per i premi di fine stagione si salva una fotografia alla
-- fine della regular season, in player_seasons: statistiche, squadra di quel momento e se il giocatore era al
-- primo anno nella lega (per il rookie dell'anno). La scrive advance-turn con apply_round, nella sezione
-- player_seasons, nello stesso turno che chiude la giornata 82.
--
-- Campioni, finaliste e classifiche finali si ricavano già da playoff_series e games; i premi li calcola l'app
-- da questa tabella con formule fisse (packages/engine/src/season/awards.ts).

create table public.player_seasons (
  season_id uuid not null references public.seasons (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  team_id uuid references public.teams (id) on delete set null,
  -- Primo anno nella lega; null se non si sa (stagioni ricostruite qui sotto dalle partite)
  rookie boolean,
  -- Come players.season_stats: g, gs, seconds, pts, fgm, fga, tpm, tpa, ftm, fta, orb, drb, ast, stl, blk, tov, pf
  stats jsonb not null check (jsonb_typeof(stats) = 'object'),
  primary key (season_id, player_id)
);
create index player_seasons_league on public.player_seasons (league_id);
create index player_seasons_player on public.player_seasons (player_id);
create index player_seasons_team on public.player_seasons (team_id);

alter table public.player_seasons enable row level security;
create policy player_seasons_read on public.player_seasons for select to authenticated
  using (private.is_member(league_id));
revoke all on public.player_seasons from anon, authenticated;
grant select on public.player_seasons to authenticated;
grant all on public.player_seasons to service_role;

/*
  Come prima (Fase 12), più:
    player_seasons   [{ player_id, team_id, rookie, stats }] statistiche di regular season, a fine regular season
  Le righe vanno alla stagione del turno che si chiude.
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
    p_payload - 'requests' - 'new_trades' - 'draft_order' - 'draft_prospects' - 'new_games' - 'player_seasons');
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

revoke execute on function public.apply_round(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.apply_round(uuid, jsonb) to service_role;

-- ---------------------------------------------------------------- stagioni già giocate

-- Le regular season finite prima di questa migrazione si ricostruiscono dai box score (player_game_stats, che
-- restano anche quando la cronaca delle partite si cancella): stessi conteggi del motore (una presenza = almeno
-- un secondo in campo), squadra dell'ultima partita giocata. Il primo anno nella lega si sa solo per la stagione
-- corrente: in play-in e playoff è chi ha 0 anni nella lega, in offseason (dopo il +1 di fine stagione) chi ne ha 1.
create function private.rebuild_player_seasons(p_season uuid) returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.player_seasons (season_id, league_id, player_id, team_id, rookie, stats)
  select s.id, s.league_id, x.player_id, x.team_id,
    case
      when s.id = l.current_season_id and s.phase in ('play-in', 'playoffs') then p.years_in_league = 0
      when s.id = l.current_season_id and s.phase = 'offseason' then p.years_in_league = 1
    end,
    x.stats
  from public.seasons s
  join public.leagues l on l.id = s.league_id
  cross join lateral (
    select st.player_id,
      (array_agg(st.team_id order by g.round_number desc))[1] as team_id,
      jsonb_build_object(
        'g', count(*), 'gs', count(*) filter (where st.starter), 'seconds', sum(st.seconds),
        'pts', sum(st.pts), 'fgm', sum(st.fgm), 'fga', sum(st.fga), 'tpm', sum(st.tpm), 'tpa', sum(st.tpa),
        'ftm', sum(st.ftm), 'fta', sum(st.fta), 'orb', sum(st.orb), 'drb', sum(st.drb), 'ast', sum(st.ast),
        'stl', sum(st.stl), 'blk', sum(st.blk), 'tov', sum(st.tov), 'pf', sum(st.pf)
      ) as stats
    from public.games g
    join public.player_game_stats st on st.game_id = g.id
    where g.season_id = s.id and g.kind = 'regular' and st.seconds > 0
    group by st.player_id
  ) x
  join public.players p on p.id = x.player_id
  where s.id = p_season
  on conflict (season_id, player_id) do nothing;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function private.rebuild_player_seasons(uuid) from public, anon, authenticated;

select private.rebuild_player_seasons(s.id)
from public.seasons s
join public.leagues l on l.id = s.league_id
where (s.phase <> 'regular' or s.id is distinct from l.current_season_id)
  and not exists (select 1 from public.player_seasons y where y.season_id = s.id);
