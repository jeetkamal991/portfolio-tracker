import { describe, it, expect } from "vitest";
import { createMemoryRepo } from "@/lib/db/memoryRepo";
import type { Instrument } from "@/lib/db/types";
import type { Quote } from "@/lib/provider/types";
import { handleAlertCreate, handleAlertDelete, handleAlertFeed, handleAlertPatch, handleAlertRead, handleAlertsList } from "@/lib/api/alerts";

const CLOSED = new Date("2026-10-16T12:00:00Z"); // 17:30 IST
const OPEN = new Date("2026-10-16T05:00:00Z"); // 10:30 IST

const inst = (id: number, key: string, type: Instrument["type"] = "stock"): Instrument => ({ id, key, name: key, type, yahooTicker: `${key}.NS`, active: true });

async function setup() {
  const repo = createMemoryRepo({ instruments: [inst(1, "TCS"), inst(2, "NIFTY_IT", "sector"), inst(3, "NODATA")] });
  for (const id of [1, 2]) await repo.upsertCandles(id, [{ date: "2026-10-16", open: 100, high: 100, low: 100, close: 100, volume: 1 }]);
  return repo;
}
const noQuotes = { async get(): Promise<Quote[]> { return []; } };
const deps = (repo: Awaited<ReturnType<typeof setup>>, now = CLOSED, quotes = noQuotes) => ({ repo, now, quotes });

describe("handleAlertCreate", () => {
  it("creates a rule and says when it is already true", async () => {
    const repo = await setup();
    const r = await handleAlertCreate(deps(repo), { key: "TCS", condition: "price_above", value: 90, mode: "once" });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ alreadyTrue: true, rule: { key: "TCS", condition: "price_above", value: 90, mode: "once", source: "user", lastState: true, active: true } });
    const later = await handleAlertCreate(deps(repo), { key: "TCS", condition: "price_above", value: 110, mode: "repeat" });
    expect(later.body).toMatchObject({ alreadyTrue: false, rule: { lastState: false } });
  });
  it("uses the live price for price rules during market hours", async () => {
    const repo = await setup();
    const live = { async get(): Promise<Quote[]> { return [{ ticker: "TCS.NS", price: 120, changePct: 0.2, prevClose: 100, dayHigh: null, dayLow: null, asOf: OPEN.toISOString() }]; } };
    const r = await handleAlertCreate(deps(repo, OPEN, live), { key: "TCS", condition: "price_above", value: 110, mode: "once" });
    expect(r.body).toMatchObject({ alreadyTrue: true });
  });
  it("allows indices and sectors, and an unknown state when there is no data", async () => {
    const repo = await setup();
    expect((await handleAlertCreate(deps(repo), { key: "NIFTY_IT", condition: "cross_ema200", mode: "repeat" })).status).toBe(201);
    const r = await handleAlertCreate(deps(repo), { key: "NODATA", condition: "rsi_above_70", mode: "once" });
    expect(r).toMatchObject({ status: 201, body: { alreadyTrue: false, rule: { lastState: null } } });
  });
  it("validates the body", async () => {
    const repo = await setup();
    const bad = async (b: unknown) => (await handleAlertCreate(deps(repo), b)).status;
    expect(await bad({ key: "TCS", condition: "price_above", mode: "once" })).toBe(400);
    expect(await bad({ key: "TCS", condition: "price_below", value: 0, mode: "once" })).toBe(400);
    expect(await bad({ key: "TCS", condition: "holding_sl", value: 90, mode: "repeat" })).toBe(400);
    expect(await bad({ key: "TCS", condition: "cross_ema20", mode: "sometimes" })).toBe(400);
    expect(await bad(null)).toBe(400);
    expect((await handleAlertCreate(deps(repo), { key: "NOPE", condition: "cross_ema20", mode: "once" })).status).toBe(404);
    expect(await repo.listAlertRules()).toEqual([]);
  });
  it("a value on a condition that takes none is dropped", async () => {
    const repo = await setup();
    const r = await handleAlertCreate(deps(repo), { key: "TCS", condition: "cross_ema50", value: 5, mode: "once" });
    expect(r.body).toMatchObject({ rule: { value: null } });
  });
});

describe("handleAlertPatch / Delete", () => {
  it("pauses, resumes and deletes user rules", async () => {
    const repo = await setup();
    const { rule } = (await handleAlertCreate(deps(repo), { key: "TCS", condition: "cross_ema20", mode: "once" })).body as { rule: { id: number } };
    expect((await handleAlertPatch(repo, String(rule.id), { active: false })).status).toBe(200);
    expect((await repo.listAlertRules())[0].active).toBe(false);
    expect((await handleAlertPatch(repo, String(rule.id), { active: "yes" })).status).toBe(400);
    expect((await handleAlertDelete(repo, String(rule.id))).status).toBe(204);
    expect(await repo.listAlertRules()).toEqual([]);
    expect((await handleAlertDelete(repo, String(rule.id))).status).toBe(404);
    expect((await handleAlertPatch(repo, "abc", { active: true })).status).toBe(404);
  });
  it("holding rules are managed by the portfolio", async () => {
    const repo = await setup();
    const r = await repo.createAlertRule({ instrumentId: 1, condition: "holding_sl", value: 90, mode: "repeat", source: "holding", lastState: null, lastLevel: "none" });
    expect(await handleAlertPatch(repo, String(r.id), { active: false })).toEqual({ status: 409, body: { error: "managed_by_portfolio" } });
    expect(await handleAlertDelete(repo, String(r.id))).toEqual({ status: 409, body: { error: "managed_by_portfolio" } });
  });
});

describe("feed, list and read", () => {
  async function withEvents() {
    const repo = await setup();
    const rule = await repo.createAlertRule({ instrumentId: 1, condition: "price_above", value: 90, mode: "once", source: "user", lastState: false, lastLevel: null });
    await repo.insertAlertEvents([1, 2, 3, 4, 5, 6].map((i) => ({
      alertId: rule.id, instrumentId: 1, firedAt: `2026-10-1${i}T10:00:00.000Z`, price: 100, message: `m${i}`, telegramStatus: "sent",
    })));
    return repo;
  }
  it("feed has the unread count and the latest five; marking all read empties the count", async () => {
    const repo = await withEvents();
    const feed = await handleAlertFeed(repo);
    expect(feed.body).toMatchObject({ unread: 6 });
    expect((feed.body as { latest: { message: string }[] }).latest.map((e) => e.message)).toEqual(["m6", "m5", "m4", "m3", "m2"]);
    expect((await handleAlertRead(repo, { all: true })).status).toBe(204);
    expect((await handleAlertFeed(repo)).body).toMatchObject({ unread: 0 });
  });
  it("marks chosen events read and rejects a bad body", async () => {
    const repo = await withEvents();
    const ids = (await repo.listAlertEvents(2)).map((e) => e.id);
    expect((await handleAlertRead(repo, { ids })).status).toBe(204);
    expect((await handleAlertFeed(repo)).body).toMatchObject({ unread: 4 });
    expect((await handleAlertRead(repo, { ids: ["x"] })).status).toBe(400);
    expect((await handleAlertRead(repo, {})).status).toBe(400);
  });
  it("list returns rules, events and the Telegram status", async () => {
    const repo = await withEvents();
    const r = await handleAlertsList(repo, false);
    expect(r.body).toMatchObject({ telegram: "not_configured" });
    expect((r.body as { rules: unknown[]; events: unknown[] }).rules).toHaveLength(1);
    expect((r.body as { rules: unknown[]; events: unknown[] }).events).toHaveLength(6);
    expect((await handleAlertsList(repo, true)).body).toMatchObject({ telegram: "connected" });
  });
});
