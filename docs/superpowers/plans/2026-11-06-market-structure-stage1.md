# Market Structure Engine, Stage 1: implementation plan

Spec: `docs/superpowers/specs/2026-11-06-market-structure-stage1-design.md`. Branch `feature/structure-engine`. Run after every task: `npm run typecheck`, `npm run lint`, `npm test`. Run `npm run build` at the end. Commit locally after each task with `git -c safe.directory=D:/Git/Tracker -c user.name=<name> -c user.email=<email> commit` (no config change, no push).

Order matters: pure code first (no DB), then migration, then storage, then jobs, then UI.

## Task 1: shared pivots and swing.ts refactor (behaviour-preserving)

Files: create `src/lib/calc/structure/pivots.ts`, `tests/calc/structure/pivots.test.ts`; modify `src/lib/calc/swing.ts`; existing swing tests stay as they are.

1. Before touching `swing.ts`, add a characterisation test file `tests/calc/swingEquivalence.test.ts` that runs `swingLevelList` and `swingLevels` over 3-4 hand-made series (V-shape, plateau, double top, short series) and pins today's outputs. Run: passes against current code.
2. `pivots.ts`: `SWING_SIDE_DAILY = 5`, `SWING_SIDE_WEEKLY = 3`, `findPivots(bars: {high:number;low:number}[], side): { highs: Pivot[]; lows: Pivot[] }` where `Pivot = { index; price; confirmedAt }` and `confirmedAt = index + side`. Same tie rule as `swing.ts` today (highest-or-equal each way, not a flat plateau).
3. Tests: a pivot at index `i` is not returned for a series that ends before `i + side` (the confirmation delay); plateau gives none; equal highs on one side still count; first and last `side` bars are never pivots.
4. `swing.ts`: `swingLevelList` slices the lookback window, calls `findPivots`, and uses a new exported `clusterLevels(prices, tol): { price; touches }[]`; the old `cluster` becomes a thin map to `price`. Run the equivalence tests: unchanged.

## Task 2: weekly bars

Files: `src/lib/calc/structure/weekly.ts`, `tests/calc/structure/weekly.test.ts`.

`weeklyBars(daily: {date; open; high; low; close}[])` using `weekEnds(dates, Infinity)` from `rotation.ts` (no copy of the rule). Open = first session's open of the week, date = week-end session. Tests: normal 5-day weeks; a Friday holiday (Thursday is the week end); a partial last week (ends at the latest session); days with a null open fall back to the first non-null open; unsorted input.

## Task 3: engine (trend, BOS/CHoCH)

Files: `src/lib/calc/structure/engine.ts`, `tests/calc/structure/engine.test.ts`.

`structureSeries(bars, params): StructurePoint[]` (one forward pass, no lookahead). Point: `{ date; close; trend; lastHigh; lastHighDate; lastLow; lastLowDate; event }`. Tests with small hand-made series:
- trend UP / DOWN / RANGE, and `null` before two highs and lows are confirmed;
- the trend does not change on the bar a pivot forms, only `side` bars later (confirmation delay);
- bullish BOS, bearish BOS, bearish CHoCH, bullish CHoCH, each on a close;
- a wick above the swing high with a close below it fires nothing;
- one pivot fires once even if the next closes also exceed it;
- the latest event persists until a newer one.

## Task 4: levels

Files: `src/lib/calc/structure/levels.ts`, `tests/calc/structure/levels.test.ts`.

`structureLevels(pivots, close, params)` -> `{ support; supportStrength; resistance; resistanceStrength; ath }`. Constants `LEVEL_MERGE_TOL = 0.015`, `LEVEL_BARS_DAILY = 250`, `LEVEL_BARS_WEEKLY = 130`. Tests: two pivots 1.4% apart merge, 1.6% apart do not; strength counts touches; support is the nearest level below the close and resistance the nearest above (equal to the close counts as neither); pivots older than the level window are ignored; all-time high is the highest stored high; no levels gives nulls.

## Task 5: public entry points and the no-lookahead test

Files: `src/lib/calc/structure/index.ts`, `tests/calc/structure/index.test.ts`.

- `structureForInstrument(bars): { D: StructureRow | null; W: StructureRow | null }` for the latest session.
- `structureHistory(bars, fromDate): StructureRow[]`: D rows for every session on or after `fromDate`, W rows at week-end sessions (and the latest session).
- `StructureRow` mirrors the table columns (camelCase) and carries `swingN`.
- Test: for a random-ish 300-bar series and a set of cut points, `structureHistory(bars).find(date = cut)` equals `structureForInstrument(bars.slice(0, cut + 1))` for D and for W at week ends. This is the no-lookahead guarantee Stage 3 relies on.

## Task 6: migration 0020

Files: `supabase/migrations/0020_structure.sql`.

Table `structure_daily` per the spec, primary key `(instrument_id, session_date, timeframe)`, check constraints on `timeframe`, `trend`, `event_type`, `event_direction`, index on `(session_date, timeframe)`, `alter table structure_daily enable row level security;` and no policies. Same comment style as `0018`/`0019`. **Not applied by me.** Re-check that `0020` is still free just before committing.

## Task 7: repo methods

Files: `src/lib/db/repo.ts`, `supabaseRepo.ts`, `memoryRepo.ts`, `src/lib/db/types.ts`; test `tests/db/structureRepo.test.ts` (memory repo).

`upsertStructure(rows: StructureRow[]): Promise<void>` (chunks of 500, `onConflict` on the primary key) and `getLatestStructure(instrumentId): Promise<{ D: StructureRow | null; W: StructureRow | null }>`. Round-trip test on the memory repo: upsert twice (idempotent), latest per timeframe is the newest date.

## Task 8: EOD step

Files: `src/lib/jobs/eod.ts`, `src/lib/jobs/structure.ts` (new, thin), tests `tests/jobs/eodStructure.test.ts`.

1. Add an optional `onBars?: (inst, bars) => void` to `recomputeFromBars` / `recomputeInstrument` opts and thread it through `refreshInstrument` and the NIFTY50 path. Indicator output is unchanged: add a test that the stored indicators are identical with and without the callback.
2. In `work()`, skip INDIAVIX; collect `structureForInstrument(bars)` rows (wrapped in try/catch per instrument, failures listed).
3. After the ingest pool and before `scorePass`'s notes are built, `repo.upsertStructure(rows)` once, in a try/catch: an error sets `structureError`, downgrades the run to `partial`, never undoes ingest or scores.
4. Run message gains `structure N, structure failed N` and the notes include the error text.
5. Tests with the memory repo and a fake provider: rows appear for index, sector and stock; a throwing structure computation for one instrument is reported and the rest are written; an upsert failure gives `partial`.

## Task 9: backfill script

Files: `scripts/backfill-structure.ts`, `package.json` (`"backfill-structure": "tsx scripts/backfill-structure.ts"`).

Arguments: `--from YYYY-MM-DD` (default 2019-01-01), `--key KEY`, `--dry-run`. Per instrument (same set as EOD): `getPriceBars(id, 100000)`, `structureHistory`, upsert in chunks, print `[n] KEY rows`. Failures are listed at the end and exit code is 1. Pure logic is already covered in Task 5; verify with `--dry-run --key NIFTY50` locally.

## Task 10: pop-up

Files: `src/lib/api/instrument.ts`, `src/lib/view/popup.ts`, `src/app/components/popup/IndicatorTab.tsx` (and `StockModal.tsx` where it passes props), tests `tests/view/popupStructure.test.ts`.

- `handleInstrumentGet` adds `repo.getLatestStructure(inst.id)` to the existing `Promise.all`.
- `buildPopupData` builds `structure: { D; W }` display rows (trend text, event text with date and level, support/resistance with distance % from the latest close and touches, ATH). A manual level from `levels` replaces the computed one and sets `manual: true`. Pure function, tested: trend and event text; distance sign and rounding; manual wins; no rows gives `null`.
- `IndicatorTab` renders a "Structure" section under the existing table in the same row style, with "Appears after the nightly run" when null. Read `StockModal.tsx` first to see how `PopupData` reaches the tab.

## Task 11: README

Add "Stage 8: Market structure" under the data scripts / stages: the `0020_structure.sql` migration (apply before deploying), `npm run backfill-structure -- --from 2019-01-01`, what the EOD step does and its message fields, what the pop-up shows, the rules in two lines (closes, N = 5 daily / 3 weekly, no lookahead, manual levels win). Update the migrations list ("A new project applies all ... ") without changing the existing counts text beyond adding 0020.

## Final checks

`npm test`, `npm run typecheck`, `npm run lint`, `npm run build`: all pass. Then give the owner the PowerShell steps:

```powershell
# 1. apply the migration (Supabase SQL editor, or the CLI), then
# 2. back-fill history (about 255 instruments; prints one line each)
npm run backfill-structure -- --from 2019-01-01
# 3. time the EOD run with the dev server running
Measure-Command { curl.exe -H "Authorization: Bearer <CRON_SECRET>" http://localhost:3000/api/cron/eod }
# 4. look at the pop-up
npm run dev   # open http://localhost:3000/?stock=NIFTY50, then the Indicators tab
```

## Risks

- `swing.ts` refactor: guarded by the characterisation tests written first.
- EOD duration: unmeasured today; the structure step is small, but the owner's timing decides whether the EOD split comes first.
- Backfill size: about 90 MB; watch the database size after it runs.
