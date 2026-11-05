import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearClientCache, fetchCached, invalidate, mutate, peek, prefetchStock, stockUrl, evaluationUrl } from "@/lib/client/cache";

const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200 });

beforeEach(() => {
  clearClientCache();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-05T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("fetchCached", () => {
  it("serves a fresh entry without a request", async () => {
    const f = vi.fn().mockImplementation(async () => ok({ n: 1 }));
    vi.stubGlobal("fetch", f);
    expect((await fetchCached("/a", { ttlMs: 1000 })).fromCache).toBe(false);
    const again = await fetchCached<{ n: number }>("/a", { ttlMs: 1000 });
    expect(again).toMatchObject({ ok: true, fromCache: true, data: { n: 1 } });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("refetches once the entry is older than its ttl, but peek still offers the stale copy meanwhile", async () => {
    const f = vi.fn().mockImplementation(async () => ok({ n: f.mock.calls.length }));
    vi.stubGlobal("fetch", f);
    await fetchCached("/a", { ttlMs: 1000 });
    vi.advanceTimersByTime(1500);
    expect(peek("/a", 1000)).toMatchObject({ fresh: false, data: { n: 1 } }); // stale-while-revalidate: still shown
    expect((await fetchCached<{ n: number }>("/a", { ttlMs: 1000 })).data).toEqual({ n: 2 });
    expect(f).toHaveBeenCalledTimes(2);
  });
  it("shares one request between simultaneous callers", async () => {
    let release!: (r: Response) => void;
    const f = vi.fn().mockImplementation(() => new Promise<Response>((r) => { release = r; }));
    vi.stubGlobal("fetch", f);
    const a = fetchCached("/a", { ttlMs: 1000 });
    const b = fetchCached("/a", { ttlMs: 1000 });
    release(ok({ x: 1 }));
    expect((await a).data).toEqual({ x: 1 });
    expect((await b).data).toEqual({ x: 1 });
    expect(f).toHaveBeenCalledTimes(1);
  });
  it("never caches an error or a non-200 answer", async () => {
    const f = vi.fn().mockResolvedValueOnce(new Response("{}", { status: 500 })).mockResolvedValueOnce(ok({ fine: true }));
    vi.stubGlobal("fetch", f);
    expect(await fetchCached("/a", { ttlMs: 1000 })).toMatchObject({ ok: false, status: 500, data: null });
    expect(peek("/a", 1000)).toBeNull();
    expect((await fetchCached("/a", { ttlMs: 1000 })).ok).toBe(true);
    const g = vi.fn().mockRejectedValue(new Error("offline"));
    vi.stubGlobal("fetch", g);
    await expect(fetchCached("/b", { ttlMs: 1000 })).rejects.toThrow("offline");
    expect(peek("/b", 1000)).toBeNull();
  });
  it("force bypasses a fresh entry", async () => {
    const f = vi.fn().mockImplementation(async () => ok({ n: f.mock.calls.length }));
    vi.stubGlobal("fetch", f);
    await fetchCached("/a", { ttlMs: 60_000 });
    expect((await fetchCached<{ n: number }>("/a", { ttlMs: 60_000, force: true })).data).toEqual({ n: 2 });
  });
  it("keeps memory bounded", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok({})));
    for (let i = 0; i < 60; i++) await fetchCached(`/k${i}`, { ttlMs: 1000 });
    expect(peek("/k0", 1000)).toBeNull();
    expect(peek("/k59", 1000)).not.toBeNull();
  });
});

describe("privacy and invalidation", () => {
  it("clearClientCache (sign-out / login page) drops everything, including in-flight sharing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok({ holding: { qty: 10 } })));
    await fetchCached(stockUrl("AAA"), { ttlMs: 60_000 });
    clearClientCache();
    expect(peek(stockUrl("AAA"), 60_000)).toBeNull();
  });
  it("any write drops cached pop-up data (holding, watchlist flag, reports) but not market-wide evaluation snapshots", async () => {
    const f = vi.fn().mockImplementation(async () => ok({}));
    vi.stubGlobal("fetch", f);
    await fetchCached(stockUrl("AAA"), { ttlMs: 60_000 });
    await fetchCached(evaluationUrl("AAA"), { ttlMs: 60_000 });
    await mutate("/api/holdings/AAA", { method: "DELETE" });
    expect(peek(stockUrl("AAA"), 60_000)).toBeNull();
    expect(peek(evaluationUrl("AAA"), 60_000)).not.toBeNull();
  });
  it("invalidates even when the write fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async (u: string) => (u.startsWith("/api/instrument") ? ok({}) : Promise.reject(new Error("network")))));
    await fetchCached(stockUrl("AAA"), { ttlMs: 60_000 });
    await expect(mutate("/api/watchlist", { method: "POST" })).rejects.toThrow();
    expect(peek(stockUrl("AAA"), 60_000)).toBeNull();
  });
  it("invalidate matches by prefix", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => ok({})));
    await fetchCached("/api/instrument/A", { ttlMs: 1000 });
    await fetchCached("/api/other", { ttlMs: 1000 });
    invalidate("/api/instrument/");
    expect(peek("/api/instrument/A", 1000)).toBeNull();
    expect(peek("/api/other", 1000)).not.toBeNull();
  });
  it("prefetch warms only the pop-up payload and is a no-op when it is already fresh", async () => {
    const f = vi.fn().mockImplementation(async () => ok({}));
    vi.stubGlobal("fetch", f);
    prefetchStock("AAA");
    prefetchStock("AAA");
    await vi.runAllTimersAsync();
    expect(f.mock.calls.map((c) => c[0])).toEqual([stockUrl("AAA")]);
  });
});
