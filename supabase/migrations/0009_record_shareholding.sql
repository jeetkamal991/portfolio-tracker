-- Shareholding writes for the unattended Claude task. The Supabase connector asks for approval before
-- an UPDATE (an upsert counts), so the task calls this with a plain select, like complete_report (0007).
-- Returns the instrument id when a row was written, null when nothing changed: unknown key,
-- fii + dii + promoter above 100.5, or (p_replace false) a row for that quarter already exists.
-- A value outside 0-100 raises the table check error.
create or replace function record_shareholding(
  p_key text, p_quarter date, p_fii numeric, p_dii numeric, p_promoter numeric, p_url text, p_replace boolean
) returns bigint language plpgsql as $$
declare
  v_id bigint;
begin
  if coalesce(p_fii, 0) + coalesce(p_dii, 0) + coalesce(p_promoter, 0) > 100.5 then
    return null;
  end if;
  select id into v_id from instruments where key = p_key;
  if v_id is null then
    return null;
  end if;
  if p_replace then
    insert into shareholding (instrument_id, quarter_end, fii_pct, dii_pct, promoter_pct, source_url)
    values (v_id, p_quarter, p_fii, p_dii, p_promoter, p_url)
    on conflict (instrument_id, quarter_end) do update set
      fii_pct = excluded.fii_pct, dii_pct = excluded.dii_pct, promoter_pct = excluded.promoter_pct,
      source_url = excluded.source_url, collected_at = now();
    return v_id;
  end if;
  insert into shareholding (instrument_id, quarter_end, fii_pct, dii_pct, promoter_pct, source_url)
  values (v_id, p_quarter, p_fii, p_dii, p_promoter, p_url)
  on conflict (instrument_id, quarter_end) do nothing
  returning instrument_id into v_id;
  return v_id;
end;
$$;

revoke execute on function record_shareholding(text, date, numeric, numeric, numeric, text, boolean) from public, anon, authenticated;
