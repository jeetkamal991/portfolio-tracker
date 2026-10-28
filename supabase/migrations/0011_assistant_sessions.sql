-- Research assistant chats. Written by /api/assistant (service role), read by the Research assistant tab.
-- messages is an array of { role: "user", text } or { role: "assistant", steps, text, usage, reports, error? }.
create table if not exists assistant_sessions (
  id bigserial primary key,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  title text not null,
  cli_session_id text,
  messages jsonb not null default '[]'::jsonb);
comment on table assistant_sessions is 'Research assistant chats; cli_session_id is the Claude Code CLI session used for --resume on the owner''s PC.';
alter table assistant_sessions enable row level security;
