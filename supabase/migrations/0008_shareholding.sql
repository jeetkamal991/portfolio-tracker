create table if not exists shareholding (
  instrument_id bigint not null references instruments on delete cascade,
  quarter_end date not null,
  fii_pct numeric check (fii_pct between 0 and 100),
  dii_pct numeric check (dii_pct between 0 and 100),
  promoter_pct numeric check (promoter_pct between 0 and 100),
  source_url text,
  collected_at timestamptz not null default now(),
  primary key (instrument_id, quarter_end));
comment on table shareholding is 'Quarterly shareholding pattern; *_pct are percent numbers (48.1 = 48.1%), not fractions.';
alter table shareholding enable row level security;
