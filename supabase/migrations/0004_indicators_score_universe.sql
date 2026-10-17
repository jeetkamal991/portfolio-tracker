-- Redesign stage 2: more stored indicators, the Technical Score, and index constituents.
alter table daily_prices
  add column if not exists macd numeric, add column if not exists macd_signal numeric, add column if not exists macd_hist numeric,
  add column if not exists bb_upper numeric, add column if not exists bb_middle numeric, add column if not exists bb_lower numeric,
  add column if not exists vol_avg20 numeric, add column if not exists high_52w numeric, add column if not exists low_52w numeric,
  add column if not exists patterns jsonb, add column if not exists rs_vs_sector numeric,
  add column if not exists score numeric, add column if not exists score_components jsonb,
  add column if not exists score_label text, add column if not exists score_confidence text, add column if not exists score_signal text;
create table if not exists index_constituents (
  index_key text not null, instrument_id bigint not null references instruments on delete cascade,
  primary key (index_key, instrument_id));
alter table index_constituents enable row level security;
create index if not exists daily_prices_score_idx on daily_prices (date, score);
