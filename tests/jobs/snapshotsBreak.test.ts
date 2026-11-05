import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import type { Candle } from "@/lib/provider/types";
import { computeIndicators } from "@/lib/calc/indicators";
import { KNOWN_PRICE_BREAKS, breakFor } from "@/lib/calc/scoreV2/dataQuality";
import { addDays } from "@/lib/time/ist";
import { buildContext, evaluateStock } from "@/lib/jobs/snapshots";

const inst = (id: number, key: string, type: Instrument["type"]): Instrument => ({ id, key, name: key, type, yahooTicker: `T_${key}`, active: true });
const BREAK = KNOWN_PRICE_BREAKS.TMPV![0]!.date;

// Mock candles for tests only: weekdays ending 2026-03-31, prices on one basis until BREAK and 0.6x of it after.
function series(n: number, withBreak: boolean): Candle[] {
  const out: Candle[] = [];
  let d = "2026-03-31";
  while (out.length < n) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length;
      const base = 1000 + (n - i) * 1.5 + Math.sin(i / 4) * 25;
      const close = withBreak && d >= BREAK ? base * 0.6 : base;
      out.unshift({ date: d, open: close - 2, high: close + 6, low: close - 6, close, volume: 200_000 + (i % 7) * 10_000 });
    }
    d = addDays(d, -1);
  }
  return out;
}

async function setup(key: string) {
  const nc = series(330, false);
  const nm = new Map(nc.map((c) => [c.date, c.close]));
  const repo = createMemoryRepo({ instruments: [inst(1, "NIFTY50", "index"), inst(2, key, "stock")] });
  const put = async (id: number, c: Candle[]) => {
    await repo.upsertCandles(id, c);
    await repo.upsertIndicators(id, computeIndicators(c, nm));
  };
  await put(1, nc);
  await put(2, series(330, true));
  await repo.replaceConstituents("NIFTY200", [2]);
  const stock = (await repo.getInstrumentByKey(key))!;
  const ctx = await buildContext(repo, [stock]);
  return evaluateStock(ctx, stock);
}

type Cov = { dataQuality: { kind: string; date: string; sessionsUsed: number; note: string }[]; tradeQuality: { flags: string[] }; atr: { jumps: string[]; candles: number } };

describe("known price break (TMPV demerger)", () => {
  it("registry only applies when there are bars on both sides of the break", () => {
    expect(breakFor("TMPV", [{ date: "2025-10-14" }, { date: "2025-10-15" }])).toBeNull();
    expect(breakFor("TMPV", [{ date: "2025-10-13" }, { date: "2025-10-14" }])?.date).toBe(BREAK);
    expect(breakFor("RELIANCE", [{ date: "2025-10-13" }, { date: "2025-10-14" }])).toBeNull();
  });

  it("scores only the new price basis and carries a data-quality note", async () => {
    const snap = (await setup("TMPV"))!;
    const cov = snap.dataCoverage as Cov;
    expect(cov.dataQuality).toHaveLength(1);
    expect(cov.dataQuality[0]).toMatchObject({ kind: "price_break", date: BREAK });
    expect(cov.dataQuality[0]!.note).toMatch(/different bases/);
    const used = cov.dataQuality[0]!.sessionsUsed;
    expect(used).toBeGreaterThan(100);
    expect(used).toBeLessThan(200);
    // ATR and indicators come from the post-break bars only: no jump is seen, so no "unadjusted" flag is needed.
    expect(cov.atr.jumps).toEqual([]);
    expect(cov.atr.candles).toBe(used);
    // EMA200 cannot exist on fewer than 200 post-break sessions: that input is missing, not computed across the break.
    const tech = (snap.categoryBreakdown as { technical: { key: string; items: { key: string; status: string }[] }[] }).technical;
    expect(tech.find((c) => c.key === "trend")!.items.find((i) => i.key === "aboveEma200")!.status).toBe("missing");
  });

  it("an ordinary stock with the same prices is NOT reset: its ATR hits the jump rule instead", async () => {
    const snap = (await setup("OTHER"))!;
    const cov = snap.dataCoverage as Cov;
    expect(cov.dataQuality).toEqual([]);
    expect(cov.atr.jumps).toEqual([BREAK]);
    expect(cov.tradeQuality.flags.join("|")).toMatch(/over 30%/);
  });
});
