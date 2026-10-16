import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import type { Candle, MarketDataProvider } from "@/lib/provider/types";
import { addDays } from "@/lib/time/ist";
import { addStock, backfillInstrument } from "@/lib/jobs/backfill";

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

  it("120 candles -> ema200 null on last day", async () => {
    const repo = setup();
    expect(await addStock({ repo, provider: provider({ T_BBB: 120 }), now: NOW }, "BBB")).toEqual({ ok: true });
    const days = await repo.getDays(3, 1000);
    expect(days[days.length - 1]!.ema200).toBeNull();
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
