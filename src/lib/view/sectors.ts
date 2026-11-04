import { emaTrend, type EmaTrend } from "@/lib/calc/levels";
import type { ScoreLabel } from "@/lib/calc/score";
import type { StoredDay } from "@/lib/db/types";
import type { SectorRow } from "./dashboard";

export interface ConstituentRow {
  key: string;
  name: string;
  cmp: number | null;
  dayPct: number | null;
  score: number | null;
  scoreLabel: ScoreLabel | null;
  trend: EmaTrend | null;
  rsi: number | null;
}

export interface SectorTile extends SectorRow {
  score: number | null;
  scoreLabel: ScoreLabel | null;
  /** Score computed from incomplete inputs (a thin sector's 50); shown muted. */
  scorePartial: boolean;
  rsi: number | null;
  rsVsNifty: number | null;
  constituentCount: number;
  /** Up to 3, dayPct > 0, descending. */
  topGainers: ConstituentRow[];
  /** Up to 3, dayPct < 0, ascending. */
  topLosers: ConstituentRow[];
}

const PREVIEW = 3;

/** One row per member, sorted by day % descending; members with no row on the session sort last with nulls. */
export function buildConstituentRows(members: { key: string; name: string }[], dayOf: Map<string, StoredDay>): ConstituentRow[] {
  const rows = members.map(({ key, name }): ConstituentRow => {
    const d = dayOf.get(key);
    const cmp = d?.close ?? null;
    return {
      key,
      name,
      cmp,
      dayPct: d ? d.pctChange ?? d.importedPct : null,
      score: d?.score ?? null,
      scoreLabel: d?.scoreLabel ?? null,
      trend: d && cmp !== null ? emaTrend(cmp, d.ema20, d.ema50, d.ema200) : null,
      rsi: d?.rsi14 ?? null,
    };
  });
  return rows.sort((a, b) => {
    if (a.dayPct === null || b.dayPct === null) {
      if (a.dayPct !== b.dayPct) return a.dayPct === null ? 1 : -1;
    } else if (a.dayPct !== b.dayPct) return b.dayPct - a.dayPct;
    return a.key.localeCompare(b.key);
  });
}

/** Up to PREVIEW rows moving in `dir` (1 up, -1 down), biggest move first, ties by key. */
function movers(cons: ConstituentRow[], dir: 1 | -1): ConstituentRow[] {
  return cons
    .filter((c): c is ConstituentRow & { dayPct: number } => c.dayPct !== null && Math.sign(c.dayPct) === dir)
    .sort((a, b) => dir * (b.dayPct - a.dayPct) || a.key.localeCompare(b.key))
    .slice(0, PREVIEW);
}

export function buildSectorTiles(
  rows: SectorRow[],
  latest: Map<string, StoredDay | null>,
  members: Map<string, ConstituentRow[]>,
): SectorTile[] {
  return rows.map((row) => {
    const d = latest.get(row.key) ?? null;
    const cons = members.get(row.key) ?? [];
    return {
      ...row,
      score: d?.score ?? null,
      scoreLabel: d?.scoreLabel ?? null,
      scorePartial: d?.scoreComponents?.partial ?? false,
      rsi: d?.rsi14 ?? null,
      rsVsNifty: d?.rsVsNifty ?? null,
      constituentCount: cons.length,
      topGainers: movers(cons, 1),
      topLosers: movers(cons, -1),
    };
  });
}

export type Mood = "RISK_ON" | "MIXED" | "RISK_OFF";

export interface SectorMoodSummary {
  /** null when no sector has a day move. */
  mood: Mood | null;
  up: number;
  total: number;
  best: { name: string; d1: number } | null;
  worst: { name: string; d1: number } | null;
}

const short = (name: string) => name.replace(/^Nifty /, "");

/** RISK_ON at two thirds of sectors green or more, RISK_OFF at one third or fewer, otherwise MIXED. */
export function sectorMood(tiles: Pick<SectorTile, "name" | "d1">[]): SectorMoodSummary {
  const moved = tiles.filter((t): t is { name: string; d1: number } => t.d1 !== null);
  const up = moved.filter((t) => t.d1 > 0).length;
  const total = moved.length;
  const sorted = [...moved].sort((a, b) => b.d1 - a.d1);
  const pick = (t: { name: string; d1: number } | undefined) => (t ? { name: short(t.name), d1: t.d1 } : null);
  const mood: Mood | null = total === 0 ? null : up / total >= 2 / 3 ? "RISK_ON" : up / total <= 1 / 3 ? "RISK_OFF" : "MIXED";
  return { mood, up, total, best: pick(sorted[0]), worst: total > 1 ? pick(sorted[sorted.length - 1]) : null };
}

/** Keys of the `count` sectors with the biggest absolute day move; they get the large tiles. Zero and missing moves never qualify. */
export function bigTileKeys(tiles: Pick<SectorTile, "key" | "d1">[], count = 2): Set<string> {
  return new Set(
    tiles
      .filter((t) => t.d1 !== null && t.d1 !== 0)
      .sort((a, b) => Math.abs(b.d1 as number) - Math.abs(a.d1 as number) || a.key.localeCompare(b.key))
      .slice(0, count)
      .map((t) => t.key),
  );
}
