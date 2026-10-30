# Research assistant and Backtest reports Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Research assistant" chat tab that drives the owner's local Claude Code CLI with read-only data tools, and rename the Backtests tab "Backtest reports".

**Architecture:** `POST /api/assistant` spawns the native `claude.exe` with a locked-down argument set (tool allow-list per mode), parses its `stream-json` output into UI events and relays them as server-sent events. Data tools are `npm run tracker -- <tool>` scripts over the existing `Repo`. Chats persist in an `assistant_sessions` table. The page streams, renders steps and markdown answers.

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, vitest, tsx, Supabase (`Repo` interface with memory and Supabase implementations), `react-markdown` + `remark-gfm`.

**Spec:** `docs/superpowers/specs/2026-10-27-research-assistant-design.md` (read it first; it holds the verified CLI facts).

## Global Constraints

- Branch: new branch `feat/research-assistant` created from current HEAD (`feat/stage6b-shareholding`), not `main`.
- Do NOT use `--bare` (ignores the subscription login). Default model `claude-sonnet-5-5`; `--model` overrides.
- Spawn the native `claude.exe` directly with an argument array; no shell. `CLAUDE_BIN` overrides.
- CLI args: `-p <message> --output-format stream-json --verbose --include-partial-messages --setting-sources project --permission-mode dontAsk --disable-slash-commands --max-budget-usd <ASSISTANT_MAX_USD, default 1>`; working folder `assistant/`.
- Research mode (`holdings:false`, default): `--tools Bash,WebSearch,WebFetch`; allowed `Bash(npm run tracker -- find *)`, `... stock *`, `... screeners*`, `... alphas*`, `... market*`, `Bash(npm run backtest *)`, `WebSearch`, `WebFetch`.
- Holdings mode (`holdings:true`): `--tools Bash`; same Bash list plus `Bash(npm run tracker -- portfolio*)`; NO web tools. Holdings and web never share a run.
- Limits: one run at a time (409 "busy"); `ASSISTANT_TIMEOUT_MS` default 600000; message at most 4,000 chars; 501 "The assistant runs only on your PC" when `process.env.VERCEL` is set; route requires sign-in like every `/api` route (check how `src/lib/auth` gates `/api`).
- `step_end` output excerpt at most 2,000 chars. `Saved as run N` in a backtest step output adds N to report ids.
- Tracker tools are read-only, capped output, read `.env.local` from the repo root regardless of cwd; `stock` never prints quantity or prices paid.
- New deps: `react-markdown`, `remark-gfm` only. App is dark-only.
- Migration `0011_assistant_sessions.sql` is written but applied only after asking the owner.
- Existing conventions: handlers in `src/lib/api/*.ts` return `{status, body}`; `getRepo()` from `src/lib/api/server.ts`; scripts call `process.loadEnvFile(".env.local")`; tests live under `tests/<area>/`.

## Review Focus

- Message containing shell metacharacters (`; & | $( )`, quotes, newlines, leading `-`): passed as a single argv entry, never interpreted.
- CLI emits a half line, a blank line, or non-JSON noise: skipped, run continues.
- Client disconnects mid-run: process killed, the busy lock released, partial text saved with the turn marked.
- `--resume` with a missing transcript: fresh session, user told.
- Holdings mode request carrying `model` or crafted fields: still no web tools (args built only from the `holdings` boolean).
- Two sessions started back to back: second gets 409, lock frees after the first ends or errors.

---

### Task 1: Branch, dependencies, assistant folder, CLI argument builder

**Files:**
- Create: `assistant/CLAUDE.md`, `src/lib/assistant/args.ts`, `tests/assistant/args.test.ts`
- Modify: `package.json`

**Interfaces:**
- Produces: `buildArgs(o: { message: string; holdings: boolean; model?: string; resume?: string; maxUsd?: number }): string[]` and `ALLOWED_BASH: string[]`, `HOLDINGS_BASH: string`.

- [x] **Step 1:** `git checkout -b feat/research-assistant`; `npm i react-markdown remark-gfm`.
- [x] **Step 2: Write failing tests** in `tests/assistant/args.test.ts`: research args contain `--tools Bash,WebSearch,WebFetch` and every allow entry from Global Constraints and no `portfolio`; holdings args have `--tools Bash`, contain `Bash(npm run tracker -- portfolio*)`, and contain neither `WebSearch` nor `WebFetch`; `--model X` present only when set; `--resume id` present only when set; `--max-budget-usd 1` default and `2.5` when given; the message is exactly one array element following `-p` (test with `"a; rm -rf / $(x) --tools"`); `--bare` never present.
- [x] **Step 3:** Run `npx vitest run tests/assistant/args.test.ts`; expect FAIL (module missing).
- [x] **Step 4:** Implement `buildArgs` in `src/lib/assistant/args.ts` (allow-list passed via one `--allowedTools` value per spec; join entries with spaces/commas per the CLI help, verified in Task 8).
- [x] **Step 5:** Write `assistant/CLAUDE.md` from the spec section "The assistant's instructions" (verbatim intent: tools first, no invented numbers, cite source, state backtest parameters, caveats and "check data" trades, ideas not advice, short, supported strategies = six alphas, eight screener rules, hold, random, rupees and NSE keys).
- [x] **Step 6:** Run the test; expect PASS. Commit `feat(assistant): CLI argument builder and instructions`.

### Task 2: Stream parser

**Files:**
- Create: `src/lib/assistant/stream.ts`, `tests/assistant/stream.test.ts`

**Interfaces:**
- Produces: `type AssistantEvent = {type:"text";delta:string} | {type:"step_start";id:string;name:string;summary:string} | {type:"step_end";id:string;ok:boolean;output:string} | {type:"done";inputTokens:number;outputTokens:number;costUsd:number;turns:number;durationMs:number;denials:number;reports:number[];cliSessionId:string|null} | {type:"error";message:string}`; `createStreamParser(): { push(chunk: string): AssistantEvent[]; end(): AssistantEvent[] }`.

- [x] **Step 1: Write failing tests** with recorded-shape fixture lines: a chunk split mid-line yields nothing until the newline; `stream_event` text delta -> `text`; `assistant` `tool_use` (Bash with `input.command`, WebSearch `input.query`, WebFetch `input.url`) -> `step_start` with summary = that field; `user` `tool_result` pairs by `tool_use_id` -> `step_end` (ok = not `is_error`, output cut to 2,000 chars); final `result` -> `done` with usage, `total_cost_usd`, `num_turns`, `permission_denials.length`, `session_id`; output containing `Saved as run 7` from a Bash step adds 7 to `reports`; blank and malformed lines skipped; `result` with `is_error` -> also an `error` event.
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement the parser (line buffer; map of open tool ids; text only from `stream_event` deltas, not from the duplicate full `assistant` text blocks).
- [x] **Step 4:** Run; expect PASS. Commit `feat(assistant): stream parser`.

### Task 3: Session storage

**Files:**
- Create: `supabase/migrations/0011_assistant_sessions.sql`, `tests/db/assistantSessions.test.ts`
- Modify: `src/lib/db/types.ts`, `repo.ts`, `memoryRepo.ts`, `supabaseRepo.ts`

**Interfaces:**
- Produces in `types.ts`: `AssistantMessage = {role:"user";text:string} | {role:"assistant";steps:{id:string;name:string;summary:string;ok:boolean;output:string}[];text:string;usage:{inputTokens:number;outputTokens:number;costUsd:number}|null;reports:number[];error?:string}`; `AssistantSession {id:number;createdAt:string;updatedAt:string;title:string;cliSessionId:string|null;messages:AssistantMessage[]}`; `AssistantSessionSummary = Omit<AssistantSession,"messages">`.
- Repo methods: `createAssistantSession(title:string): Promise<number>`; `updateAssistantSession(id:number, p:{cliSessionId?:string|null;messages?:AssistantMessage[]}): Promise<void>` (sets `updatedAt`); `listAssistantSessions(): Promise<AssistantSessionSummary[]>` newest first; `getAssistantSession(id:number): Promise<AssistantSession|null>`; `deleteAssistantSession(id:number): Promise<void>`.

- [x] **Step 1: Write failing tests** on the memory repo: create+get round trip; update changes messages and `updatedAt`; list is newest-updated first and has no `messages`; delete removes; get of unknown id is null. Add one test for the Supabase repo using the fake client pattern in `tests/db/supabaseRepo.paging.test.ts` covering the create->get column mapping (`cli_session_id`, `messages`).
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Add the methods (mirror `saveBacktestRun`/`getBacktestRun` style) and write migration `0011` (columns per spec; RLS on, no policies; comment like 0010).
- [x] **Step 4:** `npm test`, `npm run typecheck`; expect PASS. Commit `feat(db): assistant sessions`.

### Task 4: Data tools (`npm run tracker`)

**Files:**
- Create: `scripts/tracker.ts`, `src/lib/assistant/tools/{find,stock,screeners,alphas,market,portfolio}.ts`, `tests/assistant/tools.test.ts`
- Modify: `package.json` (`"tracker": "tsx scripts/tracker.ts"`)

**Interfaces:**
- Produces, each `(repo: Repo, args: string[]) => Promise<string>`: `findTool`, `stockTool`, `screenersTool`, `alphasTool`, `marketTool`, `portfolioTool`; `scripts/tracker.ts` dispatches `argv[2]` to them, loads env from the repo root (resolve relative to the script file, not cwd), prints the result, exits 1 with message on unknown tool.
- Reuse existing builders: `buildPopupData` (`src/lib/view/popup.ts`), `buildPortfolioView`, existing alpha/screener/breadth/sector/daily-summary code behind the Market page (read `src/app/(app)/market/page.tsx` and `src/lib/view/market.ts` to see what it calls; call the same functions, do not reimplement).

- [x] **Step 1: Write failing tests** on the memory repo seeded with a few instruments: `find` lists matches by key and name and caps at 10; `stock RELIANCE` output contains close, RSI, Technical Score, an alpha rank line, holding change when present, last 10 bars (cap), and does NOT contain the holding's quantity or average price when a holding exists; unknown key -> "Not found" text; `screeners`, `alphas` (notes the #1/#54 tie), `market` include their headline figures and respect a line cap; `portfolio` prints holdings with P/L and warnings.
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement each formatter (plain text, tables as aligned text, hard cap ~6,000 chars per tool) and the dispatcher.
- [x] **Step 4:** Run tests; expect PASS. Smoke by hand: `npm run tracker -- find RELI` prints rows.
- [x] **Step 5:** Commit `feat(assistant): read-only data tools`.

### Task 5: Runner (spawn, lock, timeout, abort)

**Files:**
- Create: `src/lib/assistant/runner.ts`, `tests/assistant/runner.test.ts`, `tests/assistant/fakeCli.mjs`

**Interfaces:**
- Consumes: `buildArgs`, `createStreamParser`.
- Produces: `class BusyError extends Error`; `runAssistant(o: { args: string[]; cwd: string; signal: AbortSignal; timeoutMs: number; bin?: string; spawnFn?: typeof spawn }, onEvent: (e: AssistantEvent) => void): Promise<void>` holding a module-level single-run lock; `resolveClaudeBin(env: NodeJS.ProcessEnv): string` (`CLAUDE_BIN`, else native binary beside `claude` on PATH, else `"claude"`).

- [x] **Step 1: Write failing tests** using `fakeCli.mjs` (a node script that prints canned stream lines, optionally sleeps): events arrive in order; a second concurrent call throws `BusyError` and the lock frees after completion and after an error; abort signal kills the child and resolves; timeout kills the child and emits an `error` event "timed out"; spawn failure (`ENOENT`) emits an `error` with the `claude login`/install hint; stderr noise does not throw.
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement with `child_process.spawn(bin, args, {cwd, shell:false})`; on abort/timeout send SIGINT then SIGTERM after 2 s (on Windows `kill()` directly); always release the lock in `finally`.
- [x] **Step 4:** Run; expect PASS. Commit `feat(assistant): CLI runner`.

### Task 6: API route and session persistence

**Files:**
- Create: `src/lib/api/assistant.ts`, `src/app/api/assistant/route.ts`, `src/app/api/assistant/sessions/[id]/route.ts`, `tests/api/assistant.test.ts`

**Interfaces:**
- Consumes: `buildArgs`, `runAssistant`, `BusyError`, Repo session methods.
- Produces: `handleAssistantRun(deps: { repo: Repo; run: typeof runAssistant; env: NodeJS.ProcessEnv; signal: AbortSignal }, body: unknown): Promise<{status:number;body:unknown} | {stream: ReadableStream<Uint8Array>}>`; SSE frames `event: <type>\ndata: <json>\n\n`; first frame `session` with `{id}`.

- [x] **Step 1: Write failing tests** with an injected fake `run`: 501 when `env.VERCEL` set; 400 for empty, over 4,000 chars, or non-boolean `holdings`; 409 on `BusyError`; a good run creates a session (title = first 60 chars), streams `session`, `text`, `step_start`, `step_end`, `done`, and afterwards the stored session has the user message, the assistant message with steps, text, usage and report ids and the CLI session id; sending `sessionId` resumes (`--resume <cliSessionId>` in args); a resume whose run reports a failure emits a note and retries once without `--resume`; aborting the signal stores the partial text with `error: "Stopped"`; holdings true => args lack web tools regardless of `model` input; unknown `sessionId` -> 404.
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement the handler; route files wire `getRepo()`, `process.env`, `req.signal`, return `new Response(stream, {headers:{"Content-Type":"text/event-stream","Cache-Control":"no-store"}})`; `export const dynamic="force-dynamic"`, `maxDuration` set high. DELETE route calls `deleteAssistantSession`. Confirm `/api/assistant` is covered by the existing sign-in gate (`src/lib/auth`), add a test line to the auth tests if paths are enumerated.
- [x] **Step 4:** Run; expect PASS. Commit `feat(assistant): API route`.

### Task 7: Page, components, tabs

**Files:**
- Create: `src/app/(app)/assistant/page.tsx`, `src/app/components/assistant/{Chat,Composer,Steps,Answer,ReportCard,SessionList}.tsx`, `src/lib/view/assistant.ts`, `tests/view/assistant.test.ts`
- Modify: `src/lib/view/shell.ts`, `tests/view/shell.test.ts` (if present), `src/app/(app)/backtests/page.tsx` panel titles

**Interfaces:**
- Produces in `src/lib/view/assistant.ts`: `stepLabel(name:string, summary:string): string` ("Pulled RELIANCE indicators", "Searched the web: <query>", "Fetched <url>", "Ran backtest"); `fmtCost(usd:number): string`; `applyEvent(turn: AssistantTurn, e: AssistantEvent): AssistantTurn` (pure reducer used by Chat); `STARTERS: {label:string; text:string; holdings:boolean}[]` (three chips; only "Review my holdings" has `holdings:true`).
- `TABS`: insert `{ href: "/assistant", label: "Research assistant" }` before Backtests and relabel `/backtests` as "Backtest reports".

- [x] **Step 1: Write failing tests** for `stepLabel`, `applyEvent` (text accumulates, step start/end pair, done sets usage/reports, error sets error), `STARTERS` holdings flags, and `TABS` (both labels; `activeTab("/assistant")` is `/assistant`).
- [x] **Step 2:** Run; expect FAIL.
- [x] **Step 3:** Implement the view module and TABS change.
- [x] **Step 4:** Build the page: server component loads `listAssistantSessions()` (try/catch with a "apply migration 0011" panel like the backtests page) and, for `?s=<id>`, `getAssistantSession`; `Chat` (client) posts to `/api/assistant`, reads the SSE stream via `fetch` + `ReadableStream`, reduces with `applyEvent`, Stop via `AbortController`; `Composer` (Enter sends, Shift+Enter newline, Stop while running, "Include my holdings" switch off by default, model picker Sonnet/Opus remembered in `localStorage` inside try/catch); `Steps` collapsed rows expanding to raw output; `Answer` uses `react-markdown` + `remark-gfm` (tables styled for the dark theme); `ReportCard` links `/backtests/N`; `SessionList` with delete, slide-over on phones. On a 501 response show "The assistant runs only on your PC"; on the deployed site past chats are read-only. Follow the look of existing Panel/dark tokens.
- [x] **Step 5:** `npm test`, `npm run typecheck`, `npm run lint`; expect all pass.
- [x] **Step 6:** Start `npm run dev`, screenshot in a real browser (per owner memory: verify UI visually): empty state, a streamed answer with steps and a report card (use a fake CLI via `CLAUDE_BIN` pointing at `fakeCli.mjs`), an error banner, phone width. Look at them; fix what is off.
- [x] **Step 7:** Commit `feat(ui): Research assistant tab`.

### Task 8: `assistant-check` against the real CLI, then end-to-end

**Files:**
- Create: `scripts/assistant-check.ts`
- Modify: `package.json` (`"assistant-check": "tsx scripts/assistant-check.ts"`), `src/lib/assistant/args.ts` if a switch needs adjusting

- [x] **Step 1:** Implement the check (not part of `npm test`): runs the real CLI with `buildArgs` and prints PASS/FAIL for: a listed command runs; an unlisted file-writing command is refused and no file is created; the init message's tool list contains only the intended tools in each mode; no skills load; auto-memory is off (find and use the actual switch, record it in `args.ts` and the spec); a repo-root `CLAUDE.md` is not picked up from `assistant/`; `npm run tracker -- find x` and `npm run backtest -- --help`-style calls work from `assistant/` (otherwise switch the allow-list and tool usage to `npm --prefix ..`; update Task 1 strings and tests accordingly).
- [x] **Step 2:** Run `npm run assistant-check`; every line PASS. Fix args until it does.
- [ ] **Step 3:** Ask the owner before applying migration `0011`. After approval, apply it, then end to end on real data in the browser: stock research with web news, a strategy test whose report opens under Backtest reports, a holdings review (confirm no web steps appear in that run), and Stop mid-run.
- [x] **Step 4:** Add a short section to the project docs (where Backtests is documented) on running the assistant, env settings (`CLAUDE_BIN`, `ASSISTANT_MODEL`, `ASSISTANT_MAX_USD`, `ASSISTANT_TIMEOUT_MS`) and `assistant-check`. Commit `docs: research assistant`.

## Status (2026-10-30)

Tasks 1-8 are built and committed on `feat/research-assistant`; 747 tests, typecheck, lint and `npm run build` pass, and migration `0011` is applied to Tracker1. Step 3 of Task 8 is the only open item: it needs the signed-in browser, which only the owner can reach. The look was checked by static render instead (desktop 1280 and a true 390 px viewport, dark): empty state, a finished answer with steps, table, report card and cost line, and a stopped run. Two fixes came out of it (`2ee4453`).

## Self-review notes

- Spec coverage: structure, run, events, limits, settings (Tasks 1, 2, 5, 6); data tools (4); instructions (1); security split (1, 6, 8); sessions and page (3, 7); failure handling (5, 6); testing and checks (all, 8); success criteria 1-7 (7, 8). Migration applied only after asking (8).
- Open item carried from the spec: the exact auto-memory switch is discovered in Task 8.
