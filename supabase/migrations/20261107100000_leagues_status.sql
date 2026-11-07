-- NBBGM: stato del turno di tutte le leghe dell'utente in una lettura (seconda analisi, funzioni nuove).
--
-- L'elenco delle leghe mostra per ognuna se tocca al manager, quanti umani sono pronti, le decisioni bloccanti
-- aperte e lo stato della lega (pausa, turno bloccato, simulazione, draft iniziale). Una chiamata per lega
-- (turn_status) farebbe tante richieste quante sono le leghe, ogni volta che l'elenco si rilegge: questa funzione
-- dà tutto in una, circa 0,3 KB per lega.
--
-- security invoker, come turn_status: ogni lettura passa dalla RLS di chi chiama (le proprie squadre, gli avvisi
-- della propria squadra, le colonne dei turni già aperte ai membri). Lo stato delle squadre umane viene da
-- round_readiness, quindi da private.team_readiness, la stessa regola che decide la chiusura del turno.

create function public.my_leagues_status() returns jsonb
language sql stable security invoker set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'league_id', l.id,
    'paused', l.paused,
    'draft_state', (select d.state from public.initial_drafts d where d.league_id = l.id),
    'round', (
      select jsonb_build_object('id', r.id, 'number', r.number, 'kind', r.kind, 'state', r.state, 'stage', r.stage,
        'closing_started_at', r.closing_started_at, 'attempts', r.attempts, 'failed_at', r.failed_at)
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

revoke execute on function public.my_leagues_status() from public, anon, authenticated;
grant execute on function public.my_leagues_status() to authenticated;
