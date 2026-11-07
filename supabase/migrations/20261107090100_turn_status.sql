-- NBBGM: stato del turno in una sola lettura (seconda analisi, prestazioni).
--
-- La barra del turno faceva 4 richieste in 2 viaggi (lega con il turno, propria squadra, poi avvisi e
-- round_readiness), la scheda del turno da 6 a 9 in 2-3 viaggi; ognuna si rileggeva da sola ogni 30 secondi e a ogni
-- Pronto della lega. Ora l'app le legge da un solo negozio per lega (apps/web/src/lib/turnStore.ts) con questa
-- funzione: turno, pausa, draft iniziale, Pronto, allenatori, propri avvisi aperti, ultima partita della propria
-- squadra, stato delle squadre umane (round_readiness), squadre in campo in play-in e playoff, campione.
--
-- security invoker: ogni lettura passa dalla RLS di chi chiama, come le letture che sostituisce (gli avvisi sono solo
-- quelli della propria squadra, tentativi e blocco del turno le colonne già aperte ai membri). Chi non è membro della
-- lega non vede la riga di leagues e riceve null.

create function public.turn_status(p_league uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with me as (
    select t.id from public.teams t where t.league_id = p_league and t.owner_id = (select auth.uid())
  )
  select jsonb_build_object(
    'paused', l.paused,
    'max_pace_seconds', l.max_pace_seconds,
    'season_id', l.current_season_id,
    'round', (
      select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state, 'stage', r.stage,
        'deadline', r.deadline, 'created_at', r.created_at, 'forced_at', r.forced_at,
        'closing_started_at', r.closing_started_at, 'attempts', r.attempts, 'failed_at', r.failed_at)
      from public.rounds r where r.id = l.current_round_id
    ),
    'draft_state', (select d.state from public.initial_drafts d where d.league_id = l.id),
    'my_team_id', (select me.id from me),
    'ready', (
      select coalesce(jsonb_agg(f.team_id order by f.team_id), '[]')
      from public.ready_flags f where f.round_id = l.current_round_id and f.ready
    ),
    'delegations', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', d.team_id, 'active', d.active,
        'until_round', d.until_round, 'until_at', d.until_at) order by d.team_id), '[]')
      from public.coach_delegations d where d.league_id = l.id
    ),
    'alerts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'kind', a.kind, 'blocking', a.blocking,
        'payload', a.payload, 'created_at', a.created_at) order by a.created_at desc, a.id), '[]')
      from public.alerts a where a.team_id = (select me.id from me) and a.status = 'open'
    ),
    'last_game', (
      select jsonb_build_object('round_number', g.round_number, 'home_team_id', g.home_team_id,
        'away_team_id', g.away_team_id, 'home_score', g.home_score, 'away_score', g.away_score,
        'overtimes', g.overtimes)
      from public.games g, me
      where g.league_id = l.id and g.home_score is not null and me.id in (g.home_team_id, g.away_team_id)
      order by g.played_at desc nulls last
      limit 1
    ),
    'readiness', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', x.team_id, 'state', x.state) order by x.team_id), '[]')
      from public.round_readiness(l.id) x
      where l.current_round_id is not null
    ),
    'playing', (
      select coalesce(jsonb_agg(distinct x.team_id), '[]')
      from public.rounds r
      join public.games g on g.season_id = r.season_id and g.round_number = r.number
      cross join lateral (values (g.home_team_id), (g.away_team_id)) x(team_id)
      where r.id = l.current_round_id and r.kind in ('play-in', 'playoffs')
    ),
    'champion_id', (
      select s.winner_team_id
      from public.rounds r
      join public.playoff_series s on s.season_id = l.current_season_id and s.round = 4
      where r.id = l.current_round_id and r.kind = 'offseason'
    )
  )
  from public.leagues l
  where l.id = p_league
$$;

revoke execute on function public.turn_status(uuid) from public, anon, authenticated;
grant execute on function public.turn_status(uuid) to authenticated;
