-- All data access goes through server code using the service-role key, which bypasses RLS.
-- The open "owner_all" policies only widened access for any authenticated session, so drop them.
-- RLS stays enabled on every table, so anon and authenticated clients are denied.
drop policy if exists owner_all on instruments;
drop policy if exists owner_all on daily_prices;
drop policy if exists owner_all on watchlist;
drop policy if exists owner_all on levels;
drop policy if exists owner_all on rotation_snapshots;
drop policy if exists owner_all on daily_summaries;
drop policy if exists owner_all on reports;
drop policy if exists owner_all on job_runs;
