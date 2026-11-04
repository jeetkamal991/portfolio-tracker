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

import { eventMarkers } from "@/lib/view/alerts";

describe("eventMarkers", () => {
  const dates = ["2026-10-29", "2026-10-30", "2026-11-02", "2026-11-03"];
  it("pins to the same day, or to the session before a weekend", () => {
    const m = eventMarkers(
      [
        { key: "ACE", firedAt: "2026-10-30T11:42:21Z", message: "🛑 ACE stop loss hit" },
        { key: "BEL", firedAt: "2026-11-01T06:00:00Z", message: "⚠️ BEL near stop loss" }, // Sunday
      ],
      dates,
    );
    expect(m).toEqual([
      { time: "2026-10-30", key: "ACE", kind: "stop_hit" },
      { time: "2026-10-30", key: "BEL", kind: "near_stop" },
    ]);
  });
  it("drops events before the first candle and keeps IST dates (late UTC evening is next day)", () => {
    expect(eventMarkers([{ key: "X", firedAt: "2026-10-01T10:00:00Z", message: "🔔 x" }], dates)).toEqual([]);
    // 20:00 UTC on 2 Nov is 01:30 IST on 3 Nov
    expect(eventMarkers([{ key: "Y", firedAt: "2026-11-02T20:00:00Z", message: "📄 Y report is ready to read" }], dates)).toEqual([
      { time: "2026-11-03", key: "Y", kind: "report" },
    ]);
  });
});
