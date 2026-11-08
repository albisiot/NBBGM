-- NBBGM: un turno = un giorno, Fase 2 (server e database).
--
-- Dalla Fase 1 il motore gioca la regular season a giorni, come il calendario NBA: un turno è un giorno con partite
-- (da 2 a 15), circa 164 turni, e in play-in e playoff un turno è un giorno di partite. Qui:
--   - rounds.day e games.day: giorni dall'apertura della stagione (il giorno 0 è il martedì tra il 20 e il 26
--     ottobre; null nei turni di offseason). Le date le ricavano motore e app dall'anno della stagione;
--   - chi riposa parte pronto: nei turni di regular season le squadre umane senza partita e senza avvisi bloccanti
--     aperti ricevono un Pronto automatico (ready_flags.auto), che possono togliere per fare mercato o altro. Con una
--     decisione aperta si risponde e poi si preme Pronto. Lo stato della squadra è 'rest' e conta come pronta;
--   - il turno si chiude subito solo con un Pronto premuto a mano: se sono tutti a riposo o con l'allenatore si
--     chiude al ritmo massimo, così chi riposa ha almeno quel tempo per togliere il Pronto;
--   - niente notifica di turno nuovo a chi riposa senza decisioni;
--   - il Pronto automatico non è un'attività umana per la pausa delle leghe abbandonate, e un giorno di riposo senza
--     nessuno non azzera il conto dei turni senza nessuno;
--   - letture con il giorno: league_state, market_state (la trade deadline è un giorno), turn_status (con le squadre
--     che giocano anche in regular season), my_leagues_status, push_take.
-- Le leghe create prima sono di prova e si eliminano: il codice ha un solo formato.

alter table public.rounds add column day integer check (day >= 0);
alter table public.games add column day integer check (day >= 0);
-- Pronto messo dal server a chi riposa: diventa false appena il manager tocca il Pronto
alter table public.ready_flags add column auto boolean not null default false;

-- Come le altre colonne di rounds e games (20261106090100_round_seeds.sql): il client legge tutto tranne seed
grant select (day) on public.rounds to authenticated;
grant select (day) on public.games to authenticated;

-- ---------------------------------------------------------------- stato delle squadre nel turno

/*
  Come in 20261106110000_team_readiness.sql, più
    rest   in regular season, senza partita nel turno, con il Pronto messo dal server (ready_flags.auto): conta
           come pronta. Se il manager toglie il Pronto (o lo rimette a mano) il Pronto non è più automatico.
*/
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

/*
  Pronto automatico di chi riposa: nei turni di regular season le squadre umane senza partita e senza avvisi
  bloccanti aperti partono pronte. Con un avviso bloccante (per esempio una proposta di scambio ricevuta) il
  manager risponde e poi preme Pronto. p_team: solo quella squadra (chi entra nella lega a turno aperto).
*/
create function private.auto_ready(p_round uuid, p_team uuid default null) returns void
language sql volatile security definer set search_path = ''
as $$
  insert into public.ready_flags (round_id, team_id, league_id, ready, auto, updated_at)
  select r.id, t.id, r.league_id, true, true, now()
  from public.rounds r
  join public.teams t on t.league_id = r.league_id and t.owner_id is not null
  where r.id = p_round and r.kind = 'regular' and r.state = 'open'
    and (p_team is null or t.id = p_team)
    and not exists (
      select 1 from public.games g
      where g.season_id = r.season_id and g.round_number = r.number and t.id in (g.home_team_id, g.away_team_id)
    )
    and not exists (
      select 1 from public.alerts a where a.team_id = t.id and a.blocking and a.status = 'open'
    )
  on conflict (round_id, team_id) do nothing
$$;

-- Chi prende una squadra a turno aperto (ingresso nella lega) e quel giorno riposa parte pronto come gli altri
create function private.team_owner_ready() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.owner_id is not null and old.owner_id is distinct from new.owner_id then
    perform private.auto_ready(l.current_round_id, new.id)
    from public.leagues l
    where l.id = new.league_id and l.current_round_id is not null;
  end if;
  return null;
end;
$$;

create trigger teams_owner_ready after update of owner_id on public.teams
  for each row execute function private.team_owner_ready();

-- ---------------------------------------------------------------- chiusura del turno

-- Come in 20261105170000_offseason.sql, ma il turno si chiude subito solo con un Pronto premuto a mano: se sono
-- tutti a riposo (Pronto automatico) o con l'allenatore si chiude al ritmo massimo, così chi riposa ha almeno quel
-- tempo per togliere il Pronto
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
      where f.round_id = r.id and f.ready and not f.auto
    ) then 'ready'
    when now() >= r.created_at + make_interval(secs => l.max_pace_seconds) then 'coach'
    else null
  end
  from public.rounds r
  join public.leagues l on l.id = r.league_id
  where r.id = p_round
$$;

-- Come in 20261107110000_league_limits.sql: il Pronto automatico di chi riposa non è un'attività umana
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

-- Come in 20261107110000_league_limits.sql: un turno chiuso al ritmo massimo senza attività in cui qualcuno è pronto
-- solo perché riposa non azzera il conto dei turni senza nessuno (lo azzerano i turni chiusi dagli allenatori di
-- tutti, voluti, e quelli con attività)
create or replace function public.try_close_round(p_league uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_paused boolean;
  v_idle integer;
  v_reason text;
  v_reclaimed boolean := false;
  v_commissioner_team uuid;
begin
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    return null;
  end if;
  select paused, idle_rounds into v_paused, v_idle from public.leagues where id = p_league;
  if v_round.state = 'closing' then
    if v_round.failed_at is not null or v_round.closing_started_at >= now() - interval '5 minutes' or v_paused then
      return null;
    end if;
    if v_round.last_error_at is null or v_round.last_error_at < v_round.closing_started_at then
      update public.rounds
      set last_error = 'Simulazione interrotta senza un errore: probabilmente ha superato il tempo o la memoria '
                       || 'della Edge Function (tentativo ' || v_round.attempts || ')',
          last_error_at = now()
      where id = v_round.id;
    end if;
    if v_round.attempts >= private.max_round_attempts() then
      update public.rounds set failed_at = now() where id = v_round.id;
      return null;
    end if;
    update public.rounds set closing_started_at = now(), attempts = attempts + 1 where id = v_round.id;
    v_reason := v_round.close_reason;
    v_reclaimed := true;
  else
    v_reason := private.round_due(v_round.id);
    if v_reason is null then
      return null;
    end if;
    if v_reason = 'deadline' and private.round_idle(v_round.id) then
      if v_idle >= private.idle_rounds_before_pause() then
        -- Lega abbandonata: si ferma qui, il turno resta aperto
        update public.leagues set paused = true, auto_paused_at = now(), idle_rounds = 0 where id = p_league;
        select t.id into v_commissioner_team
        from public.leagues l
        join public.teams t on t.league_id = l.id and t.owner_id = l.commissioner_id
        where l.id = p_league;
        if v_commissioner_team is not null then
          insert into public.alerts (league_id, team_id, kind, blocking, payload, round_id)
          values (p_league, v_commissioner_team, 'league_paused', false,
            jsonb_build_object('rounds', v_idle), v_round.id);
        end if;
        return null;
      end if;
      update public.leagues set idle_rounds = idle_rounds + 1 where id = p_league;
    elsif v_reason = 'coach' and private.round_idle(v_round.id) and exists (
      select 1 from public.teams t
      where t.league_id = p_league and t.owner_id is not null and not private.coach_active(t.id, v_round.id)
    ) then
      -- Giorno di riposo senza nessuno (chi non ha l'allenatore è pronto solo perché riposa): il conto resta
      -- com'è, altrimenti una lega abbandonata non si fermerebbe mai
      null;
    elsif v_idle <> 0 then
      update public.leagues set idle_rounds = 0 where id = p_league;
    end if;
    update public.rounds
    set state = 'closing', closing_started_at = now(), seed = coalesce(seed, gen_random_uuid()::text),
        close_reason = v_reason, attempts = 1, failed_at = null
    where id = v_round.id
    returning * into v_round;
  end if;
  return jsonb_build_object('round_id', v_round.id, 'number', v_round.number, 'kind', v_round.kind,
    'seed', v_round.seed, 'reason', v_reason, 'reclaimed', v_reclaimed);
end;
$$;

-- Come in 20261107110000_league_limits.sql: un Pronto dato o tolto dal manager non è più automatico (chi riposa e
-- preme Pronto fa partire il turno senza aspettare il ritmo massimo)
create or replace function public.set_ready(p_team uuid, p_ready boolean default true, p_round uuid default null)
returns boolean
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
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

-- Come in 20261106170100_stuck_rounds_members.sql: con i Pronto da rifare tornano quelli automatici di chi riposa
create or replace function public.reopen_round(p_league uuid, p_new_seed boolean default false,
  p_withdraw_market boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_minutes integer;
begin
  if not private.is_member(p_league) then
    raise exception 'Non fai parte di questa lega' using errcode = '42501';
  end if;
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    raise exception 'La lega non ha un turno in corso';
  end if;
  if not private.is_commissioner(p_league)
     and (v_round.state <> 'closing' or v_round.failed_at is null
          or v_round.failed_at > now() - make_interval(hours => private.member_reopen_hours())) then
    raise exception 'Solo il commissario può sbloccare il turno, o qualsiasi membro % ore dopo il blocco',
      private.member_reopen_hours() using errcode = '42501';
  end if;
  select deadline_minutes into v_minutes from public.leagues where id = p_league;
  if v_round.state <> 'closing' then
    raise exception 'Il turno non è bloccato';
  end if;
  if v_round.failed_at is null and v_round.closing_started_at >= now() - interval '5 minutes' then
    raise exception 'La simulazione è in corso: se non finisce, si può sbloccare dopo 5 minuti';
  end if;
  update public.rounds
  set state = 'open', closing_started_at = null, close_reason = null, forced_at = null, attempts = 0,
      failed_at = null, last_error = null, last_error_at = null, created_at = now(),
      seed = case when p_new_seed then null else seed end,
      deadline = case when v_minutes is null then null else now() + make_interval(mins => v_minutes) end
  where id = v_round.id;
  delete from public.ready_flags where round_id = v_round.id;
  perform private.auto_ready(v_round.id);
  if p_withdraw_market then
    update public.free_agent_bids set status = 'withdrawn' where league_id = p_league and status = 'pending';
    update public.roster_requests set status = 'withdrawn' where league_id = p_league and status = 'pending';
    -- Con le proposte di scambio decadono gli avvisi di chi le ha ricevute
    with offers as (
      update public.trade_offers
      set status = 'withdrawn', responded_at = coalesce(responded_at, now())
      where league_id = p_league and status in ('pending', 'accepted')
      returning id
    )
    update public.alerts a
    set status = 'expired'
    from offers o
    where a.league_id = p_league and a.kind = 'trade_offer' and a.status = 'open'
      and a.payload ->> 'trade_id' = o.id::text;
  end if;
end;
$$;

-- ---------------------------------------------------------------- notifiche

-- Come in 20261106170400_push_throttle.sql: niente "turno nuovo" a chi riposa senza decisioni (con una decisione
-- arriva anche l'avviso)
create or replace function private.push_round() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if old.current_round_id is not null and new.current_round_id is not null
     and new.current_round_id <> old.current_round_id then
    perform private.enqueue_push(t.owner_id, new.id, 'turn', new.current_round_id, null, null)
    from public.teams t
    join private.team_readiness(new.current_round_id) x on x.team_id = t.id
    where t.league_id = new.id and t.owner_id is not null and x.state not in ('out', 'rest')
      and not private.coach_active(t.id, new.current_round_id);
  end if;
  return null;
end;
$$;

-- Come in 20261106170400_push_throttle.sql, con il giorno del turno e l'anno della stagione (la data nel testo)
create or replace function public.push_take(p_limit integer) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v jsonb;
begin
  with taken as (
    delete from public.push_outbox o
    where o.id in (
      select x.id from public.push_outbox x order by x.id
      limit greatest(1, least(coalesce(p_limit, 500), 1000))
      for update skip locked
    )
    returning o.*
  )
  select jsonb_build_object(
    'notifications', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'user_id', t.user_id, 'league_id', t.league_id,
        'kind', t.kind, 'detail', t.detail, 'pick', t.pick, 'league_name', l.name, 'round_kind', r.kind,
        'round_number', r.number, 'round_stage', r.stage, 'round_day', r.day, 'season_year', s.year) order by t.id)
      from taken t
      left join public.leagues l on l.id = t.league_id
      left join public.rounds r on r.id = t.round_id
      left join public.seasons s on s.id = r.season_id
    ), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('user_id', s.user_id, 'endpoint', s.endpoint, 'p256dh', s.p256dh,
        'auth', s.auth, 'failures', s.failures) order by s.created_at, s.id)
      from public.push_subscriptions s
      where s.user_id in (select t.user_id from taken t)
    ), '[]'::jsonb),
    'badges', coalesce((
      select jsonb_object_agg(u.user_id, (
        select count(*) from public.alerts a join public.teams tm on tm.id = a.team_id
        where tm.owner_id = u.user_id and a.status = 'open' and a.blocking
      ))
      from (select distinct t.user_id from taken t) u
    ), '{}'::jsonb)
  ) into v;
  return v;
end;
$$;

-- ---------------------------------------------------------------- scrittura del turno

/*
  Come in 20261105090200_turns.sql, più:
    games         con day (giorno della partita)
    next_round    { number, kind, stage?, day? }: stage dei turni di offseason (prima lo scriveva apply_round), day del
                  turno (giorni dall'apertura della stagione; null in offseason)
    new_games     righe di games della stagione nuova, con day (prima le scriveva apply_round, dopo l'apertura del
                  turno): ora prima degli avvisi e del Pronto automatico di chi riposa
  Alla fine il Pronto automatico di chi riposa nel turno che si apre (private.auto_ready).
*/
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
    insert into public.transactions (league_id, season_year, round_number, type, text)
    select v_league, x.season_year, x.round_number, x.type, x.text
    from jsonb_populate_recordset(null::public.transactions, p_payload -> 'transactions') x;
  end if;

  -- ------------------------------------------------ turno successivo (gli avvisi nuovi vi appartengono)
  update public.rounds set state = 'done', simulated_at = now() where id = p_round;
  select deadline_minutes into v_deadline from public.leagues where id = v_league;
  insert into public.rounds (league_id, season_id, number, kind, stage, day, deadline)
  values (
    v_league,
    coalesce((v_next ->> 'season_id')::uuid, v_new_season, v_season),
    (v_next ->> 'number')::integer,
    v_next ->> 'kind',
    v_next ->> 'stage',
    (v_next ->> 'day')::integer,
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

-- Come in 20261106130000_season_history.sql: stage e calendario della stagione nuova li scrive apply_turn
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
    p_payload - 'requests' - 'new_trades' - 'draft_order' - 'draft_prospects' - 'player_seasons');
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

-- Come in 20261105120000_initial_draft.sql: giorno del primo turno e delle partite, Pronto automatico di chi
-- riposa il primo giorno
create or replace function public.insert_league(p_league jsonb) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_league uuid := (p_league -> 'league' ->> 'id')::uuid;
  v_commissioner uuid := (p_league -> 'league' ->> 'commissioner_id')::uuid;
  v_code text := coalesce(
    nullif(private.normalize_code(p_league -> 'league' ->> 'invite_code'), ''),
    private.new_invite_code()
  );
  v_season uuid := (p_league -> 'season' ->> 'id')::uuid;
  v_round uuid := (p_league -> 'round' ->> 'id')::uuid;
begin
  if v_league is null or v_commissioner is null or v_season is null or v_round is null then
    raise exception 'insert_league: mancano gli id di lega, commissario, stagione o turno';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(p_league -> 'teams') t where (t ->> 'owner_id')::uuid = v_commissioner
  ) then
    raise exception 'insert_league: il commissario deve guidare una squadra';
  end if;

  insert into public.leagues (id, name, invite_code, commissioner_id, deadline_minutes, max_pace_seconds,
    roster_mode, draft_mode, rookie_source, seed, talent_reference)
  select v_league, x.name, v_code, v_commissioner, x.deadline_minutes, coalesce(x.max_pace_seconds, 60),
    coalesce(x.roster_mode, 'real'), coalesce(x.draft_mode, 'list'), coalesce(x.rookie_source, 'generated'),
    x.seed, coalesce(x.talent_reference, 0)
  from jsonb_populate_record(null::public.leagues, p_league -> 'league') x;

  insert into public.league_members (league_id, user_id, role)
  select v_league, v_commissioner, 'commissioner'
  union
  select v_league, x.user_id, 'manager'
  from jsonb_populate_recordset(null::public.league_members, coalesce(p_league -> 'members', '[]')) x
  where x.user_id <> v_commissioner;

  insert into public.seasons (id, league_id, year, phase, salary_cap, luxury_tax, first_apron, second_apron,
    minimum_team_salary, minimum_salary, rookie_scale, revenue, growth)
  select v_season, v_league, x.year, coalesce(x.phase, 'regular'), x.salary_cap, x.luxury_tax, x.first_apron,
    x.second_apron, x.minimum_team_salary, x.minimum_salary, x.rookie_scale, x.revenue, x.growth
  from jsonb_populate_record(null::public.seasons, p_league -> 'season') x;

  insert into public.teams (id, league_id, code, city, name, full_name, conference, division, owner_id, balance,
    strategy, tax_history)
  select x.id, v_league, x.code, x.city, x.name, x.full_name, x.conference, x.division, x.owner_id,
    coalesce(x.balance, 0), coalesce(x.strategy, 'middle'), coalesce(x.tax_history, '{}')
  from jsonb_populate_recordset(null::public.teams, p_league -> 'teams') x;

  insert into public.players (id, league_id, slug, team_id, first_name, last_name, nationality, role,
    secondary_role, hand, archetype, age, height_cm, wingspan_cm, weight_kg, years_in_league, ratings,
    tendencies, energy, morale, scouted_potential, two_way_games, season_stats, retired)
  select x.id, v_league, x.slug, x.team_id, x.first_name, x.last_name, x.nationality, x.role,
    x.secondary_role, x.hand, x.archetype, x.age, x.height_cm, x.wingspan_cm, x.weight_kg, x.years_in_league,
    x.ratings, x.tendencies, x.energy, x.morale, x.scouted_potential, coalesce(x.two_way_games, 0),
    coalesce(x.season_stats, '{}'), false
  from jsonb_populate_recordset(null::public.players, p_league -> 'players') x;

  insert into public.player_hidden (player_id, league_id, hidden)
  select x.player_id, v_league, x.hidden
  from jsonb_populate_recordset(null::public.player_hidden, coalesce(p_league -> 'player_hidden', '[]')) x;

  insert into public.injuries (player_id, league_id, body_part, severity, games_remaining)
  select x.player_id, v_league, x.body_part, x.severity, x.games_remaining
  from jsonb_populate_recordset(null::public.injuries, coalesce(p_league -> 'injuries', '[]')) x;

  insert into public.contracts (player_id, league_id, team_id, type, salaries, options, guaranteed)
  select x.player_id, v_league, x.team_id, x.type, x.salaries, x.options, x.guaranteed
  from jsonb_populate_recordset(null::public.contracts, coalesce(p_league -> 'contracts', '[]')) x;

  insert into public.dead_money (id, league_id, team_id, player_name, salaries)
  select coalesce(x.id, gen_random_uuid()), v_league, x.team_id, x.player_name, x.salaries
  from jsonb_populate_recordset(null::public.dead_money, coalesce(p_league -> 'dead_money', '[]')) x;

  insert into public.draft_picks (id, league_id, draft_year, round, original_team_id, owner_team_id, protection,
    deferrals)
  select x.id, v_league, x.draft_year, x.round, x.original_team_id, x.owner_team_id, x.protection,
    coalesce(x.deferrals, 0)
  from jsonb_populate_recordset(null::public.draft_picks, coalesce(p_league -> 'draft_picks', '[]')) x;

  insert into public.rounds (id, league_id, season_id, number, kind, day, deadline)
  select v_round, v_league, v_season, coalesce(x.number, 0), coalesce(x.kind, 'regular'), x.day,
    case when l.deadline_minutes is null then null else now() + make_interval(mins => l.deadline_minutes) end
  from jsonb_populate_record(null::public.rounds, p_league -> 'round') x
  join public.leagues l on l.id = v_league;

  insert into public.games (id, league_id, season_id, round_number, day, kind, home_team_id, away_team_id)
  select x.id, v_league, v_season, x.round_number, x.day, coalesce(x.kind, 'regular'), x.home_team_id,
    x.away_team_id
  from jsonb_populate_recordset(null::public.games, coalesce(p_league -> 'games', '[]')) x;

  insert into public.team_settings (team_id, league_id, starters, minutes, tactics)
  select x.team_id, v_league, x.starters, x.minutes, x.tactics
  from jsonb_populate_recordset(null::public.team_settings, coalesce(p_league -> 'team_settings', '[]')) x;

  -- Draft iniziale (rose iniziali in modalità draft): ordine delle chiamate e giocatori in palio
  if p_league ? 'initial_draft' then
    insert into public.initial_drafts (league_id, mode, pick_seconds, team_order)
    select v_league, coalesce(x.mode, 'list'), coalesce(x.pick_seconds, 60), x.team_order
    from jsonb_populate_record(null::public.initial_drafts, p_league -> 'initial_draft') x;
    insert into public.initial_draft_pool (player_id, league_id, overall, contract_type, salaries, options,
      guaranteed)
    select x.player_id, v_league, x.overall, x.contract_type, coalesce(x.salaries, '{}'),
      coalesce(x.options, '{}'), x.guaranteed
    from jsonb_populate_recordset(null::public.initial_draft_pool, p_league -> 'initial_draft' -> 'pool') x;
  end if;

  update public.leagues set current_season_id = v_season, current_round_id = v_round where id = v_league;
  perform private.auto_ready(v_round);
  return jsonb_build_object('league_id', v_league, 'invite_code', v_code);
end;
$$;

-- ---------------------------------------------------------------- letture

-- Come in 20261106170500_league_state_order.sql, con il giorno del turno e delle partite
create or replace function public.league_state(p_league uuid) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'league', jsonb_build_object('id', l.id, 'seed', l.seed, 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'seed', r.seed, 'close_reason', r.close_reason, 'stage', r.stage, 'day', r.day)
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
    )
  )
  from public.leagues l
  join public.seasons s on s.id = l.current_season_id
  where l.id = p_league
$$;

-- Come in 20261107090000_market_state.sql, con il giorno del turno (la trade deadline è un giorno)
create or replace function public.market_state(p_league uuid, p_player uuid default null) returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    -- Il seed della lega non serve ai controlli
    'league', jsonb_build_object('id', l.id, 'seed', '', 'talent_reference', l.talent_reference),
    'season', to_jsonb(s),
    'round', (select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state,
                'stage', r.stage, 'day', r.day)
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

-- Come in 20261107090100_turn_status.sql, con il giorno del turno e l'anno della stagione; playing anche in regular
-- season (chi gioca quel giorno)
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

-- Come in 20261107100000_leagues_status.sql, con il giorno del turno e l'anno della stagione
create or replace function public.my_leagues_status() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'league_id', l.id,
    'paused', l.paused,
    'draft_state', (select d.state from public.initial_drafts d where d.league_id = l.id),
    'round', (
      select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state, 'stage', r.stage,
        'closing_started_at', r.closing_started_at, 'attempts', r.attempts, 'failed_at', r.failed_at, 'day', r.day,
        'season_year', (select s.year from public.seasons s where s.id = r.season_id))
      from public.rounds r where r.id = l.current_round_id
    ),
    'my_team_id', t.id,
    'decisions', (
      select count(*) from public.alerts a where a.team_id = t.id and a.status = 'open' and a.blocking
    ),
    'readiness', (
      select coalesce(jsonb_agg(jsonb_build_object('team_id', x.team_id, 'state', x.state) order by x.team_id), '[]')
      from public.round_readiness(l.id) x
      where l.current_round_id is not null
    )
  ) order by l.name, l.id), '[]')
  from public.teams t
  join public.leagues l on l.id = t.league_id
  where t.owner_id = (select auth.uid())
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.auto_ready(uuid, uuid), private.team_owner_ready()
  from public, anon, authenticated;
