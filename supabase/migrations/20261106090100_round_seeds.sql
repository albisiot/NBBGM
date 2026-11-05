-- NBBGM: seed dei turni e delle partite solo al server (dopo la Fase 13).
--
-- Come per leagues.seed (Fase 10): il seed del turno decide tutto il caso del turno, comprese la classe del
-- draft generata alla chiusura della finale e il rumore delle stime. Con il seed e il motore (il repository è
-- pubblico) un membro rifarebbe i valori nascosti dei prospetti; games.seed comincia con il seed del turno.
-- Il client legge tutte le colonne tranne seed. Il tempo reale su rounds continua a funzionare: arrivano le
-- colonne leggibili (serve la chiave primaria id), seed resta fuori.

revoke select on public.rounds from authenticated;
grant select (id, league_id, season_id, number, kind, state, deadline, closing_started_at, simulated_at,
  created_at, forced_at, close_reason, stage)
  on public.rounds to authenticated;

revoke select on public.games from authenticated;
grant select (id, league_id, season_id, round_number, kind, home_team_id, away_team_id, series_id, home_score,
  away_score, overtimes, quarters, play_by_play, played_at)
  on public.games to authenticated;
