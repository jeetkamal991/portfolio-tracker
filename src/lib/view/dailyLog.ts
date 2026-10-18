import type { StoredDay } from "@/lib/db/types";
import { istDate } from "@/lib/time/ist";

export const LOG_COLUMNS: { key: string; label: string }[] = [
  { key: "NIFTY50", label: "NIFTY" }, { key: "NIFTY_AUTO", label: "AUTO" }, { key: "NIFTY_BANK", label: "BANK" },
  { key: "NIFTY_FIN", label: "Financial" }, { key: "NIFTY_FMCG", label: "FMCG" }, { key: "NIFTY_IT", label: "IT" },
  { key: "NIFTY_MEDIA", label: "MEDIA" }, { key: "NIFTY_METAL", label: "METAL" }, { key: "NIFTY_PHARMA", label: "PHARMA" },
  { key: "NIFTY_PSU_BANK", label: "PSU BANK" }, { key: "NIFTY_PVT_BANK", label: "PVT BANK" }, { key: "NIFTY_HEALTHCARE", label: "HEALTHCARE" },
];

export interface LogMonth {
  /** "2026-10" */
  id: string;
  /** "OCT", or "DEC 2025" when the months span two years. */
  label: string;
  /** Ascending by date. */
  rows: { date: string; values: Record<string, number | null> }[];
  totals: Record<string, { sum: number | null; compound: number | null }>;
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function buildDailyLog(series: Record<string, StoredDay[]>, sessionDates: string[], now: Date, months = 6): LogMonth[] {
  const [y, m] = istDate(now).split("-").map(Number);
  const spans = Array.from({ length: months }, (_, i) => {
    const idx = y * 12 + (m - 1) - i;
    return { year: Math.floor(idx / 12), month: idx % 12 };
  });
  const multiYear = spans.some((s) => s.year !== y);

  const pctOf = new Map(
    LOG_COLUMNS.map((c) => [c.key, new Map((series[c.key] ?? []).map((d) => [d.date, d.pctChange ?? d.importedPct]))]),
  );

  return spans.map(({ year, month }) => {
    const id = `${year}-${String(month + 1).padStart(2, "0")}`;
    const rows = sessionDates
      .filter((d) => d.startsWith(`${id}-`))
      .sort()
      .map((date) => ({
        date,
        values: Object.fromEntries(LOG_COLUMNS.map((c) => [c.key, pctOf.get(c.key)!.get(date) ?? null])) as Record<string, number | null>,
      }));
    const totals = Object.fromEntries(
      LOG_COLUMNS.map((c) => {
        const vs = rows.flatMap((r) => (r.values[c.key] === null ? [] : [r.values[c.key] as number]));
        return [
          c.key,
          vs.length === 0
            ? { sum: null, compound: null }
            : { sum: vs.reduce((a, v) => a + v, 0), compound: vs.reduce((a, v) => a * (1 + v), 1) - 1 },
        ];
      }),
    );
    return { id, label: multiYear ? `${MONTHS[month]} ${year}` : MONTHS[month], rows, totals };
  });
}

export function logCellColor(value: number | null, kind: "day" | "total"): string {
  if (value === null) return "transparent";
  // Capped at 0.5 so the light cell text keeps at least 4.5:1 contrast on the strongest shade.
  const a = 0.08 + 0.42 * Math.min(Math.abs(value) / (kind === "day" ? 0.03 : 0.1), 1);
  return value >= 0 ? `rgba(52,211,153,${a.toFixed(3)})` : `rgba(251,113,133,${a.toFixed(3)})`;
}
