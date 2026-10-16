import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { handleLevelsPut } from "@/lib/api/levels";
import { effectiveLevel } from "@/lib/calc/levels";

const setup = async () => {
  const repo = createMemoryRepo({
    instruments: [{ id: 1, key: "TCS", name: "TCS", type: "stock", yahooTicker: "TCS.NS", active: true }],
  });
  await repo.setAutoLevels(1, 90, 120);
  return repo;
};

describe("handleLevelsPut", () => {
  it("stores manual support and leaves auto values", async () => {
    const repo = await setup();
    const r = await handleLevelsPut(repo, "TCS", { manualSupport: 95, manualResistance: null });
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ autoSupport: 90, autoResistance: 120, manualSupport: 95, manualResistance: null });
  });

  it("clears overrides when both null", async () => {
    const repo = await setup();
    await handleLevelsPut(repo, "TCS", { manualSupport: 95, manualResistance: 130 });
    const r = await handleLevelsPut(repo, "TCS", { manualSupport: null, manualResistance: null });
    const l = r.body as { autoSupport: number; manualSupport: number | null };
    expect(effectiveLevel(l.autoSupport, l.manualSupport)).toBe(90);
  });

  it.each([
    [{ manualSupport: -1, manualResistance: null }],
    [{ manualSupport: 0, manualResistance: null }],
    [{ manualSupport: NaN, manualResistance: null }],
    [{ manualSupport: Infinity, manualResistance: null }],
    [{ manualSupport: "5", manualResistance: null }],
    [{ manualSupport: 5 }],
    [null],
  ])("rejects invalid body %#", async (body) => {
    const repo = await setup();
    const r = await handleLevelsPut(repo, "TCS", body);
    expect(r.status).toBe(400);
    expect(r.body).toHaveProperty("error");
    expect((await repo.getLevels(1)).manualSupport).toBeNull();
  });

  it("404s on unknown key", async () => {
    const repo = await setup();
    const r = await handleLevelsPut(repo, "NOPE", { manualSupport: 1, manualResistance: null });
    expect(r.status).toBe(404);
  });
});
