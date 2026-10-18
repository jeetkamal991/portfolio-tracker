import type { StoredDay } from "@/lib/db/types";

export interface Breadth {
  advances: number;
  declines: number;
  unchanged: number;
  total: number;
  adRatio: number | null;
  aboveEma200: number | null;
  aboveEma200Count: number;
  ema200Count: number;
  vix: { close: number | null; dayPct: number | null; spark: number[] };
}

const SPARK = 21;

/** Day % rule matches stage 3 movers: `pctChange ?? importedPct`; rows without one are excluded. */
export function buildBreadth(sessionRows: StoredDay[], vixDays: StoredDay[]): Breadth {
  let advances = 0, declines = 0, unchanged = 0;
  for (const r of sessionRows) {
    const pct = r.pctChange ?? r.importedPct;
    if (pct === null) continue;
    if (pct > 0) advances++; else if (pct < 0) declines++; else unchanged++;
  }
  let above = 0, withEma = 0;
  for (const r of sessionRows) {
    if (r.ema200 === null || r.close === null) continue;
    withEma++;
    if (r.close > r.ema200) above++;
  }
  const priced = vixDays.filter((d) => d.close !== null);
  const last = priced[priced.length - 1];
  return {
    advances, declines, unchanged,
    total: advances + declines + unchanged,
    adRatio: declines === 0 ? null : advances / declines,
    aboveEma200: withEma === 0 ? null : above / withEma,
    aboveEma200Count: above,
    ema200Count: withEma,
    vix: {
      close: last?.close ?? null,
      dayPct: last ? (last.pctChange ?? last.importedPct) : null,
      spark: priced.slice(-SPARK).map((d) => d.close as number),
    },
  };
}
