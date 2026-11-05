-- NBBGM: risultati, classifica e post-season (Fase 10).
--
-- Play-in e playoff si giocano come gli altri turni. Il tabellone non si salva come stato: il server lo
-- ricostruisce dalle partite giocate (replayPostseason) e salva le serie in playoff_series e le partite del
-- turno successivo in games, così tutti vedono chi gioca. Nei turni di post-season le squadre umane che non
-- giocano (eliminate o in attesa) contano come pronte.

-- ---------------------------------------------------------------- seed della lega solo al server

-- Con il seed della lega e il motore (che è nell'app) si rifarebbero le stime del potenziale e la crescita:
-- il client legge tutte le colonne tranne seed
revoke select on public.leagues from authenticated;
grant select (id, name, invite_code, commissioner_id, deadline_minutes, max_pace_seconds, roster_mode,
  draft_mode, rookie_source, paused, talent_reference, current_season_id, current_round_id, created_at)
  on public.leagues to authenticated;

-- ---------------------------------------------------------------- chi deve essere pronto

-- Tutte le squadre umane che giocano nel turno sono pronte: Pronto premuto oppure allenatore attivo senza
-- avvisi bloccanti. In regular season giocano tutte; in play-in e playoff solo quelle con una partita.
create or replace function public.round_all_ready(p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1
    from public.rounds r
    join public.teams t on t.league_id = r.league_id and t.owner_id is not null
    where r.id = p_round
      and (
        r.kind not in ('play-in', 'playoffs')
        or exists (
          select 1 from public.games g
          where g.season_id = r.season_id and g.round_number = r.number
            and t.id in (g.home_team_id, g.away_team_id)
        )
      )
      and not exists (
        select 1 from public.ready_flags f where f.round_id = r.id and f.team_id = t.id and f.ready
      )
      and not public.coach_ready(t.id, r.id)
  )
$$;

-- Come nella Fase 9, ma play-in e playoff si giocano; l'offseason arriva con la Fase 12
create or replace function private.round_due(p_round uuid) returns text
language sql stable security definer set search_path = ''
as $$
  select case
    when r.state <> 'open' or r.kind = 'offseason' then null
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
  if v_round.kind = 'offseason' then
    raise exception 'L''offseason non è ancora disponibile';
  end if;
  update public.rounds set forced_at = coalesce(forced_at, now()) where id = v_round.id;
  perform private.kick('advance-turn', jsonb_build_object('league_id', p_league));
end;
$$;

-- ---------------------------------------------------------------- stato della lega per il motore

-- Come nella Fase 9, più le serie di playoff della stagione e la serie di ogni partita
create or replace function public.league_state(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'seed', l.seed, 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'seed', r.seed, 'close_reason', r.close_reason)
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
    'draft_picks', (select coalesce(jsonb_agg(to_jsonb(k)), '[]') from public.draft_picks k where k.league_id = l.id),
    'draft_swaps', (select coalesce(jsonb_agg(to_jsonb(w)), '[]') from public.draft_swaps w where w.league_id = l.id),
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
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;
