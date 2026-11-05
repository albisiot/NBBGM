-- NBBGM: turni. Il manager preme Pronto; il server chiude il turno (vince solo la prima chiamata), simula
-- con il pacchetto engine e passa tutto il risultato ad apply_turn, che lo scrive in una sola transazione.

-- ---------------------------------------------------------------- chi è pronto

-- Allenatore attivo per quel turno e nessun avviso bloccante aperto: la squadra è pronta da sola
create function public.coach_ready(p_team uuid, p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1
    from public.coach_delegations d
    join public.rounds r on r.id = p_round
    where d.team_id = p_team and d.active
      and (d.until_round is null or r.number <= d.until_round)
      and (d.until_at is null or now() < d.until_at)
  )
  and not exists (
    select 1 from public.alerts a where a.team_id = p_team and a.blocking and a.status = 'open'
  )
$$;

-- Tutte le squadre umane sono pronte: Pronto premuto oppure allenatore attivo senza avvisi bloccanti
create function public.round_all_ready(p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1
    from public.rounds r
    join public.teams t on t.league_id = r.league_id and t.owner_id is not null
    where r.id = p_round
      and not exists (
        select 1 from public.ready_flags f where f.round_id = r.id and f.team_id = t.id and f.ready
      )
      and not public.coach_ready(t.id, r.id)
  )
$$;

-- Pronto (o tolto il Pronto) per la propria squadra nel turno corrente, finché il turno è aperto.
-- Restituisce true se con questo Pronto tutte le squadre umane sono pronte: dalla Fase 9 a quel punto
-- si chiamerà la Edge Function advance-turn.
create function public.set_ready(p_team uuid, p_ready boolean default true) returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
begin
  if not public.owns_team(p_team) then
    raise exception 'Non è la tua squadra' using errcode = '42501';
  end if;
  -- Il lock sul turno mette in fila i Pronto simultanei: l'ultimo vede tutti gli altri
  select r.* into v_round
  from public.teams t
  join public.leagues l on l.id = t.league_id
  join public.rounds r on r.id = l.current_round_id
  where t.id = p_team
  for update of r;
  if not found then
    raise exception 'La lega non ha un turno in corso';
  end if;
  if v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura: non si accettano modifiche';
  end if;
  insert into public.ready_flags (round_id, team_id, league_id, ready, updated_at)
  values (v_round.id, p_team, v_round.league_id, p_ready, now())
  on conflict (round_id, team_id) do update set ready = excluded.ready, updated_at = excluded.updated_at;
  return public.round_all_ready(v_round.id);
end;
$$;

-- ---------------------------------------------------------------- chiusura

-- Da aperto a in chiusura con un aggiornamento condizionato: solo la prima chiamata vince e riceve il
-- seed della simulazione, le altre ricevono null. Il seed nasce qui e resta salvato per le riprese.
create function public.close_round(p_round uuid) returns text
language sql volatile security definer set search_path = ''
as $$
  update public.rounds
  set state = 'closing', closing_started_at = now(), seed = coalesce(seed, gen_random_uuid()::text)
  where id = p_round and state = 'open'
  returning seed
$$;

-- Riprende un turno rimasto in chiusura da più di 5 minuti (scrittura fallita): stesso seed, stesso risultato
create function public.reclaim_round(p_round uuid) returns text
language sql volatile security definer set search_path = ''
as $$
  update public.rounds
  set closing_started_at = now()
  where id = p_round and state = 'closing' and closing_started_at < now() - interval '5 minutes'
  returning seed
$$;

-- ---------------------------------------------------------------- apply_turn

create function public.expect_rows(p_section text, p_count bigint, p_rows jsonb) returns void
language plpgsql immutable set search_path = ''
as $$
begin
  if p_count <> jsonb_array_length(p_rows) then
    raise exception 'apply_turn: nella sezione % ci sono righe inesistenti o di un''altra lega (% su %)',
      p_section, p_count, jsonb_array_length(p_rows);
  end if;
end;
$$;

/*
  Scrive il risultato di un turno e apre il successivo, tutto o niente. p_payload è un oggetto con queste
  sezioni, tutte facoltative tranne next_round; le righe usano i nomi delle colonne e, dove si inseriscono
  righe intere, devono essere complete (le chiavi mancanti diventano null, non il valore di default).

    season_phase        fase della stagione corrente ('regular', 'play-in', 'playoffs', 'offseason')
    new_season          riga di seasons per la stagione nuova (offseason)
    league              { talent_reference }
    teams               [{ id, balance, strategy, tax_history }]
    players             righe intere di players: nuovi (draft) o cambiati in offseason
    player_status       [{ id, energy, morale, two_way_games, season_stats }] dopo le partite
    player_moves        [{ id, team_id }] firme, tagli, scambi (team_id null = svincolato)
    player_hidden       [{ player_id, hidden }]
    contracts           righe intere di contracts; contracts_removed [player_id]
    dead_money          tutti gli stipendi residui della lega (sostituiscono quelli salvati)
    injuries            tutti gli infortuni in corso della lega (sostituiscono quelli salvati)
    draft_picks         righe intere; draft_picks_removed [id]
    draft_swaps         righe intere; draft_swaps_removed [id]
    draft_lottery       [{ draft_year, pick_order }]
    playoff_series      righe intere
    games               righe intere: le partite in calendario ricevono il punteggio, le nuove si aggiungono
    player_game_stats   righe del box score
    team_settings       [{ team_id, starters, minutes, tactics }] slot corretti dal bot
    bids                [{ id, status }] esito delle offerte agli svincolati
    trades              [{ id, status }] esito delle proposte di scambio
    alerts              [{ team_id, kind, blocking, payload, deadline }] nuovi avvisi
    alerts_closed       [{ id, status }]
    coach_expired       [team_id] deleghe all'allenatore scadute
    ledger              [{ team_id, kind, amount, note }]
    transactions        [{ season_year, round_number, type, text }]
    next_round          { number, kind, season_id? } turno da aprire (season_id: di default la stagione
                        nuova, se c'è, altrimenti quella corrente)

  Restituisce l'id del turno aperto. Una seconda chiamata sullo stesso turno fallisce: il turno non è più
  in chiusura.
*/
create function public.apply_turn(p_round uuid, p_payload jsonb) returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_league uuid;
  v_season uuid;
  v_new_season uuid;
  v_next jsonb := p_payload -> 'next_round';
  v_next_id uuid;
  v_deadline integer;
  v_count bigint;
  v_unknown text;
begin
  if jsonb_typeof(p_payload) is distinct from 'object' then
    raise exception 'apply_turn: il risultato deve essere un oggetto';
  end if;
  select string_agg(k, ', ') into v_unknown
  from jsonb_object_keys(p_payload) as k
  where k not in (
    'season_phase', 'new_season', 'league', 'teams', 'players', 'player_status', 'player_moves', 'player_hidden',
    'contracts', 'contracts_removed', 'dead_money', 'injuries', 'draft_picks', 'draft_picks_removed',
    'draft_swaps', 'draft_swaps_removed', 'draft_lottery', 'playoff_series', 'games', 'player_game_stats',
    'team_settings', 'bids', 'trades', 'alerts', 'alerts_closed', 'coach_expired', 'ledger', 'transactions',
    'next_round'
  );
  if v_unknown is not null then
    raise exception 'apply_turn: sezioni sconosciute: %', v_unknown;
  end if;
  if jsonb_typeof(v_next) is distinct from 'object' then
    raise exception 'apply_turn: manca il turno successivo (next_round)';
  end if;

  -- Il lock sul turno ferma un'eventuale seconda chiamata finché questa non finisce
  select * into v_round from public.rounds where id = p_round for update;
  if not found then
    raise exception 'apply_turn: turno inesistente';
  end if;
  if v_round.state <> 'closing' then
    raise exception 'apply_turn: il turno non è in chiusura (stato %)', v_round.state;
  end if;
  v_league := v_round.league_id;
  v_season := v_round.season_id;
  if (select current_round_id from public.leagues where id = v_league) is distinct from p_round then
    raise exception 'apply_turn: non è il turno corrente della lega';
  end if;

  -- ------------------------------------------------ stagione e lega
  if p_payload ? 'season_phase' then
    update public.seasons set phase = p_payload ->> 'season_phase' where id = v_season;
  end if;
  if p_payload ? 'new_season' then
    insert into public.seasons (league_id, year, phase, salary_cap, luxury_tax, first_apron, second_apron,
      minimum_team_salary, minimum_salary, rookie_scale, revenue, growth)
    select v_league, s.year, s.phase, s.salary_cap, s.luxury_tax, s.first_apron, s.second_apron,
      s.minimum_team_salary, s.minimum_salary, s.rookie_scale, s.revenue, s.growth
    from jsonb_populate_record(null::public.seasons, p_payload -> 'new_season') s
    returning id into v_new_season;
  end if;
  if p_payload ? 'league' then
    update public.leagues
    set talent_reference = coalesce((p_payload -> 'league' ->> 'talent_reference')::numeric, talent_reference)
    where id = v_league;
  end if;

  -- ------------------------------------------------ squadre
  if p_payload ? 'teams' then
    update public.teams t
    set balance = x.balance, strategy = x.strategy, tax_history = x.tax_history
    from jsonb_populate_recordset(null::public.teams, p_payload -> 'teams') x
    where t.id = x.id and t.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('teams', v_count, p_payload -> 'teams');
  end if;

  -- ------------------------------------------------ giocatori
  if p_payload ? 'players' then
    insert into public.players as p (id, league_id, slug, team_id, first_name, last_name, nationality, role,
      secondary_role, hand, archetype, age, height_cm, wingspan_cm, weight_kg, years_in_league, ratings,
      tendencies, energy, morale, scouted_potential, two_way_games, season_stats, retired)
    select x.id, v_league, x.slug, x.team_id, x.first_name, x.last_name, x.nationality, x.role,
      x.secondary_role, x.hand, x.archetype, x.age, x.height_cm, x.wingspan_cm, x.weight_kg, x.years_in_league,
      x.ratings, x.tendencies, x.energy, x.morale, x.scouted_potential, x.two_way_games, x.season_stats,
      x.retired
    from jsonb_populate_recordset(null::public.players, p_payload -> 'players') x
    on conflict (id) do update set
      team_id = excluded.team_id, first_name = excluded.first_name, last_name = excluded.last_name,
      nationality = excluded.nationality, role = excluded.role, secondary_role = excluded.secondary_role,
      hand = excluded.hand, archetype = excluded.archetype, age = excluded.age, height_cm = excluded.height_cm,
      wingspan_cm = excluded.wingspan_cm, weight_kg = excluded.weight_kg,
      years_in_league = excluded.years_in_league, ratings = excluded.ratings, tendencies = excluded.tendencies,
      energy = excluded.energy, morale = excluded.morale, scouted_potential = excluded.scouted_potential,
      two_way_games = excluded.two_way_games, season_stats = excluded.season_stats, retired = excluded.retired
    where p.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('players', v_count, p_payload -> 'players');
  end if;
  if p_payload ? 'player_status' then
    update public.players p
    set energy = x.energy, morale = x.morale, two_way_games = x.two_way_games, season_stats = x.season_stats
    from jsonb_populate_recordset(null::public.players, p_payload -> 'player_status') x
    where p.id = x.id and p.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('player_status', v_count, p_payload -> 'player_status');
  end if;
  if p_payload ? 'player_moves' then
    update public.players p
    set team_id = x.team_id
    from jsonb_populate_recordset(null::public.players, p_payload -> 'player_moves') x
    where p.id = x.id and p.league_id = v_league
      and (x.team_id is null or exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league));
    get diagnostics v_count = row_count;
    perform public.expect_rows('player_moves', v_count, p_payload -> 'player_moves');
  end if;
  if p_payload ? 'player_hidden' then
    insert into public.player_hidden as h (player_id, league_id, hidden)
    select x.player_id, v_league, x.hidden
    from jsonb_populate_recordset(null::public.player_hidden, p_payload -> 'player_hidden') x
    where exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league)
    on conflict (player_id) do update set hidden = excluded.hidden;
    get diagnostics v_count = row_count;
    perform public.expect_rows('player_hidden', v_count, p_payload -> 'player_hidden');
  end if;

  -- ------------------------------------------------ contratti, residui, infortuni
  if p_payload ? 'contracts_removed' then
    delete from public.contracts
    where league_id = v_league
      and player_id in (select (jsonb_array_elements_text(p_payload -> 'contracts_removed'))::uuid);
  end if;
  if p_payload ? 'contracts' then
    insert into public.contracts as c (player_id, league_id, team_id, type, salaries, options, guaranteed)
    select x.player_id, v_league, x.team_id, x.type, x.salaries, x.options, x.guaranteed
    from jsonb_populate_recordset(null::public.contracts, p_payload -> 'contracts') x
    where exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league)
    on conflict (player_id) do update set
      team_id = excluded.team_id, type = excluded.type, salaries = excluded.salaries,
      options = excluded.options, guaranteed = excluded.guaranteed;
    get diagnostics v_count = row_count;
    perform public.expect_rows('contracts', v_count, p_payload -> 'contracts');
  end if;
  if p_payload ? 'dead_money' then
    delete from public.dead_money where league_id = v_league;
    insert into public.dead_money (league_id, team_id, player_name, salaries)
    select v_league, x.team_id, x.player_name, x.salaries
    from jsonb_populate_recordset(null::public.dead_money, p_payload -> 'dead_money') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('dead_money', v_count, p_payload -> 'dead_money');
  end if;
  if p_payload ? 'injuries' then
    delete from public.injuries where league_id = v_league;
    insert into public.injuries (player_id, league_id, body_part, severity, games_remaining)
    select x.player_id, v_league, x.body_part, x.severity, x.games_remaining
    from jsonb_populate_recordset(null::public.injuries, p_payload -> 'injuries') x
    where exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('injuries', v_count, p_payload -> 'injuries');
  end if;

  -- ------------------------------------------------ draft
  if p_payload ? 'draft_picks_removed' then
    delete from public.draft_picks
    where league_id = v_league
      and id in (select (jsonb_array_elements_text(p_payload -> 'draft_picks_removed'))::uuid);
  end if;
  if p_payload ? 'draft_picks' then
    insert into public.draft_picks as d (id, league_id, draft_year, round, original_team_id, owner_team_id,
      protection, deferrals, position, player_id)
    select x.id, v_league, x.draft_year, x.round, x.original_team_id, x.owner_team_id, x.protection,
      x.deferrals, x.position, x.player_id
    from jsonb_populate_recordset(null::public.draft_picks, p_payload -> 'draft_picks') x
    where exists (select 1 from public.teams t where t.id = x.original_team_id and t.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.owner_team_id and t.league_id = v_league)
    on conflict (id) do update set
      draft_year = excluded.draft_year, round = excluded.round, owner_team_id = excluded.owner_team_id,
      protection = excluded.protection, deferrals = excluded.deferrals, position = excluded.position,
      player_id = excluded.player_id
    where d.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('draft_picks', v_count, p_payload -> 'draft_picks');
  end if;
  if p_payload ? 'draft_swaps_removed' then
    delete from public.draft_swaps
    where league_id = v_league
      and id in (select (jsonb_array_elements_text(p_payload -> 'draft_swaps_removed'))::uuid);
  end if;
  if p_payload ? 'draft_swaps' then
    insert into public.draft_swaps as d (id, league_id, draft_year, round, holder_team_id, other_team_id, result)
    select x.id, v_league, x.draft_year, x.round, x.holder_team_id, x.other_team_id, x.result
    from jsonb_populate_recordset(null::public.draft_swaps, p_payload -> 'draft_swaps') x
    where exists (select 1 from public.teams t where t.id = x.holder_team_id and t.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.other_team_id and t.league_id = v_league)
    on conflict (id) do update set
      holder_team_id = excluded.holder_team_id, other_team_id = excluded.other_team_id, result = excluded.result
    where d.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('draft_swaps', v_count, p_payload -> 'draft_swaps');
  end if;
  if p_payload ? 'draft_lottery' then
    insert into public.draft_lottery (league_id, season_id, draft_year, pick_order)
    select v_league, v_season, x.draft_year, x.pick_order
    from jsonb_populate_recordset(null::public.draft_lottery, p_payload -> 'draft_lottery') x;
  end if;

  -- ------------------------------------------------ partite
  if p_payload ? 'playoff_series' then
    insert into public.playoff_series as s (id, league_id, season_id, round, conference, high_team_id, low_team_id,
      high_seed, low_seed, wins_high, wins_low, winner_team_id)
    select x.id, v_league, coalesce(x.season_id, v_season), x.round, x.conference, x.high_team_id,
      x.low_team_id, x.high_seed, x.low_seed, x.wins_high, x.wins_low, x.winner_team_id
    from jsonb_populate_recordset(null::public.playoff_series, p_payload -> 'playoff_series') x
    on conflict (id) do update set
      wins_high = excluded.wins_high, wins_low = excluded.wins_low, winner_team_id = excluded.winner_team_id
    where s.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('playoff_series', v_count, p_payload -> 'playoff_series');
  end if;
  if p_payload ? 'games' then
    insert into public.games as g (id, league_id, season_id, round_number, kind, home_team_id, away_team_id,
      series_id, home_score, away_score, overtimes, quarters, play_by_play, seed, played_at)
    select x.id, v_league, coalesce(x.season_id, v_season), x.round_number, x.kind, x.home_team_id,
      x.away_team_id, x.series_id, x.home_score, x.away_score, x.overtimes, x.quarters, x.play_by_play, x.seed,
      case when x.home_score is null then null else coalesce(x.played_at, now()) end
    from jsonb_populate_recordset(null::public.games, p_payload -> 'games') x
    where exists (select 1 from public.teams t where t.id = x.home_team_id and t.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.away_team_id and t.league_id = v_league)
    on conflict (id) do update set
      series_id = excluded.series_id, home_score = excluded.home_score, away_score = excluded.away_score,
      overtimes = excluded.overtimes, quarters = excluded.quarters, play_by_play = excluded.play_by_play,
      seed = excluded.seed, played_at = excluded.played_at
    -- Una partita già giocata non si riscrive
    where g.league_id = v_league and g.home_team_id = excluded.home_team_id
      and g.away_team_id = excluded.away_team_id and g.home_score is null;
    get diagnostics v_count = row_count;
    perform public.expect_rows('games', v_count, p_payload -> 'games');
  end if;
  if p_payload ? 'player_game_stats' then
    insert into public.player_game_stats (game_id, player_id, team_id, league_id, starter, seconds, pts, fgm, fga,
      tpm, tpa, ftm, fta, orb, drb, ast, stl, blk, tov, pf, plus_minus)
    select x.game_id, x.player_id, x.team_id, v_league, x.starter, x.seconds, x.pts, x.fgm, x.fga, x.tpm, x.tpa,
      x.ftm, x.fta, x.orb, x.drb, x.ast, x.stl, x.blk, x.tov, x.pf, x.plus_minus
    from jsonb_populate_recordset(null::public.player_game_stats, p_payload -> 'player_game_stats') x
    where exists (
      select 1 from public.games g
      where g.id = x.game_id and g.league_id = v_league and x.team_id in (g.home_team_id, g.away_team_id)
    )
      and exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('player_game_stats', v_count, p_payload -> 'player_game_stats');
  end if;

  -- ------------------------------------------------ impostazioni corrette dal bot
  if p_payload ? 'team_settings' then
    insert into public.team_settings as s (team_id, league_id, starters, minutes, tactics)
    select x.team_id, v_league, x.starters, x.minutes, x.tactics
    from jsonb_populate_recordset(null::public.team_settings, p_payload -> 'team_settings') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league)
    on conflict (team_id) do update set
      starters = excluded.starters, minutes = excluded.minutes, tactics = excluded.tactics;
    get diagnostics v_count = row_count;
    perform public.expect_rows('team_settings', v_count, p_payload -> 'team_settings');
  end if;

  -- ------------------------------------------------ mercato e avvisi
  if p_payload ? 'bids' then
    update public.free_agent_bids b
    set status = x.status
    from jsonb_populate_recordset(null::public.free_agent_bids, p_payload -> 'bids') x
    where b.id = x.id and b.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('bids', v_count, p_payload -> 'bids');
  end if;
  if p_payload ? 'trades' then
    update public.trade_offers o
    set status = x.status, responded_at = coalesce(o.responded_at, now())
    from jsonb_populate_recordset(null::public.trade_offers, p_payload -> 'trades') x
    where o.id = x.id and o.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('trades', v_count, p_payload -> 'trades');
  end if;
  if p_payload ? 'alerts_closed' then
    update public.alerts a
    set status = x.status
    from jsonb_populate_recordset(null::public.alerts, p_payload -> 'alerts_closed') x
    where a.id = x.id and a.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('alerts_closed', v_count, p_payload -> 'alerts_closed');
  end if;
  if p_payload ? 'coach_expired' then
    update public.coach_delegations
    set active = false
    where league_id = v_league
      and team_id in (select (jsonb_array_elements_text(p_payload -> 'coach_expired'))::uuid);
  end if;

  -- ------------------------------------------------ bilancio e storico
  if p_payload ? 'ledger' then
    insert into public.ledger (league_id, team_id, season_id, round_id, kind, amount, note)
    select v_league, x.team_id, v_season, p_round, x.kind, x.amount, x.note
    from jsonb_populate_recordset(null::public.ledger, p_payload -> 'ledger') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('ledger', v_count, p_payload -> 'ledger');
  end if;
  if p_payload ? 'transactions' then
    insert into public.transactions (league_id, season_year, round_number, type, text)
    select v_league, x.season_year, x.round_number, x.type, x.text
    from jsonb_populate_recordset(null::public.transactions, p_payload -> 'transactions') x;
  end if;

  -- ------------------------------------------------ turno successivo (gli avvisi nuovi vi appartengono)
  update public.rounds set state = 'done', simulated_at = now() where id = p_round;
  select deadline_minutes into v_deadline from public.leagues where id = v_league;
  insert into public.rounds (league_id, season_id, number, kind, deadline)
  values (
    v_league,
    coalesce((v_next ->> 'season_id')::uuid, v_new_season, v_season),
    (v_next ->> 'number')::integer,
    v_next ->> 'kind',
    case when v_deadline is null then null else now() + make_interval(mins => v_deadline) end
  )
  returning id into v_next_id;

  if p_payload ? 'alerts' then
    insert into public.alerts (league_id, team_id, kind, blocking, payload, round_id, deadline)
    select v_league, x.team_id, x.kind, coalesce(x.blocking, false), coalesce(x.payload, '{}'), v_next_id, x.deadline
    from jsonb_populate_recordset(null::public.alerts, p_payload -> 'alerts') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('alerts', v_count, p_payload -> 'alerts');
  end if;

  update public.leagues
  set current_round_id = v_next_id,
      current_season_id = (select season_id from public.rounds where id = v_next_id)
  where id = v_league;
  return v_next_id;
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function public.coach_ready(uuid, uuid), public.round_all_ready(uuid),
  public.set_ready(uuid, boolean), public.close_round(uuid), public.reclaim_round(uuid),
  public.expect_rows(text, bigint, jsonb), public.apply_turn(uuid, jsonb)
from public, anon, authenticated;

-- Il manager preme Pronto e può chiedere se il turno è completo; chiusura e scrittura solo dal server
grant execute on function public.set_ready(uuid, boolean), public.round_all_ready(uuid), public.coach_ready(uuid, uuid)
  to authenticated;
grant execute on function public.coach_ready(uuid, uuid), public.round_all_ready(uuid), public.close_round(uuid),
  public.reclaim_round(uuid), public.expect_rows(text, bigint, jsonb), public.apply_turn(uuid, jsonb)
  to service_role;
