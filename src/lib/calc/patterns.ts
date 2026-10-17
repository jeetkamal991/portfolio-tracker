export type PatternBias = "bullish" | "bearish" | "neutral";
export interface PatternHit {
  name: string;
  bias: PatternBias;
}
type Bar = { open: number; high: number; low: number; close: number };

const body = (x: Bar) => Math.abs(x.close - x.open);
const range = (x: Bar) => x.high - x.low;
const bearish = (x: Bar) => x.close < x.open;
const bullish = (x: Bar) => x.close > x.open;

/** Prior 5-bar drift: close[i-1] vs close[i-6]. Needs i >= 6. */
function trend5(bars: Bar[], i: number): "up" | "down" | null {
  if (i < 6) return null;
  const a = bars[i - 1].close;
  const z = bars[i - 6].close;
  return a < z ? "down" : a > z ? "up" : null;
}

/** Candlestick patterns completing on bar i (uses bars up to i only). */
export function detectPatterns(bars: Bar[], i: number): PatternHit[] {
  const c = bars[i];
  if (!c || range(c) === 0) return [];
  const hits: PatternHit[] = [];
  const hit = (name: string, bias: PatternBias) => hits.push({ name, bias });

  const r = range(c);
  const bd = body(c);
  const upper = c.high - Math.max(c.open, c.close);
  const lower = Math.min(c.open, c.close) - c.low;

  if (bd <= 0.1 * r) {
    hit("doji", "neutral");
  } else {
    const t = trend5(bars, i);
    if (lower >= 2 * bd && upper <= 0.1 * r) {
      if (t === "down") hit("hammer", "bullish");
      if (t === "up") hit("hanging_man", "bearish");
    }
    if (upper >= 2 * bd && lower <= 0.1 * r) {
      if (t === "down") hit("inverted_hammer", "bullish");
      if (t === "up") hit("shooting_star", "bearish");
    }
  }

  const p = bars[i - 1];
  const q = bars[i - 2];
  if (p) {
    if (bearish(p) && bullish(c)) {
      if (c.open <= p.close && c.close >= p.open && bd > body(p)) hit("bullish_engulfing", "bullish");
      if (c.open < p.close && c.close > (p.open + p.close) / 2 && c.close < p.open) hit("piercing_line", "bullish");
    }
    if (bullish(p) && bearish(c)) {
      if (c.open >= p.close && c.close <= p.open && bd > body(p)) hit("bearish_engulfing", "bearish");
      if (c.open > p.close && c.close < (p.open + p.close) / 2 && c.close > p.open) hit("dark_cloud_cover", "bearish");
    }
  }
  if (p && q) {
    const qMid = (q.open + q.close) / 2;
    const strongQ = body(q) >= 0.5 * range(q);
    const smallP = body(p) <= 0.3 * body(q);
    if (bearish(q) && strongQ && smallP && bullish(c) && c.close > qMid) hit("morning_star", "bullish");
    if (bullish(q) && strongQ && smallP && bearish(c) && c.close < qMid) hit("evening_star", "bearish");
  }
  return hits;
}
