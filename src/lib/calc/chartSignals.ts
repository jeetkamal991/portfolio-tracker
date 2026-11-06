import type { StoredDay } from "@/lib/db/types";

export type SignalKind = "golden" | "death" | "above200" | "below200" | "up2050" | "down2050";
export interface ChartSignal { time: string; kind: SignalKind }

type Row = Pick<StoredDay, "date" | "close" | "ema20" | "ema50" | "ema200">;

/** Lower index wins when several signals land on one day. */
const PRIORITY: SignalKind[] = ["golden", "death", "above200", "below200", "up2050", "down2050"];

/** +1 = `a` crossed above `b` between the two rows, -1 = crossed below, 0 = no cross or a value is missing. */
function cross(pa: number | null, pb: number | null, a: number | null, b: number | null): 1 | -1 | 0 {
  if (pa === null || pb === null || a === null || b === null) return 0;
  if (pa <= pb && a > b) return 1;
  if (pa >= pb && a < b) return -1;
  return 0;
}

/** EMA/close crossings from stored values, at most one signal per day (golden/death > close vs 200 > 20/50). */
export function chartSignals(days: Row[]): ChartSignal[] {
  const rows = [...days].sort((x, y) => x.date.localeCompare(y.date));
  const out: ChartSignal[] = [];
  for (let i = 1; i < rows.length; i++) {
    const p = rows[i - 1]!, c = rows[i]!;
    const found: SignalKind[] = [];
    const g = cross(p.ema50, p.ema200, c.ema50, c.ema200);
    if (g) found.push(g > 0 ? "golden" : "death");
    const k = cross(p.close, p.ema200, c.close, c.ema200);
    if (k) found.push(k > 0 ? "above200" : "below200");
    const s = cross(p.ema20, p.ema50, c.ema20, c.ema50);
    if (s) found.push(s > 0 ? "up2050" : "down2050");
    const kind = PRIORITY.find((x) => found.includes(x));
    if (kind) out.push({ time: c.date, kind });
  }
  return out;
}
