create table instruments (
  id bigserial primary key,
  key text unique not null,
  name text not null,
  type text not null check (type in ('index','sector','stock')),
  yahoo_ticker text not null,
  active boolean not null default true
);

-- imported_pct replaces a "source" column: imported days are those with imported_pct set.
-- History views read coalesce(pct_change, imported_pct).
create table daily_prices (
  instrument_id bigint not null references instruments on delete cascade,
  date date not null,
  open numeric, high numeric, low numeric, close numeric, volume numeric,
  pct_change numeric,
  imported_pct numeric,
  ema50 numeric, ema200 numeric, rsi14 numeric, rs_vs_nifty numeric,
  primary key (instrument_id, date)
);
create index daily_prices_date_idx on daily_prices (date);

create table watchlist (
  instrument_id bigint primary key references instruments on delete cascade,
  added_at timestamptz default now()
);

create table levels (
  instrument_id bigint primary key references instruments on delete cascade,
  auto_support numeric, auto_resistance numeric,
  manual_support numeric, manual_resistance numeric,
  updated_at timestamptz default now()
);

create table rotation_snapshots (
  week_ending date not null,
  instrument_id bigint not null references instruments,
  rs_score numeric,
  rank int,
  grp text not null check (grp in ('sector','watchlist')),
  primary key (week_ending, instrument_id, grp)
);

create table daily_summaries (
  date date primary key,
  summary text not null,
  market_events jsonb not null default '[]',
  watchlist_news jsonb not null default '[]',
  created_at timestamptz default now()
);

create table reports (
  id bigserial primary key,
  instrument_id bigint references instruments,
  status text check (status in ('pending','done','failed')) default 'pending',
  requested_at timestamptz default now(),
  completed_at timestamptz,
  requested_via text check (requested_via in ('site','chat')),
  content jsonb,
  error text
);

create table job_runs (
  id bigserial primary key,
  job text,
  started_at timestamptz,
  finished_at timestamptz,
  status text,
  message text
);

-- Signups are disabled, so the only authenticated user is the owner.
-- The service role bypasses RLS.
alter table instruments enable row level security;
alter table daily_prices enable row level security;
alter table watchlist enable row level security;
alter table levels enable row level security;
alter table rotation_snapshots enable row level security;
alter table daily_summaries enable row level security;
alter table reports enable row level security;
alter table job_runs enable row level security;

create policy owner_all on instruments for all to authenticated using (true) with check (true);
create policy owner_all on daily_prices for all to authenticated using (true) with check (true);
create policy owner_all on watchlist for all to authenticated using (true) with check (true);
create policy owner_all on levels for all to authenticated using (true) with check (true);
create policy owner_all on rotation_snapshots for all to authenticated using (true) with check (true);
create policy owner_all on daily_summaries for all to authenticated using (true) with check (true);
create policy owner_all on reports for all to authenticated using (true) with check (true);
create policy owner_all on job_runs for all to authenticated using (true) with check (true);
