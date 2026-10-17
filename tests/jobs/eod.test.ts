import { describe, it, expect, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import type { Candle, MarketDataProvider } from "@/lib/provider/types";
import { addDays } from "@/lib/time/ist";
import { runEod } from "@/lib/jobs/eod";
import { isAuthorized } from "@/app/api/cron/eod/auth";

const NOW = new Date("2026-10-16T11:00:00Z");
const TODAY = "2026-10-16";

const inst = (id: number, key: string, type: Instrument["type"]): Instrument => ({
  id, key, name: key, type, yahooTicker: `T_${key}`, active: true,
});

function series(ticker: string, end: string, n: number): Candle[] {
  const seed = [...ticker].reduce((a, c) => a + c.charCodeAt(0), 0);
  const out: Candle[] = [];
  let d = end;
  while (out.length < n) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length;
      const close = 1000 + i * 0.5 + Math.sin(i / 3 + seed) * 20;
      out.unshift({ date: d, open: close - 1, high: close + 5, low: close - 5, close, volume: 1000 });
    }
    d = addDays(d, -1);
  }
  return out;
}

function fakeProvider(
  opts: { throwOn?: string[]; defaultEnd?: string; count?: Record<string, number> } = {},
): MarketDataProvider {
  return {
    async getDailyHistory(ticker, from, to) {
      if (opts.throwOn?.includes(ticker)) throw new Error("boom " + ticker);
      const end = opts.defaultEnd ?? TODAY;
      return series(ticker, end, opts.count?.[ticker] ?? 260).filter((c) => c.date >= from && c.date <= to);
    },
    async getQuotes() { return []; },
  };
}

// The job asks for a 10-day window, so older history is seeded straight into the repo.
async function seedHistory(repo: ReturnType<typeof createMemoryRepo>, instruments: Instrument[], end = TODAY) {
  for (const i of instruments) await repo.upsertCandles(i.id, series(`T_${i.key}`, end, 260));
}

const setup = () => {
  const instruments = [inst(1, "NIFTY50", "index"), inst(2, "NIFTY_IT", "sector"), inst(3, "AAA", "stock"), inst(4, "BBB", "stock")];
  const repo = createMemoryRepo({ instruments });
  return { repo, instruments };
};

describe("runEod", () => {
  it("ok run writes today's row with indicators and logs a job run", async () => {
    const { repo, instruments } = setup();
    await repo.addToWatchlist(3);
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    const run = await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect(run.status).toBe("ok");
    const days = await repo.getDays(1, 100_000);
    const last = days[days.length - 1]!;
    expect(last.date).toBe(TODAY);
    expect(last.close).not.toBeNull();
    expect(last.pctChange).not.toBeNull();
    expect(last.ema50).not.toBeNull();
    expect(last.ema200).not.toBeNull();
    expect(await repo.lastJobRun("eod")).toMatchObject({ job: "eod", status: "ok" });
  });

  it("does not process non-watchlist stocks", async () => {
    const { repo } = setup();
    await repo.addToWatchlist(3);
    await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect((await repo.getDays(4, 100)).length).toBe(0);
    expect((await repo.getDays(3, 100)).length).toBeGreaterThan(0);
  });

  it("is idempotent", async () => {
    const { repo, instruments } = setup();
    await repo.addToWatchlist(3);
    await seedHistory(repo, instruments);
    await runEod({ repo, provider: fakeProvider(), now: NOW });
    const snap = async () => Promise.all([1, 2, 3].map((id) => repo.getDays(id, 100_000)));
    const a = await snap();
    const la = await repo.getLevels(3);
    await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect(await snap()).toEqual(a);
    expect(await repo.getLevels(3)).toEqual(la);
  });

  it("no_session when newest candle is not today, and no row for today", async () => {
    const { repo, instruments } = setup();
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    const run = await runEod({ repo, provider: fakeProvider({ defaultEnd: "2026-10-15" }), now: NOW });
    expect(run.status).toBe("no_session");
    const days = await repo.getDays(1, 100_000);
    expect(days.find((d) => d.date === TODAY)).toBeUndefined();
    expect(await repo.lastJobRun("eod")).toMatchObject({ status: "no_session" });
  });

  it("self-heals when a flapping provider later includes today", async () => {
    const { repo, instruments } = setup();
    await seedHistory(repo, instruments, addDays(TODAY, -2));
    const r1 = await runEod({ repo, provider: fakeProvider({ defaultEnd: "2026-10-15" }), now: NOW });
    expect(r1.status).toBe("no_session");
    expect((await repo.getDays(1, 100_000)).find((d) => d.date === TODAY)).toBeUndefined();
    const r2 = await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect(r2.status).toBe("ok");
    const row = (await repo.getDays(1, 100_000)).find((d) => d.date === TODAY);
    expect(row?.close).not.toBeNull();
    expect(row?.ema50).not.toBeNull();
    expect(row?.pctChange).not.toBeNull();
  });

  it("partial when one ticker throws; message names it; others updated", async () => {
    const { repo } = setup();
    const run = await runEod({ repo, provider: fakeProvider({ throwOn: ["T_NIFTY_IT"] }), now: NOW });
    expect(run.status).toBe("partial");
    expect(run.message).toContain("NIFTY_IT");
    expect((await repo.getDays(1, 100_000)).some((d) => d.date === TODAY)).toBe(true);
    expect((await repo.getDays(2, 100)).length).toBe(0);
    expect(await repo.lastJobRun("eod")).toMatchObject({ status: "partial" });
  });

  it("failed when every instrument throws", async () => {
    const { repo } = setup();
    const run = await runEod({ repo, provider: fakeProvider({ throwOn: ["T_NIFTY50", "T_NIFTY_IT"] }), now: NOW });
    expect(run.status).toBe("failed");
    expect(await repo.lastJobRun("eod")).toMatchObject({ status: "failed" });
  });

  it("still processes others when NIFTY50 fails, with null RS, and reports it", async () => {
    const { repo } = setup();
    await repo.upsertCandles(2, series("T_NIFTY_IT", addDays(TODAY, -1), 260));
    const run = await runEod({ repo, provider: fakeProvider({ throwOn: ["T_NIFTY50"] }), now: NOW });
    expect(run.status).toBe("partial");
    expect(run.message).toContain("NIFTY50");
    const days = await repo.getDays(2, 100_000);
    const last = days[days.length - 1]!;
    expect(last.date).toBe(TODAY);
    expect(last.ema50).not.toBeNull();
    expect(last.rsVsNifty).toBeNull();
  });

  it("computes RS vs Nifty for others when Nifty succeeds", async () => {
    const { repo, instruments } = setup();
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    await runEod({ repo, provider: fakeProvider(), now: NOW });
    const days = await repo.getDays(2, 100_000);
    expect(days[days.length - 1]!.rsVsNifty).not.toBeNull();
  });

  it("sets auto levels on watchlist stocks and leaves manual levels alone", async () => {
    const { repo, instruments } = setup();
    await repo.addToWatchlist(3);
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    await repo.setManualLevels(3, 123, 456);
    await runEod({ repo, provider: fakeProvider(), now: NOW });
    const l = await repo.getLevels(3);
    expect(l.autoSupport !== null || l.autoResistance !== null).toBe(true);
    expect(l.manualSupport).toBe(123);
    expect(l.manualResistance).toBe(456);
  });

  it("does not throw on instruments with 1-2 candles; indicators and levels stay null", async () => {
    const { repo } = setup();
    await repo.addToWatchlist(3);
    const run = await runEod({
      repo,
      provider: fakeProvider({ count: { T_NIFTY_IT: 2, T_AAA: 1 } }),
      now: NOW,
    });
    expect(run.status).toBe("ok");
    const sector = await repo.getDays(2, 100);
    expect(sector.length).toBe(2);
    expect(sector[1]!.ema50).toBeNull();
    expect(sector[1]!.rsi14).toBeNull();
    const l = await repo.getLevels(3);
    expect(l.autoSupport).toBeNull();
    expect(l.autoResistance).toBeNull();
  });

  it("computes over full stored history, skipping null-close imported days", async () => {
    const { repo } = setup();
    await repo.upsertImportedPct([{ instrumentId: 1, date: "2020-01-01", importedPct: 0.5 }]);
    await repo.upsertCandles(1, series("T_NIFTY50", addDays(TODAY, -1), 260));
    await runEod({ repo, provider: fakeProvider({ throwOn: ["T_NIFTY_IT"] }), now: NOW });
    const days = await repo.getDays(1, 100_000);
    expect(days[0]!.date).toBe("2020-01-01");
    expect(days[days.length - 1]!.ema200).not.toBeNull();
  });
});

describe("runEod job_runs bookkeeping", () => {
  it("leaves exactly one job_runs row, finished (not running)", async () => {
    const { repo, instruments } = setup();
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    const run = await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect(repo._jobRuns).toHaveLength(1);
    expect(repo._jobRuns[0]).toMatchObject({ job: "eod", status: "ok", startedAt: run.startedAt });
    expect(repo._jobRuns[0]!.finishedAt).not.toBeNull();
  });

  it("the row is 'running' while the job is in flight", async () => {
    const { repo } = setup();
    let seen: unknown = undefined;
    const provider: MarketDataProvider = {
      async getDailyHistory() {
        seen ??= await repo.lastJobRun("eod");
        return [];
      },
      async getQuotes() { return []; },
    };
    await runEod({ repo, provider, now: NOW });
    expect(seen).toMatchObject({ job: "eod", status: "running", finishedAt: null });
    expect(repo._jobRuns).toHaveLength(1);
    expect(repo._jobRuns[0]!.status).not.toBe("running");
  });

  it("a thrown error mid-run still finishes the row as failed", async () => {
    const { repo } = setup();
    repo.listWatchlist = async () => { throw new Error("db down"); };
    const run = await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect(run.status).toBe("failed");
    expect(repo._jobRuns).toHaveLength(1);
    expect(repo._jobRuns[0]).toMatchObject({ status: "failed" });
    expect(repo._jobRuns[0]!.message).toContain("db down");
    expect(repo._jobRuns[0]!.finishedAt).not.toBeNull();
  });

  it("reads lean price bars only, and NIFTY50's history once", async () => {
    const { repo, instruments } = setup();
    await repo.addToWatchlist(3);
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    const reads: number[] = [];
    const getPriceBars = repo.getPriceBars.bind(repo);
    repo.getPriceBars = async (id, limit) => { reads.push(id); return getPriceBars(id, limit); };
    const run = await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect(run.status).toBe("ok");
    expect(reads.filter((id) => id === 1)).toHaveLength(1);
    expect(reads.sort()).toEqual([1, 2, 3]);
  });
});

describe("runEod Nifty 200 universe", () => {
  const universe = () => {
    const instruments = [
      inst(1, "NIFTY50", "index"), inst(2, "NIFTY_IT", "sector"),
      inst(3, "AAA", "stock"), inst(4, "BBB", "stock"), inst(5, "CCC", "stock"),
    ];
    const repo = createMemoryRepo({ instruments });
    return { repo, instruments };
  };

  it("ingests and scores every constituent (watchlist overlap not duplicated)", async () => {
    const { repo, instruments } = universe();
    await repo.replaceConstituents("NIFTY200", [3, 4, 5]);
    await repo.addToWatchlist(3);
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    const calls: string[] = [];
    const base = fakeProvider();
    const provider: MarketDataProvider = {
      getQuotes: base.getQuotes,
      async getDailyHistory(t, f, to) { calls.push(t); return base.getDailyHistory(t, f, to); },
    };
    const run = await runEod({ repo, provider, now: NOW });
    expect(run.status).toBe("ok");
    expect(calls.filter((t) => t === "T_AAA")).toHaveLength(1);
    for (const id of [1, 2, 3, 4, 5]) {
      const days = await repo.getDays(id, 100_000);
      const last = days[days.length - 1]!;
      expect(last.date).toBe(TODAY);
      expect(last.score).not.toBeNull();
    }
    expect(run.message).toContain("skipped 0");
  });

  it("a failing constituent -> partial naming it; others scored", async () => {
    const { repo, instruments } = universe();
    await repo.replaceConstituents("NIFTY200", [3, 4, 5]);
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    const run = await runEod({ repo, provider: fakeProvider({ throwOn: ["T_BBB"] }), now: NOW });
    expect(run.status).toBe("partial");
    expect(run.message).toContain("BBB");
    const last = async (id: number) => { const d = await repo.getDays(id, 100_000); return d[d.length - 1]!; };
    expect((await last(3)).score).not.toBeNull();
    expect((await last(5)).score).not.toBeNull();
  });

  it("scores Nifty before stocks", async () => {
    const { repo, instruments } = universe();
    await repo.replaceConstituents("NIFTY200", [3, 4, 5]);
    await seedHistory(repo, instruments, addDays(TODAY, -1));
    const order: number[] = [];
    const orig = repo.upsertScore.bind(repo);
    vi.spyOn(repo, "upsertScore").mockImplementation(async (id, row) => { order.push(id); return orig(id, row); });
    await runEod({ repo, provider: fakeProvider(), now: NOW });
    expect(order[0]).toBe(1);
    expect(order.indexOf(2)).toBeLessThan(order.indexOf(3));
    expect(order.slice(-3).sort()).toEqual([3, 4, 5]);
  });
});

describe("isAuthorized", () => {
  it("accepts only the exact bearer secret", () => {
    expect(isAuthorized("Bearer s3", "s3")).toBe(true);
    expect(isAuthorized("Bearer nope", "s3")).toBe(false);
    expect(isAuthorized(null, "s3")).toBe(false);
    expect(isAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isAuthorized("Bearer ", "")).toBe(false);
  });
});
