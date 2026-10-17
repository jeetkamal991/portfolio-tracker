import { z } from "zod";
import type { Repo } from "@/lib/db/repo";
import { primarySector } from "@/lib/universe/sectors";
import { buildPopupData } from "@/lib/view/popup";
import type { ApiResult } from "./levels";

const NIFTY_KEY = "NIFTY50";
const HISTORY_LIMIT = 5000;
const reportBody = z.object({ key: z.string().min(1) });

export async function handleInstrumentGet(repo: Repo, key: string): Promise<ApiResult> {
  const inst = await repo.getInstrumentByKey(key);
  if (!inst) return { status: 404, body: { error: "not_found" } };

  const [days, levels, watchlist, memberships, nifty, reports] = await Promise.all([
    repo.getDays(inst.id, HISTORY_LIMIT),
    repo.getLevels(inst.id),
    repo.listWatchlist(),
    repo.listMemberships(),
    repo.getInstrumentByKey(NIFTY_KEY),
    repo.listReports(inst.id),
  ]);
  const sectorKey =
    inst.type === "stock"
      ? primarySector(memberships.filter((m) => m.instrumentId === inst.id).map((m) => m.indexKey))
      : null;
  const [sector, niftyLatest] = await Promise.all([
    sectorKey ? repo.getInstrumentByKey(sectorKey) : Promise.resolve(null),
    nifty ? repo.getLatestDay(nifty.id) : Promise.resolve(null),
  ]);

  const data = buildPopupData({
    instrument: inst, sector, days, levels, niftyLatest,
    onWatchlist: watchlist.some((w) => w.id === inst.id), reports,
  });
  return { status: 200, body: data };
}

export async function handleReportPost(repo: Repo, body: unknown): Promise<ApiResult> {
  const parsed = reportBody.safeParse(body);
  if (!parsed.success) return { status: 400, body: { error: "invalid_body" } };
  const inst = await repo.getInstrumentByKey(parsed.data.key);
  if (!inst) return { status: 404, body: { error: "not_found" } };
  return { status: 200, body: await repo.requestReport(inst.id) };
}
