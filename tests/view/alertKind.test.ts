import { describe, expect, it } from "vitest";
import { eventKind, urgencyOf } from "@/lib/view/alerts";

describe("eventKind", () => {
  it.each([
    ["🛑 ACE stop loss hit ₹1,000.00 · ₹994.70 · 30 Oct 17:12", "stop_hit"],
    ["⚠️ BEL near stop loss ₹360.50 · ₹363.35 · 28 Oct 17:12", "near_stop"],
    ["🎯 ASIANPAINT target hit ₹2,398.40 · ₹2,437.80 · 3 Nov 17:12", "target_hit"],
    ["🎯 TCS near target ₹4,000.00 · ₹3,950.00 · 3 Nov 17:12", "near_target"],
    ["📄 FIEMIND report is ready to read", "report"],
    ["🔔 RELIANCE crossed above ₹1,400.00 · ₹1,410.00 · 3 Nov 17:12", "other"],
    ["", "other"],
  ] as const)("%s -> %s", (msg, kind) => expect(eventKind(msg)).toBe(kind));
});

describe("urgencyOf", () => {
  it("ranks stop hits before near stops, targets, reports, then the rest", () => {
    const order = ["stop_hit", "near_stop", "target_hit", "near_target", "report", "other"] as const;
    expect(order.map(urgencyOf)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
