-- Tells the owner a requested stock report is ready to read: every report that reaches 'done'
-- adds an unread row to alert_events, so the top-bar bell counts it like a fired alert and the
-- Alerts tab lists it (alert_id null, the way the stage 6 test events were written).
-- A trigger, not a change to complete_report (0007), because the report task also writes a
-- finished report with a plain insert (docs/claude-tasks/stock-report.md section 5).
create or replace function notify_report_ready() returns trigger language plpgsql as $$
begin
  -- re-saving a report that was already done is not news
  if tg_op = 'UPDATE' and old.status = 'done' then
    return null;
  end if;
  -- the join drops a report with no instrument; alert_events.instrument_id is not null
  insert into alert_events (alert_id, instrument_id, message)
  select null, i.id, '📄 ' || i.key || ' report is ready to read'
  from instruments i where i.id = new.instrument_id;
  return null;
end;
$$;

drop trigger if exists reports_ready_notify on reports;
create trigger reports_ready_notify
after insert or update on reports
for each row when (new.status = 'done')
execute function notify_report_ready();

revoke execute on function notify_report_ready() from public, anon, authenticated;
