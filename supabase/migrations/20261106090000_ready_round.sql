-- NBBGM: il Pronto vale per il turno che il manager sta guardando (dopo la Fase 13).
--
-- set_ready segnava pronto il turno corrente del server: chi riapriva l'app ferma alla giornata 10 e premeva
-- Pronto risultava pronto per la 11 senza averne visto risultati e avvisi (e, se era l'ultimo, la chiudeva).
-- Ora l'app passa il turno che mostra (p_round) e il server rifiuta se nel frattempo è cambiato. Il parametro è
-- facoltativo: le app già installate, che non lo passano, continuano a funzionare come prima.

-- Con un parametro in più sarebbe una seconda funzione con lo stesso nome, ambigua con due argomenti: si
-- sostituisce la vecchia.
drop function public.set_ready(uuid, boolean);

-- Pronto (o tolto il Pronto) nel turno corrente, finché il turno è aperto. Se con questo Pronto il turno va
-- chiuso, chiama advance-turn. Restituisce true se tutte le squadre umane sono pronte.
create function public.set_ready(p_team uuid, p_ready boolean default true, p_round uuid default null)
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
  insert into public.ready_flags (round_id, team_id, league_id, ready, updated_at)
  values (v_round.id, p_team, v_round.league_id, p_ready, now())
  on conflict (round_id, team_id) do update set ready = excluded.ready, updated_at = excluded.updated_at;
  if p_ready and private.round_due(v_round.id) is not null then
    perform private.kick('advance-turn', jsonb_build_object('league_id', v_round.league_id));
  end if;
  return public.round_all_ready(v_round.id);
end;
$$;

revoke execute on function public.set_ready(uuid, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_ready(uuid, boolean, uuid) to authenticated;
