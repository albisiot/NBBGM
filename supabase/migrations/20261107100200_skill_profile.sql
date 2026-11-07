-- NBBGM: media della lega per i bisogni della squadra (seconda analisi, funzioni nuove).
--
-- Nel mercato l'app confronta la rotazione della propria squadra con la media della lega, gruppo di abilità per
-- gruppo (tiro da 3, regia, rimbalzi...). Per la media servirebbero le rose delle 30 squadre con le abilità (circa
-- 300 KB): questa funzione la calcola nel database e restituisce una decina di numeri.
--
-- Le regole sono quelle di apps/web/src/lib/skills.ts, che il test sul database confronta con questa funzione:
--   gruppo        media di alcune abilità visibili (mai i valori nascosti);
--   rotazione     gli 8 giocatori di ogni squadra con contratto non two-way e la media dei gruppi più alta (a
--                 parità l'id più piccolo);
--   media         di ogni gruppo sui giocatori delle rotazioni di tutte le squadre.
--
-- security invoker: legge con la RLS di chi chiama (giocatori e contratti della lega li vedono i membri); per chi
-- non è nella lega i giocatori non si vedono e la risposta ha zero squadre.

create function public.league_skill_profile(p_league uuid) returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with g as (
    select p.id, p.team_id,
      (p.ratings->>'threePoint')::numeric as tiro3,
      ((p.ratings->>'midRange')::numeric + (p.ratings->>'pullUp')::numeric) / 2 as media,
      ((p.ratings->>'closeShot')::numeric + (p.ratings->>'layup')::numeric
        + (p.ratings->>'drivingDunk')::numeric) / 3 as ferro,
      ((p.ratings->>'postControl')::numeric + (p.ratings->>'hook')::numeric
        + (p.ratings->>'postFade')::numeric) / 3 as post,
      ((p.ratings->>'ballHandle')::numeric + (p.ratings->>'passAccuracy')::numeric
        + (p.ratings->>'passVision')::numeric) / 3 as regia,
      ((p.ratings->>'perimeterDefense')::numeric + (p.ratings->>'steal')::numeric
        + (p.ratings->>'passLaneReading')::numeric) / 3 as perimetro,
      ((p.ratings->>'interiorDefense')::numeric + (p.ratings->>'block')::numeric
        + (p.ratings->>'helpDefense')::numeric) / 3 as protezione,
      ((p.ratings->>'offensiveRebound')::numeric + (p.ratings->>'defensiveRebound')::numeric) / 2 as rimbalzi,
      ((p.ratings->>'speed')::numeric + (p.ratings->>'agility')::numeric + (p.ratings->>'vertical')::numeric
        + (p.ratings->>'strength')::numeric) / 4 as atletismo
    from public.players p
    join public.contracts c on c.player_id = p.id and c.type <> 'two-way'
    where p.league_id = p_league and p.team_id is not null and not p.retired
  ),
  ranked as (
    select g.*, row_number() over (
      partition by g.team_id
      order by (tiro3 + media + ferro + post + regia + perimetro + protezione + rimbalzi + atletismo) / 9 desc, g.id
    ) as n
    from g
  )
  select jsonb_build_object(
    'teams', count(distinct team_id),
    'tiro3', round(avg(tiro3), 3),
    'media', round(avg(media), 3),
    'ferro', round(avg(ferro), 3),
    'post', round(avg(post), 3),
    'regia', round(avg(regia), 3),
    'perimetro', round(avg(perimetro), 3),
    'protezione', round(avg(protezione), 3),
    'rimbalzi', round(avg(rimbalzi), 3),
    'atletismo', round(avg(atletismo), 3)
  )
  from ranked
  where n <= 8
$$;

revoke execute on function public.league_skill_profile(uuid) from public, anon, authenticated;
grant execute on function public.league_skill_profile(uuid) to authenticated;
