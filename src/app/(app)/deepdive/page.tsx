import { getRepo } from "@/lib/api/server";
import type { ReportTile } from "@/lib/view/deepdive";
import { DeepDiveTiles } from "../../components/deepdive/DeepDiveTiles";

export const dynamic = "force-dynamic";

export default async function DeepDivePage() {
  const repo = getRepo();
  const reports = await repo.listAllReports();
  // One lookup per researched stock, in parallel: its latest stored Technical Score.
  const ids = [...new Set(reports.map((r) => r.instrumentId))];
  const days = await Promise.all(ids.map((id) => repo.getLatestDay(id).catch(() => null)));
  const latest = new Map(ids.map((id, i) => [id, days[i]]));
  const tiles: ReportTile[] = reports.map((r) => ({
    ...r,
    score: latest.get(r.instrumentId)?.score ?? null,
    scoreLabel: latest.get(r.instrumentId)?.scoreLabel ?? null,
  }));
  return <DeepDiveTiles initial={tiles} />;
}
