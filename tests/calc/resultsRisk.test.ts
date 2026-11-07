import { describe, expect, it } from "vitest";
import { daysToResults, resultsLabel } from "@/lib/calc/resultsRisk";

describe("daysToResults", () => {
  const today = "2026-11-09";
  it("counts calendar days inside the 7-day window, today and the 7th day included", () => {
    expect(daysToResults("2026-11-09", today)).toBe(0);
    expect(daysToResults("2026-11-10", today)).toBe(1);
    expect(daysToResults("2026-11-16", today)).toBe(7);
  });
  it("is null for no date, a past date or a date beyond the window", () => {
    expect(daysToResults(null, today)).toBeNull();
    expect(daysToResults(undefined, today)).toBeNull();
    expect(daysToResults("2026-11-08", today)).toBeNull();
    expect(daysToResults("2026-11-17", today)).toBeNull();
  });
  it("words the label", () => {
    expect([0, 1, 5].map(resultsLabel)).toEqual(["Results today", "Results tomorrow", "Results in 5 days"]);
  });
});
