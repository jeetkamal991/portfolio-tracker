import { describe, expect, it } from "vitest";
import {
  correlation, csRank, delta, log, map1, map2, returns, sign, signedPower, stddev, tsArgmax,
} from "@/lib/calc/alpha/ops";

const nan = Number.NaN;

describe("delta", () => {
  it("is x[t] - x[t-d], NaN while there is no t-d", () => {
    expect(delta([[1, 3, 6]], 1)).toEqual([[nan, 2, 3]]);
    expect(delta([[1, 3, 6]], 2)).toEqual([[nan, nan, 5]]);
  });
  it("propagates NaN", () => {
    expect(delta([[1, nan, 6]], 1)).toEqual([[nan, nan, nan]]);
  });
});

describe("returns", () => {
  it("is x[t]/x[t-1] - 1", () => {
    const r = returns([[100, 110]]);
    expect(r[0][0]).toBeNaN();
    expect(r[0][1]).toBeCloseTo(0.1, 12);
  });
  it("is NaN when the previous value is 0", () => {
    expect(returns([[0, 5]])).toEqual([[nan, nan]]);
  });
});

describe("stddev", () => {
  it("is the sample standard deviation (n-1) of the window", () => {
    expect(stddev([[1, 2, 3]], 3)).toEqual([[nan, nan, 1]]);
  });
  it("is NaN when the window holds a NaN", () => {
    expect(stddev([[1, nan, 3, 4]], 3)).toEqual([[nan, nan, nan, nan]]);
  });
});

describe("correlation", () => {
  it("is 1 for two rising series and -1 for one rising and one falling", () => {
    const up = [[1, 2, 3, 4]];
    const same = correlation(up, [[2, 4, 6, 8]], 3)[0];
    expect(same[2]).toBeCloseTo(1, 12);
    expect(same[3]).toBeCloseTo(1, 12);
    const c = correlation(up, [[4, 3, 2, 1]], 3);
    expect(c[0][3]).toBeCloseTo(-1, 12);
    expect(c[0][0]).toBeNaN();
    expect(c[0][1]).toBeNaN();
  });
  it("is NaN when the window holds a NaN", () => {
    expect(correlation([[1, 2, nan, 4]], [[1, 2, 3, 4]], 3)[0][3]).toBeNaN();
  });
  it("is NaN for a flat window (zero variance)", () => {
    expect(correlation([[5, 5, 5]], [[1, 2, 3]], 3)[0][2]).toBeNaN();
  });
});

describe("tsArgmax", () => {
  it("is the 0-based position of the window maximum, earliest on ties", () => {
    // windows: [1,5,5] -> 1, [5,5,2] -> 0
    expect(tsArgmax([[1, 5, 5, 2]], 3)).toEqual([[nan, nan, 1, 0]]);
  });
});

describe("csRank", () => {
  it("ranks across stocks per date, average rank for ties, divided by the non-NaN count", () => {
    const r = csRank([[10], [20], [20], [nan]]);
    expect(r.map((row) => row[0])).toEqual([1 / 3, 2.5 / 3, 2.5 / 3, nan]);
  });
  it("ranks each date independently", () => {
    expect(csRank([[1, 9], [2, 3]])).toEqual([[0.5, 1], [1, 0.5]]);
  });
});

describe("elementwise helpers", () => {
  it("log is NaN for 0 and negatives", () => {
    expect(log([[Math.E, 0, -1]])[0][0]).toBeCloseTo(1, 12);
    expect(log([[0, -1]])).toEqual([[nan, nan]]);
  });
  it("signedPower keeps the sign", () => {
    expect(signedPower([[-2, 3]], 2)).toEqual([[-4, 9]]);
  });
  it("sign is -1, 0, 1", () => {
    expect(sign([[-3, 0, 5]])).toEqual([[-1, 0, 1]]);
  });
  it("map1 and map2 turn non-finite results into NaN", () => {
    expect(map1([[1, 0]], (x) => 1 / x)).toEqual([[1, nan]]);
    expect(map2([[1, 2]], [[1, 0]], (x, y) => x / y)).toEqual([[1, nan]]);
  });
});
