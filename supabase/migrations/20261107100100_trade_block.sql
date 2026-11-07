-- NBBGM: giocatori sul mercato (seconda analisi, funzioni nuove).
--
-- Un manager segna i propri giocatori come disponibili a uno scambio; la lista la vedono i membri della lega nella
-- pagina della squadra e nel mercato. È solo un'indicazione: gli scambi passano sempre dalla funzione market e
-- dalla chiusura del turno. Per le squadre dei bot l'app ricava una lista dalla loro strategia, senza righe qui.
--
-- Scrittura del client, come impostazioni e allenatore: solo la propria squadra (private.can_edit_team: è sua e il
-- turno corrente è aperto, quindi niente scritture a turno in chiusura) e solo giocatori che sono nella squadra.
-- Le righe spariscono da sole quando il giocatore cambia squadra (scambio, taglio, ritiro con la squadra tolta) e
-- quando la squadra cambia manager (liberata, lasciata, presa da un altro).

create table public.trade_block (
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, player_id)
);
create index trade_block_league_id_idx on public.trade_block (league_id);
create index trade_block_player_id_idx on public.trade_block (player_id);

alter table public.trade_block enable row level security;
create policy trade_block_read on public.trade_block for select to authenticated
  using (private.is_member(league_id));
create policy trade_block_insert on public.trade_block for insert to authenticated
  with check (
    private.can_edit_team(team_id, league_id)
    and exists (
      select 1 from public.players p
      where p.id = player_id and p.team_id = trade_block.team_id and p.league_id = trade_block.league_id
    )
  );
create policy trade_block_delete on public.trade_block for delete to authenticated
  using (private.can_edit_team(team_id, league_id));

grant select, insert, delete on public.trade_block to authenticated;
grant all on public.trade_block to service_role;

-- Un giocatore che cambia squadra non è più sul mercato per quella di prima
create function private.trade_block_player_moved() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.trade_block b where b.player_id = new.id and b.team_id is distinct from new.team_id;
  return null;
end;
$$;

create trigger players_trade_block after update of team_id on public.players
  for each row when (old.team_id is distinct from new.team_id)
  execute function private.trade_block_player_moved();

-- Una squadra che cambia manager riparte senza lista: quella di prima era del manager uscito
create function private.trade_block_owner_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.trade_block b where b.team_id = new.id;
  return null;
end;
$$;

create trigger teams_trade_block after update of owner_id on public.teams
  for each row when (old.owner_id is distinct from new.owner_id)
  execute function private.trade_block_owner_changed();

revoke execute on function private.trade_block_player_moved(), private.trade_block_owner_changed()
  from public, anon, authenticated;
