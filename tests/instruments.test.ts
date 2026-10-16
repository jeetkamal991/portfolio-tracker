import { describe, expect, it } from "vitest";
import { INDEX_INSTRUMENTS, SECTOR_KEYS, STRIP_KEYS, parseEquityCsv } from "@/lib/instruments";

const CSV = [
  "SYMBOL,NAME OF COMPANY, SERIES, DATE OF LISTING",
  "RELIANCE,Reliance Industries Limited,EQ,29-NOV-1995",
  "FOO,Foo Ltd,BE,01-JAN-2000",
  'BAR,"Bar, Baz & Co Limited",EQ,01-JAN-2001',
].join("\n");

describe("instruments", () => {
  it("parses EQ rows only, handling quoted commas", () => {
    expect(parseEquityCsv(CSV)).toEqual([
      { key: "RELIANCE", name: "Reliance Industries Limited", type: "stock", yahooTicker: "RELIANCE.NS", active: true },
      { key: "BAR", name: "Bar, Baz & Co Limited", type: "stock", yahooTicker: "BAR.NS", active: true },
    ]);
  });
  it("has 11 sector keys, all present as sector instruments", () => {
    expect(SECTOR_KEYS).toHaveLength(11);
    for (const k of SECTOR_KEYS) expect(INDEX_INSTRUMENTS.find((i) => i.key === k)?.type).toBe("sector");
  });
  it("strip keys exist; 13 instruments", () => {
    for (const k of STRIP_KEYS) expect(INDEX_INSTRUMENTS.some((i) => i.key === k)).toBe(true);
    expect(INDEX_INSTRUMENTS).toHaveLength(13);
  });
});
