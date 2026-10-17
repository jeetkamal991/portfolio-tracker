import { describe, expect, it } from "vitest";
import { detectPatterns } from "@/lib/calc/patterns";

type B = { open: number; high: number; low: number; close: number };
const b = (open: number, high: number, low: number, close: number): B => ({ open, high, low, close });
/** Six flat-ish bars whose closes fall (down) or rise (up) from index 0 to 5. */
const pad = (dir: "down" | "up"): B[] =>
  [0, 1, 2, 3, 4, 5].map((k) => {
    const c = dir === "down" ? 120 - 2 * k : 100 + 2 * k;
    return b(c, c + 1, c - 1, c);
  });
const names = (bars: B[], i = bars.length - 1) => detectPatterns(bars, i).map((h) => h.name);

describe("detectPatterns", () => {
  it("returns [] for a zero-range bar", () => {
    expect(detectPatterns([...pad("down"), b(100, 100, 100, 100)], 6)).toEqual([]);
  });

  it("doji, and not also a hammer shape", () => {
    expect(names([...pad("down"), b(100, 102, 98, 100.1)])).toEqual(["doji"]);
    expect(names([...pad("down"), b(100, 100.12, 95, 100.1)])).toEqual(["doji"]);
    expect(names([...pad("down"), b(100, 102, 99, 101)])).not.toContain("doji");
  });

  it("hammer after a down trend only", () => {
    const bar = b(100, 101.05, 95, 101);
    expect(detectPatterns([...pad("down"), bar], 6)).toEqual([{ name: "hammer", bias: "bullish" }]);
    expect(names([...pad("down"), b(100, 101.05, 98.5, 101)])).not.toContain("hammer");
    expect(names([...pad("up"), bar])).not.toContain("hammer");
  });

  it("hanging man after an up trend", () => {
    const bar = b(100, 101.05, 95, 101);
    expect(detectPatterns([...pad("up"), bar], 6)).toEqual([{ name: "hanging_man", bias: "bearish" }]);
    expect(names([...pad("up"), b(100, 101.05, 98.5, 101)])).not.toContain("hanging_man");
  });

  it("inverted hammer after a down trend", () => {
    const bar = b(100, 106, 99.95, 101);
    expect(detectPatterns([...pad("down"), bar], 6)).toEqual([{ name: "inverted_hammer", bias: "bullish" }]);
    expect(names([...pad("down"), b(100, 102.5, 99.95, 101)])).not.toContain("inverted_hammer");
  });

  it("shooting star after an up trend", () => {
    const bar = b(100, 106, 99.95, 101);
    expect(detectPatterns([...pad("up"), bar], 6)).toEqual([{ name: "shooting_star", bias: "bearish" }]);
    expect(names([...pad("up"), b(100, 102.5, 99.95, 101)])).not.toContain("shooting_star");
  });

  it("i < 6 gives no trend-dependent patterns", () => {
    const bars = [b(110, 111, 109, 110), b(108, 109, 107, 108), b(106, 107, 105, 106), b(100, 101.05, 95, 101)];
    expect(names(bars)).toEqual([]);
  });

  it("bullish engulfing; equal bodies do not match", () => {
    expect(names([b(105, 105.5, 99.5, 100), b(99, 106, 98.5, 106)])).toContain("bullish_engulfing");
    expect(names([b(105, 105.5, 99.5, 100), b(100, 105.5, 99.5, 105)])).not.toContain("bullish_engulfing");
  });

  it("bearish engulfing; equal bodies do not match", () => {
    expect(names([b(100, 105.5, 99.5, 105), b(106, 106.5, 98.5, 99)])).toContain("bearish_engulfing");
    expect(names([b(100, 105.5, 99.5, 105), b(105, 105.5, 99.5, 100)])).not.toContain("bearish_engulfing");
  });

  it("piercing line; close below midpoint does not match", () => {
    expect(names([b(110, 110.5, 99.5, 100), b(98, 106.5, 97.5, 106)])).toContain("piercing_line");
    expect(names([b(110, 110.5, 99.5, 100), b(98, 104.5, 97.5, 104)])).not.toContain("piercing_line");
  });

  it("dark cloud cover; close above midpoint does not match", () => {
    expect(names([b(100, 110.5, 99.5, 110), b(112, 112.5, 103.5, 104)])).toContain("dark_cloud_cover");
    expect(names([b(100, 110.5, 99.5, 110), b(112, 112.5, 105.5, 106)])).not.toContain("dark_cloud_cover");
  });

  it("morning star; weak recovery does not match", () => {
    const q = b(110, 110, 100, 100);
    const p = b(98, 99.5, 97.5, 99);
    expect(names([q, p, b(99, 106, 99, 106)])).toContain("morning_star");
    expect(names([q, p, b(99, 104, 99, 104)])).not.toContain("morning_star");
  });

  it("evening star; weak drop does not match", () => {
    const q = b(100, 110, 100, 110);
    const p = b(112, 112.5, 110.5, 111);
    expect(names([q, p, b(111, 111, 104, 104)])).toContain("evening_star");
    expect(names([q, p, b(111, 111, 106, 106)])).not.toContain("evening_star");
  });
});
