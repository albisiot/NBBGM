-- NBBGM: chi taglia un giocatore non lo rifirma nella stessa stagione (seconda analisi dopo la Fase 13, economia).
--
-- In stagione uno svincolato chiede quanto all'ultimo turno di free agency, cioè meno del rinnovo: tagliare un
-- giocatore all'ultimo anno e rifargli subito un'offerta costava meno che rinnovarlo. Ora una squadra non firma chi
-- ha tagliato fino alla stagione dopo. Il motore lo legge da LeagueState.releases: league_state gli passa i tagli
-- eseguiti (roster_requests 'release' fatte) nei turni della stagione corrente, offseason compresa (i turni
-- dell'offseason appartengono ancora alla stagione appena finita, fino alla preparazione). La funzione market e la
-- chiusura del turno rifiutano l'offerta con il motore (canSign).

-- Come nella Fase 12, più i tagli della stagione
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
    'releases', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', q.player_id, 'team_id', q.team_id)
        order by q.created_at), '[]')
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
      select coalesce(jsonb_agg(to_jsonb(x)), '[]') from public.draft_lists x where x.league_id = l.id
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;
