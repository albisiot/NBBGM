-- NBBGM: notifiche push solo verso i servizi push veri (seconda analisi dopo la Fase 13).
--
-- L'indirizzo di un'iscrizione lo manda l'app, quindi chiunque abbia un account poteva salvarne uno qualsiasi e
-- far chiamare alla Edge Function push un indirizzo a sua scelta. Ora si accettano solo gli host dei servizi push
-- dei browser (elenco di pushpad/known-push-services, senza gli host di prova di Mozilla):
--   fcm.googleapis.com, android.googleapis.com, jmt17.google.com   Chrome e i browser Chromium (Opera, Brave,
--                                                                  Samsung Internet), Android
--   *.push.services.mozilla.com                                    Firefox (updates.push.services.mozilla.com)
--   *.notify.windows.com                                           Edge su Windows (WNS)
--   *.push.apple.com                                               Safari su Mac, iPhone e iPad (web.push.apple.com)
-- sempre https, senza porta né credenziali nell'indirizzo. Lo stesso elenco lo applica la Edge Function
-- (supabase/functions/_shared/push.ts, PUSH_HOSTS). Le iscrizioni già salvate con altri host si cancellano.

-- L'host dell'indirizzo è uno dei servizi push ammessi? Dopo l'host deve venire subito il percorso: niente porta,
-- niente credenziali (user@host), niente host che finisce con un nome ammesso ma è un altro (fcm.googleapis.com.x)
create function private.push_endpoint_ok(p_endpoint text) returns boolean
language sql immutable set search_path = ''
as $$
  select coalesce(
    length(p_endpoint) <= 1000
    and (
      p_endpoint ~* '^https://(fcm\.googleapis\.com|android\.googleapis\.com|jmt17\.google\.com)/'
      or p_endpoint ~* '^https://([a-z0-9-]+\.)+(push\.services\.mozilla\.com|notify\.windows\.com|push\.apple\.com)/'
    ),
    false)
$$;
revoke execute on function private.push_endpoint_ok(text) from public, anon, authenticated;
-- Il vincolo qui sotto la chiama con i permessi di chi scrive: il server (che ha tutti i permessi sulla tabella) e
-- il proprietario delle funzioni security definer (save_push_subscription)
grant execute on function private.push_endpoint_ok(text) to service_role;

-- Le iscrizioni verso host non ammessi spariscono (le notifiche in coda per chi le aveva restano: vanno ai suoi
-- altri dispositivi, se ne ha)
delete from public.push_subscriptions where not private.push_endpoint_ok(endpoint);

alter table public.push_subscriptions
  add constraint push_subscriptions_endpoint_host check (private.push_endpoint_ok(endpoint));

-- Come prima, con il controllo dell'host: un servizio non riconosciuto ha il suo messaggio
create or replace function public.save_push_subscription(p_endpoint text, p_p256dh text, p_auth text,
  p_user_agent text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Serve il login' using errcode = '42501';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 1000
     or length(coalesce(p_p256dh, '')) not between 80 and 100 or length(coalesce(p_auth, '')) not between 16 and 30 then
    raise exception 'Iscrizione alle notifiche non valida';
  end if;
  if not private.push_endpoint_ok(p_endpoint) then
    raise exception 'Iscrizione alle notifiche non valida: servizio push non riconosciuto';
  end if;
  delete from public.push_subscriptions where endpoint = p_endpoint;
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_user, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 300));
  delete from public.push_subscriptions s
  where s.user_id = v_user
    and s.id not in (
      select x.id from public.push_subscriptions x where x.user_id = v_user order by x.created_at desc, x.id limit 10
    );
end;
$$;
