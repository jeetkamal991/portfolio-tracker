import { describe, expect, it } from "vitest";
import { isUnknownSymbolError } from "@/lib/provider/errors";

describe("isUnknownSymbolError", () => {
  it("matches Yahoo's unknown/delisted answer", () => {
    expect(isUnknownSymbolError(new Error("No data found, symbol may be delisted"))).toBe(true);
  });
  it("does not match transient errors", () => {
    expect(isUnknownSymbolError(new Error("fetch failed"))).toBe(false);
    expect(isUnknownSymbolError(new Error("Too Many Requests"))).toBe(false);
    expect(isUnknownSymbolError("ECONNRESET")).toBe(false);
  });
});
