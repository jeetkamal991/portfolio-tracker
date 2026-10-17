import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { handleInstrumentGet, handleReportPost } from "@/lib/api/instrument";
import type { PopupData } from "@/lib/view/popup";

const setup = async () => {
  const repo = createMemoryRepo({
    instruments: [
      { id: 1, key: "TCS", name: "TCS", type: "stock", yahooTicker: "TCS.NS", active: true },
      { id: 2, key: "NIFTY_IT", name: "Nifty IT", type: "sector", yahooTicker: "^CNXIT", active: true },
      { id: 3, key: "NIFTY50", name: "Nifty 50", type: "index", yahooTicker: "^NSEI", active: true },
    ],
  });
  await repo.upsertCandles(1, [{ date: "2026-01-01", open: 1, high: 2, low: 1, close: 2, volume: 10 }]);
  await repo.replaceConstituents("NIFTY_IT", [1]);
  await repo.addToWatchlist(1);
  return repo;
};

describe("handleInstrumentGet", () => {
  it("returns the payload", async () => {
    const r = await handleInstrumentGet(await setup(), "TCS");
    expect(r.status).toBe(200);
    const p = r.body as PopupData;
    expect(p.instrument.sectorKey).toBe("NIFTY_IT");
    expect(p.instrument.sectorName).toBe("Nifty IT");
    expect(p.onWatchlist).toBe(true);
    expect(p.days).toHaveLength(1);
  });
  it("404s on unknown key", async () => {
    expect(await handleInstrumentGet(await setup(), "NOPE")).toEqual({ status: 404, body: { error: "not_found" } });
  });
});

describe("handleReportPost", () => {
  it("inserts a pending site report", async () => {
    const repo = await setup();
    const r = await handleReportPost(repo, { key: "TCS" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "pending", instrumentId: 1, requestedVia: "site" });
    expect(await repo.listReports(1)).toHaveLength(1);
    const p = (await handleInstrumentGet(repo, "TCS")).body as PopupData;
    expect(p.reports).toHaveLength(1);
  });
  it("404s unknown and 400s bad body", async () => {
    const repo = await setup();
    expect((await handleReportPost(repo, { key: "NOPE" })).status).toBe(404);
    expect((await handleReportPost(repo, {})).status).toBe(400);
  });
});
