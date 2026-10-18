import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Candle, MarketDataProvider } from "@/lib/provider/types";
import { addDays } from "@/lib/time/ist";
import { handleHoldingDelete, handleHoldingPost, handleHoldingPrefill, handleHoldingPut, type PrefillData } from "@/lib/api/portfolio";

const NOW = new Date("2026-10-16T11:00:00Z");
const provider = (): MarketDataProvider => ({
  async getDailyHistory() { return []; },
  async getQuotes() { return []; },
});

/** AAA: 45 flat bars ending 2026-10-15 (close 100) with swing highs 112, 120, 130 and a swing low 90. BBB: no data. */
async function setup() {
  const repo = createMemoryRepo({
    instruments: [
      { id: 1, key: "AAA", name: "Aaa Ltd", type: "stock", yahooTicker: "AAA.NS", active: true },
      { id: 2, key: "NIFTY_IT", name: "Nifty IT", type: "sector", yahooTicker: "^CNXIT", active: true },
      { id: 3, key: "BBB", name: "Bbb Ltd", type: "stock", yahooTicker: "BBB.NS", active: true },
    ],
  });
  const peaks: Record<number, { high?: number; low?: number }> = { 8: { high: 112 }, 18: { high: 120 }, 28: { high: 130 }, 20: { low: 90 } };
  const candles: Candle[] = [];
  for (let i = 0; i < 45; i++) {
    const p = peaks[i] ?? {};
    candles.push({ date: addDays("2026-10-15", i - 44), open: 100, high: p.high ?? 101, low: p.low ?? 99, close: 100, volume: 1 });
  }
  await repo.upsertCandles(1, candles);
  await repo.replaceConstituents("NIFTY_IT", [1]);
  return repo;
}

const body = { key: "AAA", qty: 10, avgPrice: 100, buyDate: "2026-10-01", stopLoss: 90, target1: 120 };
const deps = (repo: Awaited<ReturnType<typeof setup>>) => ({ repo, provider: provider(), now: NOW });

describe("handleHoldingPost", () => {
  it("valid body stores the holding", async () => {
    const repo = await setup();
    const r = await handleHoldingPost(deps(repo), body);
    expect(r).toEqual({ status: 200, body: { ok: true, merged: false, warnings: [] } });
    expect(await repo.getHolding(1)).toMatchObject({ qty: 10, avgPrice: 100, stopLoss: 90, target1: 120, target2: null });
  });
  it("qty 0 -> 400 with errors.qty and nothing saved", async () => {
    const repo = await setup();
    const r = await handleHoldingPost(deps(repo), { ...body, qty: 0 });
    expect(r.status).toBe(400);
    expect((r.body as { errors: Record<string, string> }).errors.qty).toBeTruthy();
    expect(await repo.listHoldings()).toEqual([]);
  });
  it("a held key merges", async () => {
    const repo = await setup();
    await handleHoldingPost(deps(repo), body);
    const r = await handleHoldingPost(deps(repo), { ...body, qty: 30, avgPrice: 200, stopLoss: null });
    expect(r.body).toMatchObject({ ok: true, merged: true });
    expect(await repo.getHolding(1)).toMatchObject({ qty: 40, avgPrice: 175, stopLoss: 90 });
  });
  it("returns validation warnings", async () => {
    const repo = await setup();
    const r = await handleHoldingPost(deps(repo), { ...body, stopLoss: 100 });
    expect((r.body as { warnings: string[] }).warnings).toHaveLength(1);
  });
  it("a stock with no price data -> clear error, nothing saved", async () => {
    const repo = await setup();
    const r = await handleHoldingPost(deps(repo), { ...body, key: "BBB" });
    expect(r).toEqual({ status: 400, body: { error: "No price data for this stock" } });
    expect(await repo.listHoldings()).toEqual([]);
  });
  it("unknown / non-stock key and missing key", async () => {
    const repo = await setup();
    expect(await handleHoldingPost(deps(repo), { ...body, key: "NOPE" })).toEqual({ status: 400, body: { error: "Unknown stock" } });
    expect(await handleHoldingPost(deps(repo), { ...body, key: "NIFTY_IT" })).toEqual({ status: 400, body: { error: "Unknown stock" } });
    expect(await handleHoldingPost(deps(repo), { qty: 1 })).toEqual({ status: 400, body: { errors: { key: "Pick a stock" } } });
    expect(await handleHoldingPost(deps(repo), null)).toEqual({ status: 400, body: { errors: { key: "Pick a stock" } } });
  });
});

describe("handleHoldingPut / Delete", () => {
  it("PUT replaces values exactly", async () => {
    const repo = await setup();
    await handleHoldingPost(deps(repo), body);
    const r = await handleHoldingPut(deps(repo), "AAA", { qty: 5, avgPrice: 50, buyDate: "2026-09-01" });
    expect(r.status).toBe(200);
    expect(await repo.getHolding(1)).toMatchObject({ qty: 5, avgPrice: 50, buyDate: "2026-09-01", stopLoss: null, target1: null, target2: null });
  });
  it("PUT validates and 404s when not held", async () => {
    const repo = await setup();
    expect((await handleHoldingPut(deps(repo), "AAA", body)).status).toBe(404);
    expect((await handleHoldingPut(deps(repo), "NOPE", body)).status).toBe(404);
    await handleHoldingPost(deps(repo), body);
    expect((await handleHoldingPut(deps(repo), "AAA", { ...body, qty: -1 })).status).toBe(400);
  });
  it("DELETE removes it (204) and is idempotent", async () => {
    const repo = await setup();
    await handleHoldingPost(deps(repo), body);
    expect((await handleHoldingDelete({ repo }, "AAA")).status).toBe(204);
    expect(await repo.listHoldings()).toEqual([]);
    expect((await handleHoldingDelete({ repo }, "AAA")).status).toBe(204);
  });
});

describe("handleHoldingPrefill", () => {
  it("returns levels, sector and the held position", async () => {
    const repo = await setup();
    const r = await handleHoldingPrefill(repo, "AAA");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({
      key: "AAA", name: "Aaa Ltd", sectorName: "Nifty IT", cmp: 100, score: null,
      support: 90, resistance: 112, nextResistance: 120, held: null,
    } satisfies Partial<PrefillData>);
    await handleHoldingPost(deps(repo), body);
    expect(((await handleHoldingPrefill(repo, "AAA")).body as PrefillData).held).toEqual({
      qty: 10, avgPrice: 100, buyDate: "2026-10-01", stopLoss: 90, target1: 120, target2: null,
    });
  });
  it("404s on unknown or non-stock keys", async () => {
    const repo = await setup();
    expect((await handleHoldingPrefill(repo, "NOPE")).status).toBe(404);
    expect((await handleHoldingPrefill(repo, "NIFTY_IT")).status).toBe(404);
  });
});
