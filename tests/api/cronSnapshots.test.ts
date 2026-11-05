import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/cron/snapshots/route";
import { kickSnapshots } from "@/lib/api/snapshotKick";
import { SNAPSHOT_DEFAULTS } from "@/lib/jobs/snapshots";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const req = (auth?: string) => new Request("https://app.example/api/cron/snapshots", { headers: auth ? { authorization: auth } : {} });

describe("/api/cron/snapshots authentication", () => {
  it("rejects a missing, wrong or unconfigured secret before touching the database", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer nope"))).status).toBe(401);
    expect((await GET(req("s3cret"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
  });
});

describe("kickSnapshots", () => {
  it("does nothing without a secret or past the chain limit (no unlimited chaining)", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await kickSnapshots("https://app.example", undefined, 0)).toBe("skipped");
    expect(await kickSnapshots("https://app.example", "s", SNAPSHOT_DEFAULTS.maxBatches)).toBe("skipped");
    expect(f).not.toHaveBeenCalled();
  });
  it("calls the route with the bearer secret and the next chain number", async () => {
    const f = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", f);
    expect(await kickSnapshots("https://app.example", "s3cret", 2)).toBe("kicked");
    expect(f).toHaveBeenCalledWith("https://app.example/api/cron/snapshots?chain=3", expect.objectContaining({ headers: { authorization: "Bearer s3cret" } }));
  });
  it("treats a slow response as kicked and a network error as failed, never throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("t"), { name: "TimeoutError" })));
    expect(await kickSnapshots("https://app.example", "s", 0)).toBe("kicked");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    expect(await kickSnapshots("https://app.example", "s", 0)).toBe("failed");
  });
});
