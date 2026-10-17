-- Redesign stage 1: EMA 20 joins the stored indicators (computed by computeIndicators).
alter table daily_prices add column if not exists ema20 numeric;
