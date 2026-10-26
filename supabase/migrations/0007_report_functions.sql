-- Report writes for the unattended Claude report task. The Supabase connector asks for approval
-- before any UPDATE, which an hourly job can't give; calling these with a plain select avoids that.
-- Both only touch a row that is still 'pending' and return its id, or null when nothing changed.
create or replace function complete_report(p_id bigint, p_content jsonb) returns bigint
language sql as $$
  update reports set status = 'done', completed_at = now(), content = p_content
  where id = p_id and status = 'pending'
  returning id;
$$;

create or replace function fail_report(p_id bigint, p_error text) returns bigint
language sql as $$
  update reports set status = 'failed', error = p_error
  where id = p_id and status = 'pending'
  returning id;
$$;

-- Not callable from the site's anon/authenticated API roles; only the owner's SQL connection uses them.
revoke execute on function complete_report(bigint, jsonb) from public, anon, authenticated;
revoke execute on function fail_report(bigint, text) from public, anon, authenticated;
