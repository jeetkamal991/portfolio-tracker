import type { NextRequest } from "next/server";
import { cached, getRepo } from "@/lib/api/server";
import { timedJson } from "@/lib/api/timing";
import { addDays } from "@/lib/time/ist";
import { breadthSeries, type BreadthPoint } from "@/lib/view/breadth";

export const dynamic = "force-dynamic";

/** Session counts the pane may ask for (about 1M, 3M, 6M, 1Y); the last is the cap. Fewer sessions = a much smaller read. */
export const BREADTH_SESSIONS = [21, 63, 126, 260] as const;
const HALF_DAY_MS = 12 * 3_600_000;

export type BreadthResponse =
  | { state: "no_universe" | "no_data" }
  | { state: "ok"; points: BreadthPoint[]; vix: { time: string; value: number }[] };

/** % of Nifty 200 above their stored EMA 200 per day, plus the India VIX close. Changes once a day, so it is memoised per session. */
export async function GET(req: NextRequest) {
  const t0 = performance.now();
  const asked = Number(req.nextUrl.searchParams.get("n"));
  const n = BREADTH_SESSIONS.find((b) => b >= asked) ?? BREADTH_SESSIONS[BREADTH_SESSIONS.length - 1];
  const repo = getRepo();
  const [universe, nifty, vix] = await Promise.all([repo.listConstituents("NIFTY200"), repo.getInstrumentByKey("NIFTY50"), repo.getInstrumentByKey("INDIAVIX")]);
  if (universe.length === 0) return timedJson({ state: "no_universe" } satisfies BreadthResponse, 200, t0);
  const latest = nifty ? await repo.getLatestDay(nifty.id) : null;
  if (!latest) return timedJson({ state: "no_data" } satisfies BreadthResponse, 200, t0);

  const body = await cached<BreadthResponse>(`breadth:${latest.date}:${universe.length}:${n}`, async () => {
    const from = addDays(latest.date, -Math.ceil(n * 1.5));
    const [rows, vixDays] = await Promise.all([repo.getCloseEma200(universe.map((i) => i.id), from, n), vix ? repo.getDays(vix.id, n) : Promise.resolve([])]);
    const points = breadthSeries(rows).slice(-n);
    if (points.length === 0) return { state: "no_data" };
    return { state: "ok", points, vix: vixDays.flatMap((d) => (d.close === null ? [] : [{ time: d.date, value: d.close }])) };
  }, HALF_DAY_MS);
  return timedJson(body, 200, t0);
}
