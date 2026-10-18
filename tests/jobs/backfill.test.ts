import { describe, it, expect, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import type { Candle, MarketDataProvider } from "@/lib/provider/types";
import { addDays } from "@/lib/time/ist";
import { addHolding, addStock, backfillInstrument, backfillUniverse } from "@/lib/jobs/backfill";

const NOW = new Date("2026-10-16T11:00:00Z");
const TODAY = "2026-10-16";

const inst = (id: number, key: string, type: Instrument["type"]): Instrument => ({
  id, key, name: key, type, yahooTicker: `T_${key}`, active: true,
});

function series(end: string, n: number): Candle[] {
  const out: Candle[] = [];
  let d = end;
  while (out.length < n) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length;
      const close = 1000 + i * 0.5 + Math.sin(i / 3) * 20;
      out.unshift({ date: d, open: close - 1, high: close + 5, low: close - 5, close, volume: 1000 });
    }
    d = addDays(d, -1);
  }
  return out;
}

function provider(counts: Record<string, number>, reject: string[] = []): MarketDataProvider {
  return {
    async getDailyHistory(ticker, from, to) {
      if (reject.includes(ticker)) throw new Error("unknown " + ticker);
      return series(TODAY, counts[ticker] ?? 0).filter((c) => c.date >= from && c.date <= to);
    },
    async getQuotes() { return []; },
  };
}

const setup = () => {
  const instruments = [inst(1, "NIFTY50", "index"), inst(2, "AAA", "stock"), inst(3, "BBB", "stock"), inst(4, "NIFTY_IT", "sector")];
  return createMemoryRepo({ instruments });
};

describe("addStock", () => {
  it("unknown key and non-stock keys -> unknown_symbol", async () => {
    const repo = setup();
    const deps = { repo, provider: provider({}), now: NOW };
    expect(await addStock(deps, "NOPE")).toEqual({ ok: false, error: "unknown_symbol" });
    expect(await addStock(deps, "NIFTY_IT")).toEqual({ ok: false, error: "unknown_symbol" });
  });

  it("0 candles -> no_data, nothing added or stored", async () => {
    const repo = setup();
    expect(await addStock({ repo, provider: provider({ T_AAA: 0 }), now: NOW }, "AAA")).toEqual({ ok: false, error: "no_data" });
    expect(await repo.listWatchlist()).toEqual([]);
    expect(await repo.getDays(2, 1000)).toEqual([]);
  });

  it("provider rejection -> no_data", async () => {
    const repo = setup();
    expect(await addStock({ repo, provider: provider({}, ["T_AAA"]), now: NOW }, "AAA")).toEqual({ ok: false, error: "no_data" });
    expect(await repo.listWatchlist()).toEqual([]);
  });

  it("success: watchlisted, ema200 on last day, levels set; second add -> already_added", async () => {
    const repo = setup();
    const deps = { repo, provider: provider({ T_AAA: 500 }), now: NOW };
    expect(await addStock(deps, "AAA")).toEqual({ ok: true });
    expect((await repo.listWatchlist()).map((i) => i.key)).toEqual(["AAA"]);
    const days = await repo.getDays(2, 1000);
    expect(days.length).toBeGreaterThan(400);
    expect(days[days.length - 1]!.ema200).not.toBeNull();
    const lv = await repo.getLevels(2);
    expect(lv.autoSupport !== null || lv.autoResistance !== null).toBe(true);
    expect(await addStock(deps, "AAA")).toEqual({ ok: false, error: "already_added" });
  });

  it("stores a score for the added stock immediately", async () => {
    const repo = setup();
    expect(await addStock({ repo, provider: provider({ T_AAA: 300 }), now: NOW }, "AAA")).toEqual({ ok: true });
    const days = await repo.getDays(2, 1000);
    expect(days[days.length - 1]!.score).not.toBeNull();
  });

  it("a score-pass error after storing still returns ok", async () => {
    const repo = setup();
    repo.listMemberships = async () => { throw new Error("db down"); };
    expect(await addStock({ repo, provider: provider({ T_AAA: 300 }), now: NOW }, "AAA")).toEqual({ ok: true });
    expect((await repo.listWatchlist()).map((i) => i.key)).toEqual(["AAA"]);
  });

  it("120 candles -> ema200 null on last day", async () => {
    const repo = setup();
    expect(await addStock({ repo, provider: provider({ T_BBB: 120 }), now: NOW }, "BBB")).toEqual({ ok: true });
    const days = await repo.getDays(3, 1000);
    expect(days[days.length - 1]!.ema200).toBeNull();
  });
});

describe("addHolding", () => {
  const input = { qty: 10, avgPrice: 100, buyDate: "2026-10-01", stopLoss: 90, target1: 120, target2: null };

  it("new stock: stores candles, saves the holding, scores it, merged false", async () => {
    const repo = setup();
    expect(await addHolding({ repo, provider: provider({ T_AAA: 300 }), now: NOW }, "AAA", input)).toEqual({ ok: true, merged: false });
    expect((await repo.getDays(2, 1000)).length).toBe(300);
    expect(await repo.getHolding(2)).toMatchObject({ qty: 10, avgPrice: 100, key: "AAA" });
    const days = await repo.getDays(2, 1000);
    expect(days[days.length - 1]!.score).not.toBeNull();
  });

  it("same key again merges: qty summed, average weighted, no refetch", async () => {
    const repo = setup();
    const p = provider({ T_AAA: 300 });
    const spy = vi.spyOn(p, "getDailyHistory");
    const deps = { repo, provider: p, now: NOW };
    await addHolding(deps, "AAA", input);
    const calls = spy.mock.calls.length;
    expect(await addHolding(deps, "AAA", { ...input, qty: 30, avgPrice: 200, stopLoss: null })).toEqual({ ok: true, merged: true });
    expect(spy.mock.calls.length).toBe(calls);
    expect(await repo.getHolding(2)).toMatchObject({ qty: 40, avgPrice: 175, stopLoss: 90 });
  });

  it("no history -> no_data and nothing saved", async () => {
    const repo = setup();
    expect(await addHolding({ repo, provider: provider({ T_AAA: 0 }), now: NOW }, "AAA", input)).toEqual({ ok: false, error: "no_data" });
    expect(await repo.listHoldings()).toEqual([]);
  });

  it("unknown or non-stock key -> unknown_symbol", async () => {
    const deps = { repo: setup(), provider: provider({}), now: NOW };
    expect(await addHolding(deps, "NOPE", input)).toEqual({ ok: false, error: "unknown_symbol" });
    expect(await addHolding(deps, "NIFTY_IT", input)).toEqual({ ok: false, error: "unknown_symbol" });
  });

  it("a stock already priced yesterday is not refetched", async () => {
    const repo = setup();
    await repo.replaceConstituents("NIFTY200", [2]);
    await repo.upsertCandles(2, [{ date: "2026-10-15", open: 1, high: 2, low: 1, close: 1.5, volume: 10 }]);
    const p = provider({ T_AAA: 300 });
    const spy = vi.spyOn(p, "getDailyHistory");
    expect(await addHolding({ repo, provider: p, now: NOW }, "AAA", input)).toEqual({ ok: true, merged: false });
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("backfillInstrument", () => {
  it("stores candles, upserts indicators for all rows, returns count", async () => {
    const repo = setup();
    const n = await backfillInstrument({ repo, provider: provider({ T_NIFTY50: 300 }), now: NOW }, inst(1, "NIFTY50", "index"), addDays(TODAY, -1000));
    expect(n).toBe(300);
    const days = await repo.getDays(1, 1000);
    expect(days.length).toBe(300);
    expect(days[250]!.ema200).not.toBeNull();
  });
});

describe("backfillUniverse", () => {
  it("stores all constituents and watchlist stocks, one scorePass, failures recorded", async () => {
    const repo = setup();
    await repo.replaceConstituents("NIFTY200", [2]);
    await repo.addToWatchlist(2);
    await repo.addToWatchlist(3);
    const spy = vi.spyOn(repo, "upsertScore");
    const progress: string[] = [];
    const res = await backfillUniverse(
      { repo, provider: provider({ T_AAA: 300, T_BBB: 300 }, []), now: NOW },
      { from: "2019-01-01", onProgress: (k) => progress.push(k) },
    );
    expect(res).toEqual({ done: 2, failed: [], unknown: [], scoreFailed: [] });
    expect((await repo.getDays(2, 1000)).length).toBe(300);
    expect((await repo.getDays(3, 1000)).length).toBe(300);
    expect(progress.sort()).toEqual(["AAA", "BBB"]);
    expect(spy.mock.calls.map((c) => c[0]).sort()).toEqual([2, 3]);
  });

  it("includes sector constituents that are not in the Nifty 200", async () => {
    const repo = setup();
    await repo.replaceConstituents("NIFTY200", [2]);
    await repo.replaceConstituents("NIFTY_MEDIA", [3]);
    const res = await backfillUniverse({ repo, provider: provider({ T_AAA: 300, T_BBB: 300 }, []), now: NOW }, { from: "2019-01-01" });
    expect(res.done).toBe(2);
    expect((await repo.getDays(3, 1000)).length).toBe(300);
  });
  it("a failing instrument is listed and does not stop the others", async () => {
    const repo = setup();
    await repo.replaceConstituents("NIFTY200", [2, 3]);
    const res = await backfillUniverse(
      { repo, provider: provider({ T_BBB: 300 }, ["T_AAA"]), now: NOW },
      { from: "2019-01-01" },
    );
    expect(res.done).toBe(1);
    expect(res.failed).toEqual(["AAA"]);
    expect((await repo.getDays(3, 1000)).length).toBe(300);
  });

  it("deactivates a stock Yahoo does not know and reports it apart from transient failures", async () => {
    const repo = setup();
    await repo.upsertInstruments([{ key: "CCC", name: "CCC", type: "stock", yahooTicker: "T_CCC", active: true }]);
    const ccc = (await repo.getInstrumentByKey("CCC"))!;
    await repo.replaceConstituents("NIFTY200", [2, 3, ccc.id]);
    const base = provider({ T_BBB: 300 });
    const deps = {
      repo, now: NOW,
      provider: {
        ...base,
        async getDailyHistory(t: string, f: string, to: string) {
          if (t === "T_AAA") throw new Error("No data found, symbol may be delisted");
          if (t === "T_CCC") throw new Error("fetch failed");
          return base.getDailyHistory(t, f, to);
        },
      },
    };
    const res = await backfillUniverse(deps, { from: "2019-01-01" });
    expect(res.unknown).toEqual(["AAA"]);
    expect(res.failed).toEqual(["CCC"]);
    expect(res.done).toBe(1);
    expect((await repo.getInstrumentByKey("AAA"))!.active).toBe(false);
    expect((await repo.getInstrumentByKey("CCC"))!.active).toBe(true);
    expect((await repo.getInstrumentByKey("BBB"))!.active).toBe(true);
  });

  it("deactivates a stock whose history comes back empty", async () => {
    const repo = setup();
    await repo.replaceConstituents("NIFTY200", [2, 3]);
    const res = await backfillUniverse({ repo, provider: provider({ T_BBB: 300, T_AAA: 0 }), now: NOW }, { from: "2019-01-01" });
    expect(res.unknown).toEqual(["AAA"]);
    expect(res.failed).toEqual([]);
    expect(res.done).toBe(1);
    expect((await repo.getInstrumentByKey("AAA"))!.active).toBe(false);
  });

  it("reports score-pass failures instead of throwing", async () => {
    const repo = setup();
    await repo.replaceConstituents("NIFTY200", [2]);
    const upsert = repo.upsertScore.bind(repo);
    repo.upsertScore = async (id, row) => { if (id === 2) throw new Error("write failed"); return upsert(id, row); };
    const res = await backfillUniverse({ repo, provider: provider({ T_AAA: 300 }), now: NOW }, { from: "2019-01-01" });
    expect(res.scoreFailed).toEqual(["AAA (write failed)"]);
  });
});
