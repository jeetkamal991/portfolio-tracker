import { describe, it, expect, vi } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import type { Candle } from "@/lib/provider/types";
import { computeIndicators } from "@/lib/calc/indicators";
import { scoreInstrument } from "@/lib/calc/score";
import { effectiveLevel } from "@/lib/calc/levels";
import { addDays } from "@/lib/time/ist";
import { scorePass } from "@/lib/jobs/score";

const inst = (id: number, key: string, type: Instrument["type"]): Instrument => ({
  id, key, name: key, type, yahooTicker: `T_${key}`, active: true,
});

function series(n: number, drift: number): Candle[] {
  const out: Candle[] = [];
  let d = "2026-10-16";
  while (out.length < n) {
    const dow = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (dow !== 0 && dow !== 6) {
      const i = n - out.length;
      const close = 1000 + (n - i) * drift + Math.sin(i / 4) * 25;
      out.unshift({ date: d, open: close - 2, high: close + 6, low: close - 6, close, volume: 1000 + (i % 7) * 100 });
    }
    d = addDays(d, -1);
  }
  return out;
}

type MemRepo = ReturnType<typeof createMemoryRepo>;

async function seed(repo: MemRepo, id: number, candles: Candle[], nifty: Map<string, number>) {
  await repo.upsertCandles(id, candles);
  await repo.upsertIndicators(id, computeIndicators(candles, nifty));
}

async function setup(): Promise<MemRepo> {
  const repo = createMemoryRepo({
    instruments: [
      inst(1, "NIFTY50", "index"), inst(2, "NIFTY_IT", "sector"), inst(3, "TCS", "stock"),
      inst(4, "EMPTY", "stock"),
    ],
  });
  const nc = series(260, 1);
  const niftyMap = new Map(nc.map((c) => [c.date, c.close]));
  await seed(repo, 1, nc, niftyMap);
  await seed(repo, 2, series(260, 1.5), niftyMap);
  await seed(repo, 3, series(260, 2), niftyMap);
  await repo.replaceConstituents("NIFTY200", [3, 4]);
  await repo.replaceConstituents("NIFTY_IT", [3]);
  await repo.setManualLevels(3, 1900, 2200);
  return repo;
}

const latest = async (repo: MemRepo, id: number) => (await repo.getLatestDay(id))!;

describe("scorePass", () => {
  it("scores Nifty, sector and stock on their latest date; stock market reflects sector label", async () => {
    const repo = await setup();
    const res = await scorePass(repo);
    expect(res.skipped).toEqual(["EMPTY"]);
    const n = await latest(repo, 1);
    const sec = await latest(repo, 2);
    const tcs = await latest(repo, 3);
    for (const d of [n, sec, tcs]) {
      expect(d.score).not.toBeNull();
      expect(d.date).toBe("2026-10-16");
    }
    expect(n.scoreComponents!.market).toBe(10);
    expect(tcs.rsVsSector).not.toBeNull();
    expect(n.rsVsSector).toBeNull();

    const days = (await repo.getDays(3, 30)).filter((d) => d.close !== null);
    const l = days[days.length - 1]!;
    const p = days[days.length - 2]!;
    const re = scoreInstrument({
      kind: "stock", close: l.close!, prevClose: p.close,
      ema20: l.ema20, ema50: l.ema50, ema200: l.ema200, rsi14: l.rsi14,
      macd: l.macd, macdSignal: l.macdSignal, macdHist: l.macdHist, prevMacdHist: p.macdHist,
      volume: l.volume, volAvg20: l.volAvg20,
      recentPatterns: days.slice(-3).flatMap((d) => d.patterns ?? []),
      niftyLabel: n.scoreLabel, sectorLabel: sec.scoreLabel, rs20: l.rsVsNifty,
      support: effectiveLevel(null, 1900), resistance: effectiveLevel(null, 2200),
    });
    expect(tcs.scoreComponents).toEqual({ ...re.components, partial: re.partial });
    expect(tcs.score).toBe(re.score);
  });

  it("scores in dependency order: NIFTY50 first, stocks last", async () => {
    const repo = await setup();
    const order: number[] = [];
    const orig = repo.upsertScore.bind(repo);
    vi.spyOn(repo, "upsertScore").mockImplementation(async (id, row) => {
      order.push(id);
      return orig(id, row);
    });
    await scorePass(repo);
    expect(order[0]).toBe(1);
    expect(order[order.length - 1]).toBe(3);
    expect(order).toContain(2);
  });

  it("stock with no priced bars is skipped without throwing", async () => {
    const repo = await setup();
    const res = await scorePass(repo);
    expect(res.skipped).toContain("EMPTY");
    expect(res.scored).toBe(3);
  });

  it("is idempotent", async () => {
    const repo = await setup();
    await scorePass(repo);
    const snap = () => JSON.stringify([1, 2, 3].map((id) => [...repo._days.get(id)!.values()]));
    const a = snap();
    await scorePass(repo);
    expect(snap()).toBe(a);
  });

  it("onlyIds scores just those instruments", async () => {
    const repo = await setup();
    const res = await scorePass(repo, { onlyIds: new Set([3]) });
    expect(res.scored).toBe(1);
    expect((await latest(repo, 1)).score).toBeNull();
    expect((await latest(repo, 3)).score).not.toBeNull();
  });
});

describe("scorePass fault tolerance and scope", () => {
  it("continues past a throwing instrument and reports it in failed", async () => {
    const repo = await setup();
    const getDays = repo.getDays.bind(repo);
    repo.getDays = async (id, limit) => {
      if (id === 2) throw new Error("db hiccup");
      return getDays(id, limit);
    };
    const res = await scorePass(repo);
    expect(res.failed).toEqual(["NIFTY_IT (db hiccup)"]);
    expect((await latest(repo, 1)).score).not.toBeNull();
    expect((await latest(repo, 3)).score).not.toBeNull();
  });

  it("a throwing stock is reported and does not stop the other stocks", async () => {
    const repo = await setup();
    const upsert = repo.upsertScore.bind(repo);
    repo.upsertScore = async (id, row) => {
      if (id === 3) throw new Error("write failed");
      return upsert(id, row);
    };
    const res = await scorePass(repo);
    expect(res.failed).toEqual(["TCS (write failed)"]);
    expect(res.scored).toBe(2);
  });

  it("scores stocks concurrently", async () => {
    const instruments = [inst(1, "NIFTY50", "index")];
    for (let i = 0; i < 12; i++) instruments.push(inst(10 + i, `S${i}`, "stock"));
    const repo = createMemoryRepo({ instruments });
    const nc = series(60, 1);
    const niftyMap = new Map(nc.map((c) => [c.date, c.close]));
    await seed(repo, 1, nc, niftyMap);
    for (let i = 0; i < 12; i++) await seed(repo, 10 + i, series(60, 1), niftyMap);
    await repo.replaceConstituents("NIFTY200", instruments.slice(1).map((i) => i.id));
    let inFlight = 0;
    let max = 0;
    const getDays = repo.getDays.bind(repo);
    repo.getDays = async (id, limit) => {
      inFlight++;
      max = Math.max(max, inFlight);
      await new Promise((r) => setTimeout(r, 2));
      inFlight--;
      return getDays(id, limit);
    };
    const res = await scorePass(repo);
    expect(res.scored).toBe(13);
    expect(max).toBeGreaterThan(1);
  });

  it("finishes every index/sector before any stock is scored", async () => {
    const repo = await setup();
    await repo.upsertInstruments([{ key: "NIFTY_BANK", name: "Bank", type: "sector", yahooTicker: "T_B", active: true }]);
    const bank = (await repo.getInstrumentByKey("NIFTY_BANK"))!;
    const nc = series(260, 1);
    await seed(repo, bank.id, series(260, 0.5), new Map(nc.map((c) => [c.date, c.close])));
    const order: number[] = [];
    const orig = repo.upsertScore.bind(repo);
    repo.upsertScore = async (id, row) => { order.push(id); return orig(id, row); };
    await scorePass(repo);
    expect(order[0]).toBe(1);
    expect(order.indexOf(3)).toBeGreaterThan(order.indexOf(2));
    expect(order.indexOf(3)).toBeGreaterThan(order.indexOf(bank.id));
  });

  it("does not score India VIX", async () => {
    const repo = await setup();
    await repo.upsertInstruments([{ key: "INDIAVIX", name: "India VIX", type: "index", yahooTicker: "^INDIAVIX", active: true }]);
    const vix = (await repo.getInstrumentByKey("INDIAVIX"))!;
    const nc = series(260, 1);
    await seed(repo, vix.id, series(260, 0.1), new Map(nc.map((c) => [c.date, c.close])));
    const res = await scorePass(repo);
    expect((await latest(repo, vix.id)).score).toBeNull();
    expect(res.scored).toBe(3);
  });

  it("lists only indices and sectors, never the whole instrument table", async () => {
    const repo = await setup();
    const spy = vi.spyOn(repo, "listInstruments");
    await scorePass(repo);
    expect(spy).toHaveBeenCalled();
    for (const [f] of spy.mock.calls) expect(f).toEqual({ types: ["index", "sector"], activeOnly: true });
  });

  it("reports a missing NIFTY50 in skipped", async () => {
    const repo = createMemoryRepo({ instruments: [inst(2, "NIFTY_IT", "sector")] });
    const res = await scorePass(repo);
    expect(res.skipped).toContain("NIFTY50");
  });

  it("reports an unpriced NIFTY50 in skipped", async () => {
    const repo = createMemoryRepo({ instruments: [inst(1, "NIFTY50", "index")] });
    const res = await scorePass(repo);
    expect(res.skipped).toEqual(["NIFTY50"]);
  });
});
