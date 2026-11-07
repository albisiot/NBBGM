-- NBBGM: turni bloccati anche senza commissario (seconda analisi, server).
--
--   - Il commissario passa il ruolo a un altro manager della lega (transfer_commissioner).
--   - Un turno fermo dopo l'ultimo tentativo (failed_at) lo può riaprire qualsiasi membro, passate 6 ore dal
--     blocco (private.member_reopen_hours): prima solo il commissario, e se era assente la lega restava ferma.
--   - La riapertura fa ripartire anche l'orologio del ritmo massimo degli allenatori (rounds.created_at, che
--     usa solo private.round_due): prima, con tutti gli allenatori attivi, il turno riaperto si richiudeva entro
--     15 secondi con gli stessi dati.
--   - Alla riapertura si possono ritirare le azioni di mercato in sospeso (offerte agli svincolati, tagli e
--     rinnovi chiesti, proposte di scambio in attesa o accettate): se è una di loro a far fallire la simulazione,
--     il turno riaperto non si blocca di nuovo per la stessa ragione.
--   - Se la Edge Function viene interrotta (tempo o memoria) non salva nessun errore: la ripresa successiva lo
--     scrive lei ("Simulazione interrotta..."), così il commissario capisce che cosa è successo.

-- ---------------------------------------------------------------- colonne

-- Quando advance-turn ha salvato l'ultimo errore: se è prima dell'inizio del tentativo, quel tentativo non ha
-- salvato nulla (solo il server la legge, come last_error)
alter table public.rounds add column last_error_at timestamptz;

-- Ore dopo il blocco del turno oltre le quali qualsiasi membro lo può riaprire
create function private.member_reopen_hours() returns integer
language sql immutable set search_path = ''
as $$
  select 6
$$;

-- ---------------------------------------------------------------- errori e riprese

create or replace function public.record_round_error(p_round uuid, p_error text) returns void
language plpgsql security definer set search_path = ''
as $$
begin
  update public.rounds
  set last_error = left(coalesce(nullif(p_error, ''), 'Errore sconosciuto'), 2000),
      last_error_at = now(),
      failed_at = case when attempts >= private.max_round_attempts() then coalesce(failed_at, now()) end
  where id = p_round and state = 'closing';
end;
$$;

/*
  Come dopo la Fase 13 (tentativi, pausa, blocco dopo l'ultimo tentativo), più l'errore dei tentativi interrotti:
  un turno fermo in chiusura il cui tentativo non ha salvato errori è stato interrotto (la Edge Function ha
  superato il tempo o la memoria), e lo si scrive prima di riprenderlo o di fermarlo.
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

-- ---------------------------------------------------------------- riapertura

/*
  Riapre il turno corrente rimasto in chiusura: fermo dopo l'ultimo tentativo, oppure in chiusura da più di 5
  minuti (per esempio con la lega in pausa). Lo può fare il commissario e, passate private.member_reopen_hours()
  ore dal blocco, qualsiasi membro. Il turno torna aperto come all'inizio: Pronto da rifare, nessun avanzamento
  forzato, scadenza (se la lega ne ha una) e ritmo degli allenatori contati da adesso. Con p_new_seed il seed si
  rifà alla prossima chiusura; con p_withdraw_market si ritirano le azioni di mercato in sospeso della lega. La
  simulazione in corso, se c'è ancora, non può più scrivere: apply_turn accetta solo turni in chiusura.
*/
drop function public.reopen_round(uuid, boolean);
create function public.reopen_round(p_league uuid, p_new_seed boolean default false,
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

-- ---------------------------------------------------------------- passaggio del commissario

-- Il commissario passa il ruolo a un altro manager della lega (chi guida una squadra): da quel momento lui è un
-- manager come gli altri
create function public.transfer_commissioner(p_league uuid, p_user uuid) returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_old uuid := (select auth.uid());
begin
  if not private.is_commissioner(p_league) then
    raise exception 'Solo il commissario può passare il ruolo' using errcode = '42501';
  end if;
  if p_user is null or p_user = v_old then
    raise exception 'Scegli un altro manager della lega';
  end if;
  if not exists (
    select 1
    from public.league_members m
    join public.teams t on t.league_id = m.league_id and t.owner_id = m.user_id
    where m.league_id = p_league and m.user_id = p_user
  ) then
    raise exception 'Può diventare commissario solo un manager della lega';
  end if;
  update public.leagues set commissioner_id = p_user where id = p_league;
  update public.league_members
  set role = case when user_id = p_user then 'commissioner' else 'manager' end
  where league_id = p_league and user_id in (v_old, p_user);
end;
$$;

-- ---------------------------------------------------------------- permessi

revoke execute on function private.member_reopen_hours(),
  public.reopen_round(uuid, boolean, boolean), public.transfer_commissioner(uuid, uuid)
from public, anon, authenticated;

grant execute on function public.reopen_round(uuid, boolean, boolean), public.transfer_commissioner(uuid, uuid)
  to authenticated;
