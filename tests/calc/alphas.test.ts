import { describe, expect, it } from "vitest";
import { ALPHAS, type AlphaId, type Panel } from "@/lib/calc/alpha/alphas";

const nan = Number.NaN;
type Bar = { o: number; h: number; l: number; c: number; v: number } | null;

// one array of bars per stock, oldest to newest; null is a missing bar
function panel(stocks: Bar[][]): Panel {
  const col = (f: (b: NonNullable<Bar>) => number) => stocks.map((bars) => bars.map((b) => (b ? f(b) : nan)));
  return { open: col((b) => b.o), high: col((b) => b.h), low: col((b) => b.l), close: col((b) => b.c), volume: col((b) => b.v) };
}
const run = (id: AlphaId, p: Panel) => ALPHAS.find((a) => a.id === id)!.compute(p);
const flatBar = (c: number, v = 100): NonNullable<Bar> => ({ o: c, h: c, l: c, c, v });
const series = (n: number, f: (t: number) => NonNullable<Bar>): Bar[] => Array.from({ length: n }, (_, t) => f(t));

describe("ALPHAS", () => {
  it("lists the six alphas in order with the paper numbers and warm-up bars", () => {
    expect(ALPHAS.map((a) => a.id)).toEqual(["a001", "a002", "a006", "a012", "a054", "a101"]);
    expect(ALPHAS.map((a) => a.paperNo)).toEqual([1, 2, 6, 12, 54, 101]);
    expect(ALPHAS.map((a) => a.minBars)).toEqual([25, 10, 10, 2, 1, 1]);
  });
});

describe("a001", () => {
  // 30 bars. Rising stock: no negative returns, so the base is close, whose maximum is the newest of the last 5 (position 4).
  // Flat stock: return 0 is not < 0, base is the constant close, ties resolve to the earliest (position 0).
  // Cross-sectional rank over two stocks is 0.5 and 1, minus 0.5.
  it("ranks a rising stock above a flat one", () => {
    const p = panel([series(30, (t) => flatBar(100 + t)), series(30, () => flatBar(100))]);
    expect(run("a001", p)).toEqual([0.5, 0]);
  });
  // A stock that falls every bar needs the 20-return stddev. With 25 valid bars (index 5..29) it is scored,
  // with 24 (index 6..29) the first return the oldest window needs is missing, so it is NaN.
  it("needs 25 bars when every return is negative", () => {
    const falling = (from: number) => series(30, (t) => (t < from ? null : flatBar(200 - t))) as Bar[];
    const rising = series(30, (t) => flatBar(100 + t));
    expect(Number.isNaN(run("a001", panel([falling(5), rising]))[0])).toBe(false);
    expect(run("a001", panel([falling(6), rising]))[0]).toBeNaN();
  });
  it("is NaN for a stock with a missing bar in the window", () => {
    const gap = series(30, (t) => (t === 27 ? null : flatBar(100 + t)));
    const rising = series(30, (t) => flatBar(100 + t));
    expect(run("a001", panel([gap, rising]))[0]).toBeNaN();
  });
});

describe("a002", () => {
  // Two stocks, 8 bars. B: constant volume and close = open, so its delta(log volume, 2) is 0 and its intraday return is 0.
  // A volume: log change over 2 bars is positive at t=2..4 and negative at t=5..7. A is above B, then below B.
  const vol = [100, 100, 200, 300, 400, 200, 150, 100];
  const b = series(8, () => flatBar(100));
  const a = (closes: number[]) => series(8, (t) => ({ o: 100, h: 120, l: 80, c: closes[t], v: vol[t] }));
  it("is -1 when the intraday move ranks the same way as the volume change", () => {
    const aligned = a([100, 100, 110, 110, 110, 90, 90, 90]); // above B at t=2..4, below at t=5..7
    const [ra, rb] = run("a002", panel([aligned, b]));
    expect(ra).toBeCloseTo(-1, 12);
    expect(rb).toBeCloseTo(-1, 12);
  });
  it("is +1 when it ranks the opposite way", () => {
    const opposed = a([100, 100, 90, 90, 90, 110, 110, 110]);
    const [ra, rb] = run("a002", panel([opposed, b]));
    expect(ra).toBeCloseTo(1, 12);
    expect(rb).toBeCloseTo(1, 12);
  });
  it("is NaN when a window holds zero volume (log of 0)", () => {
    const zero = series(8, (t) => flatBar(100, t === 4 ? 0 : 100 + t));
    const aligned = a([100, 100, 110, 110, 110, 90, 90, 90]);
    expect(run("a002", panel([aligned, zero]))[1]).toBeNaN();
  });
});

describe("a006", () => {
  it("is -1 * the 10-bar correlation of open and volume", () => {
    const up = series(10, (t) => ({ o: 1 + t, h: 20, l: 1, c: 5, v: 2 * (1 + t) })); // corr +1
    const down = series(10, (t) => ({ o: 1 + t, h: 20, l: 1, c: 5, v: 10 - t })); // corr -1
    const flatOpen = series(10, (t) => ({ o: 5, h: 20, l: 1, c: 5, v: 1 + t })); // zero variance
    const r = run("a006", panel([up, down, flatOpen]));
    expect(r[0]).toBeCloseTo(-1, 12);
    expect(r[1]).toBeCloseTo(1, 12);
    expect(r[2]).toBeNaN();
  });
});

describe("a012", () => {
  it("is sign(volume change) * -(close change)", () => {
    const bars = (c: [number, number], v: [number, number]): Bar[] => [
      { o: 1, h: 1, l: 1, c: c[0], v: v[0] }, { o: 1, h: 1, l: 1, c: c[1], v: v[1] },
    ];
    const r = run("a012", panel([
      bars([10, 12], [5, 7]), // volume up, close +2 -> -2
      bars([10, 12], [7, 5]), // volume down, close +2 -> +2
      bars([10, 12], [5, 5]), // volume flat -> 0
    ]));
    expect(r[0]).toBe(-2);
    expect(r[1]).toBe(2);
    expect(Math.abs(r[2])).toBe(0);
  });
});

describe("a054", () => {
  it("is -((low-close)*open^5) / ((low-high)*close^5)", () => {
    const r = run("a054", panel([[{ o: 10, h: 12, l: 8, c: 11, v: 1 }]]));
    expect(r[0]).toBeCloseTo(-((8 - 11) * 10 ** 5) / ((8 - 12) * 11 ** 5), 12);
  });
  it("is NaN on a flat bar (high = low)", () => {
    expect(run("a054", panel([[flatBar(10)]]))[0]).toBeNaN();
  });
});

describe("a101", () => {
  it("is (close-open) / ((high-low) + 0.001)", () => {
    const r = run("a101", panel([[{ o: 10, h: 12, l: 8, c: 11, v: 1 }], [{ o: 10, h: 10, l: 10, c: 10.5, v: 1 }]]));
    expect(r[0]).toBeCloseTo(1 / 4.001, 12);
    expect(r[1]).toBeCloseTo(0.5 / 0.001, 9); // a flat range stays defined
  });
});
