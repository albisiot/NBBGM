-- NBBGM: stato di ogni squadra umana nel turno, dato dal server (dopo la Fase 13).
--
-- L'app contava pronta una squadra con l'allenatore anche quando aveva un avviso bloccante aperto, che il server
-- invece non conta: gli avvisi delle altre squadre non si leggono (RLS). La scheda del turno diceva "la lega
-- avanza da sola" mentre era ferma. Ora lo stato lo calcola il database, con la stessa regola che decide la
-- chiusura del turno (round_all_ready, usata da private.round_due):
--   ready     Pronto premuto
--   coach     allenatore attivo, senza avvisi bloccanti
--   blocked   allenatore attivo, ma con un avviso bloccante aperto: la squadra non è pronta finché il manager
--             non risponde
--   waiting   non pronta
--   out       in play-in e playoff, senza partita nel turno: non deve essere pronta
-- Ai membri della lega round_readiness dice solo che c'è una decisione in sospeso, non quale.

create function private.team_readiness(p_round uuid)
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
      when exists (
        select 1 from public.ready_flags f where f.round_id = r.id and f.team_id = t.id and f.ready
      ) then 'ready'
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
  where r.id = p_round
$$;

-- Tutte le squadre umane che giocano nel turno sono pronte: come prima (Pronto premuto oppure allenatore attivo
-- senza avvisi bloccanti), ma dalla stessa funzione che l'app legge, così le due cose non si separano
create or replace function public.round_all_ready(p_round uuid) returns boolean
language sql stable security definer set search_path = ''
as $$
  select not exists (
    select 1 from private.team_readiness(p_round) x where x.state in ('waiting', 'blocked')
  )
$$;

-- Stato delle squadre umane nel turno corrente della lega, per i suoi membri
create function public.round_readiness(p_league uuid)
returns table (team_id uuid, state text)
language plpgsql stable security definer set search_path = ''
as $$
begin
  if not private.is_member(p_league) then
    raise exception 'Non fai parte di questa lega' using errcode = '42501';
  end if;
  return query
    select x.team_id, x.state
    from public.leagues l
    cross join lateral private.team_readiness(l.current_round_id) x
    where l.id = p_league;
end;
$$;

revoke execute on function private.team_readiness(uuid), public.round_readiness(uuid)
  from public, anon, authenticated;
grant execute on function public.round_readiness(uuid) to authenticated;
