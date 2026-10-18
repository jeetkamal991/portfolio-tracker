import type { StoredDay } from "@/lib/db/types";
import { addDays } from "@/lib/time/ist";

export interface RotationRow {
  key: string;
  name: string;
  rs: number | null;
  rank: number | null;
  /** Previous week's rank − current rank (positive = moved up); null when either is missing. */
  change: number | null;
  /** Rank at each week end, oldest → newest. */
  history: (number | null)[];
}

/** Monday of the ISO week containing an IST date string. */
function weekOf(date: string): string {
  const wd = new Date(`${date}T12:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((wd + 6) % 7));
}

/** The latest session of each week, ascending, last `weeks` of them. The current week ends at the latest session. */
export function weekEnds(sessionDates: string[], weeks: number): string[] {
  const last = new Map<string, string>();
  for (const d of sessionDates) {
    const w = weekOf(d);
    const cur = last.get(w);
    if (!cur || d > cur) last.set(w, d);
  }
  return [...last.values()].sort().slice(-weeks);
}

/** Ranks by RS vs Nifty desc (ties by key) among sectors with RS on `date`. */
function ranksOn(sectors: { key: string; rsOn: Map<string, number | null> }[], date: string): Map<string, number> {
  const ranked = sectors
    .map((s) => ({ key: s.key, rs: s.rsOn.get(date) ?? null }))
    .filter((s): s is { key: string; rs: number } => s.rs !== null)
    .sort((a, b) => b.rs - a.rs || a.key.localeCompare(b.key));
  return new Map(ranked.map((s, i) => [s.key, i + 1]));
}

export function buildRotation(
  sectors: { key: string; name: string; days: StoredDay[] }[],
  sessionDates: string[],
  weeks = 8,
): RotationRow[] {
  // One extra week end gives the newest week its change.
  const ends = weekEnds(sessionDates, weeks + 1);
  const withRs = sectors.map((s) => ({ ...s, rsOn: new Map(s.days.map((d) => [d.date, d.rsVsNifty])) }));
  const ranks = ends.map((d) => ranksOn(withRs, d));
  const latest = ends.at(-1);
  const cur = ranks.at(-1) ?? new Map<string, number>();
  const prev = ranks.length >= 2 ? ranks[ranks.length - 2] : new Map<string, number>();
  const shown = ranks.slice(-weeks);

  const rows = withRs.map((s): RotationRow => {
    const rank = cur.get(s.key) ?? null;
    const before = prev.get(s.key) ?? null;
    return {
      key: s.key,
      name: s.name,
      rs: latest ? s.rsOn.get(latest) ?? null : null,
      rank,
      change: rank !== null && before !== null ? before - rank : null,
      history: shown.map((m) => m.get(s.key) ?? null),
    };
  });
  return rows.sort((a, b) => {
    if (a.rank === null || b.rank === null) {
      if (a.rank !== b.rank) return a.rank === null ? 1 : -1;
      return a.key.localeCompare(b.key);
    }
    return a.rank - b.rank;
  });
}
