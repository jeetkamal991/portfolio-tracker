import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { findTool } from "@/lib/assistant/tools/find";
import { stockTool } from "@/lib/assistant/tools/stock";
import { screenersTool } from "@/lib/assistant/tools/screeners";
import { alphasTool } from "@/lib/assistant/tools/alphas";
import { marketTool } from "@/lib/assistant/tools/market";
import { portfolioTool } from "@/lib/assistant/tools/portfolio";
import { runTool, TOOL_CAP } from "@/lib/assistant/tools";

const stocks = Array.from({ length: 12 }, (_, i) => ({
  id: 10 + i, key: `ABC${i}`, name: `Alpha Corp ${i}`, type: "stock" as const, yahooTicker: `ABC${i}.NS`, active: true,
}));

async function setup() {
  const repo = createMemoryRepo({
    instruments: [
      { id: 1, key: "NIFTY50", name: "Nifty 50", type: "index", yahooTicker: "^NSEI", active: true },
      { id: 2, key: "INDIAVIX", name: "India VIX", type: "index", yahooTicker: "^INDIAVIX", active: true },
      ...stocks,
    ],
  });
  const candles = (base: number) =>
    Array.from({ length: 15 }, (_, i) => ({ date: `2026-10-${String(i + 1).padStart(2, "0")}`, open: base, high: base + 2, low: base - 1, close: base + i, volume: 1000 + i }));
  await repo.upsertCandles(1, candles(100));
  await repo.upsertCandles(2, candles(15));
  await repo.upsertCandles(10, candles(500));
  await repo.replaceConstituents("NIFTY200", stocks.map((s) => s.id));
  return repo;
}

describe("assistant tools", () => {
  it("find lists matches by key or name, capped at 10", async () => {
    const out = await findTool(await setup(), ["alpha"]);
    expect(out).toContain("ABC0");
    expect(out.split("\n").filter((l) => l.startsWith("ABC"))).toHaveLength(10);
    expect(await findTool(await setup(), ["zzzz"])).toMatch(/No instruments/);
  });

  it("stock shows the figures, last 10 bars, and never the owner's position", async () => {
    const repo = await setup();
    await repo.upsertHolding(10, { qty: 777, avgPrice: 4321.5, buyDate: "2026-09-01", stopLoss: null, target1: null, target2: null });
    const out = await stockTool(repo, ["ABC0"]);
    expect(out).toContain("ABC0");
    expect(out).toContain("RSI 14");
    expect(out).toContain("2026-10-15");
    expect(out.match(/^2026-10-\d\d/gm)).toHaveLength(10);
    expect(out).not.toContain("777");
    expect(out).not.toContain("4321");
    expect(await stockTool(repo, ["NOPE"])).toMatch(/Not found/);
    expect(await stockTool(repo, [])).toMatch(/Usage/);
  });

  it("screeners, alphas, market respond and respect the cap", async () => {
    const repo = await setup();
    expect(await screenersTool(repo)).toContain("Volume shockers");
    const a = await alphasTool(repo, []);
    expect(a).toMatch(/#1 and #54/);
    expect((await marketTool(repo)).length).toBeLessThanOrEqual(TOOL_CAP);
    expect(await marketTool(repo)).toContain("Nifty");
  });

  it("portfolio prints holdings with P/L", async () => {
    const repo = await setup();
    await repo.upsertHolding(10, { qty: 10, avgPrice: 400, buyDate: "2026-09-01", stopLoss: null, target1: null, target2: null });
    const out = await portfolioTool(repo);
    expect(out).toContain("ABC0");
    expect(out).toMatch(/P\/L/);
    expect(await portfolioTool(createMemoryRepo())).toMatch(/No holdings/);
  });

  it("runTool rejects unknown tools and truncates long output", async () => {
    const repo = await setup();
    await expect(runTool(repo, "bogus", [])).rejects.toThrow(/Unknown tool/);
    expect((await runTool(repo, "find", ["a"])).length).toBeLessThanOrEqual(TOOL_CAP + 60);
  });
});
