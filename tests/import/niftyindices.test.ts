import { describe, expect, it, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { importConstituentFile, parseConstituentsCsv, parseIndexHistoryCsv } from "@/lib/import/niftyindices";

describe("parseConstituentsCsv", () => {
  it("handles padded header, quoted comma names, blank lines", () => {
    const csv = [
      "Company Name ,Industry,Symbol,Series,ISIN Code",
      '"Foo, Ltd.",Auto,FOO ,EQ,INE1',
      "",
      "Bar Ltd.,Auto,BAR,EQ,INE2",
    ].join("\r\n");
    expect(parseConstituentsCsv(csv)).toEqual([
      { symbol: "FOO", name: "Foo, Ltd.", series: "EQ" },
      { symbol: "BAR", name: "Bar Ltd.", series: "EQ" },
    ]);
  });
  it("throws on missing column", () => expect(() => parseConstituentsCsv("A,B\n1,2")).toThrow());
});

describe("parseIndexHistoryCsv", () => {
  const head = "Date ,Open ,High ,Low ,Close ,Shares Traded";
  it("parses DD-MMM-YYYY with comma numbers", () => {
    const r = parseIndexHistoryCsv([head, '17-Oct-2026,"18,245.30","18,300.00","18,100.5","18,200",100'].join("\n"));
    expect(r).toEqual([{ date: "2026-10-17", open: 18245.3, high: 18300, low: 18100.5, close: 18200 }]);
  });
  it("parses DD MMM YYYY and ISO, skips - rows, sorts", () => {
    const r = parseIndexHistoryCsv([head, "17 Oct 2026,1,2,0.5,1.5,1", "16 Oct 2026,-,-,-,-,-", "2026-10-15,3,4,2,3.5,1"].join("\n"));
    expect(r.map((x) => x.date)).toEqual(["2026-10-15", "2026-10-17"]);
  });
  it("later duplicate wins on concatenation", () => {
    const a = [head, "17-Oct-2026,1,1,1,1,0"].join("\n");
    const b = [head, "17-Oct-2026,2,2,2,2,0"].join("\n");
    const r = parseIndexHistoryCsv(`${a}\n${b.split("\n")[1]}`);
    expect(r).toHaveLength(1);
    expect(r[0].close).toBe(2);
  });
});

describe("importConstituentFile", () => {
  const HEAD = "Company Name,Industry,Symbol,Series,ISIN Code";
  const repoWith = () => createMemoryRepo({ instruments: [{ id: 1, key: "OLD", name: "Old", type: "stock", yahooTicker: "OLD.NS", active: true }] });

  it("header-only file -> throws and leaves membership untouched", async () => {
    const repo = repoWith();
    await repo.replaceConstituents("NIFTY200", [1]);
    const spy = vi.spyOn(repo, "replaceConstituents");
    await expect(importConstituentFile(repo, "NIFTY200", HEAD + "\n", new Map([["OLD", 1]]))).rejects.toThrow(/no constituent rows/);
    await expect(importConstituentFile(repo, "NIFTY200", "", new Map([["OLD", 1]]))).rejects.toThrow(/no constituent rows/);
    expect(spy).not.toHaveBeenCalled();
    expect((await repo.listConstituents("NIFTY200")).map((i) => i.key)).toEqual(["OLD"]);
  });

  it("empty file in a dry run (no repo) also throws", async () => {
    await expect(importConstituentFile(null, "NIFTY200", HEAD, new Map())).rejects.toThrow(/no constituent rows/);
  });

  it("inserts new symbols and replaces membership", async () => {
    const repo = repoWith();
    const res = await importConstituentFile(repo, "NIFTY200", [HEAD, "Old,X,OLD,EQ,I1", "New Co,X,NEW,EQ,I2"].join("\n"), new Map([["OLD", 1]]));
    expect(res.rows).toBe(2);
    expect(res.created).toBe(1);
    expect(res.idByKey.has("NEW")).toBe(true);
    expect((await repo.listConstituents("NIFTY200")).map((i) => i.key).sort()).toEqual(["NEW", "OLD"]);
    expect((await repo.getInstrumentByKey("NEW"))!.yahooTicker).toBe("NEW.NS");
  });
});
