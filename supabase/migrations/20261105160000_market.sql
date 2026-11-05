-- NBBGM: mercato ed economia (Fase 11).
--
-- Le azioni di mercato dei manager (offerte agli svincolati, proposte e risposte agli scambi, tagli e rinnovi)
-- passano tutte dalla Edge Function market, che le controlla con il motore (rosa, cap, bilancio, trade deadline,
-- regola Stepien) e le scrive con market_write sotto il lock del turno aperto. Il client non scrive più
-- direttamente offerte e scambi. Tutto si esegue alla chiusura del turno: advance-turn passa il risultato ad
-- apply_round, che aggiunge le sezioni del mercato e chiama apply_turn, in una sola transazione.

-- ---------------------------------------------------------------- tabelle

-- Protezione "top N" messa da chi cede su una sua prima scelta: { id della scelta: N }
alter table public.trade_offers add column protections jsonb not null default '{}';

-- Tagli e rinnovi chiesti dal manager durante il turno, eseguiti alla chiusura
create table public.roster_requests (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  kind text not null check (kind in ('release', 'renew')),
  -- Rinnovo: { salaries } concordati al momento della richiesta
  payload jsonb not null default '{}',
  status text not null default 'pending' check (status in ('pending', 'done', 'invalid', 'withdrawn')),
  created_at timestamptz not null default now()
);
create unique index roster_requests_pending on public.roster_requests (round_id, player_id, kind)
  where status = 'pending';
create index roster_requests_league on public.roster_requests (league_id);
create index roster_requests_team on public.roster_requests (team_id);
create index roster_requests_player on public.roster_requests (player_id);

alter table public.roster_requests enable row level security;
create policy requests_own on public.roster_requests for select to authenticated using (private.owns_team(team_id));
grant select on public.roster_requests to authenticated;
grant all on public.roster_requests to service_role;

-- ---------------------------------------------------------------- niente scritture dirette dal client

drop policy bids_insert on public.free_agent_bids;
drop policy bids_update on public.free_agent_bids;
drop policy bids_delete on public.free_agent_bids;
drop policy trades_propose on public.trade_offers;
revoke insert, update, delete on public.free_agent_bids from authenticated;
revoke insert on public.trade_offers from authenticated;

-- ---------------------------------------------------------------- bilancio solo alla propria squadra

-- Il bilancio lo vede la propria squadra, il commissario tutte: saldo e storico della tassa non sono più
-- colonne leggibili da tutti i membri, si leggono con team_balance
revoke select on public.teams from authenticated;
grant select (id, league_id, code, city, name, full_name, conference, division, owner_id, strategy)
  on public.teams to authenticated;

create function public.team_balance(p_team uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object('balance', t.balance, 'tax_history', t.tax_history)
  from public.teams t
  where t.id = p_team and (private.owns_team(t.id) or private.is_commissioner(t.league_id))
$$;

-- ---------------------------------------------------------------- scrittura delle azioni di mercato

/*
  Scrive un'azione di mercato già controllata dalla Edge Function market, solo se il turno è ancora quello
  aperto: il lock sul turno la mette in fila con la chiusura, così nessuna richiesta finisce in un turno già
  simulato. p_action ha kind e i campi dell'azione:
    bid               player_id, salaries          offerta a busta chiusa (una per giocatore e turno)
    withdraw_bid      bid_id
    propose_trade     to_team_id, players_from, players_to, picks_from, picks_to, swaps, protections, to_human
    respond_trade     offer_id, accept
    withdraw_trade    offer_id
    release / renew   player_id (renew: salaries)
    withdraw_request  request_id
  Restituisce { id } della riga scritta.
*/
create function public.market_write(p_league uuid, p_round uuid, p_team uuid, p_action jsonb) returns jsonb
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

  else
    raise exception 'Azione di mercato sconosciuta: %', v_kind;
  end case;
  if v_id is null then
    raise exception 'Niente da cambiare';
  end if;
  return jsonb_build_object('id', v_id);
end;
$$;

-- ---------------------------------------------------------------- risultato del turno con il mercato

/*
  apply_turn più le sezioni del mercato dei manager, nella stessa transazione:
    requests     [{ id, status }] esito di tagli e rinnovi
    new_trades   righe intere di trade_offers: proposte dei bot per il turno che si apre
  Il resto passa ad apply_turn. Restituisce l'id del turno aperto.
*/
create function public.apply_round(p_round uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_league uuid;
  v_next uuid;
  v_count bigint;
begin
  select league_id into v_league from public.rounds where id = p_round;
  v_next := public.apply_turn(p_round, p_payload - 'requests' - 'new_trades');
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
  return v_next;
end;
$$;

-- ---------------------------------------------------------------- stato della lega per il motore

-- Come nella Fase 10, più le richieste di mercato da eseguire e l'ultima proposta dei bot a ogni squadra umana
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
    -- Ultimo turno (della stagione corrente) in cui un bot ha proposto uno scambio a ogni squadra umana
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
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function public.market_write(uuid, uuid, uuid, jsonb), public.apply_round(uuid, jsonb),
  public.team_balance(uuid)
from public, anon, authenticated;
grant execute on function public.team_balance(uuid) to authenticated;
grant execute on function public.market_write(uuid, uuid, uuid, jsonb), public.apply_round(uuid, jsonb)
to service_role;

-- Le risposte agli scambi e le richieste arrivano alle app aperte
do $$
begin
  if exists (select 1 from pg_catalog.pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.trade_offers, public.roster_requests;
  end if;
end;
$$;
