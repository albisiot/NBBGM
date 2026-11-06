-- NBBGM: cronaca della lega (dopo la Fase 13).
--
-- La cronaca è la tabella transactions, che i membri della lega leggono già: firme, rinnovi, scambi, tagli,
-- opzioni, draft, ritiri e ora anche gli infortuni medi e gravi (li aggiunge advance-turn). Per filtrarla per
-- squadra serve sapere quali squadre riguarda ogni riga: il testo le cita con la sigla ("BOS firma ...",
-- "Scambio: LAL cede ... a NYK ..."). Le sigle le ricava dal testo un trigger, così vale per tutte le scritture
-- (apply_turn, draft iniziale, creazione della lega) senza cambiare il formato dei dati; le righe già scritte si
-- aggiornano qui sotto.

alter table public.transactions add column team_codes text[] not null default '{}';

-- Sigle delle squadre della lega citate nel testo, come parole intere (\m e \M), in ordine alfabetico
create function private.transaction_team_codes(p_league uuid, p_text text) returns text[]
language sql stable security definer set search_path = ''
as $$
  select coalesce(array_agg(t.code order by t.code), '{}')
  from public.teams t
  where t.league_id = p_league and p_text ~ ('\m' || t.code || '\M')
$$;

create function private.transaction_teams() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.team_codes is null or cardinality(new.team_codes) = 0 then
    new.team_codes := private.transaction_team_codes(new.league_id, new.text);
  end if;
  return new;
end;
$$;

create trigger transactions_teams before insert on public.transactions
  for each row execute function private.transaction_teams();

update public.transactions x
set team_codes = private.transaction_team_codes(x.league_id, x.text)
where cardinality(x.team_codes) = 0;

-- La cronaca si legge dalla più recente, per lega, eventualmente per squadra
create index transactions_league_recent on public.transactions (league_id, created_at desc, id desc);
create index transactions_team_codes on public.transactions using gin (team_codes);

revoke execute on function private.transaction_team_codes(uuid, text), private.transaction_teams()
  from public, anon, authenticated;
