-- Audit trail for corrections to stored daily prices. Every changed value is recorded here BEFORE it is changed,
-- so a correction can be reverted exactly (see scripts/correct-price-history.ts --revert <batch_id>).
create table if not exists price_corrections (
  id bigint generated always as identity primary key,
  batch_id text not null,
  instrument_id bigint not null references instruments on delete cascade,
  date date not null,
  field text not null check (field in ('open', 'high', 'low', 'close', 'volume')),
  old_value numeric,
  new_value numeric,
  factor numeric,
  reason text not null,
  source text not null,
  applied_at timestamptz not null default now(),
  reverted_at timestamptz);
create index if not exists price_corrections_batch_idx on price_corrections (batch_id);
create index if not exists price_corrections_instrument_idx on price_corrections (instrument_id, date);
comment on table price_corrections is 'Previous and corrected values of stored daily prices, one row per field changed; reverted_at is set when a batch is rolled back.';
alter table price_corrections enable row level security;
