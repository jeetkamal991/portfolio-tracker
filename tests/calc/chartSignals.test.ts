import { describe, expect, it } from "vitest";
import { chartSignals } from "@/lib/calc/chartSignals";

const d = (date: string, close: number | null, ema20: number | null, ema50: number | null, ema200: number | null) => ({ date, close, ema20, ema50, ema200 });

describe("chartSignals", () => {
  it("finds golden and death crosses", () => {
    const s = chartSignals([d("1", 10, null, 9, 10), d("2", 10, null, 11, 10), d("3", 10, null, 9, 10)]);
    expect(s).toEqual([{ time: "2", kind: "golden" }, { time: "3", kind: "death" }]);
  });
  it("finds close vs 200 and 20/50 crosses", () => {
    const s = chartSignals([d("1", 9, 9, 10, 10), d("2", 11, 11, 10.5, 10.5), d("3", 9, 9, 10, 10)]);
    expect(s.map((x) => x.kind)).toEqual(["above200", "below200"]);
    const t = chartSignals([d("1", 5, 9, 10, 1), d("2", 5, 11, 10, 1), d("3", 5, 9, 10, 1)]);
    expect(t.map((x) => x.kind)).toEqual(["up2050", "down2050"]);
  });
  it("keeps only the highest priority signal per day", () => {
    const s = chartSignals([d("1", 9, 9, 9, 10), d("2", 11, 11, 11, 10)]);
    // 50/200 does not cross (50 stays under... 9<10, 11>10 -> golden), close crosses 200, 20/50 equal -> none
    expect(s).toEqual([{ time: "2", kind: "golden" }]);
  });
  it("skips days with a missing value and sorts by date", () => {
    expect(chartSignals([d("1", 9, null, null, null), d("2", 11, null, null, 10)])).toEqual([]);
    expect(chartSignals([d("2", 11, null, null, 10), d("1", 9, null, null, 10)])).toEqual([{ time: "2", kind: "above200" }]);
  });
});
