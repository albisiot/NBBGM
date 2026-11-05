-- NBBGM: schermata roster (Fase 8).
--
-- league_state dà al server, in una sola lettura, tutto quello che serve al motore per simulare: impostazioni
-- salvate dai manager comprese. player_scouting dà al manager le stime dei valori nascosti di un giocatore,
-- mai i numeri: più precise per i giocatori della propria squadra.

-- ---------------------------------------------------------------- stato della lega per il motore (solo server)

create function public.league_state(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'seed', l.seed, 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state)
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
        'away_score', g.away_score, 'overtimes', g.overtimes) order by g.round_number, g.id), '[]')
      from public.games g where g.season_id = l.current_season_id
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- ---------------------------------------------------------------- stime dei valori nascosti (scheda giocatore)

-- Livello di un valore nascosto: 5 livelli per i giocatori della propria squadra, 3 per gli altri
create function private.scout_level(p_value numeric, p_own boolean) returns text
language sql immutable set search_path = ''
as $$
  select case
    when p_value is null then null
    when p_own then
      case when p_value < 40 then 'molto bassa' when p_value < 55 then 'bassa' when p_value < 70 then 'media'
           when p_value < 85 then 'alta' else 'molto alta' end
    else
      case when p_value < 50 then 'bassa' when p_value < 75 then 'media' else 'alta' end
  end
$$;

create function public.player_scouting(p_player uuid) returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_player public.players%rowtype;
  v_hidden jsonb;
  v_own boolean;
  v_threshold numeric;
begin
  select * into v_player from public.players where id = p_player;
  if not found or not private.is_member(v_player.league_id) then
    raise exception 'Giocatore non trovato' using errcode = '42501';
  end if;
  v_own := v_player.team_id is not null and private.owns_team(v_player.team_id);
  select hidden into v_hidden from public.player_hidden where player_id = p_player;
  -- Un distretto è "a rischio" sotto 70 per i propri giocatori, sotto 55 per gli altri (si vede meno)
  v_threshold := case when v_own then 70 else 55 end;
  return jsonb_build_object(
    'own', v_own,
    'potential', v_player.scouted_potential,
    'offensive_consistency', private.scout_level((v_hidden ->> 'offensiveConsistency')::numeric, v_own),
    'defensive_consistency', private.scout_level((v_hidden ->> 'defensiveConsistency')::numeric, v_own),
    'work_ethic', private.scout_level((v_hidden ->> 'workEthic')::numeric, v_own),
    'risks', (
      select coalesce(jsonb_agg(x.label order by x.label), '[]')
      from (values ('schiena', 'durabilityBack'), ('ginocchia', 'durabilityKnees'), ('caviglie', 'durabilityAnkles'),
                   ('piedi', 'durabilityFeet'), ('spalle', 'durabilityShoulders')) as x(label, key)
      where (v_hidden ->> x.key)::numeric < v_threshold
    )
  );
end;
$$;

revoke execute on function public.league_state(uuid), private.scout_level(numeric, boolean),
  public.player_scouting(uuid)
from public, anon, authenticated;
grant execute on function public.league_state(uuid) to service_role;
grant execute on function public.player_scouting(uuid) to authenticated, service_role;
