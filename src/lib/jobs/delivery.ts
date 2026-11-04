import { parseBhavcopy } from "@/lib/calc/delivery";
import type { Repo } from "@/lib/db/repo";
import { addDays, istDate } from "@/lib/time/ist";

const url = (date: string) =>
  `https://nsearchives.nseindia.com/products/content/sec_bhavdata_full_${date.slice(8, 10)}${date.slice(5, 7)}${date.slice(0, 4)}.csv`;

/** NSE's file for one session, or null when it is not published (holiday, weekend, not out yet). */
export async function fetchBhavcopy(date: string): Promise<string | null> {
  const res = await fetch(url(date), { headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(30_000) });
  if (res.status === 404 || res.status === 403) return null;
  if (!res.ok) throw new Error(`NSE ${res.status} for ${date}`);
  return res.text();
}

const isWeekday = (d: string) => {
  const w = new Date(`${d}T00:00:00Z`).getUTCDay();
  return w >= 1 && w <= 5;
};

export interface DeliveryRun { fetched: string[]; unavailable: string[]; failed: string[] }

/**
 * Stores every weekday in the last `lookbackDays` calendar days that has no rows yet. Idempotent, so a missed
 * night is picked up by the next one. A day NSE has not published is left for next time.
 */
export async function runDelivery(repo: Repo, now: Date, lookbackDays = 7, fetchText = fetchBhavcopy): Promise<DeliveryRun> {
  const today = istDate(now);
  const have = new Set((await repo.listDelivery(addDays(today, -lookbackDays))).map((r) => r.date));
  const out: DeliveryRun = { fetched: [], unavailable: [], failed: [] };
  for (let i = lookbackDays; i >= 0; i--) {
    const date = addDays(today, -i);
    if (!isWeekday(date) || have.has(date)) continue;
    try {
      const csv = await fetchText(date);
      if (csv === null) {
        out.unavailable.push(date);
        continue;
      }
      const rows = parseBhavcopy(csv).filter((r) => r.date === date);
      if (rows.length === 0) {
        out.unavailable.push(date);
        continue;
      }
      await repo.upsertDelivery(rows);
      out.fetched.push(date);
    } catch (e) {
      out.failed.push(`${date} (${e instanceof Error ? e.message : String(e)})`);
    }
  }
  return out;
}
