import { describe, it, expect } from "vitest";
import { dedupeLastWins } from "@/lib/db/dedupe";

describe("dedupeLastWins", () => {
  it("keeps the last row per key", () => {
    const out = dedupeLastWins(
      [{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "a", v: 3 }],
      (r) => r.k,
    );
    expect(out).toEqual([{ k: "a", v: 3 }, { k: "b", v: 2 }]);
  });
});
