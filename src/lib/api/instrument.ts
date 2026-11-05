import { z } from "zod";
import type { Repo } from "@/lib/db/repo";
import { previousQuarterEnd } from "@/lib/calc/shareholding";
import { primarySector } from "@/lib/universe/sectors";
import { buildPopupData } from "@/lib/view/popup";
import type { ApiResult } from "./levels";

const NIFTY_KEY = "NIFTY50";
/**
 * The pop-up opens on a 6-month chart and the indicator panels only read the latest rows, so it loads one year (252
 * sessions plus spare) instead of the whole history. The full series is fetched on demand by /api/history/[key] when the
 * user picks a longer chart range. `historyTruncated` tells the client whether there is more to fetch.
 */
export const POPUP_BARS = 260;
const reportBody = z.object({ key: z.string().min(1) });

type Memo = <T>(key: string, fn: () => Promise<T>, ttlMs?: number) => Promise<T>;
const NO_MEMO: Memo = (_k, fn) => fn();
/** Reference data that is the same for every user and changes at most daily; safe to reuse briefly. */
const REFERENCE_TTL_MS = 60_000;
const STATIC_TTL_MS = 600_000;

/**
 * `opts.memo` (the route passes the real one) reuses market-wide reference data between pop-up opens: Nifty's latest day, the
 * latest reported quarter and index memberships. The owner's own state (holding, watchlist, reports, levels) is always read live.
 */
export async function handleInstrumentGet(repo: Repo, key: string, opts: { memo?: Memo } = {}): Promise<ApiResult> {
  const memo = opts.memo ?? NO_MEMO;
  const inst = await repo.getInstrumentByKey(key);
  if (!inst) return { status: 404, body: { error: "not_found" } };

  // Every read starts now. Dependent lookups (sector instrument, Nifty latest day, shareholding rows) are chained inside the
  // same parallel group instead of waiting for the others, so the whole pop-up costs about two round trips, not four.
  const [days, levels, watchlist, nifty, reports, held, sector, quarterRows] = await Promise.all([
    repo.getDays(inst.id, POPUP_BARS),
    repo.getLevels(inst.id),
    repo.listWatchlist(),
    memo("nifty-latest-day", () => repo.getInstrumentByKey(NIFTY_KEY).then((n) => (n ? repo.getLatestDay(n.id) : null)), REFERENCE_TTL_MS),
    repo.listReports(inst.id),
    repo.getHolding(inst.id),
    inst.type === "stock"
      ? memo("memberships", () => repo.listMemberships(), STATIC_TTL_MS).then((m) => {
          const sectorKey = primarySector(m.filter((x) => x.instrumentId === inst.id).map((x) => x.indexKey));
          return sectorKey ? repo.getInstrumentByKey(sectorKey) : null;
        })
      : Promise.resolve(null),
    memo("shareholding-quarter", () => repo.latestShareholdingQuarter(), STATIC_TTL_MS).then((q) => (q ? repo.listShareholding([q, previousQuarterEnd(q)], [inst.id]) : [])),
  ]);
  const niftyLatest = nifty;

  const data = buildPopupData({
    instrument: inst, sector, days, levels, niftyLatest,
    shareholding: quarterRows.filter((r) => r.instrumentId === inst.id),
    onWatchlist: watchlist.some((w) => w.id === inst.id), reports,
    holding: held
      ? { qty: held.qty, avgPrice: held.avgPrice, buyDate: held.buyDate, stopLoss: held.stopLoss, target1: held.target1 }
      : null,
  });
  return { status: 200, body: { ...data, historyTruncated: days.length >= POPUP_BARS } };
}

export async function handleReportDelete(repo: Repo, id: string): Promise<ApiResult> {
  if (!/^\d+$/.test(id)) return { status: 400, body: { error: "invalid_id" } };
  await repo.deleteReport(Number(id));
  return { status: 204, body: null };
}

export async function handleReportPost(repo: Repo, body: unknown): Promise<ApiResult> {
  const parsed = reportBody.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  const inst = await repo.getInstrumentByKey(parsed.data.key);
  if (!inst) return { status: 404, body: { error: "not_found" } };
  return { status: 200, body: await repo.requestReport(inst.id) };
}
