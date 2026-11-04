-- NSE daily delivery data (sec_bhavdata_full). Only the 100 most traded stocks (by value) per day are kept,
-- which bounds the table to ~100 rows a day. turnover_rank is that day's rank, 1 = most traded.
create table if not exists delivery_daily (
  symbol text not null,
  date date not null,
  turnover_lacs numeric not null,
  traded_qty numeric,
  deliv_qty numeric,
  deliv_per numeric not null,
  close numeric,
  turnover_rank integer not null,
  primary key (symbol, date));
create index if not exists delivery_daily_date_idx on delivery_daily (date);
comment on table delivery_daily is 'NSE EQ-series delivery % for the top 100 stocks by traded value each day; deliv_per is a percent (63.4 = 63.4%).';
alter table delivery_daily enable row level security;
