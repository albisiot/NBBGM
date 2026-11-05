-- NBBGM: tabelle del modello dati (CLAUDE.md, sezione Modello dati essenziale).
-- Abilità, tendenze e valori nascosti sono jsonb con le stesse chiavi del pacchetto engine.

-- ---------------------------------------------------------------- utenti e leghe

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now()
);

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 60),
  invite_code text not null unique,
  commissioner_id uuid not null references public.profiles (id),
  -- Scadenza facoltativa dei turni: null = si avanza solo quando tutti sono pronti
  deadline_minutes integer check (deadline_minutes is null or deadline_minutes > 0),
  -- Ritmo massimo quando tutte le squadre umane hanno l'allenatore
  max_pace_seconds integer not null default 60 check (max_pace_seconds >= 0),
  roster_mode text not null default 'real' check (roster_mode in ('real', 'draft')),
  draft_mode text not null default 'list' check (draft_mode in ('list', 'live')),
  rookie_source text not null default 'generated' check (rookie_source in ('generated', 'real')),
  paused boolean not null default false,
  -- Seed della lega e livello di riferimento dei migliori 150 (normalizeTalent)
  seed text not null,
  talent_reference numeric not null default 0,
  current_season_id uuid,
  current_round_id uuid,
  created_at timestamptz not null default now()
);

create table public.league_members (
  league_id uuid not null references public.leagues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'manager' check (role in ('commissioner', 'manager')),
  joined_at timestamptz not null default now(),
  primary key (league_id, user_id)
);

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  year integer not null,
  phase text not null default 'regular' check (phase in ('regular', 'play-in', 'playoffs', 'offseason')),
  salary_cap bigint not null,
  luxury_tax bigint not null,
  first_apron bigint not null,
  second_apron bigint not null,
  minimum_team_salary bigint not null,
  minimum_salary bigint[] not null,
  rookie_scale jsonb not null,
  revenue bigint not null,
  growth numeric not null,
  unique (league_id, year)
);

-- ---------------------------------------------------------------- squadre e giocatori

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  code text not null,
  city text not null,
  name text not null,
  full_name text not null,
  conference text not null check (conference in ('East', 'West')),
  division text not null,
  -- null = guidata da un bot
  owner_id uuid references public.profiles (id) on delete set null,
  balance bigint not null default 0,
  strategy text not null default 'middle' check (strategy in ('contend', 'middle', 'rebuild')),
  tax_history boolean[] not null default '{}',
  unique (league_id, code),
  unique (league_id, owner_id)
);

create table public.players (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  -- Identificativo del giocatore nel file dati o nel generatore
  slug text not null,
  -- null = svincolato
  team_id uuid references public.teams (id) on delete set null,
  first_name text not null,
  last_name text not null,
  nationality text not null default '',
  role text not null check (role in ('PG', 'SG', 'SF', 'PF', 'C')),
  secondary_role text check (secondary_role in ('PG', 'SG', 'SF', 'PF', 'C')),
  hand text not null default 'R' check (hand in ('R', 'L')),
  archetype text not null default '',
  age integer not null check (age between 15 and 50),
  height_cm numeric not null,
  wingspan_cm numeric not null,
  weight_kg numeric not null,
  years_in_league integer,
  ratings jsonb not null check (jsonb_typeof(ratings) = 'object'),
  tendencies jsonb not null check (jsonb_typeof(tendencies) = 'object'),
  energy numeric not null default 100 check (energy between 0 and 100),
  morale numeric not null default 60 check (morale between 0 and 100),
  -- Stima del potenziale visibile a manager e bot (il valore vero sta in player_hidden)
  scouted_potential integer not null,
  two_way_games integer not null default 0,
  season_stats jsonb not null default '{}',
  -- I ritirati restano per lo storico delle statistiche, fuori da ogni squadra
  retired boolean not null default false,
  unique (league_id, slug)
);
create index players_team on public.players (league_id, team_id);

-- Valori nascosti: nessun accesso dal client (vedi la migrazione di sicurezza)
create table public.player_hidden (
  player_id uuid primary key references public.players (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  hidden jsonb not null check (jsonb_typeof(hidden) = 'object')
);

create table public.contracts (
  player_id uuid primary key references public.players (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  type text not null check (type in ('standard', 'rookie', 'two-way', 'ten-day', 'minimum', 'unknown')),
  -- Stipendio di ogni stagione a partire da quella corrente; vuoto per i two-way
  salaries bigint[] not null default '{}',
  -- Opzione sulla stagione con lo stesso indice: 'player', 'team' o null
  options text[] not null default '{}',
  guaranteed bigint
);
create index contracts_team on public.contracts (team_id);

-- Stipendi residui dei giocatori tagliati, a carico di chi li ha tagliati
create table public.dead_money (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_name text not null,
  salaries bigint[] not null
);

create table public.injuries (
  player_id uuid primary key references public.players (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  body_part text not null check (body_part in ('back', 'knees', 'ankles', 'feet', 'shoulders')),
  severity text not null check (severity in ('light', 'medium', 'severe')),
  games_remaining integer not null check (games_remaining > 0)
);

-- ---------------------------------------------------------------- dati di partenza (solo server)

create table public.base_teams (
  code text primary key,
  city text not null,
  name text not null,
  full_name text not null unique,
  conference text not null check (conference in ('East', 'West')),
  division text not null
);

create table public.base_players (
  dataset text not null,
  slug text not null,
  team_code text references public.base_teams (code),
  first_name text not null,
  last_name text not null,
  nationality text not null default '',
  role text not null check (role in ('PG', 'SG', 'SF', 'PF', 'C')),
  secondary_role text check (secondary_role in ('PG', 'SG', 'SF', 'PF', 'C')),
  hand text not null default 'R' check (hand in ('R', 'L')),
  archetype text not null default '',
  age integer not null,
  height_cm numeric not null,
  wingspan_cm numeric not null,
  weight_kg numeric not null,
  years_in_league integer,
  ratings jsonb not null,
  tendencies jsonb not null,
  hidden jsonb not null,
  primary key (dataset, slug)
);

create table public.base_contracts (
  dataset text not null,
  player_slug text not null,
  team_code text not null references public.base_teams (code),
  type text not null check (type in ('standard', 'rookie', 'two-way', 'ten-day', 'minimum', 'unknown')),
  salaries bigint[] not null default '{}',
  options text[] not null default '{}',
  guaranteed bigint,
  primary key (dataset, player_slug),
  foreign key (dataset, player_slug) references public.base_players (dataset, slug) on delete cascade
);

create table public.base_dead_money (
  id bigint generated always as identity primary key,
  dataset text not null,
  team_code text not null references public.base_teams (code),
  player_name text not null,
  salaries bigint[] not null
);

-- ---------------------------------------------------------------- turni e partite

create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  -- 0-81 regular season, poi play-in, playoff e offseason
  number integer not null,
  kind text not null check (kind in ('regular', 'play-in', 'playoffs', 'offseason')),
  state text not null default 'open' check (state in ('open', 'closing', 'done')),
  deadline timestamptz,
  closing_started_at timestamptz,
  simulated_at timestamptz,
  seed text,
  created_at timestamptz not null default now(),
  unique (season_id, number)
);

alter table public.leagues
  add constraint leagues_current_season foreign key (current_season_id) references public.seasons (id) on delete set null,
  add constraint leagues_current_round foreign key (current_round_id) references public.rounds (id) on delete set null;

create table public.ready_flags (
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  ready boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (round_id, team_id)
);

create table public.playoff_series (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  round integer not null check (round between 1 and 4),
  conference text check (conference in ('East', 'West')),
  high_team_id uuid not null references public.teams (id),
  low_team_id uuid not null references public.teams (id),
  high_seed integer not null,
  low_seed integer not null,
  wins_high integer not null default 0 check (wins_high between 0 and 4),
  wins_low integer not null default 0 check (wins_low between 0 and 4),
  winner_team_id uuid references public.teams (id)
);

-- Partite in calendario (punteggi null) e giocate
create table public.games (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  round_number integer not null,
  kind text not null default 'regular' check (kind in ('regular', 'play-in', 'playoffs')),
  home_team_id uuid not null references public.teams (id),
  away_team_id uuid not null references public.teams (id),
  series_id uuid references public.playoff_series (id) on delete set null,
  home_score integer,
  away_score integer,
  overtimes integer,
  quarters jsonb,
  play_by_play jsonb,
  seed text,
  played_at timestamptz,
  check (home_team_id <> away_team_id),
  check ((home_score is null) = (away_score is null))
);
create index games_round on public.games (season_id, round_number);

create table public.player_game_stats (
  game_id uuid not null references public.games (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  team_id uuid not null references public.teams (id),
  league_id uuid not null references public.leagues (id) on delete cascade,
  starter boolean not null default false,
  seconds integer not null default 0,
  pts integer not null default 0,
  fgm integer not null default 0,
  fga integer not null default 0,
  tpm integer not null default 0,
  tpa integer not null default 0,
  ftm integer not null default 0,
  fta integer not null default 0,
  orb integer not null default 0,
  drb integer not null default 0,
  ast integer not null default 0,
  stl integer not null default 0,
  blk integer not null default 0,
  tov integer not null default 0,
  pf integer not null default 0,
  plus_minus integer not null default 0,
  primary key (game_id, player_id)
);
create index player_game_stats_player on public.player_game_stats (player_id);

-- ---------------------------------------------------------------- impostazioni e allenatore

create table public.team_settings (
  team_id uuid primary key references public.teams (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  starters uuid[] not null check (cardinality(starters) = 5),
  -- id giocatore -> minuti obiettivo; la somma deve fare 240 (controllo nel trigger)
  minutes jsonb not null check (jsonb_typeof(minutes) = 'object'),
  tactics jsonb not null check (jsonb_typeof(tactics) = 'object'),
  updated_at timestamptz not null default now()
);

create table public.coach_delegations (
  team_id uuid primary key references public.teams (id) on delete cascade,
  league_id uuid not null references public.leagues (id) on delete cascade,
  active boolean not null default true,
  until_round integer,
  until_at timestamptz,
  until_phase_end boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  kind text not null,
  blocking boolean not null default false,
  status text not null default 'open' check (status in ('open', 'resolved', 'expired')),
  payload jsonb not null default '{}',
  round_id uuid references public.rounds (id) on delete set null,
  deadline timestamptz,
  created_at timestamptz not null default now()
);
create index alerts_team on public.alerts (team_id, status);

-- ---------------------------------------------------------------- draft e mercato

create table public.draft_lottery (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  draft_year integer not null,
  -- Squadre d'origine nell'ordine di scelta del primo giro
  pick_order uuid[] not null,
  drawn_at timestamptz not null default now(),
  unique (league_id, draft_year)
);

create table public.draft_picks (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  draft_year integer not null,
  round smallint not null check (round in (1, 2)),
  original_team_id uuid not null references public.teams (id) on delete cascade,
  owner_team_id uuid not null references public.teams (id) on delete cascade,
  -- Protezione "top N" (solo primo giro)
  protection smallint check (protection between 1 and 20),
  deferrals smallint not null default 0 check (deferrals between 0 and 3),
  position smallint,
  player_id uuid references public.players (id) on delete set null,
  unique (league_id, draft_year, round, original_team_id),
  check (protection is null or round = 1)
);

create table public.draft_swaps (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  draft_year integer not null,
  round smallint not null check (round in (1, 2)),
  holder_team_id uuid not null references public.teams (id) on delete cascade,
  other_team_id uuid not null references public.teams (id) on delete cascade,
  result text,
  check (holder_team_id <> other_team_id)
);

-- Offerte a busta chiusa agli svincolati: le vede solo chi le fa
create table public.free_agent_bids (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  salaries bigint[] not null check (cardinality(salaries) between 1 and 5),
  status text not null default 'pending' check (status in ('pending', 'won', 'lost', 'invalid', 'withdrawn')),
  created_at timestamptz not null default now(),
  unique (round_id, team_id, player_id)
);

create table public.trade_offers (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues (id) on delete cascade,
  from_team_id uuid not null references public.teams (id) on delete cascade,
  to_team_id uuid not null references public.teams (id) on delete cascade,
  players_from uuid[] not null default '{}',
  players_to uuid[] not null default '{}',
  picks_from uuid[] not null default '{}',
  picks_to uuid[] not null default '{}',
  swaps jsonb not null default '[]',
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'rejected', 'withdrawn', 'executed', 'void', 'expired')),
  created_round_id uuid references public.rounds (id) on delete set null,
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  check (from_team_id <> to_team_id)
);

-- ---------------------------------------------------------------- bilancio e storico

create table public.ledger (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  team_id uuid not null references public.teams (id) on delete cascade,
  season_id uuid not null references public.seasons (id) on delete cascade,
  round_id uuid references public.rounds (id) on delete set null,
  kind text not null check (kind in ('revenue', 'salary', 'two-way', 'tax', 'minimum-shortfall', 'other')),
  amount bigint not null,
  note text,
  created_at timestamptz not null default now()
);
create index ledger_team on public.ledger (team_id, season_id);

create table public.transactions (
  id bigint generated always as identity primary key,
  league_id uuid not null references public.leagues (id) on delete cascade,
  season_year integer not null,
  round_number integer,
  type text not null check (type in ('signing', 'renewal', 'trade', 'release', 'retirement', 'draft', 'option', 'injury')),
  text text not null,
  created_at timestamptz not null default now()
);
create index transactions_league on public.transactions (league_id, created_at);
