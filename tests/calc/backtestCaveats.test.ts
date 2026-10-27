import { describe, expect, it } from "vitest";
import { caveats } from "@/lib/calc/backtest/caveats";

describe("caveats", () => {
  it("always lists survivorship bias, price-only and the missing liquidity limits", () => {
    const c = caveats("alpha:a101");
    expect(c).toHaveLength(3);
    expect(c[0]).toMatch(/survivorship/i);
    expect(c[1]).toMatch(/dividends/i);
    expect(c[2]).toMatch(/liquidity/i);
    expect(caveats("rule:golden")).toHaveLength(3);
    expect(caveats("random")).toHaveLength(3);
  });
  it("adds the tie note for the two alphas with few distinct values", () => {
    for (const id of ["alpha:a001", "alpha:a054"]) {
      const c = caveats(id);
      expect(c).toHaveLength(4);
      expect(c[3]).toMatch(/tied/i);
    }
  });
});
