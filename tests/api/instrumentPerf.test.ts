import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import { createSupabaseRepo } from "@/lib/db/supabaseRepo";
import type { Instrument } from "@/lib/db/types";
import type { Candle } from "@/lib/provider/types";
import { addDays } from "@/lib/time/ist";
import { handleInstrumentGet, POPUP_BARS } from "@/lib/api/instrument";

const inst = (id: number, key: string, type: Instrument["type"] = "stock"): Instrument => ({ id, key, name: key, type, yahooTicker: `${key}.NS`, active: true });

// Mock candles for tests only: n weekdays ending 2026-10-16.
function series(n: number): Candle[] {
  const out: Candle[] = [];
  let d = "2026-10-16";
  while (out.length < n) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) out.unshift({ date: d, open: 100, high: 102, low: 98, close: 100 + out.length * 0.01, volume: 1000 });
    d = addDays(d, -1);
  }
  return out;
}

async function setup(rows: number) {
  const repo = createMemoryRepo({ instruments: [inst(1, "NIFTY50", "index"), inst(2, "AAA")] });
  await repo.upsertCandles(1, series(rows));
  await repo.upsertCandles(2, series(rows));
  return repo;
}

describe("handleInstrumentGet: loads a year, not the history", () => {
  it("returns only POPUP_BARS rows and says older history exists", async () => {
    const r = await handleInstrumentGet(await setup(900), "AAA");
    const body = r.body as { days: unknown[]; historyTruncated: boolean };
    expect(body.days).toHaveLength(POPUP_BARS);
    expect(body.historyTruncated).toBe(true);
  });
  it("does not claim more history when the stock has less than a year", async () => {
    const body = (await handleInstrumentGet(await setup(120), "AAA")).body as { days: unknown[]; historyTruncated: boolean };
    expect(body.days).toHaveLength(120);
    expect(body.historyTruncated).toBe(false);
  });
  it("404s an unknown key", async () => {
    expect((await handleInstrumentGet(await setup(10), "NOPE")).status).toBe(404);
  });
});

describe("handleInstrumentGet: memoised reference data, live private data", () => {
  it("reuses Nifty's latest day, memberships and the quarter across opens, but reads the owner's state every time", async () => {
    const repo = await setup(300);
    const store = new Map<string, Promise<unknown>>();
    const memo = <T,>(key: string, fn: () => Promise<T>) => {
      if (!store.has(key)) store.set(key, fn());
      return store.get(key) as Promise<T>;
    };
    const memberships = vi.spyOn(repo, "listMemberships");
    const quarter = vi.spyOn(repo, "latestShareholdingQuarter");
    const watch = vi.spyOn(repo, "listWatchlist");
    const holding = vi.spyOn(repo, "getHolding");
    const first = (await handleInstrumentGet(repo, "AAA", { memo })).body as { onWatchlist: boolean };
    await repo.addToWatchlist(2);
    const second = (await handleInstrumentGet(repo, "AAA", { memo })).body as { onWatchlist: boolean };
    expect(memberships).toHaveBeenCalledTimes(1);
    expect(quarter).toHaveBeenCalledTimes(1);
    expect(watch).toHaveBeenCalledTimes(2);
    expect(holding).toHaveBeenCalledTimes(2);
    expect(first.onWatchlist).toBe(false);
    expect(second.onWatchlist).toBe(true); // private state is never served from the memo
  });
  it("asks for one stock's shareholding rows, not everyone's", async () => {
    const repo = await setup(50);
    const spy = vi.spyOn(repo, "listShareholding");
    await repo.upsertShareholding([{ instrumentId: 2, quarterEnd: "2026-09-30", fiiPct: 10, diiPct: 5, promoterPct: 50, sourceUrl: null }]);
    await handleInstrumentGet(repo, "AAA");
    expect(spy).toHaveBeenCalledWith(["2026-09-30", "2026-06-30"], [2]);
  });
});

describe("getDays request count (supabase repo, fake client)", () => {
  function fake(total: number) {
    const ranges: [number, number][] = [];
    const db = {
      from: () => {
        let withCount = false;
        const q: Record<string, unknown> = {};
        q.select = (_c: string, o?: { count?: string }) => { withCount = o?.count === "exact"; return q; };
        q.eq = () => q; q.order = () => q;
        q.range = (a: number, b: number) => {
          ranges.push([a, b]);
          const data = [];
          for (let i = a; i <= Math.min(b, total - 1); i++) data.push({ instrument_id: 1, date: `d${String(total - i).padStart(5, "0")}` });
          return Promise.resolve({ data, error: null, count: withCount ? total : null });
        };
        return q;
      },
    } as unknown as SupabaseClient;
    return { db, ranges };
  }
  it("a year of rows is one request", async () => {
    const { db, ranges } = fake(1939);
    const days = await createSupabaseRepo(db).getDays(1, 260);
    expect(ranges).toEqual([[0, 259]]);
    expect(days).toHaveLength(260);
  });
  it("a 5000-row ask on a 1939-row history is ONE wave of three speculative pages, not five and not a count-then-fetch chain", async () => {
    const { db, ranges } = fake(1939);
    const days = await createSupabaseRepo(db).getDays(1, 5000);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
    expect(days).toHaveLength(1939);
    expect(days[0]!.date < days[days.length - 1]!.date).toBe(true); // returned oldest first
  });
  it("never reads beyond the requested limit", async () => {
    const { db, ranges } = fake(4000);
    const days = await createSupabaseRepo(db).getDays(1, 1500);
    expect(ranges).toEqual([[0, 999], [1000, 1499]]);
    expect(days).toHaveLength(1500);
  });
  it("a history longer than the speculative pages takes a second wave for the rest, together", async () => {
    const { db, ranges } = fake(4500);
    const days = await createSupabaseRepo(db).getDays(1, 5000);
    expect(ranges).toEqual([[0, 999], [1000, 1999], [2000, 2999], [3000, 3999], [4000, 4999]]);
    expect(days).toHaveLength(4500);
  });
});
