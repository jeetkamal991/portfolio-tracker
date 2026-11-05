-- Resumable, chunked snapshot runs: one row per (run_date, scoring_version). next_offset is the cursor into the ordered universe.
create table if not exists score_runs (
  id bigint generated always as identity primary key,
  run_date date not null,
  scoring_version text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'completed', 'failed')),
  total integer not null,
  next_offset integer not null default 0,
  processed integer not null default 0,
  failed jsonb not null default '[]',
  batches integer not null default 0,
  max_batches integer not null default 12,
  locked_until timestamptz,
  last_success_at timestamptz,
  finished_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  unique (run_date, scoring_version));
comment on column score_runs.failed is 'Array of {key, attempts, error} for symbols that threw; retried at the end of the run up to the per-symbol limit.';
alter table score_runs enable row level security;
