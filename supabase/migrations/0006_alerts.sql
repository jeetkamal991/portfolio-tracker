create table if not exists alerts (
  id bigserial primary key,
  instrument_id bigint not null references instruments on delete cascade,
  condition text not null,
  value numeric,
  mode text not null default 'once' check (mode in ('once','repeat')),
  active boolean not null default true,
  source text not null default 'user' check (source in ('user','holding')),
  last_state boolean, last_level text check (last_level in ('none','near','hit')),
  last_fired_at timestamptz,
  created_at timestamptz not null default now());
create unique index if not exists alerts_holding_unique on alerts (instrument_id, condition) where source = 'holding';
create table if not exists alert_events (
  id bigserial primary key,
  alert_id bigint references alerts on delete set null,
  instrument_id bigint not null references instruments on delete cascade,
  fired_at timestamptz not null default now(),
  price numeric, message text not null,
  read boolean not null default false,
  telegram_status text);
create index if not exists alert_events_fired_idx on alert_events (fired_at desc);
alter table alerts enable row level security;
alter table alert_events enable row level security;
