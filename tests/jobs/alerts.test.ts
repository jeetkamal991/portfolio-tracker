import { describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Snapshot } from "@/lib/calc/alerts";
import type { NewAlertRule } from "@/lib/db/types";
import { runAlerts, syncHoldingAlerts } from "@/lib/jobs/alerts";
import type { Sender } from "@/lib/notify/telegram";

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

describe("runAlerts", () => {
  const NOW = new Date("2026-10-16T10:00:00Z"); // 15:30 IST
  const IND = { pctChange: null, rsi14: null, rsVsNifty: null, macd: null, macdSignal: null, macdHist: null, bbUpper: null, bbMiddle: null, bbLower: null, volAvg20: null, high52w: null, low52w: null, patterns: null };
  const nifty = { id: 9, key: "NIFTY50", name: "Nifty 50", type: "index" as const, yahooTicker: "^NSEI", active: true };

  /** TCS closes at `close` on 2026-10-16 with EMA 200 = 3400 (and EMA 20/50 = 3400). */
  async function setup(close = 3412) {
    const repo = createMemoryRepo({ instruments: [...instruments, nifty] });
    for (const id of [1, 9]) {
      await repo.upsertCandles(id, [{ date: "2026-10-16", open: close, high: close, low: close, close, volume: 1 }]);
    }
    await repo.upsertIndicators(1, [{ ...IND, date: "2026-10-16", ema20: 3400, ema50: 3400, ema200: 3400 }]);
    return repo;
  }
  const fakeSend = (result: Awaited<ReturnType<Sender>> = "sent") => vi.fn<Sender>(async () => result);
  const rule = (o: Partial<NewAlertRule>): NewAlertRule =>
    ({ instrumentId: 1, condition: "cross_ema200", value: null, mode: "repeat", source: "user", lastState: false, lastLevel: null, ...o });

  it("EOD: an EMA 200 cross fires once with the exact message and Telegram status; a second run fires nothing", async () => {
    const repo = await setup();
    await repo.createAlertRule(rule({}));
    const send = fakeSend();
    expect(await runAlerts({ repo, send, now: NOW, mode: "eod" })).toEqual({ evaluated: 1, fired: 1, telegramFailed: 0 });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("🔔 TCS crossed above EMA 200 · ₹3,412.00 · 16 Oct 15:30");
    expect(await repo.listAlertEvents(10)).toEqual([
      expect.objectContaining({ key: "TCS", alertId: 1, price: 3412, message: "🔔 TCS crossed above EMA 200 · ₹3,412.00 · 16 Oct 15:30", telegramStatus: "sent", read: false }),
    ]);
    expect((await repo.listAlertRules())[0]).toMatchObject({ lastState: true, lastFiredAt: NOW.toISOString(), active: true });

    expect(await runAlerts({ repo, send, now: new Date(NOW.getTime() + 86_400_000), mode: "eod" })).toMatchObject({ fired: 0 });
    expect(await repo.listAlertEvents(10)).toHaveLength(1);
  });

  it("a once rule is switched off after it fires; a repeat rule stays on", async () => {
    const repo = await setup();
    await repo.createAlertRule(rule({ condition: "price_above", value: 3410, mode: "once" }));
    await repo.createAlertRule(rule({ condition: "price_below", value: 3500, mode: "repeat" }));
    await runAlerts({ repo, send: fakeSend(), now: NOW, mode: "eod" });
    expect((await repo.listAlertRules()).map((r) => [r.condition, r.active])).toEqual([["price_above", false], ["price_below", true]]);
    expect(await repo.listAlertEvents(10)).toHaveLength(2);
  });

  it("a Telegram failure is stored on the event and counted", async () => {
    const repo = await setup();
    await repo.createAlertRule(rule({}));
    const r = await runAlerts({ repo, send: fakeSend("failed: chat not found"), now: NOW, mode: "eod" });
    expect(r).toMatchObject({ fired: 1, telegramFailed: 1 });
    expect((await repo.listAlertEvents(1))[0].telegramStatus).toBe("failed: chat not found");
  });

  it("missing data: no event and the previous state is kept", async () => {
    const repo = await setup();
    await repo.createAlertRule(rule({ instrumentId: 2 }));
    expect(await runAlerts({ repo, send: fakeSend(), now: NOW, mode: "eod" })).toEqual({ evaluated: 0, fired: 0, telegramFailed: 0 });
    expect((await repo.listAlertRules())[0].lastState).toBe(false);
  });

  it("intraday: a holding near its SL fires from a live quote, is throttled within 15 minutes, and EOD-only rules are untouched", async () => {
    const repo = await setup();
    await repo.createAlertRule(rule({ condition: "holding_sl", value: 3400, source: "holding", lastLevel: "none" }));
    await repo.createAlertRule(rule({ condition: "cross_ema200", lastState: false }));
    const send = fakeSend();
    const quotes = { "TCS.NS": { price: 3420 } };
    expect(await runAlerts({ repo, send, now: NOW, mode: "intraday", quotes })).toEqual({ evaluated: 1, fired: 1, telegramFailed: 0 });
    expect(send).toHaveBeenCalledWith("⚠️ TCS near stop loss ₹3,400.00 · ₹3,420.00 · 16 Oct 15:30");
    // Back to none, then near again 5 minutes later: throttled.
    await runAlerts({ repo, send, now: new Date(NOW.getTime() + 60_000), mode: "intraday", quotes: { "TCS.NS": { price: 3600 } } });
    await runAlerts({ repo, send, now: new Date(NOW.getTime() + 300_000), mode: "intraday", quotes });
    expect(await repo.listAlertEvents(10)).toHaveLength(1);
    expect((await repo.listAlertRules()).find((r) => r.condition === "cross_ema200")!.lastState).toBe(false);
  });

  it("intraday: a rule whose ticker has no quote is skipped", async () => {
    const repo = await setup();
    await repo.createAlertRule(rule({ condition: "price_above", value: 3000 }));
    expect(await runAlerts({ repo, send: fakeSend(), now: NOW, mode: "intraday", quotes: {} })).toEqual({ evaluated: 0, fired: 0, telegramFailed: 0 });
  });

  it("uses preloaded rules without querying them again, and ignores inactive ones", async () => {
    const repo = await setup();
    const r = await repo.createAlertRule(rule({ condition: "price_above", value: 3000 }));
    const spy = vi.spyOn(repo, "listAlertRules");
    await runAlerts({ repo, send: fakeSend(), now: NOW, mode: "intraday", quotes: { "TCS.NS": { price: 3100 } }, rules: [{ ...r, active: false }] });
    expect(spy).not.toHaveBeenCalled();
    expect(await repo.listAlertEvents(10)).toEqual([]);
  });
});

describe("runAlerts writes", () => {
  it("does not rewrite rules whose state did not change", async () => {
    const repo = createMemoryRepo({ instruments });
    await repo.createAlertRule({ instrumentId: 1, condition: "price_above", value: 4000, mode: "once", source: "user", lastState: false, lastLevel: null });
    const spy = vi.spyOn(repo, "saveAlertStates");
    await runAlerts({ repo, send: async () => "sent", now: new Date(), mode: "intraday", quotes: { "TCS.NS": { price: 3600 } } });
    expect(spy).toHaveBeenCalledWith([]);
  });
});
