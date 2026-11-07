import { describe, expect, it } from "vitest";
import {
  CONDITIONS, alertMessage, evaluateRule, initialState,
  type AlertCondition, type RuleState, type Snapshot,
} from "@/lib/calc/alerts";

const AT = new Date("2026-10-17T10:00:00Z"); // 15:30 IST
const snap = (o: Partial<Snapshot> = {}): Snapshot => ({
  key: "RELIANCE", price: 1352.4, ema20: null, ema50: null, ema200: null, rsi14: null,
  score: null, scoreLabel: null, at: AT, live: false, ...o,
});
const rule = (condition: AlertCondition, o: Partial<RuleState> = {}): RuleState => ({
  condition, value: null, mode: "repeat", lastState: false, lastLevel: null, lastFiredAt: null, ...o,
});
const ev = (r: RuleState, s: Snapshot, throttleMs?: number) => evaluateRule(r, s, { throttleMs });

describe("evaluateRule · price", () => {
  const above = (o: Partial<RuleState> = {}) => rule("price_above", { value: 1350, ...o });
  it("fires when the state goes false → true", () => {
    expect(ev(above(), snap())).toEqual({ known: true, state: true, level: null, fire: true, direction: "above" });
  });
  it("does not fire while already true", () => {
    expect(ev(above({ lastState: true }), snap({ price: 1360 })).fire).toBe(false);
  });
  it("does not fire on a fresh rule but records the state", () => {
    const e = ev(above({ lastState: null }), snap());
    expect(e.fire).toBe(false);
    expect(e.state).toBe(true);
  });
  it("is unknown without a price, keeping the previous state", () => {
    expect(ev(above({ lastState: false }), snap({ price: null }))).toEqual({
      known: false, state: false, level: null, fire: false, direction: null,
    });
  });
  it("price_below fires on a drop below", () => {
    const e = ev(rule("price_below", { value: 1350 }), snap({ price: 1340 }));
    expect(e).toMatchObject({ fire: true, direction: "below" });
  });
});

describe("evaluateRule · EMA cross", () => {
  it("fires on a change either way, with the direction", () => {
    expect(ev(rule("cross_ema200", { lastState: false }), snap({ ema200: 1300 }))).toMatchObject({ fire: true, direction: "above", state: true });
    expect(ev(rule("cross_ema200", { lastState: true }), snap({ ema200: 1400 }))).toMatchObject({ fire: true, direction: "below", state: false });
  });
  it("does not fire when unchanged, and is unknown without the EMA", () => {
    expect(ev(rule("cross_ema50", { lastState: true }), snap({ ema50: 1300 })).fire).toBe(false);
    expect(ev(rule("cross_ema20", { lastState: true }), snap()).known).toBe(false);
  });
});

describe("evaluateRule · RSI and score", () => {
  it("RSI 70 is not above 70; 70.01 is", () => {
    expect(ev(rule("rsi_above_70"), snap({ rsi14: 70 })).state).toBe(false);
    expect(ev(rule("rsi_above_70"), snap({ rsi14: 70.01 }))).toMatchObject({ state: true, fire: true });
    expect(ev(rule("rsi_below_30"), snap({ rsi14: 29.9 }))).toMatchObject({ state: true, fire: true });
  });
  it("score turns bullish from Neutral, not from Bullish to Strong Bullish", () => {
    expect(ev(rule("score_turns_bullish", { lastState: false }), snap({ scoreLabel: "Bullish", score: 64 })).fire).toBe(true);
    expect(ev(rule("score_turns_bullish", { lastState: true }), snap({ scoreLabel: "Strong Bullish", score: 80 })).fire).toBe(false);
    expect(ev(rule("score_turns_bearish", { lastState: false }), snap({ scoreLabel: "Strong Bearish", score: 20 })).fire).toBe(true);
    expect(ev(rule("score_turns_bearish"), snap()).known).toBe(false);
  });
  const stage = (n: 1 | 2 | 3 | 4 | null, freshBreakout = false) => ({ stage: n, freshBreakout, ma30: 100, slope: 0.02, weeksInStage: 3 });
  it("enters Stage 2 fires on the change only, and skips when the stage is unknown", () => {
    expect(ev(rule("enters_stage2", { lastState: false }), snap({ stage: stage(2) }))).toMatchObject({ known: true, state: true, fire: true });
    expect(ev(rule("enters_stage2", { lastState: true }), snap({ stage: stage(2) })).fire).toBe(false); // stays in Stage 2
    expect(ev(rule("enters_stage2", { lastState: false }), snap({ stage: stage(3) }))).toMatchObject({ state: false, fire: false });
    expect(ev(rule("enters_stage2", { lastState: null }), snap({ stage: stage(2) })).fire).toBe(false); // a new rule records, never fires
    expect(ev(rule("enters_stage2", { lastState: false }), snap({ stage: stage(null) })).known).toBe(false);
    expect(ev(rule("enters_stage2", { lastState: false }), snap()).known).toBe(false);
    expect(ev(rule("enters_stage2", { lastState: false }), snap({ stage: stage(2), live: true })).known).toBe(false); // nightly only
  });
});

describe("evaluateRule · holdings", () => {
  const sl = (lastLevel: RuleState["lastLevel"]) => rule("holding_sl", { value: 3400, lastState: null, lastLevel });
  it("walks none → near → near → hit → none → near, firing only when the level rises", () => {
    const steps: [number, string, boolean][] = [];
    let last: RuleState["lastLevel"] = "none";
    for (const price of [3412, 3420, 3399, 3600, 3410]) {
      const e = ev(sl(last), snap({ key: "TCS", price }));
      steps.push([price, e.level as string, e.fire]);
      last = e.level;
    }
    expect(steps).toEqual([
      [3412, "near", true], [3420, "near", false], [3399, "hit", true], [3600, "none", false], [3410, "near", true],
    ]);
  });
  it("target: 1.98% below is near, at the target is hit", () => {
    const t = (price: number) => ev(rule("holding_target", { value: 1700, lastState: null, lastLevel: "none" }), snap({ price }));
    expect(t(1667)).toMatchObject({ level: "near", fire: true });
    expect(t(1700)).toMatchObject({ level: "hit", fire: true });
    expect(t(1600)).toMatchObject({ level: "none", fire: false });
  });
  it("a fresh holding rule (no level yet) does not fire", () => {
    expect(ev(sl(null), snap({ price: 3399 }))).toMatchObject({ level: "hit", fire: false });
  });
});

describe("evaluateRule · throttle and live snapshots", () => {
  const fired = (minutesAgo: number) => rule("price_above", { value: 1350, lastFiredAt: new Date(AT.getTime() - minutesAgo * 60_000) });
  it("blocks a second fire within 15 minutes", () => {
    expect(ev(fired(10), snap()).fire).toBe(false);
    expect(ev(fired(16), snap()).fire).toBe(true);
  });
  it("EOD-only conditions are untouched by a live snapshot", () => {
    const e = ev(rule("cross_ema200", { lastState: false }), snap({ ema200: 1300, live: true }));
    expect(e).toEqual({ known: false, state: false, level: null, fire: false, direction: null });
  });
});

describe("initialState", () => {
  it("returns the state or level now, without firing", () => {
    expect(initialState("price_above", 1350, snap())).toEqual({ state: true, level: null });
    expect(initialState("holding_sl", 3400, snap({ price: 3412 }))).toEqual({ state: null, level: "near" });
    expect(initialState("rsi_above_70", null, snap())).toEqual({ state: null, level: null });
  });
});

describe("CONDITIONS", () => {
  it("marks price and holding rules intraday, holding rules not user-creatable", () => {
    const by = Object.fromEntries(CONDITIONS.map((c) => [c.id, c]));
    expect(CONDITIONS.filter((c) => c.intraday).map((c) => c.id)).toEqual(["price_above", "price_below", "holding_sl", "holding_target"]);
    expect(by.holding_sl.userCreatable).toBe(false);
    expect(by.price_above.needsValue).toBe(true);
    expect(by.cross_ema50.needsValue).toBe(false);
  });
});

describe("alertMessage", () => {
  const msg = (key: string, c: AlertCondition, s: Snapshot, value: number | null, lastState: boolean | null = false, lastLevel: RuleState["lastLevel"] = "none") =>
    alertMessage(key, c, evaluateRule(rule(c, { value, lastState, lastLevel }), s, {}), s, value);
  it("matches the spec examples", () => {
    expect(msg("RELIANCE", "price_above", snap(), 1350)).toBe("🔔 RELIANCE crossed above ₹1,350.00 · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("RELIANCE", "price_below", snap({ price: 1340 }), 1350)).toBe("🔔 RELIANCE fell below ₹1,350.00 · ₹1,340.00 · 17 Oct 15:30");
    expect(msg("RELIANCE", "cross_ema200", snap({ ema200: 1300 }), null)).toBe("🔔 RELIANCE crossed above EMA 200 · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("RELIANCE", "cross_ema50", snap({ ema50: 1400 }), null, true)).toBe("🔔 RELIANCE crossed below EMA 50 · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("RELIANCE", "rsi_above_70", snap({ rsi14: 72.43 }), null)).toBe("🔔 RELIANCE RSI above 70 (72.4) · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("RELIANCE", "rsi_below_30", snap({ rsi14: 28.1 }), null)).toBe("🔔 RELIANCE RSI below 30 (28.1) · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("RELIANCE", "score_turns_bullish", snap({ scoreLabel: "Bullish", score: 64 }), null)).toBe("🔔 RELIANCE score turned Bullish (64) · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("RELIANCE", "score_turns_bearish", snap({ scoreLabel: "Bearish", score: 41 }), null)).toBe("🔔 RELIANCE score turned Bearish (41) · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("TCS", "enters_stage2", snap({ stage: { stage: 2, freshBreakout: false, ma30: 1, slope: 0, weeksInStage: 1 } }), null)).toBe("📈 TCS entered Stage 2 (Weinstein) · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("TCS", "enters_stage2", snap({ stage: { stage: 2, freshBreakout: true, ma30: 1, slope: 0, weeksInStage: 1 } }), null)).toBe("📈 TCS entered Stage 2 (Weinstein) · fresh breakout · ₹1,352.40 · 17 Oct 15:30");
    expect(msg("TCS", "holding_sl", snap({ price: 3412 }), 3400)).toBe("⚠️ TCS near stop loss ₹3,400.00 · ₹3,412.00 · 17 Oct 15:30");
    expect(msg("TCS", "holding_sl", snap({ price: 3390 }), 3400)).toBe("🛑 TCS stop loss hit ₹3,400.00 · ₹3,390.00 · 17 Oct 15:30");
    expect(msg("INFY", "holding_target", snap({ price: 1680 }), 1700)).toBe("🎯 INFY near target ₹1,700.00 · ₹1,680.00 · 17 Oct 15:30");
    expect(msg("INFY", "holding_target", snap({ price: 1705 }), 1700)).toBe("🎯 INFY target hit ₹1,700.00 · ₹1,705.00 · 17 Oct 15:30");
  });
});
