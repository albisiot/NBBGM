-- Pronto della preparazione: le offerte fatte nel turno contano anche per il massimo di 15 contratti standard.
--
-- Prima contavano solo per il minimo di 13: con 15 contratti e un'offerta il Pronto passava, e se l'offerta firmava la
-- rosa arrivava a 16 e la sistemava il server, tagliando l'overall più basso (trovato nella prova in produzione
-- dell'offseason nuova, 8 novembre 2026). Ora si contano le offerte come se firmassero tutte; chi vuole tenerne una di
-- riserva la ritira o taglia prima. Come in 20261108120000_offseason_live.sql per il resto.
create or replace function private.roster_issue(p_team uuid) returns text
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
    when standard + bids > 15 then
      case when standard + bids - 15 = 1 then 'Devi tagliare un giocatore per stare dentro ai 15'
           else format('Devi tagliare %s giocatori per stare dentro ai 15', standard + bids - 15) end
      || case when bids > 0 then ' (contando le offerte che hai fatto)' else '' end
    when two_way > 3 then
      case when two_way - 3 = 1 then 'Devi tagliare un two-way: al massimo 3'
           else format('Devi tagliare %s two-way: al massimo 3', two_way - 3) end
    when standard + bids < 13 then
      case when 13 - standard - bids = 1 then 'Devi firmare un giocatore per averne almeno 13'
           else format('Devi firmare %s giocatori per averne almeno 13', 13 - standard - bids) end
  end
  from c
$$;

revoke execute on function private.roster_issue(uuid) from public, anon, authenticated;
