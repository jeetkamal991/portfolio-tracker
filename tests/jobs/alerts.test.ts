import { describe, expect, it } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Snapshot } from "@/lib/calc/alerts";
import { syncHoldingAlerts } from "@/lib/jobs/alerts";

const instruments = [
  { id: 1, key: "TCS", name: "Tcs", type: "stock" as const, yahooTicker: "TCS.NS", active: true },
  { id: 2, key: "INFY", name: "Infy", type: "stock" as const, yahooTicker: "INFY.NS", active: true },
];
const holding = (o: Partial<{ stopLoss: number | null; target1: number | null }> = {}) =>
  ({ qty: 1, avgPrice: 3500, buyDate: "2026-10-01", stopLoss: 3400, target1: 3800, target2: null, ...o });
const snap = (price: number) => async (): Promise<Snapshot> => ({
  key: "TCS", price, ema20: null, ema50: null, ema200: null, rsi14: null, score: null, scoreLabel: null, at: new Date(), live: false,
});

describe("syncHoldingAlerts", () => {
  it("creates one repeat holding rule each for SL and T1, with the level now", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.upsertHolding(1, holding());
    await syncHoldingAlerts(repo, snap(3412));
    const rules = await repo.listAlertRules();
    expect(rules.map((r) => [r.key, r.condition, r.value, r.mode, r.source, r.lastLevel])).toEqual([
      ["TCS", "holding_sl", 3400, "repeat", "holding", "near"],
      ["TCS", "holding_target", 3800, "repeat", "holding", "none"],
    ]);
  });

  it("is idempotent", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.upsertHolding(1, holding());
    await syncHoldingAlerts(repo, snap(3600));
    await syncHoldingAlerts(repo, snap(3600));
    expect(await repo.listAlertRules()).toHaveLength(2);
  });

  it("an edited SL keeps the rule id, takes the new value and level, and fires nothing", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.upsertHolding(1, holding());
    await syncHoldingAlerts(repo, snap(3600));
    const before = (await repo.listAlertRules()).find((r) => r.condition === "holding_sl")!;
    await repo.upsertHolding(1, holding({ stopLoss: 3590 }));
    await syncHoldingAlerts(repo, snap(3600));
    const after = (await repo.listAlertRules()).find((r) => r.condition === "holding_sl")!;
    expect(after).toMatchObject({ id: before.id, value: 3590, lastLevel: "near" });
    expect(await repo.listAlertEvents(10)).toEqual([]);
  });

  it("a cleared T1 removes its rule; a removed holding removes both; user rules are left alone", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.upsertHolding(1, holding());
    await repo.upsertHolding(2, holding());
    const user = await repo.createAlertRule({ instrumentId: 1, condition: "price_above", value: 4000, mode: "once", source: "user", lastState: false, lastLevel: null });
    await syncHoldingAlerts(repo, snap(3600));
    await repo.upsertHolding(1, holding({ target1: null }));
    await repo.deleteHolding(2);
    await syncHoldingAlerts(repo, snap(3600));
    expect((await repo.listAlertRules()).map((r) => `${r.key}:${r.condition}`)).toEqual(["TCS:price_above", "TCS:holding_sl"]);
    expect((await repo.listAlertRules())[0].id).toBe(user.id);
  });

  it("an unpriced stock gets a rule with an unknown level", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.upsertHolding(1, holding({ target1: null }));
    await syncHoldingAlerts(repo, async () => null);
    expect((await repo.listAlertRules())[0]).toMatchObject({ condition: "holding_sl", lastLevel: null });
  });
});
