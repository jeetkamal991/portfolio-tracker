-- Manually entered next results date per instrument; shown as a warning only, never used in scoring.
alter table levels add column if not exists results_date date;
