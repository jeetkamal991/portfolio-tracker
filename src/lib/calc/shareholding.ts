import type { ShareholdingRow } from "@/lib/db/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-30" → "2026-06-30"; "2026-03-31" → "2025-12-31". Quarter ends only. */
export function previousQuarterEnd(q: string): string {
  const y = Number(q.slice(0, 4));
  const m = Number(q.slice(5, 7)) - 3; // 1-based month of the previous quarter end
  const [py, pm] = m < 1 ? [y - 1, m + 12] : [y, m];
  const last = new Date(Date.UTC(py, pm, 0)).getUTCDate();
  return `${py}-${String(pm).padStart(2, "0")}-${last}`;
}

/** "2026-09-30" → "Jul–Sep 2026". */
export function quarterLabel(q: string): string {
  const m = Number(q.slice(5, 7));
  return `${MONTHS[m - 3]}–${MONTHS[m - 1]} ${q.slice(0, 4)}`;
}

export interface StakeHit { key: string; name: string; from: number; to: number; change: number }
export interface StakeScreener { holder: "FII" | "DII"; quarter: string; label: string; reported: number; total: number; hits: StakeHit[] }

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Top stake increases (percentage points) of `latest` over the quarter before it. */
export function rankStakeIncreases(
  holder: "FII" | "DII",
  members: { id: number; key: string; name: string }[],
  rows: ShareholdingRow[],
  latest: string,
  limit = 25,
): StakeScreener {
  const prev = previousQuarterEnd(latest);
  const pick = (r: ShareholdingRow) => (holder === "FII" ? r.fiiPct : r.diiPct);
  const byQuarter = new Map<string, ShareholdingRow>();
  for (const r of rows) byQuarter.set(`${r.instrumentId}|${r.quarterEnd}`, r);
  let reported = 0;
  const hits: StakeHit[] = [];
  for (const m of members) {
    const now = byQuarter.get(`${m.id}|${latest}`);
    if (!now) continue;
    reported++;
    const before = byQuarter.get(`${m.id}|${prev}`);
    const to = pick(now), from = before ? pick(before) : null;
    if (to === null || from === null) continue;
    const change = round2(to - from);
    if (change > 0) hits.push({ key: m.key, name: m.name, from, to, change });
  }
  hits.sort((a, b) => b.change - a.change || a.key.localeCompare(b.key));
  return { holder, quarter: latest, label: quarterLabel(latest), reported, total: members.length, hits: hits.slice(0, limit) };
}

/** Each value 0–100; fii + dii + promoter ≤ 100.5 (rounding slack). Nulls are fine. */
export function isValidShareholding(r: ShareholdingRow): boolean {
  const vals = [r.fiiPct, r.diiPct, r.promoterPct];
  if (vals.some((v) => v !== null && !(v >= 0 && v <= 100))) return false;
  return vals.reduce<number>((s, v) => s + (v ?? 0), 0) <= 100.5;
}
