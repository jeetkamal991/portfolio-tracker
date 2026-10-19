import { describe, it, expect, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import type { Quote } from "@/lib/provider/types";
import { _resetIntradayClock, handleQuotes } from "@/lib/api/quotes";

describe("handleQuotes", () => {
  it("includes watchlist and holding tickers once each", async () => {
    const stock = (id: number, key: string): Instrument => ({ id, key, name: key, type: "stock", yahooTicker: `${key}.NS`, active: true });
    const repo = createMemoryRepo({ instruments: [stock(1, "WATCH"), stock(2, "HELD")] });
    await repo.addToWatchlist(1);
    await repo.upsertHolding(1, { qty: 1, avgPrice: 10, buyDate: "2026-10-01", stopLoss: null, target1: null, target2: null });
    await repo.upsertHolding(2, { qty: 1, avgPrice: 10, buyDate: "2026-10-01", stopLoss: null, target1: null, target2: null });
    let asked: string[] = [];
    const cache = { async get(t: string[]) { asked = t; return []; } };
    await handleQuotes(repo, cache, new Date("2026-10-16T05:00:00Z"));
    expect(asked.filter((t) => t === "WATCH.NS")).toHaveLength(1);
    expect(asked).toContain("HELD.NS");
  });
});

describe("handleQuotes intraday alerts", () => {
  const OPEN = new Date("2026-10-16T05:00:00Z"); // Fri 10:30 IST
  const stock = (id: number, key: string): Instrument => ({ id, key, name: key, type: "stock", yahooTicker: `${key}.NS`, active: true });
  const quote = (ticker: string, price: number): Quote => ({ ticker, price, changePct: 0, prevClose: price, dayHigh: null, dayLow: null, asOf: OPEN.toISOString() });

  async function setup() {
    _resetIntradayClock();
    const repo = createMemoryRepo({ instruments: [stock(1, "HELD"), stock(2, "OTHER")] });
    await repo.upsertHolding(1, { qty: 1, avgPrice: 100, buyDate: "2026-10-01", stopLoss: 95, target1: null, target2: null });
    await repo.createAlertRule({ instrumentId: 1, condition: "holding_sl", value: 95, mode: "repeat", source: "holding", lastState: null, lastLevel: "none" });
    // A price rule on a stock that is neither watched nor held still gets a live quote.
    await repo.createAlertRule({ instrumentId: 2, condition: "price_above", value: 50, mode: "once", source: "user", lastState: false, lastLevel: null });
    let asked: string[] = [];
    const cache = { async get(t: string[]) { asked = t; return [quote("HELD.NS", 96), quote("OTHER.NS", 51)]; } };
    return { repo, cache, asked: () => asked };
  }

  it("fires from live quotes during market hours, at most once a minute", async () => {
    const { repo, cache, asked } = await setup();
    const send = vi.fn(async () => "sent" as const);
    const r = await handleQuotes(repo, cache, OPEN, { send });
    expect(r.quotes).toHaveLength(2);
    expect(asked()).toContain("OTHER.NS");
    expect(send).toHaveBeenCalledTimes(2);
    expect((await repo.listAlertEvents(10)).map((e) => e.key).sort()).toEqual(["HELD", "OTHER"]);

    const spy = vi.spyOn(repo, "listAlertRules");
    await handleQuotes(repo, cache, new Date(OPEN.getTime() + 30_000), { send });
    expect(spy).not.toHaveBeenCalled();
    await handleQuotes(repo, cache, new Date(OPEN.getTime() + 61_000), { send });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("does nothing outside market hours", async () => {
    const { repo, cache, asked } = await setup();
    const send = vi.fn(async () => "sent" as const);
    await handleQuotes(repo, cache, new Date("2026-10-16T12:00:00Z"), { send });
    expect(send).not.toHaveBeenCalled();
    expect(asked()).not.toContain("OTHER.NS");
  });

  it("still returns quotes when the alert pass throws", async () => {
    const { repo, cache } = await setup();
    repo.saveAlertStates = async () => { throw new Error("db down"); };
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await handleQuotes(repo, cache, OPEN, { send: async () => "sent" });
    expect(r.quotes).toHaveLength(2);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
