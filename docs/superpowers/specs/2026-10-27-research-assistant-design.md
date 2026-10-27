# Research assistant and Backtest reports tabs (Vibe-Trading sub-project 3, reshaped)

Date: 2026-10-27. Builds on the merged alpha screeners and backtesting work (`docs/superpowers/specs/2026-10-27-factor-alpha-screeners-design.md`, `docs/superpowers/specs/2026-10-27-backtesting-design.md`). Start implementation on a new branch from the current HEAD (`feat/stage6b-shareholding`), not `main`, which lacks stage 6b, the alphas and backtesting.

## Context and intent

The owner liked Vibe-Trading (https://github.com/HKUDS/Vibe-Trading, MIT). Their reference is its web UI: a sidebar with **Research assistant** (a chat: "Research a stock", "Test a strategy", "Review my holdings"; it pulls data, runs the numbers and shows every step) and **Backtest reports** (browse what it produced). They want those as two tabs in the Tracker site. Sub-project 2 built a command-line backtester and a read-only reports page because "where it runs" was answered as "local script"; the owner then said that was the wrong path: they want to talk to it, not run commands.

Decisions made in brainstorming:
- **Two tabs:** "Research assistant" (new) and "Backtest reports" (the existing Backtests tab, renamed; same route `/backtests`).
- **The assistant runs locally on the owner's Claude login** (option A), like Vibe-Trading's "Claude Code CLI (local login)": the site's API route drives the installed Claude Code CLI. No API key, no per-message bill; usage counts against the owner's Claude plan. It only works while the site runs on the owner's PC (`npm run dev`); on Vercel the tab says so. Saved reports and past chats still show on the deployed site.
- **Web access is on** (WebSearch and WebFetch) for stock research.
- **Holdings and the web never share a run** (see Security).
- Single user, free tiers, no live trading.

Roadmap: 1) alpha screeners (merged), 2) backtesting (merged), 3) this.

## Verified facts about the CLI (spiked 2026-10-27 on Claude Code 2.1.311)

- `claude -p <msg> --output-format stream-json --verbose --include-partial-messages` streams newline-delimited JSON: `system/init`, `stream_event` text deltas, `assistant` messages with `tool_use` blocks, `user` messages with `tool_result` blocks, and a final `result` with `session_id`, `usage`, `total_cost_usd`, `num_turns` and `permission_denials`.
- The owner's login is used (no API key). Do **not** use `--bare`: it ignores the subscription login. Default model is `claude-sonnet-5-5`; `--model` overrides.
- `--resume <session_id>` continues a conversation (the CLI keeps the transcript on this PC).
- On Windows, spawn the native `claude.exe` directly with an argument array (the `claude.cmd` shim just forwards to `node_modules/@anthropic-ai/claude-code/bin/claude.exe`); no shell quoting.
- `--permission-mode dontAsk` plus `--allowedTools "Bash(<prefix> *)"`: a listed command ran; a command that writes a file and is not listed was refused (no file created, `permission_denials` filled). `echo` is in the CLI's built-in read-only set and runs regardless, so it is not a valid test command.
- `--tools Bash` limits the built-in tools to Bash only; `--disable-slash-commands` removes all skills; `--setting-sources project` kept the owner's user-level plugins, hooks and instructions out (three plugins still load but are inert, and the model reported no ponytail/superpowers/vercel instructions). Per-call context was 5,000 to 30,000 tokens, with one unexplained 119,000-token outlier; cost estimates ran from about 0.005 to 0.48 dollars per call.

Still to verify in the first build step (the `assistant-check` script covers them): the exact switch that turns auto-memory off; that `CLAUDE.md` discovery from the working folder does not pick up a repo-root file; and that `npm run tracker -- ...` and `npm run backtest -- ...` work when the CLI's working folder is `assistant/` (otherwise use `npm --prefix`).

## Structure

```
assistant/CLAUDE.md                          the assistant's instructions (its own working folder)
scripts/tracker.ts                           npm run tracker -- <tool>: read-only data tools
scripts/assistant-check.ts                   npm run assistant-check: proves the CLI guarantees on this PC
src/lib/assistant/args.ts                    builds the CLI arguments (model, resume, tool sets per mode, budget)
src/lib/assistant/stream.ts                  parses the CLI stream into UI events
src/lib/assistant/runner.ts                  spawns the CLI: one run at a time, timeout, abort
src/lib/assistant/tools/*.ts                 the data tools' formatters (find, stock, screeners, alphas, market, portfolio)
src/app/api/assistant/route.ts               POST: streams a run as server-sent events
src/app/api/assistant/sessions/[id]/route.ts DELETE a session
supabase/migrations/0011_assistant_sessions.sql
src/lib/db/types.ts, repo.ts, memoryRepo.ts, supabaseRepo.ts   assistant session methods
src/app/(app)/assistant/page.tsx             the chat page (?s=<id> opens a session)
src/app/components/assistant/*               Chat, Composer, Steps, Answer, ReportCard, SessionList
src/lib/view/shell.ts                        TABS: add { "/assistant", "Research assistant" }, relabel "/backtests" as "Backtest reports"
```

## The run

`POST /api/assistant` with `{ sessionId?: number, message: string, holdings: boolean, model?: string }`.

CLI arguments: `-p <message> --output-format stream-json --verbose --include-partial-messages --setting-sources project --permission-mode dontAsk --disable-slash-commands --max-budget-usd <ASSISTANT_MAX_USD, default 1>`, plus `--model` when set, `--resume <cliSessionId>` for an existing session, and the tool set for the mode. Working folder `assistant/`. Auto-memory off.

Tool sets:
- **Research mode** (`holdings: false`, the default): `--tools Bash,WebSearch,WebFetch`; allowed: `Bash(npm run tracker -- find *)`, `... stock *`, `... screeners*`, `... alphas*`, `... market*`, `Bash(npm run backtest *)`, `WebSearch`, `WebFetch`.
- **Holdings mode** (`holdings: true`): `--tools Bash`; the same Bash allow-list plus `Bash(npm run tracker -- portfolio*)`; **no** web tools.

Events streamed to the page (server-sent events): `session` (the stored session id), `text` (a delta), `step_start` (id, tool name, a short summary: the command for Bash, the query for WebSearch, the URL for WebFetch), `step_end` (id, ok, output excerpt of at most 2,000 characters), `done` (input and output tokens, estimated cost, turns, duration, permission denials, saved report ids), `error` (message). A `step_end` for a backtest whose output contains `Saved as run N` adds N to the saved report ids; the page shows it as a "Backtest report #N" card linking to `/backtests/N`.

Limits: one run at a time across the app (a second request gets 409 "busy"); a run over `ASSISTANT_TIMEOUT_MS` (default 600000) is stopped; Stop, or a closed connection, ends the CLI process (interrupt, then terminate); message length at most 4,000 characters; the route returns 501 "The assistant runs only on your PC" when `process.env.VERCEL` is set, and requires sign-in like every `/api` route.

Settings: `CLAUDE_BIN` (path to the CLI; default: the native binary found next to `claude` on PATH, else `claude`), `ASSISTANT_MODEL`, `ASSISTANT_MAX_USD`, `ASSISTANT_TIMEOUT_MS`.

## Data tools (`npm run tracker -- <tool>`)

Read-only wrappers over existing code through the existing `Repo`, output capped so the context stays small, `.env.local` read from the repo root regardless of the working folder:
- `find <text>`: instruments matching a name or key.
- `stock <KEY>`: latest close and day move; EMA 20/50/200, RSI, MACD, Bollinger, 52-week range; the Technical Score and label; today's rank and value on each of the six alphas; patterns; support and resistance; the latest FII/DII/promoter holding and its change; the last 10 bars; the latest stored Claude report if any. It never prints the owner's quantity or prices.
- `screeners`: today's hits for the existing screeners.
- `alphas [--alpha <id>]`: today's top and bottom per alpha, with a note that alphas #1 and #54 tie.
- `market`: Nifty and VIX, breadth, sector rotation top and bottom, the latest daily summary.
- `portfolio`: holdings with P/L and warnings (holdings mode only).
- Backtests use the existing `npm run backtest -- ...`; a run saves a report as before.

## The assistant's instructions (`assistant/CLAUDE.md`)

Use the tools first and never invent numbers; say which tool or search a figure came from; for a backtest state what was run (strategy, parameters, period) and read the metrics against Nifty 50; always give the backtest caveats and mention any trade marked "check data"; frame everything as ideas for the owner's own research, not advice; keep answers short; if asked for a strategy the backtester does not support, say what is supported (the six alphas, the eight screener rules, hold, random). Use rupees and NSE keys.

## Security

- Only the listed commands and, in research mode, WebSearch and WebFetch can run. No Write, Edit, Task or arbitrary shell. `dontAsk` denies everything else.
- **Holdings and the web never share a run.** The page has an "Include my holdings" switch, off by default; on, the `portfolio` tool exists and the web tools do not. The "Review my holdings" starter chip turns it on. No other tool prints holdings. This closes the path where a malicious page makes the assistant put holdings into a search or fetch URL.
- The route runs processes on the host, so it requires sign-in and refuses to run on Vercel.

## Sessions and the page

Table `assistant_sessions` (migration `0011`), RLS on with no policies: `id bigserial`, `created_at`, `updated_at`, `title text` (the first 60 characters of the first message), `cli_session_id text`, `messages jsonb`. Messages are `{ role: "user", text }` or `{ role: "assistant", steps: [{ id, name, summary, ok, output }], text, usage: { inputTokens, outputTokens, costUsd }, reports: number[], error? }`. Repo methods: `createAssistantSession`, `updateAssistantSession`, `listAssistantSessions` (newest first, without `messages`), `getAssistantSession`, `deleteAssistantSession`. The migration is applied by the owner, or by Claude only after asking.

`/assistant`: a sessions list on the left (a slide-over on a phone) and the chat on the right. Empty state as in Vibe-Trading: a short heading, three starter chips ("Research a stock", "Test a strategy", "Review my holdings") that only fill the box with an editable example, and a message box (Enter sends, Shift+Enter adds a line, a Stop button while running). An assistant turn shows its steps as collapsed rows ("Pulled RELIANCE indicators", "Searched the web: ..."; click for the raw output), then the answer typed out as formatted text with tables, then tokens and estimated cost, plus a report card when a backtest was saved. A model picker (Sonnet default, Opus) is remembered in the browser. Delete a session; no rename in version 1. Resume needs this PC's CLI transcript; if the transcript is missing the run starts a fresh CLI session and says so. Past chats show read-only on the deployed site.

New dependencies: `react-markdown` and `remark-gfm`, for rendering answers (tables included).

## Failure handling

- CLI missing or not logged in: a plain message with the fix (`claude login`).
- Timeout, budget cap, abort and closed connection: stop the process; show what the assistant had said so far; mark the turn.
- A failing tool shows as a failed step; the assistant sees the error and can adapt.
- A malformed stream line is skipped; a spawn error becomes an `error` event.
- A failed `--resume` starts fresh and says so.
- Empty or over-long messages are rejected; busy and Vercel cases return their codes.

## Testing

- Unit: the stream parser (partial lines, text deltas, tool pairing, usage, denials, malformed lines), the argument builder (including that holdings mode has no web tools and research mode has no `portfolio`), report-card detection, each data tool's output on the memory repo (figures present, caps respected, no quantities in `stock`), and the session repo methods on the memory repo and a fake Supabase client.
- The route with an injected fake CLI: streaming and saving, 501 on Vercel, 409 busy, abort kills the process, resume.
- `npm run assistant-check` against the real CLI: the allow-list permits a listed command and refuses an unlisted write, only the intended tools exist, no skills load, auto-memory is off, and the `npm run` commands work from `assistant/`. Run by hand, not part of `npm test`.
- UI: formatter tests, and real-browser screenshots (the app is dark-only): empty state, a streamed answer with steps and a report card, an error banner, and a phone width.
- End to end on real data, locally: a stock research prompt with web news, a strategy test that creates a report that opens in Backtest reports, and a holdings review.
- `npm run typecheck`, `npm run lint`, `npm test` pass.

## Out of scope

The other Vibe-Trading pages (Factor research, Options analysis, Asset correlation, Pixel Office, Scheduled research, Trading status), image or file input, renaming or sharing chats, live trading, running on Vercel, multi-user, and editing code or files.

## Success criteria

1. The top bar has "Research assistant" and "Backtest reports".
2. The three starter prompts work end to end locally: stock research with web news, a strategy test that creates a report opening in Backtest reports, and a holdings review.
3. Steps are visible while it works, and Stop works.
4. `assistant-check` passes against the real CLI.
5. Holdings and web tools never appear in the same run (tested).
6. Tests, typecheck and lint pass; screenshots were looked at.
7. Migration `0011` is applied only after the owner is asked.
