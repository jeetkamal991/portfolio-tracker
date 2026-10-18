create table if not exists holdings (
  instrument_id bigint primary key references instruments on delete cascade,
  quantity numeric not null check (quantity > 0),
  avg_price numeric not null check (avg_price > 0),
  buy_date date not null,
  stop_loss numeric, target1 numeric, target2 numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now());
alter table holdings enable row level security;
