-- NBBGM: la pausa ferma anche la scadenza. Quando il commissario riprende la lega, la scadenza del turno
-- aperto riparte da adesso: un turno non si chiude appena finita la pausa perché la scadenza è passata
-- mentre la lega era ferma.

create or replace function private.deadline_changed() returns trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.deadline_minutes is distinct from old.deadline_minutes or (old.paused and not new.paused) then
    update public.rounds
    set deadline = case when new.deadline_minutes is null then null
                        else now() + make_interval(mins => new.deadline_minutes) end
    where id = new.current_round_id and state = 'open';
  end if;
  return new;
end;
$$;

drop trigger leagues_deadline_changed on public.leagues;
create trigger leagues_deadline_changed
after update of deadline_minutes, paused on public.leagues
for each row execute function private.deadline_changed();

revoke execute on function private.deadline_changed() from public, anon, authenticated;
