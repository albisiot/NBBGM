-- Offseason nuova, Fase 2: server e database (vedi "Offseason nuova" in CLAUDE.md).
--
-- Turni dell'offseason: draft (uno per ogni scelta di un manager), options, renewals, fa1-fa15, preparation.
-- - Draft dal vivo: il turno ha la chiamata da fare (draft_pick) e la squadra che sceglie (draft_team_id); per le
--   altre squadre umane il turno è "non gioca" (team_readiness), come in playoff. La scelta del manager è una richiesta
--   (roster_requests 'draft_pick').
-- - Opzioni della squadra ('option'), offerte di qualifica agli RFA ('qualify'), pareggi delle offerte agli RFA
--   ('match'): richieste come tagli e rinnovi, eseguite alla chiusura del turno.
-- - Contratti: l'ultimo stipendio di chi è in scadenza o ha l'opzione della squadra da decidere (last_salary).
-- - RFA: diritti delle squadre (restricted_rights) e offerte in attesa di pareggio (offer_sheets), visibili ai membri.
-- - Rinnovi con trattativa: com'è andata con ogni giocatore nella stagione (renewal_talks), solo per la sua squadra.
-- - Offerte agli svincolati: una in attesa per squadra e giocatore, che resta da un turno all'altro della free agency.
-- - Preparazione: il Pronto aspetta che la rosa sia nei limiti (private.roster_issue).

-- ---------------------------------------------------------------- turni

alter table public.rounds drop constraint rounds_stage_check;
alter table public.rounds add constraint rounds_stage_check
  check (stage ~ '^(draft|options|renewals|preparation|fa([1-9]|1[0-5]))$');
alter table public.rounds
  add column draft_pick smallint check (draft_pick between 1 and 60),
  add column draft_team_id uuid references public.teams (id) on delete set null;
create index rounds_draft_team on public.rounds (draft_team_id);
grant select (draft_pick, draft_team_id) on public.rounds to authenticated;

-- ---------------------------------------------------------------- contratti e richieste

alter table public.contracts add column last_salary bigint;

alter table public.roster_requests drop constraint roster_requests_kind_check;
alter table public.roster_requests add constraint roster_requests_kind_check
  check (kind in ('release', 'renew', 'draft_pick', 'option', 'qualify', 'match'));

-- Un'offerta in attesa per squadra e giocatore, qualunque sia il turno in cui è nata
alter table public.free_agent_bids drop constraint free_agent_bids_round_id_team_id_player_id_key;
create unique index free_agent_bids_pending on public.free_agent_bids (team_id, player_id) where status = 'pending';
create index free_agent_bids_round on public.free_agent_bids (round_id);

-- ---------------------------------------------------------------- RFA e trattative

create table public.restricted_rights (
  player_id uuid primary key references public.players (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  qualifying_offer bigint not null check (qualifying_offer > 0)
);
create index restricted_rights_league on public.restricted_rights (league_id);
create index restricted_rights_team on public.restricted_rights (team_id);

create table public.offer_sheets (
  player_id uuid primary key references public.players (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  rights_team_id uuid not null references public.teams (id) on delete cascade,
  salaries bigint[] not null check (cardinality(salaries) between 1 and 5)
);
create index offer_sheets_league on public.offer_sheets (league_id);
create index offer_sheets_team on public.offer_sheets (team_id);
create index offer_sheets_rights_team on public.offer_sheets (rights_team_id);

create table public.renewal_talks (
  player_id uuid not null references public.players (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  -- Offerte rifiutate e ultima controproposta { salary, years, option }
  refusals smallint not null default 0 check (refusals >= 0),
  counter jsonb,
  updated_at timestamptz not null default now(),
  primary key (player_id, season_id)
);
create index renewal_talks_season on public.renewal_talks (season_id);
create index renewal_talks_league on public.renewal_talks (league_id);
create index renewal_talks_team on public.renewal_talks (team_id);

alter table public.restricted_rights enable row level security;
alter table public.offer_sheets enable row level security;
alter table public.renewal_talks enable row level security;
create policy restricted_rights_read on public.restricted_rights for select to authenticated
  using (private.is_member(league_id));
create policy offer_sheets_read on public.offer_sheets for select to authenticated
  using (private.is_member(league_id));
create policy renewal_talks_own on public.renewal_talks for select to authenticated
  using (private.owns_team(team_id));
grant select on public.restricted_rights, public.offer_sheets, public.renewal_talks to authenticated;
grant all on public.restricted_rights, public.offer_sheets, public.renewal_talks to service_role;

-- ---------------------------------------------------------------- preparazione

-- Che cosa manca alla rosa di una squadra per stare nei limiti della stagione (13-15 contratti standard, al più 3
-- two-way), contando i tagli chiesti e le offerte fatte nel turno: null se è a posto.
create function private.roster_issue(p_team uuid) returns text
language sql stable security definer set search_path = ''
as $$
  with mine as (
    select k.player_id, k.type
    from public.contracts k
    join public.players p on p.id = k.player_id and p.team_id = p_team
    where k.team_id = p_team
      and not exists (
        select 1 from public.roster_requests q
        where q.team_id = p_team and q.player_id = k.player_id and q.kind = 'release' and q.status = 'pending'
      )
  ),
  c as (
    select count(*) filter (where type <> 'two-way')::int as standard,
           count(*) filter (where type = 'two-way')::int as two_way,
           (select count(distinct b.player_id)::int from public.free_agent_bids b
            where b.team_id = p_team and b.status = 'pending') as bids
    from mine
  )
  select case
    when standard > 15 then
      case when standard - 15 = 1 then 'Devi tagliare un giocatore per stare dentro ai 15'
           else format('Devi tagliare %s giocatori per stare dentro ai 15', standard - 15) end
    when two_way > 3 then
      case when two_way - 3 = 1 then 'Devi tagliare un two-way: al massimo 3'
           else format('Devi tagliare %s two-way: al massimo 3', two_way - 3) end
    when standard + bids < 13 then
      case when 13 - standard - bids = 1 then 'Devi firmare un giocatore per averne almeno 13'
           else format('Devi firmare %s giocatori per averne almeno 13', 13 - standard - bids) end
  end
  from c
$$;

-- Come in 20261108090000_turn_days.sql, con l'ultimo stipendio dei contratti e la scelta al draft del turno
create or replace function public.apply_turn(p_round uuid, p_payload jsonb) returns uuid
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
    'next_round', 'new_games'
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
    insert into public.contracts as c (player_id, league_id, team_id, type, salaries, options, guaranteed,
      last_salary)
    select x.player_id, v_league, x.team_id, x.type, x.salaries, x.options, x.guaranteed, x.last_salary
    from jsonb_populate_recordset(null::public.contracts, p_payload -> 'contracts') x
    where exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league)
    on conflict (player_id) do update set
      team_id = excluded.team_id, type = excluded.type, salaries = excluded.salaries,
      options = excluded.options, guaranteed = excluded.guaranteed, last_salary = excluded.last_salary;
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
    insert into public.games as g (id, league_id, season_id, round_number, day, kind, home_team_id, away_team_id,
      series_id, home_score, away_score, overtimes, quarters, play_by_play, seed, played_at)
    select x.id, v_league, coalesce(x.season_id, v_season), x.round_number, x.day, x.kind, x.home_team_id,
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
    insert into public.transactions (league_id, season_year, round_number, day, type, text)
    select v_league, x.season_year, x.round_number, x.day, x.type, x.text
    from jsonb_populate_recordset(null::public.transactions, p_payload -> 'transactions') x;
  end if;

  -- ------------------------------------------------ turno successivo (gli avvisi nuovi vi appartengono)
  update public.rounds set state = 'done', simulated_at = now() where id = p_round;
  select deadline_minutes into v_deadline from public.leagues where id = v_league;
  insert into public.rounds (league_id, season_id, number, kind, stage, day, draft_pick, draft_team_id, deadline)
  values (
    v_league,
    coalesce((v_next ->> 'season_id')::uuid, v_new_season, v_season),
    (v_next ->> 'number')::integer,
    v_next ->> 'kind',
    v_next ->> 'stage',
    (v_next ->> 'day')::integer,
    (v_next ->> 'draft_pick')::smallint,
    (select t.id from public.teams t where t.id = (v_next ->> 'draft_team_id')::uuid and t.league_id = v_league),
    case when v_deadline is null then null else now() + make_interval(mins => v_deadline) end
  )
  returning id into v_next_id;

  -- Calendario della stagione nuova: prima degli avvisi e del Pronto automatico, che guardano chi gioca
  if p_payload ? 'new_games' then
    insert into public.games (id, league_id, season_id, round_number, day, kind, home_team_id, away_team_id)
    select x.id, v_league, v_new_season, x.round_number, x.day, coalesce(x.kind, 'regular'), x.home_team_id,
      x.away_team_id
    from jsonb_populate_recordset(null::public.games, p_payload -> 'new_games') x
    where v_new_season is not null
      and exists (select 1 from public.teams t where t.id = x.home_team_id and t.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.away_team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('new_games', v_count, p_payload -> 'new_games');
  end if;

  if p_payload ? 'alerts' then
    insert into public.alerts (league_id, team_id, kind, blocking, payload, round_id, deadline)
    select v_league, x.team_id, x.kind, coalesce(x.blocking, false), coalesce(x.payload, '{}'), v_next_id, x.deadline
    from jsonb_populate_recordset(null::public.alerts, p_payload -> 'alerts') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('alerts', v_count, p_payload -> 'alerts');
  end if;

  -- Chi riposa parte pronto; prima di cambiare il turno della lega, perché le notifiche (push_round) lo vedano
  perform private.auto_ready(v_next_id);

  update public.leagues
  set current_round_id = v_next_id,
      current_season_id = (select season_id from public.rounds where id = v_next_id)
  where id = v_league;
  return v_next_id;
end;
$$;

-- Come in 20261108110000_coaches.sql, con i diritti degli RFA e le offerte in attesa di pareggio
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
    p_payload - 'requests' - 'new_trades' - 'draft_order' - 'draft_prospects' - 'player_drafts' -
    'player_seasons' - 'coaches' - 'coaches_removed' - 'coach_buyouts' - 'coach_requests' - 'team_expectations' -
    'restricted' - 'offer_sheets');
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
  -- Draft annuale: anno, giro e scelta dei prospetti scelti; i non scelti con il solo anno
  if p_payload ? 'player_drafts' then
    update public.players p
    set draft = x.draft
    from jsonb_populate_recordset(null::public.players, p_payload -> 'player_drafts') x
    where p.id = x.id and p.league_id = v_league and jsonb_typeof(x.draft) = 'object';
    get diagnostics v_count = row_count;
    perform public.expect_rows('player_drafts', v_count, p_payload -> 'player_drafts');
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

  -- Allenatori: prima l'esito dei cambi chiesti (un allenatore appena preso può ritirarsi nello stesso turno, e con
  -- lui sparisce la richiesta), poi i ritirati, poi quelli cambiati o nuovi
  if p_payload ? 'coach_requests' then
    update public.coach_requests q
    set status = x.status
    from jsonb_populate_recordset(null::public.coach_requests, p_payload -> 'coach_requests') x
    where q.id = x.id and q.league_id = v_league and q.status = 'pending';
    get diagnostics v_count = row_count;
    perform public.expect_rows('coach_requests', v_count, p_payload -> 'coach_requests');
  end if;
  if p_payload ? 'coaches_removed' then
    delete from public.coaches c
    where c.league_id = v_league
      and c.id in (select (jsonb_array_elements_text(p_payload -> 'coaches_removed'))::uuid);
    get diagnostics v_count = row_count;
    perform public.expect_rows('coaches_removed', v_count, p_payload -> 'coaches_removed');
  end if;
  if p_payload ? 'coaches' then
    insert into public.coaches as c (id, league_id, team_id, first_name, last_name, nationality, age, philosophy,
      traits, ratings, salaries, since, pressure, idle_seasons)
    select x.id, v_league, x.team_id, x.first_name, x.last_name, x.nationality, x.age, x.philosophy, x.traits,
      x.ratings, coalesce(x.salaries, '{}'), x.since, coalesce(x.pressure, 0), coalesce(x.idle_seasons, 0)
    from jsonb_populate_recordset(null::public.coaches, p_payload -> 'coaches') x
    where x.team_id is null
      or exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league)
    on conflict (id) do update set
      team_id = excluded.team_id, first_name = excluded.first_name, last_name = excluded.last_name,
      nationality = excluded.nationality, age = excluded.age, philosophy = excluded.philosophy,
      traits = excluded.traits, ratings = excluded.ratings, salaries = excluded.salaries, since = excluded.since,
      pressure = excluded.pressure, idle_seasons = excluded.idle_seasons
    where c.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('coaches', v_count, p_payload -> 'coaches');
  end if;
  if p_payload ? 'coach_buyouts' then
    delete from public.coach_buyouts where league_id = v_league;
    insert into public.coach_buyouts (league_id, team_id, coach_id, coach_name, salaries)
    select v_league, x.team_id, x.coach_id, x.coach_name, x.salaries
    from jsonb_populate_recordset(null::public.coach_buyouts, p_payload -> 'coach_buyouts') x
    where exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('coach_buyouts', v_count, p_payload -> 'coach_buyouts');
  end if;
  if p_payload ? 'team_expectations' then
    update public.teams t
    set expected_wins = x.expected_wins
    from jsonb_populate_recordset(null::public.teams, p_payload -> 'team_expectations') x
    where t.id = x.id and t.league_id = v_league;
    get diagnostics v_count = row_count;
    perform public.expect_rows('team_expectations', v_count, p_payload -> 'team_expectations');
  end if;
  -- RFA: diritti delle squadre (offerte di qualifica aperte) e offerte in attesa di pareggio, sempre per intero
  if p_payload ? 'restricted' then
    delete from public.restricted_rights where league_id = v_league;
    insert into public.restricted_rights (player_id, league_id, team_id, qualifying_offer)
    select x.player_id, v_league, x.team_id, x.qualifying_offer
    from jsonb_populate_recordset(null::public.restricted_rights, p_payload -> 'restricted') x
    where exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('restricted', v_count, p_payload -> 'restricted');
  end if;
  if p_payload ? 'offer_sheets' then
    delete from public.offer_sheets where league_id = v_league;
    insert into public.offer_sheets (player_id, league_id, team_id, rights_team_id, salaries)
    select x.player_id, v_league, x.team_id, x.rights_team_id, x.salaries
    from jsonb_populate_recordset(null::public.offer_sheets, p_payload -> 'offer_sheets') x
    where exists (select 1 from public.players p where p.id = x.player_id and p.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.team_id and t.league_id = v_league)
      and exists (select 1 from public.teams t where t.id = x.rights_team_id and t.league_id = v_league);
    get diagnostics v_count = row_count;
    perform public.expect_rows('offer_sheets', v_count, p_payload -> 'offer_sheets');
  end if;
  return v_next;
end;
$$;

-- Come in 20261108090000_turn_days.sql: nei turni del draft gioca solo chi deve scegliere
create or replace function private.team_readiness(p_round uuid)
returns table (team_id uuid, state text)
language sql stable security definer set search_path = ''
as $$
  select t.id,
    case
      when r.kind in ('play-in', 'playoffs') and not exists (
        select 1 from public.games g
        where g.season_id = r.season_id and g.round_number = r.number
          and t.id in (g.home_team_id, g.away_team_id)
      ) then 'out'
      -- Draft dal vivo: il turno è di chi deve scegliere
      when r.kind = 'offseason' and r.stage = 'draft' and r.draft_team_id is not null and r.draft_team_id <> t.id
        then 'out'
      when f.ready and f.auto then 'rest'
      when f.ready then 'ready'
      when private.coach_active(t.id, r.id) then
        case
          when exists (
            select 1 from public.alerts a where a.team_id = t.id and a.blocking and a.status = 'open'
          ) then 'blocked'
          else 'coach'
        end
      else 'waiting'
    end
  from public.rounds r
  join public.teams t on t.league_id = r.league_id and t.owner_id is not null
  left join public.ready_flags f on f.round_id = r.id and f.team_id = t.id
  where r.id = p_round
$$;

-- Come in 20261108090000_turn_days.sql: in preparazione il Pronto aspetta una rosa nei limiti
create or replace function public.set_ready(p_team uuid, p_ready boolean default true, p_round uuid default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_issue text;
begin
  if not private.owns_team(p_team) then
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
  if p_round is not null and p_round <> v_round.id then
    raise exception 'Il turno è cambiato: guarda il nuovo turno prima di confermare';
  end if;
  if v_round.state <> 'open' then
    raise exception 'Il turno è già in chiusura: non si accettano modifiche';
  end if;
  -- Preparazione: il Pronto aspetta che la rosa sia nei limiti (tagli e offerte del turno compresi)
  if p_ready and v_round.kind = 'offseason' and v_round.stage = 'preparation' then
    v_issue := private.roster_issue(p_team);
    if v_issue is not null then
      raise exception '%', v_issue;
    end if;
  end if;
  insert into public.ready_flags (round_id, team_id, league_id, ready, auto, updated_at)
  values (v_round.id, p_team, v_round.league_id, p_ready, false, now())
  on conflict (round_id, team_id) do update set ready = excluded.ready, auto = false, updated_at = excluded.updated_at;
  if p_ready then
    update public.leagues set paused = false
    where id = v_round.league_id and paused and auto_paused_at is not null;
  end if;
  if p_ready and private.round_due(v_round.id) is not null then
    perform private.kick('advance-turn', jsonb_build_object('league_id', v_round.league_id));
  end if;
  return public.round_all_ready(v_round.id);
end;
$$;

-- Come in 20261108110000_coaches.sql, con scelta al draft del turno, RFA, offerte da pareggiare e trattative
create or replace function public.league_state(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'seed', l.seed, 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'seed', r.seed, 'close_reason', r.close_reason, 'stage', r.stage, 'day', r.day,
                'draft_pick', r.draft_pick, 'draft_team_id', r.draft_team_id)
              from public.rounds r where r.id = l.current_round_id),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]') from public.teams t where t.league_id = l.id),
    'players', (
      select coalesce(jsonb_agg(to_jsonb(p) || jsonb_build_object('hidden', h.hidden) order by p.id), '[]')
      from public.players p join public.player_hidden h on h.player_id = p.id
      where p.league_id = l.id and not p.retired
    ),
    'contracts', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.player_id), '[]')
      from public.contracts c where c.league_id = l.id
    ),
    'dead_money', (
      select coalesce(jsonb_agg(to_jsonb(d) order by d.id), '[]')
      from public.dead_money d where d.league_id = l.id
    ),
    'injuries', (
      select coalesce(jsonb_agg(to_jsonb(i) order by i.player_id), '[]')
      from public.injuries i where i.league_id = l.id
    ),
    'draft_picks', (
      select coalesce(jsonb_agg(to_jsonb(k) order by k.id), '[]') from public.draft_picks k
      where k.league_id = l.id and k.position is null
    ),
    'draft_swaps', (
      select coalesce(jsonb_agg(to_jsonb(w) order by w.id), '[]') from public.draft_swaps w
      where w.league_id = l.id and w.result is null
    ),
    'team_settings', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.team_id), '[]')
      from public.team_settings x where x.league_id = l.id
    ),
    'games', (
      select coalesce(jsonb_agg(jsonb_build_object('id', g.id, 'round_number', g.round_number, 'kind', g.kind,
        'home_team_id', g.home_team_id, 'away_team_id', g.away_team_id, 'home_score', g.home_score,
        'away_score', g.away_score, 'overtimes', g.overtimes, 'series_id', g.series_id, 'day', g.day)
        order by g.round_number, g.id), '[]')
      from public.games g where g.season_id = l.current_season_id
    ),
    'playoff_series', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.round, x.conference nulls last, x.id), '[]')
      from public.playoff_series x where x.season_id = l.current_season_id
    ),
    'coach', (
      select coalesce(jsonb_agg(t.id order by t.id), '[]')
      from public.teams t
      where t.league_id = l.id and t.owner_id is not null and private.coach_active(t.id, l.current_round_id)
    ),
    'coach_delegations', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', d.team_id, 'active', d.active,
        'until_round', d.until_round, 'until_at', d.until_at, 'until_phase_end', d.until_phase_end)
        order by d.team_id), '[]')
      from public.coach_delegations d where d.league_id = l.id
    ),
    'alerts', (
      select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'team_id', a.team_id, 'kind', a.kind,
        'blocking', a.blocking, 'status', a.status, 'round_id', a.round_id, 'payload', a.payload)
        order by a.created_at, a.id), '[]')
      from public.alerts a
      where a.league_id = l.id and (a.status = 'open' or a.round_id = l.current_round_id)
    ),
    'trade_offers', (
      select coalesce(jsonb_agg(to_jsonb(o) order by coalesce(o.responded_at, o.created_at), o.id), '[]')
      from public.trade_offers o where o.league_id = l.id and o.status in ('pending', 'accepted')
    ),
    'bids', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.created_at, b.id), '[]')
      from public.free_agent_bids b where b.league_id = l.id and b.status = 'pending'
    ),
    'requests', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at, q.id), '[]')
      from public.roster_requests q where q.league_id = l.id and q.status = 'pending'
    ),
    'releases', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', q.player_id, 'team_id', q.team_id)
        order by q.created_at, q.id), '[]')
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
      select coalesce(jsonb_agg(to_jsonb(x) order by x.team_id), '[]')
      from public.draft_lists x where x.league_id = l.id
    ),
    'coaches', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]') from public.coaches c where c.league_id = l.id
    ),
    'coach_buyouts', (
      select coalesce(jsonb_agg(to_jsonb(b) order by b.id), '[]')
      from public.coach_buyouts b where b.league_id = l.id
    ),
    'coach_requests', (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at, q.id), '[]')
      from public.coach_requests q where q.league_id = l.id and q.status = 'pending'
    ),
    'restricted', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.player_id), '[]')
      from public.restricted_rights x where x.league_id = l.id
    ),
    'offer_sheets', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.player_id), '[]')
      from public.offer_sheets x where x.league_id = l.id
    ),
    'renewal_talks', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.player_id), '[]')
      from public.renewal_talks x where x.league_id = l.id and x.season_id = l.current_season_id
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- Come in 20261108110000_coaches.sql, con l'ultimo stipendio, i valori nascosti e la trattativa del giocatore dell'azione, RFA e offerte da pareggiare
create or replace function public.market_state(p_league uuid, p_player uuid default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    -- Il seed della lega non serve ai controlli
    'league', jsonb_build_object('id', l.id, 'seed', '', 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'stage', r.stage, 'day', r.day, 'draft_pick', r.draft_pick, 'draft_team_id', r.draft_team_id)
              from public.rounds r where r.id = l.current_round_id),
    'teams', (select coalesce(jsonb_agg(to_jsonb(t) order by t.code), '[]') from public.teams t where t.league_id = l.id),
    'players', (
      select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'team_id', p.team_id,
        'draft_prospect', p.draft_prospect, 'first_name', p.first_name, 'last_name', p.last_name, 'role', p.role,
        'secondary_role', p.secondary_role, 'age', p.age, 'years_in_league', p.years_in_league,
        'morale', p.morale, 'scouted_potential', p.scouted_potential,
        'ratings', case when p.id = p_player then p.ratings end)
        -- Valori nascosti solo del giocatore dell'azione: servono alla trattativa del rinnovo, non escono dal server
        || case when p.id = p_player
             then jsonb_build_object('hidden', (select h.hidden from public.player_hidden h where h.player_id = p.id))
             else '{}'::jsonb end
        order by p.id), '[]')
      from public.players p
      where p.league_id = l.id and not p.retired and (p.team_id is not null or p.id = p_player)
    ),
    'contracts', (
      select coalesce(jsonb_agg(jsonb_build_object('player_id', c.player_id, 'team_id', c.team_id, 'type', c.type,
        'salaries', c.salaries, 'options', c.options, 'guaranteed', c.guaranteed)
        || case when c.last_salary is null then '{}'::jsonb else jsonb_build_object('last_salary', c.last_salary) end
        order by c.player_id), '[]')
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
    ),
    'coaches', (
      select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]') from public.coaches c where c.league_id = l.id
    ),
    'restricted', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.player_id), '[]')
      from public.restricted_rights x where x.league_id = l.id
    ),
    'offer_sheets', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.player_id), '[]')
      from public.offer_sheets x where x.league_id = l.id
    ),
    'renewal_talks', (
      select coalesce(jsonb_agg(to_jsonb(x) order by x.player_id), '[]')
      from public.renewal_talks x
      where x.league_id = l.id and x.season_id = l.current_season_id and x.player_id = p_player
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- Come in 20261108110000_coaches.sql: offerte che restano, trattativa dei rinnovi, scelta al draft, opzioni, qualifiche e pareggi
create or replace function public.market_write(p_league uuid, p_round uuid, p_team uuid, p_action jsonb)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_kind text := p_action ->> 'kind';
  v_id uuid;
  v_to uuid;
  v_player uuid;
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
  -- Un'offerta per giocatore e squadra: resta da un turno all'altro (free agency) e si cambia rilanciando
  when 'bid' then
    insert into public.free_agent_bids as b (league_id, round_id, team_id, player_id, salaries, status)
    values (p_league, p_round, p_team, (p_action ->> 'player_id')::uuid,
      array(select (jsonb_array_elements_text(p_action -> 'salaries'))::bigint), 'pending')
    on conflict (team_id, player_id) where status = 'pending'
      do update set salaries = excluded.salaries, round_id = excluded.round_id
    returning id into v_id;

  when 'withdraw_bid' then
    update public.free_agent_bids set status = 'withdrawn'
    where id = (p_action ->> 'bid_id')::uuid and team_id = p_team and status = 'pending'
    returning id into v_id;

  when 'propose_trade' then
    v_to := (p_action ->> 'to_team_id')::uuid;
    if not exists (select 1 from public.teams t where t.id = v_to and t.league_id = p_league) or v_to = p_team then
      raise exception 'Squadra non valida per lo scambio';
    end if;
    if (
      select count(*) from public.trade_offers o
      where o.from_team_id = p_team and o.to_team_id = v_to and o.created_round_id = p_round
    ) >= private.max_proposals_per_pair() then
      raise exception 'Hai già fatto % proposte a questa squadra in questo turno: riprova nel prossimo',
        private.max_proposals_per_pair();
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

  when 'release' then
    insert into public.roster_requests (league_id, team_id, round_id, player_id, kind, payload)
    values (p_league, p_team, p_round, (p_action ->> 'player_id')::uuid, v_kind, '{}')
    returning id into v_id;

  -- Rinnovo concordato (la richiesta, o un'offerta accettata nella trattativa): sostituisce quello di prima
  when 'renew' then
    update public.roster_requests set status = 'withdrawn'
    where team_id = p_team and round_id = p_round and player_id = (p_action ->> 'player_id')::uuid
      and kind = 'renew' and status = 'pending';
    insert into public.roster_requests (league_id, team_id, round_id, player_id, kind, payload)
    values (p_league, p_team, p_round, (p_action ->> 'player_id')::uuid, v_kind,
      jsonb_build_object('salaries', p_action -> 'salaries', 'options', coalesce(p_action -> 'options', '[]')))
    returning id into v_id;

  -- Trattativa del rinnovo: la risposta del giocatore l'ha già data il motore (funzione market). Si salva com'è
  -- andata, il morale perso per un'offerta offensiva e, se ha accettato, il rinnovo
  when 'renew_offer' then
    v_player := (p_action ->> 'player_id')::uuid;
    if not exists (
      select 1 from public.players p where p.id = v_player and p.league_id = p_league and p.team_id = p_team
    ) then
      raise exception 'Il giocatore non è della tua squadra';
    end if;
    insert into public.renewal_talks as k (player_id, season_id, league_id, team_id, refusals, counter, updated_at)
    select v_player, l.current_season_id, p_league, p_team, coalesce((p_action ->> 'refusals')::smallint, 0),
      p_action -> 'counter', now()
    from public.leagues l where l.id = p_league
    on conflict (player_id, season_id) do update set
      team_id = excluded.team_id, refusals = excluded.refusals, counter = excluded.counter, updated_at = now();
    if coalesce((p_action ->> 'morale_penalty')::numeric, 0) > 0 then
      update public.players
      set morale = greatest(0, morale - least((p_action ->> 'morale_penalty')::numeric, 10))
      where id = v_player;
    end if;
    if (p_action ->> 'accepted')::boolean then
      update public.roster_requests set status = 'withdrawn'
      where team_id = p_team and round_id = p_round and player_id = v_player and kind = 'renew' and status = 'pending';
      insert into public.roster_requests (league_id, team_id, round_id, player_id, kind, payload)
      values (p_league, p_team, p_round, v_player, 'renew',
        jsonb_build_object('salaries', p_action -> 'salaries', 'options', coalesce(p_action -> 'options', '[]')))
      returning id into v_id;
    else
      v_id := v_player;
    end if;

  -- Scelta al draft, opzione della squadra, offerta di qualifica, pareggio di un RFA: una per giocatore (la scelta al
  -- draft una per squadra), l'ultima sostituisce quella di prima
  when 'draft_pick', 'option', 'qualify', 'match' then
    update public.roster_requests set status = 'withdrawn'
    where team_id = p_team and round_id = p_round and kind = v_kind and status = 'pending'
      and (v_kind = 'draft_pick' or player_id = (p_action ->> 'player_id')::uuid);
    insert into public.roster_requests (league_id, team_id, round_id, player_id, kind, payload)
    values (p_league, p_team, p_round, (p_action ->> 'player_id')::uuid, v_kind, coalesce(p_action -> 'payload', '{}'))
    returning id into v_id;

  when 'withdraw_request' then
    update public.roster_requests set status = 'withdrawn'
    where id = (p_action ->> 'request_id')::uuid and team_id = p_team and round_id = p_round and status = 'pending'
    returning id into v_id;

  -- Cambio di allenatore: uno per squadra e turno, il nuovo sostituisce quello chiesto prima
  when 'hire_coach' then
    if not exists (
      select 1 from public.coaches c
      where c.id = (p_action ->> 'coach_id')::uuid and c.league_id = p_league and c.team_id is null
    ) then
      raise exception 'Allenatore non trovato o non più libero';
    end if;
    update public.coach_requests set status = 'withdrawn'
    where team_id = p_team and round_id = p_round and status = 'pending';
    insert into public.coach_requests (league_id, team_id, round_id, coach_id)
    values (p_league, p_team, p_round, (p_action ->> 'coach_id')::uuid)
    returning id into v_id;

  when 'withdraw_coach' then
    update public.coach_requests set status = 'withdrawn'
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

-- Come in 20261108090000_turn_days.sql, con la scelta al draft del turno
create or replace function public.turn_status(p_league uuid) returns jsonb
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
        'closing_started_at', r.closing_started_at, 'attempts', r.attempts, 'failed_at', r.failed_at, 'day', r.day,
        'draft_pick', r.draft_pick, 'draft_team_id', r.draft_team_id,
        'season_year', (select s.year from public.seasons s where s.id = r.season_id))
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
        'overtimes', g.overtimes, 'kind', g.kind, 'day', g.day,
        'season_year', (select s.year from public.seasons s where s.id = g.season_id))
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
      where r.id = l.current_round_id and r.kind in ('regular', 'play-in', 'playoffs')
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

-- Come in 20261108110000_coaches.sql: anche la trattativa di un rinnovo è attività del manager
create or replace function private.round_idle(p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  with r as (
    select r.id, r.league_id, r.created_at as since, coalesce(r.closing_started_at, now()) as until
    from public.rounds r where r.id = p_round
  ),
  human as (
    select t.id from public.teams t join r on t.league_id = r.league_id where t.owner_id is not null
  )
  select not (
    exists (
      select 1 from public.ready_flags f join r on f.round_id = r.id
      where f.team_id in (select id from human) and not f.auto
    )
    or exists (
      select 1 from public.trade_offers o join r on o.league_id = r.league_id
      where (o.created_round_id = r.id and o.from_team_id in (select id from human))
         or (o.responded_at > r.since and o.responded_at < r.until
             and (o.from_team_id in (select id from human) or o.to_team_id in (select id from human)))
    )
    or exists (
      select 1 from public.free_agent_bids b join r on b.round_id = r.id where b.team_id in (select id from human)
    )
    or exists (
      select 1 from public.roster_requests q join r on q.round_id = r.id where q.team_id in (select id from human)
    )
    or exists (
      select 1 from public.coach_requests q join r on q.round_id = r.id where q.team_id in (select id from human)
    )
    or exists (
      select 1 from public.renewal_talks k join r on k.league_id = r.league_id
      where k.team_id in (select id from human) and k.updated_at > r.since and k.updated_at < r.until
    )
    or exists (
      select 1 from public.team_settings s join r on s.league_id = r.league_id
      where s.team_id in (select id from human) and s.updated_at > r.since and s.updated_at < r.until
    )
    or exists (
      select 1 from public.coach_delegations c join r on c.league_id = r.league_id
      where c.team_id in (select id from human) and c.updated_at > r.since and c.updated_at < r.until
    )
    or exists (
      select 1 from public.draft_lists d join r on d.league_id = r.league_id
      where d.team_id in (select id from human) and d.updated_at > r.since and d.updated_at < r.until
    )
    or exists (
      select 1 from public.trade_block b join r on b.league_id = r.league_id
      where b.team_id in (select id from human) and b.created_at > r.since and b.created_at < r.until
    )
    or exists (
      select 1 from public.alerts a join r on a.league_id = r.league_id
      where a.team_id in (select id from human) and a.payload ? 'answered_at'
        and (a.payload ->> 'answered_at')::timestamptz > r.since
        and (a.payload ->> 'answered_at')::timestamptz < r.until
    )
  )
  from r
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.roster_issue(uuid) from public, anon, authenticated;
