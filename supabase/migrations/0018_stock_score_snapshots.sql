-- Prospective score history. enhanced_v2 lives here; legacy_v1 stays in daily_prices. Never mix versions in one ranking.
create table if not exists stock_score_snapshots (
  id bigint generated always as identity primary key,
  instrument_id bigint not null references instruments on delete cascade,
  symbol text not null,
  evaluation_date date not null,
  scoring_version text not null,
  technical_score numeric check (technical_score is null or (technical_score >= 0 and technical_score <= 100)),
  trade_quality_score numeric check (trade_quality_score is null or (trade_quality_score >= 0 and trade_quality_score <= 100)),
  fundamental_score numeric check (fundamental_score is null or (fundamental_score >= 0 and fundamental_score <= 100)),
  data_confidence numeric check (data_confidence is null or (data_confidence >= 0 and data_confidence <= 100)),
  category_breakdown jsonb not null,
  data_coverage jsonb not null,
  data_timestamp timestamptz not null,
  created_at timestamptz not null default now(),
  unique (instrument_id, evaluation_date, scoring_version));
create index if not exists stock_score_snapshots_date_version_idx on stock_score_snapshots (scoring_version, evaluation_date);
create index if not exists stock_score_snapshots_symbol_idx on stock_score_snapshots (symbol, evaluation_date);
comment on column stock_score_snapshots.data_timestamp is 'Timestamp of the newest price bar the scores were computed from (end of that IST session).';
alter table stock_score_snapshots enable row level security;
