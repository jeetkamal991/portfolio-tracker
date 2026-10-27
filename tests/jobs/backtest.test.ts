import { describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument, OhlcvDay, StoredDay } from "@/lib/db/types";
import {
  backtestAndSave, dataReport, formatRun, loadHistory, parseBacktestArgs, runBacktest,
} from "@/lib/jobs/backtest";

const inst = (id: number, key: string, type: Instrument["type"] = "stock"): Instrument => ({
  id, key, name: key, type, yahooTicker: `${key}.NS`, active: true,
});
const dayOf = (i: number) => new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10);

// NIFTY50 (id 1) plus 12 stocks (ids 2..13) over n days from 2026-01-01
async function setup(n = 80) {
  const repo = createMemoryRepo({ instruments: [inst(1, "NIFTY50", "index"), ...Array.from({ length: 12 }, (_, k) => inst(k + 2, `S${k + 2}`))] });
  for (let id = 1; id <= 13; id++) {
    await repo.upsertCandles(id, Array.from({ length: n }, (_, i) => {
      const close = id === 1 ? 1000 + 2 * i : 100 + id + 0.3 * i + (i % 7) * id * 0.1;
      return { date: dayOf(i), open: close - 0.2, high: close + 1, low: close - 1, close, volume: 1000 + 37 * i * id };
    }));
  }
  await repo.replaceConstituents("NIFTY200", Array.from({ length: 12 }, (_, k) => k + 2));
  return repo;
}
const FROM = ["--from", "2026-01-01"];

describe("parseBacktestArgs", () => {
  it("fills the defaults", () => {
    const o = parseBacktestArgs(["alpha", "--alpha", "a101"]);
    expect(o).toMatchObject({
      spec: { kind: "alpha", alpha: "a101", top: 10 }, from: "2020-01-01", maxPositions: 10, holdSessions: 5,
      stopPct: null, capital: 1000000, dryRun: false,
    });
    expect(o.name.length).toBeGreaterThan(0);
  });
  it("reads every kind and option", () => {
    expect(parseBacktestArgs(["rule", "--rule", "golden", "--hold", "10", "--stop", "8", "--max-positions", "5", "--dry-run", "--name", "x"]))
      .toMatchObject({ spec: { kind: "rule", rule: "golden" }, holdSessions: 10, stopPct: 8, maxPositions: 5, dryRun: true, name: "x" });
    expect(parseBacktestArgs(["hold", "--key", "NIFTY50"]).spec).toEqual({ kind: "hold", key: "NIFTY50" });
    expect(parseBacktestArgs(["random", "--seed", "7", "--capital", "500000"])).toMatchObject({ spec: { kind: "random", seed: 7 }, capital: 500000 });
    expect(parseBacktestArgs(["random"]).spec).toEqual({ kind: "random", seed: 1 });
  });
  it("explains what is wrong", () => {
    expect(() => parseBacktestArgs([])).toThrow(/alpha, rule, hold or random/);
    expect(() => parseBacktestArgs(["nope"])).toThrow(/Unknown strategy "nope"/);
    expect(() => parseBacktestArgs(["alpha", "--alpha", "zzz"])).toThrow(/Unknown alpha "zzz".*a001.*a101/);
    expect(() => parseBacktestArgs(["alpha"])).toThrow(/needs --alpha/);
    expect(() => parseBacktestArgs(["rule"])).toThrow(/needs --rule/);
    expect(() => parseBacktestArgs(["rule", "--rule", "score_top"])).toThrow(/Unknown rule "score_top"/);
    expect(() => parseBacktestArgs(["hold"])).toThrow(/needs --key/);
    expect(() => parseBacktestArgs(["alpha", "--alpha", "a101", "--hold", "abc"])).toThrow(/--hold/);
    expect(() => parseBacktestArgs(["alpha", "--alpha", "a101", "--from", "yesterday"])).toThrow(/--from/);
    expect(() => parseBacktestArgs(["alpha", "--alpha", "a101", "--bogus", "1"])).toThrow(/Unknown option --bogus/);
  });
});

describe("loadHistory", () => {
  it("returns every id's rows ascending, in chunks of at most 10 ids, for both column sets", async () => {
    const repo = createMemoryRepo({ instruments: Array.from({ length: 25 }, (_, k) => inst(k + 1, `K${k + 1}`)) });
    for (let id = 1; id <= 25; id++) await repo.upsertCandles(id, [3, 1, 2].map((i) => ({ date: dayOf(i), open: 1, high: 2, low: 0, close: 1, volume: 1 })));
    const ids = Array.from({ length: 25 }, (_, k) => k + 1);
    for (const wide of [false, true]) {
      const spy = vi.spyOn(repo, wide ? "getDaysRange" : "getOhlcvRange");
      const m = await loadHistory<OhlcvDay>(repo, ids, dayOf(0), dayOf(10), wide);
      expect(m.size).toBe(25);
      expect(m.get(7)!.map((d) => d.date)).toEqual([dayOf(1), dayOf(2), dayOf(3)]);
      // narrow rows go 10 ids at a time; the wide `select *` rows are heavy, so 4
      expect(spy).toHaveBeenCalledTimes(wide ? 7 : 3);
      expect(spy.mock.calls.every((c) => c[0].length <= (wide ? 4 : 10))).toBe(true);
      spy.mockRestore();
    }
  });

  it("retries a chunk whose request failed and still returns every id", async () => {
    const repo = createMemoryRepo({ instruments: Array.from({ length: 25 }, (_, k) => inst(k + 1, `K${k + 1}`)) });
    for (let id = 1; id <= 25; id++) await repo.upsertCandles(id, [{ date: dayOf(1), open: 1, high: 2, low: 0, close: 1, volume: 1 }]);
    const spy = vi.spyOn(repo, "getOhlcvRange");
    spy.mockRejectedValueOnce(new Error("terminated"));
    const m = await loadHistory<OhlcvDay>(repo, Array.from({ length: 25 }, (_, k) => k + 1), dayOf(0), dayOf(10), false, 0);
    expect(m.size).toBe(25);
    expect(spy).toHaveBeenCalledTimes(4); // 3 chunks, one of them twice
  });

  it("gives up after three attempts on a chunk and reports the error", async () => {
    const repo = createMemoryRepo({ instruments: [inst(1, "K1")] });
    const spy = vi.spyOn(repo, "getOhlcvRange").mockRejectedValue(new Error("terminated"));
    await expect(loadHistory<OhlcvDay>(repo, [1], dayOf(0), dayOf(10), false, 0)).rejects.toThrow("terminated");
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe("dataReport", () => {
  const stored = (date: string, close: number, score: number | null): StoredDay => ({ date, close, score } as StoredDay);
  it("flags moves of 35% or more either way, not 20%", () => {
    const r = dataReport([
      { key: "A", name: "A", days: [stored("2026-01-01", 100, 1), stored("2026-01-02", 50, 1), stored("2026-01-03", 60, null)] },
      { key: "B", name: "B", days: [stored("2026-01-01", 100, null), stored("2026-01-02", 120, null)] },
    ]);
    expect(r.bigMoves).toEqual([{ key: "A", date: "2026-01-02", pct: -0.5 }]);
    expect(r).toMatchObject({ stocks: 2, firstDate: "2026-01-01", lastDate: "2026-01-03" });
    expect(r.scoreCoverage).toBeCloseTo(2 / 5, 12);
  });
  it("has no score coverage for OHLCV-only rows", () => {
    const plain = (date: string, close: number): OhlcvDay => ({ date, open: close, high: close, low: close, close, volume: 1, pctChange: null, importedPct: null });
    expect(dataReport([{ key: "A", name: "A", days: [plain("2026-01-01", 1), plain("2026-01-02", 2)] }]).scoreCoverage).toBeNull();
  });
});

describe("runBacktest", () => {
  it("hold on NIFTY50 starts both lines at the capital and spans the calendar", async () => {
    const repo = await setup();
    const { run } = await runBacktest(repo, parseBacktestArgs(["hold", "--key", "NIFTY50", "--max-positions", "1", "--hold", "100000", ...FROM]));
    expect(run.equity[0]).toEqual([dayOf(0), 1000000, 1000000]);
    expect(run.equity).toHaveLength(80);
    expect(run.settings).toMatchObject({ from: dayOf(0), to: dayOf(79), capital: 1000000, maxPositions: 1 });
    expect(run.dataThrough).toBe(dayOf(79));
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0].reason).toBe("end");
    expect(run.strategy.id).toBe("hold:NIFTY50");
  });

  it("an alpha strategy trades and its metrics agree with its trades", async () => {
    const repo = await setup();
    const { run, report } = await runBacktest(repo, parseBacktestArgs(["alpha", "--alpha", "a101", "--top", "3", "--hold", "3", "--max-positions", "3", ...FROM]));
    expect(run.trades.length).toBeGreaterThan(0);
    expect(run.metrics.strategy.trades).toBe(run.trades.length);
    expect(run.metrics.benchmark.trades).toBe(0);
    expect(run.universeNote).toMatch(/survivorship/i);
    expect(report.stocks).toBe(12);
    expect(report.scoreCoverage).toBeNull();
  });

  it("a rule that never fires gives a run with no trades and no NaN", async () => {
    const repo = await setup();
    const { run } = await runBacktest(repo, parseBacktestArgs(["rule", "--rule", "golden", ...FROM]));
    expect(run.trades).toEqual([]);
    expect(run.metrics.strategy.hitRate).toBeNull();
    expect(run.equity.every(([, a, b]) => a === 1000000 && Number.isFinite(b))).toBe(true);
    expect(JSON.stringify(run)).not.toContain("NaN");
  });

  it("refuses a calendar under 60 sessions", async () => {
    const repo = await setup(30);
    await expect(runBacktest(repo, parseBacktestArgs(["alpha", "--alpha", "a101", ...FROM]))).rejects.toThrow(/Not enough Nifty 50 history/);
  });

  it("refuses an unknown held key", async () => {
    const repo = await setup();
    await expect(runBacktest(repo, parseBacktestArgs(["hold", "--key", "NOPE", ...FROM]))).rejects.toThrow(/NOPE/);
  });
});

describe("suspected unadjusted splits", () => {
  // S2 halves on day 40 (a split Yahoo did not adjust); S3 is smooth
  async function withSplit() {
    const repo = createMemoryRepo({ instruments: [inst(1, "NIFTY50", "index"), inst(2, "S2"), inst(3, "S3")] });
    for (let id = 1; id <= 3; id++) {
      await repo.upsertCandles(id, Array.from({ length: 80 }, (_, i) => {
        const close = id === 1 ? 1000 + 2 * i : id === 2 ? (i < 40 ? 200 : 100) + 0.1 * i : 100 + 0.1 * i;
        return { date: dayOf(i), open: close - 0.2, high: close + 1, low: close - 1, close, volume: 1000 };
      }));
    }
    return repo;
  }
  const hold = (key: string) => parseBacktestArgs(["hold", "--key", key, "--max-positions", "1", "--hold", "100000", ...FROM]);

  it("marks a trade that spans a daily move of 35% or more, and says so on the run", async () => {
    const { run } = await runBacktest(await withSplit(), hold("S2"));
    expect(run.trades).toHaveLength(1);
    expect(run.trades[0].suspect).toBe(true);
    expect(run.universeNote).toMatch(/35%/);
  });
  it("leaves a smooth trade unmarked and the note clean", async () => {
    const { run } = await runBacktest(await withSplit(), hold("S3"));
    expect(run.trades[0].suspect).toBeFalsy();
    expect(run.universeNote).not.toMatch(/35%/);
  });
});

describe("backtestAndSave", () => {
  it("saves a finished run and returns its id", async () => {
    const repo = await setup();
    const spy = vi.spyOn(repo, "saveBacktestRun");
    const r = await backtestAndSave(repo, parseBacktestArgs(["alpha", "--alpha", "a101", "--top", "3", "--max-positions", "3", ...FROM]));
    expect(r.id).toBe(1);
    expect(spy).toHaveBeenCalledTimes(1);
    expect((await repo.getBacktestRun(1))?.name).toBe(r.run.name);
  });
  it("saves nothing on --dry-run", async () => {
    const repo = await setup();
    const spy = vi.spyOn(repo, "saveBacktestRun");
    const r = await backtestAndSave(repo, parseBacktestArgs(["alpha", "--alpha", "a101", "--dry-run", ...FROM]));
    expect(r.id).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
  it("refuses to save a run with more trades than the cap, but a dry run still prints it", async () => {
    const repo = await setup();
    const spy = vi.spyOn(repo, "saveBacktestRun");
    const args = ["alpha", "--alpha", "a101", "--top", "3", "--hold", "3", "--max-positions", "3", ...FROM];
    await expect(backtestAndSave(repo, parseBacktestArgs(args), 1)).rejects.toThrow(/too many trades/i);
    expect(spy).not.toHaveBeenCalled();
    const dry = await backtestAndSave(repo, parseBacktestArgs([...args, "--dry-run"]), 1);
    expect(dry.id).toBeNull();
  });
  it("saves nothing when the run fails", async () => {
    const repo = await setup();
    vi.spyOn(repo, "getOhlcvRange").mockRejectedValue(new Error("boom"));
    const spy = vi.spyOn(repo, "saveBacktestRun");
    await expect(backtestAndSave(repo, parseBacktestArgs(["alpha", "--alpha", "a101", ...FROM]))).rejects.toThrow("boom");
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("formatRun", () => {
  it("prints the strategy against Nifty 50 and the caveats", async () => {
    const repo = await setup();
    const { run, report } = await runBacktest(repo, parseBacktestArgs(["alpha", "--alpha", "a101", "--top", "3", ...FROM]));
    const text = formatRun(run, report);
    expect(text).toContain(run.name);
    expect(text).toContain("Nifty 50");
    expect(text).toMatch(/CAGR/);
    expect(text).toMatch(/survivorship/i);
    // levels are plain percents, only returns carry a sign
    expect(text).not.toMatch(/(Volatility|Hit rate|Time invested)\s+\+/);
  });
});
