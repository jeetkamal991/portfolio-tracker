import { describe, it, expect } from "vitest";
import { volAvgPrev } from "@/lib/calc/volume";

describe("volAvgPrev", () => {
  const vols = Array.from({ length: 25 }, (_, i) => i + 1);
  it("averages the 20 sessions before today", () => {
    const r = volAvgPrev(vols);
    expect(r[19]).toBeNull();
    expect(r[20]).toBe(10.5);
  });
  it("is null while a null volume is in the window", () => {
    const v: (number | null)[] = [...vols];
    v[5] = null;
    const r = volAvgPrev(v);
    for (let i = 6; i <= 25 - 1; i++) expect(r[i]).toBeNull();
    expect(r[24]).toBeNull();
  });
});
