-- NBBGM: lettura leggera per le azioni di mercato (seconda analisi, prestazioni).
--
-- La Edge Function market leggeva tutto league_state a ogni azione (1,3 MB nella lega di prova: partite 311 KB,
-- giocatori 758 KB con abilità, tendenze, valori nascosti e statistiche). Il controllo dell'azione
-- (checkMarketAction in supabase/functions/_shared/market.ts) ne usa molto meno:
--   - le partite no: il turno della trade deadline in regular season è il numero del turno, e la fase della
--     stagione è 'regular' solo nei turni di regular season;
--   - dei giocatori bastano squadra, nome, ruoli, età, anzianità, morale e stima del potenziale, per contare le
--     rose e controllare gli scambi; le abilità servono solo al giocatore dell'azione (richiesta di uno svincolato o
--     di un rinnovo), che è anche l'unico svincolato che serve;
--   - di contratti, residui, scelte e swap le sole colonne che il motore legge; niente infortuni, impostazioni,
--     allenatori, avvisi, offerte, preferiti del draft.
-- Gli elenchi hanno lo stesso ordine di league_state. Il controllo si ripete comunque alla chiusura del turno, con
-- lo stato completo. A un giocatore senza abilità il motore non può calcolare l'overall e la funzione si ferma con un
-- errore: se un controllo nuovo avesse bisogno delle abilità di altri giocatori, i test del mercato lo direbbero
-- (scripts/test/market.test.ts confronta ogni azione con le due letture).

create function public.market_state(p_league uuid, p_player uuid default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    -- Il seed della lega non serve ai controlli
    'league', jsonb_build_object('id', l.id, 'seed', '', 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'stage', r.stage)
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
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- Come league_state: solo il server
revoke execute on function public.market_state(uuid, uuid) from public, anon, authenticated;
grant execute on function public.market_state(uuid, uuid) to service_role;
