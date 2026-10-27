-- One row per saved backtest run. Written by `npm run backtest` (service role), read by the Backtests tab.
-- equity is an array of [date, strategy, benchmark]; trades and metrics are JSON built by src/lib/calc/backtest.
create table if not exists backtest_runs (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  name text not null,
  strategy jsonb not null,
  settings jsonb not null,
  metrics jsonb not null,
  equity jsonb not null,
  trades jsonb not null,
  data_through date not null,
  universe_note text not null);
comment on table backtest_runs is 'Saved backtest runs; fractions in metrics (0.12 = 12%), prices in rupees.';
alter table backtest_runs enable row level security;
