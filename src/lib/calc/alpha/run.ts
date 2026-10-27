import type { OhlcvDay } from "@/lib/db/types";
import { ALPHAS, type AlphaId, type Panel } from "./alphas";
import { csRank, type Matrix } from "./ops";

/** Sessions of candles each alpha sees; a001 needs the most (25 bars). */
export const ALPHA_WINDOW = 30;
const MIN_ALPHAS_FOR_COMBINED = 3; // half of the six

export interface AlphaHit {
  key: string;
  name: string;
  close: number;
  dayPct: number | null;
  /** The raw alpha value; for the combined card, the mean rank in (0, 1]. */
  score: number;
}

export interface AlphaResult {
  id: AlphaId | "combined";
  title: string;
  status: "ok" | "unavailable";
  /** Stocks scored before the list caps. */
  count: number;
  top: AlphaHit[];
  bottom: AlphaHit[];
  /** Stocks beyond the listed ones that share the score of the last listed stock, so a tied group reads as a slice. */
  topTied: number;
  bottomTied: number;
}

interface StockInput {
  key: string;
  name: string;
  days: OhlcvDay[];
}

const nanIfNull = (v: number | null): number => v ?? Number.NaN;

function hiddenTies(shown: AlphaHit[], pool: AlphaHit[]): number {
  if (shown.length === 0) return 0;
  const edge = shown[shown.length - 1].score;
  return pool.filter((h) => h.score === edge).length - shown.filter((h) => h.score === edge).length;
}

function result(id: AlphaResult["id"], title: string, hits: AlphaHit[], limit: number): AlphaResult {
  const sorted = [...hits].sort((a, b) => b.score - a.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const top = sorted.slice(0, limit);
  // lowest first, and never a stock already in top
  const rest = sorted.slice(top.length);
  const bottom = [...rest].reverse().slice(0, limit);
  return { id, title, status: "ok", count: hits.length, top, bottom, topTied: hiddenTies(top, sorted), bottomTied: hiddenTies(bottom, rest) };
}

export function runAlphas(stocks: StockInput[], session: string, limit = 10): AlphaResult[] {
  // only stocks priced on the session qualify, as in runScreeners
  const eligible = stocks.filter((s) => {
    const last = s.days[s.days.length - 1];
    return last?.date === session && last.close != null;
  });
  // only priced rows make a date: an importedPct-only row would add an all-NaN column and blank every rolling alpha
  const dates = [...new Set(eligible.flatMap((s) => s.days.filter((d) => d.close != null).map((d) => d.date)))]
    .filter((d) => d <= session)
    .sort()
    .slice(-ALPHA_WINDOW);

  const byDate = eligible.map((s) => new Map(s.days.map((d) => [d.date, d])));
  const col = (f: (d: OhlcvDay) => number | null): Matrix =>
    byDate.map((m) => dates.map((date) => { const d = m.get(date); return d ? nanIfNull(f(d)) : Number.NaN; }));
  const panel: Panel = {
    open: col((d) => d.open), high: col((d) => d.high), low: col((d) => d.low),
    close: col((d) => d.close), volume: col((d) => d.volume),
  };
  // bars each stock has in the window; an alpha needs its declared minimum even where a branch would not read them all
  const bars = panel.close.map((row) => row.filter((v) => !Number.isNaN(v)).length);
  const sessionRows = eligible.map((s) => s.days[s.days.length - 1]);
  const hit = (i: number, score: number): AlphaHit => ({
    key: eligible[i].key,
    name: eligible[i].name,
    close: sessionRows[i].close as number,
    dayPct: sessionRows[i].pctChange ?? sessionRows[i].importedPct,
    score,
  });

  const ranksByAlpha: number[][] = [];
  const perAlpha = ALPHAS.map((a): AlphaResult => {
    if (eligible.length === 0) return result(a.id, a.title, [], limit);
    let values: number[];
    try {
      values = a.compute(panel);
    } catch (e) {
      console.error(`alpha ${a.id} failed`, e);
      return { id: a.id, title: a.title, status: "unavailable", count: 0, top: [], bottom: [], topTied: 0, bottomTied: 0 };
    }
    values = values.map((v, i) => (bars[i] >= a.minBars ? v : Number.NaN));
    ranksByAlpha.push(csRank(values.map((v) => [v])).map((r) => r[0]));
    const hits: AlphaHit[] = [];
    values.forEach((v, i) => { if (Number.isFinite(v)) hits.push(hit(i, v)); });
    return result(a.id, a.title, hits, limit);
  });

  const combinedHits: AlphaHit[] = [];
  eligible.forEach((_, i) => {
    const ranks = ranksByAlpha.map((r) => r[i]).filter((r) => !Number.isNaN(r));
    if (ranks.length >= MIN_ALPHAS_FOR_COMBINED) combinedHits.push(hit(i, ranks.reduce((s, r) => s + r, 0) / ranks.length));
  });
  return [result("combined", "Alpha rank", combinedHits, limit), ...perAlpha];
}
