-- NBBGM: turni bloccati in chiusura (dopo la Fase 13).
--
-- Un turno la cui simulazione fallisce sempre (un errore del motore, una scrittura rifiutata da apply_turn)
-- restava in chiusura per sempre: pg_cron lo riprendeva ogni 5 minuti con lo stesso seed, l'avanzamento forzato
-- dava errore e ogni modifica dei manager era rifiutata. Ora:
--   - ogni tentativo si conta (rounds.attempts) e l'Edge Function salva l'ultimo errore (record_round_error);
--   - dopo 3 tentativi falliti il turno non si riprende più da solo (rounds.failed_at) e la pagina della lega
--     lo mostra; l'errore lo legge solo il commissario (round_error);
--   - il commissario lo riapre (reopen_round): torna aperto, con lo stesso seed o con uno nuovo. apply_turn
--     scrive tutto o niente, quindi un turno in chiusura non ha scritto nulla di parziale;
--   - la ripresa automatica rispetta la pausa.

-- ---------------------------------------------------------------- colonne

alter table public.rounds
  add column attempts integer not null default 0,
  add column last_error text,
  add column failed_at timestamptz;

-- Tutti vedono se il turno è fermo; l'errore no (può contenere dettagli del server)
grant select (attempts, failed_at) on public.rounds to authenticated;

-- Tentativi di simulazione di un turno prima di fermarsi e aspettare il commissario
create function private.max_round_attempts() returns integer
language sql immutable set search_path = ''
as $$
  select 3
$$;

-- ---------------------------------------------------------------- chiusura e riprese

/*
  Come prima (Fase 9), più i tentativi: la chiusura è il primo tentativo; un turno fermo in chiusura da più di
  5 minuti si riprende con lo stesso seed solo se la lega non è in pausa e non ha già fatto 3 tentativi. Al
  quarto il turno si ferma (failed_at) e aspetta il commissario.
*/
create or replace function public.try_close_round(p_league uuid) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_paused boolean;
  v_reason text;
  v_reclaimed boolean := false;
begin
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    return null;
  end if;
  select paused into v_paused from public.leagues where id = p_league;
  if v_round.state = 'closing' then
    if v_round.failed_at is not null or v_round.closing_started_at >= now() - interval '5 minutes' or v_paused then
      return null;
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

-- La Edge Function advance-turn salva l'errore della simulazione; dopo l'ultimo tentativo il turno si ferma
-- subito, senza aspettare altri 5 minuti
create function public.record_round_error(p_round uuid, p_error text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.rounds
  set last_error = left(coalesce(nullif(p_error, ''), 'Errore sconosciuto'), 2000),
      failed_at = case when attempts >= private.max_round_attempts() then coalesce(failed_at, now()) end
  where id = p_round and state = 'closing';
end;
$$;

-- Ogni 15 secondi (pg_cron): come prima, ma i turni fermi non si riprendono in pausa né dopo l'ultimo
-- tentativo (quelli che l'hanno appena superato passano da try_close_round, che li ferma)
create or replace function private.cron_tick() returns integer
language plpgsql security definer set search_path = ''
as $$
declare
  v record;
  v_count integer := 0;
begin
  for v in
    select l.id
    from public.leagues l
    join public.rounds r on r.id = l.current_round_id
    where (r.state = 'open' and private.round_due(r.id) is not null)
       or (r.state = 'closing' and r.failed_at is null and not l.paused
           and r.closing_started_at < now() - interval '5 minutes')
  loop
    perform private.kick('advance-turn', jsonb_build_object('league_id', v.id));
    v_count := v_count + 1;
  end loop;
  for v in
    select d.league_id
    from public.initial_drafts d
    where d.state = 'running' and d.mode = 'live' and d.pick_deadline < now()
  loop
    perform private.kick('draft', jsonb_build_object('league_id', v.league_id, 'action', 'tick'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$$;

-- ---------------------------------------------------------------- il commissario

-- L'ultimo errore della simulazione del turno corrente (null se non ce n'è), solo per il commissario
create function public.round_error(p_league uuid) returns text
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario vede gli errori del turno' using errcode = '42501';
  end if;
  return (
    select r.last_error
    from public.leagues l
    join public.rounds r on r.id = l.current_round_id
    where l.id = p_league and r.state = 'closing'
  );
end;
$$;

/*
  Il commissario riapre il turno corrente rimasto in chiusura: fermo dopo l'ultimo tentativo, oppure in chiusura
  da più di 5 minuti (per esempio con la lega in pausa). Il turno torna aperto come all'inizio: Pronto da
  rifare, nessun avanzamento forzato, scadenza (se la lega ne ha una) contata da adesso. Con p_new_seed il seed
  si rifà alla prossima chiusura, così la simulazione cambia. La simulazione in corso, se c'è ancora, non può
  più scrivere: apply_turn accetta solo turni in chiusura.
*/
create function public.reopen_round(p_league uuid, p_new_seed boolean default false) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_round public.rounds%rowtype;
  v_minutes integer;
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario può sbloccare il turno' using errcode = '42501';
  end if;
  select r.* into v_round
  from public.leagues l
  join public.rounds r on r.id = l.current_round_id
  where l.id = p_league
  for update of r;
  if not found then
    raise exception 'La lega non ha un turno in corso';
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
      failed_at = null, last_error = null,
      seed = case when p_new_seed then null else seed end,
      deadline = case when v_minutes is null then null else now() + make_interval(mins => v_minutes) end
  where id = v_round.id;
  delete from public.ready_flags where round_id = v_round.id;
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.max_round_attempts(), public.record_round_error(uuid, text),
  public.round_error(uuid), public.reopen_round(uuid, boolean)
from public, anon, authenticated;

grant execute on function public.round_error(uuid), public.reopen_round(uuid, boolean) to authenticated;
grant execute on function public.record_round_error(uuid, text) to service_role;
