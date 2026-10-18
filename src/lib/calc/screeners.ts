import type { ScoreLabel } from "@/lib/calc/score";
import type { StoredDay } from "@/lib/db/types";

export type ScreenerId =
  | "vol_up" | "vol_down" | "breakout" | "breakdown" | "golden"
  | "death" | "rsi_high" | "rsi_low" | "score_top" | "score_bottom";

export interface ScreenerHit {
  key: string;
  name: string;
  close: number;
  dayPct: number | null;
  metric: number | null;
  flag: "NEW_HIGH" | "NEW_LOW" | null;
  date: string | null;
  scoreLabel: ScoreLabel | null;
}

export interface ScreenerResult {
  id: ScreenerId;
  title: string;
  count: number; // total matches before the row cap
  hits: ScreenerHit[];
}

export const SCREENERS: { id: ScreenerId; title: string }[] = [
  { id: "vol_up", title: "Volume shockers · up" },
  { id: "vol_down", title: "Volume shockers · down" },
  { id: "breakout", title: "52-week breakout zone" },
  { id: "breakdown", title: "52-week breakdown zone" },
  { id: "golden", title: "Golden cross" },
  { id: "death", title: "Death cross" },
  { id: "rsi_high", title: "RSI overbought" },
  { id: "rsi_low", title: "RSI oversold" },
  { id: "score_top", title: "Top scores" },
  { id: "score_bottom", title: "Bottom scores" },
];

interface StockInput {
  key: string;
  name: string;
  days: StoredDay[];
}

interface Candidate {
  hit: ScreenerHit;
  rank: number; // primary sort, ascending
  group: number; // secondary: lower first (new highs/lows before the rest)
}

const WINDOW = 6;
const CROSS_SESSIONS = 5;

function dayPctOf(d: StoredDay): number | null {
  return d.pctChange ?? d.importedPct;
}

function hitFor(s: StockInput, row: StoredDay, close: number, over: Partial<ScreenerHit>): ScreenerHit {
  return {
    key: s.key,
    name: s.name,
    close,
    dayPct: dayPctOf(row),
    metric: null,
    flag: null,
    date: null,
    scoreLabel: null,
    ...over,
  };
}

// Most recent day d among the last 5 rows whose ema50 side flipped versus the row before.
function crossDate(rows: StoredDay[], up: boolean): string | null {
  const n = rows.length;
  for (let i = n - 1; i >= Math.max(1, n - CROSS_SESSIONS); i--) {
    const cur = rows[i];
    const prev = rows[i - 1];
    if (cur.ema50 == null || cur.ema200 == null || prev.ema50 == null || prev.ema200 == null) continue;
    const curAbove = cur.ema50 > cur.ema200;
    const prevAbove = prev.ema50 > prev.ema200;
    if (up ? curAbove && !prevAbove : !curAbove && prevAbove) return cur.date;
  }
  return null;
}

type Evaluator = (s: StockInput, rows: StoredDay[], row: StoredDay) => Candidate | null;

function volume(up: boolean): Evaluator {
  return (s, _rows, row) => {
    const pct = dayPctOf(row);
    if (row.volume == null || row.volAvg20 == null || row.volAvg20 <= 0 || row.close == null || pct == null) return null;
    if (row.volume < 2 * row.volAvg20) return null;
    if (up ? pct <= 0 : pct >= 0) return null;
    const ratio = row.volume / row.volAvg20;
    return { hit: hitFor(s, row, row.close, { metric: ratio }), rank: -ratio, group: 0 };
  };
}

const breakout: Evaluator = (s, rows, row) => {
  if (row.close == null || row.high52w == null || row.high52w <= 0) return null;
  const prev = rows.length > 1 ? rows[rows.length - 2].high52w : null;
  const isNew = prev != null && row.high52w > prev;
  if (!isNew && row.close < 0.97 * row.high52w) return null;
  const metric = row.close / row.high52w - 1;
  return {
    hit: hitFor(s, row, row.close, { metric, flag: isNew ? "NEW_HIGH" : null }),
    rank: Math.abs(metric),
    group: isNew ? 0 : 1,
  };
};

const breakdown: Evaluator = (s, rows, row) => {
  if (row.close == null || row.low52w == null || row.low52w <= 0) return null;
  const prev = rows.length > 1 ? rows[rows.length - 2].low52w : null;
  const isNew = prev != null && row.low52w < prev;
  if (!isNew && row.close > 1.03 * row.low52w) return null;
  const metric = row.close / row.low52w - 1;
  return {
    hit: hitFor(s, row, row.close, { metric, flag: isNew ? "NEW_LOW" : null }),
    rank: Math.abs(metric),
    group: isNew ? 0 : 1,
  };
};

function cross(up: boolean): Evaluator {
  return (s, rows, row) => {
    if (row.close == null) return null;
    const date = crossDate(rows, up);
    if (date == null) return null;
    // most recent first: later ISO dates sort first
    return { hit: hitFor(s, row, row.close, { date }), rank: 0, group: 0 };
  };
}

function rsi(high: boolean): Evaluator {
  return (s, _rows, row) => {
    if (row.rsi14 == null || row.close == null) return null;
    if (high ? row.rsi14 <= 70 : row.rsi14 >= 30) return null;
    return { hit: hitFor(s, row, row.close, { metric: row.rsi14 }), rank: high ? -row.rsi14 : row.rsi14, group: 0 };
  };
}

function score(top: boolean): Evaluator {
  return (s, _rows, row) => {
    if (row.score == null || row.close == null) return null;
    return {
      hit: hitFor(s, row, row.close, { metric: row.score, scoreLabel: row.scoreLabel }),
      rank: top ? -row.score : row.score,
      group: 0,
    };
  };
}

const EVALUATORS: Record<ScreenerId, Evaluator> = {
  vol_up: volume(true),
  vol_down: volume(false),
  breakout,
  breakdown,
  golden: cross(true),
  death: cross(false),
  rsi_high: rsi(true),
  rsi_low: rsi(false),
  score_top: score(true),
  score_bottom: score(false),
};

function compare(id: ScreenerId) {
  const recentFirst = id === "golden" || id === "death";
  return (a: Candidate, b: Candidate): number => {
    if (recentFirst) {
      const da = a.hit.date ?? "";
      const db = b.hit.date ?? "";
      if (da !== db) return da < db ? 1 : -1;
    } else {
      if (a.group !== b.group) return a.group - b.group;
      if (a.rank !== b.rank) return a.rank - b.rank;
    }
    return a.hit.key < b.hit.key ? -1 : a.hit.key > b.hit.key ? 1 : 0;
  };
}

export function runScreeners(stocks: StockInput[], session: string, limit = 10): ScreenerResult[] {
  // only stocks priced on the session qualify, and only their last 6 rows count
  const eligible = stocks
    .map((s) => ({ s, rows: s.days.slice(-WINDOW) }))
    .filter(({ rows }) => rows.length > 0 && rows[rows.length - 1].date === session);

  return SCREENERS.map(({ id, title }) => {
    const evaluate = EVALUATORS[id];
    const matches: Candidate[] = [];
    for (const { s, rows } of eligible) {
      const c = evaluate(s, rows, rows[rows.length - 1]);
      if (c) matches.push(c);
    }
    matches.sort(compare(id));
    return { id, title, count: matches.length, hits: matches.slice(0, limit).map((m) => m.hit) };
  });
}
