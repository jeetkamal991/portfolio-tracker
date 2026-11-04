-- Only ~1% of daily_prices rows carry a score, so index just those (was a 31 MB full index).
create index if not exists daily_prices_score_idx_new on daily_prices (date, score) where score is not null;
drop index if exists daily_prices_score_idx;
alter index daily_prices_score_idx_new rename to daily_prices_score_idx;
-- One-off, run by hand after big updates: vacuum (full, analyze) daily_prices;  (265 MB -> 155 MB on 4 Nov 2026)
