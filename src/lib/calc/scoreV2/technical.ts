import { calendarReturn, sessionCalendar, type SessionCalendar } from "../returns";
import { stakePoints } from "../score";
import type { PatternHit } from "../patterns";
import { SCORING_VERSION, TECH_CONFIG as C, TECH_WEIGHTS, type TechCategoryKey } from "./config";

/** The slice of a stored day the scorer reads. */
export interface TechDay {
  date: string;
  open: number | null; high: number | null; low: number | null; close: number | null;
  volume: number | null; volAvg20: number | null;
  ema20: number | null; ema50: number | null; ema200: number | null;
  rsi14: number | null; macd: number | null; macdSignal: number | null; macdHist: number | null;
  patterns: PatternHit[] | null;
}

export interface TechInput {
  /** Ascending priced sessions of the stock, newest last (80+ sessions for the 60-session relative strength). */
  days: TechDay[];
  /** Nifty 50 / sector index sessions (ascending) with closes and EMAs; sector null when the stock has none. */
  nifty: TechDay[];
  sector: TechDay[] | null;
  /** Share of the universe closing above its EMA200 on the latest session; null when unavailable. */
  breadthAboveEma200: number | null;
  support: number | null;
  resistance: number | null;
  fiiDelta: number | null;
  diiDelta: number | null;
  /** Delivery % readings (ascending, latest last); only the busiest ~100 stocks have any. */
  delivery: number[];
}

export interface ScoreItem {
  key: string;
  label: string;
  max: number;
  /** Points earned; 0 when the item is missing. */
  points: number;
  status: "scored" | "missing";
  /** Sub-grouping inside a category, e.g. Market vs Sector conditions. */
  group?: string;
  value: string | number | null;
  note: string;
}
export interface ScoreCategory {
  key: string; label: string; max: number; items: ScoreItem[];
  earned: number; available: number; coverage: number;
}
export interface TechnicalResult {
  version: typeof SCORING_VERSION;
  categories: ScoreCategory[];
  earned: number;
  available: number;
  /** available / 100 */
  coverage: number;
  /** earned / available * 100; null when nothing could be scored. */
  score: number | null;
  status: "COMPLETE" | "PROVISIONAL" | "NOT_AVAILABLE";
  missing: string[];
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
export const num = (v: number | null | undefined): v is number => v !== null && v !== undefined && Number.isFinite(v);

export function scored(key: string, label: string, max: number, points: number, value: string | number | null, note: string): ScoreItem {
  return { key, label, max, points: round2(Math.min(max, Math.max(0, points))), status: "scored", value, note };
}
/** Missing data is never zero: it is excluded from `available`. */
export function missing(key: string, label: string, max: number, why: string): ScoreItem {
  return { key, label, max, points: 0, status: "missing", value: null, note: why };
}
export const tier = (v: number, tiers: readonly (readonly [number, number])[]) => tiers.find(([min]) => v >= min)?.[1] ?? 0;
export const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

function category(key: TechCategoryKey, label: string, items: ScoreItem[]): ScoreCategory {
  const max = TECH_WEIGHTS[key];
  const earned = round2(items.reduce((s, i) => s + i.points, 0));
  const available = round2(items.filter((i) => i.status === "scored").reduce((s, i) => s + i.max, 0));
  return { key, label, max, items, earned: Math.min(earned, max), available, coverage: round2(available / max) };
}

export const last = <T,>(a: T[], back = 0): T | undefined => a[a.length - 1 - back];

/** EMA slope: latest value vs `slopeSessions` earlier. */
function slope(days: TechDay[], f: (d: TechDay) => number | null): number | null {
  const a = last(days), b = last(days, C.slopeSessions);
  const x = a ? f(a) : null, y = b ? f(b) : null;
  return num(x) && num(y) ? x - y : null;
}

function trendCategory(days: TechDay[]): ScoreCategory {
  const t = C.trend, d = last(days);
  const cl = d?.close ?? null;
  const cmp = (key: string, label: string, max: number, a: number | null | undefined, b: number | null | undefined, desc: string) =>
    num(a) && num(b) ? scored(key, label, max, a > b ? max : 0, `${round2(a)} vs ${round2(b)}`, `${desc} ${a > b ? "yes" : "no"}`) : missing(key, label, max, "Not enough history for this EMA");
  const sl = (key: string, label: string, max: number, f: (x: TechDay) => number | null) => {
    const s = slope(days, f);
    return s === null ? missing(key, label, max, `Needs ${C.slopeSessions + 1} sessions of EMA`) : scored(key, label, max, s > 0 ? max : 0, round2(s), s > 0 ? "Rising" : "Flat or falling");
  };
  const n = C.structureSessions;
  let hh: ScoreItem;
  const hi = days.map((x) => x.high), lo = days.map((x) => x.low);
  if (days.length < 2 * n || [...hi.slice(-2 * n), ...lo.slice(-2 * n)].some((v) => !num(v))) {
    hh = missing("higherHighsLows", "Higher highs & higher lows", t.higherHighsLows, `Needs ${2 * n} sessions with high/low`);
  } else {
    const cur = days.slice(-n), prev = days.slice(-2 * n, -n);
    const hhOk = Math.max(...cur.map((x) => x.high as number)) > Math.max(...prev.map((x) => x.high as number));
    const hlOk = Math.min(...cur.map((x) => x.low as number)) > Math.min(...prev.map((x) => x.low as number));
    hh = scored("higherHighsLows", "Higher highs & higher lows", t.higherHighsLows, ((Number(hhOk) + Number(hlOk)) / 2) * t.higherHighsLows,
      `${hhOk ? "HH" : "no HH"} / ${hlOk ? "HL" : "no HL"}`, `Last ${n} sessions vs the ${n} before`);
  }
  return category("trend", "Trend", [
    cmp("aboveEma20", "Price above EMA20", t.aboveEma20, cl, d?.ema20, "Close above EMA20:"),
    cmp("aboveEma50", "Price above EMA50", t.aboveEma50, cl, d?.ema50, "Close above EMA50:"),
    cmp("aboveEma200", "Price above EMA200", t.aboveEma200, cl, d?.ema200, "Close above EMA200:"),
    cmp("ema20Over50", "EMA20 above EMA50", t.ema20Over50, d?.ema20, d?.ema50, "EMA20 above EMA50:"),
    cmp("ema50Over200", "EMA50 above EMA200", t.ema50Over200, d?.ema50, d?.ema200, "EMA50 above EMA200:"),
    sl("ema20Slope", "EMA20 slope", t.ema20Slope, (x) => x.ema20),
    sl("ema50Slope", "EMA50 slope", t.ema50Slope, (x) => x.ema50),
    hh,
  ]);
}

function momentumCategory(days: TechDay[]): ScoreCategory {
  const m = C.momentum, d = last(days);
  const items: ScoreItem[] = [];
  const rsi = d?.rsi14;
  if (!num(rsi)) items.push(missing("rsiLevel", "RSI(14) level", m.rsiLevel, "No RSI"));
  else {
    const zone = rsi < 40 ? "Weak" : rsi < 50 ? "Recovering" : rsi < 55 ? "Moderately positive" : rsi <= 70 ? "Healthy bullish" : rsi <= 75 ? "Strong, possibly extended" : "Overbought risk";
    items.push(scored("rsiLevel", "RSI(14) level", m.rsiLevel, tier(rsi, m.rsiBands) * m.rsiLevel, round2(rsi), zone));
  }
  const prevRsi = last(days, m.rsiLookback)?.rsi14;
  if (!num(rsi) || !num(prevRsi)) items.push(missing("rsiDirection", "RSI direction", m.rsiDirection, "Needs RSI history"));
  else {
    const dlt = rsi - prevRsi;
    const pts = Math.abs(dlt) < m.rsiFlat ? m.rsiDirection / 2 : dlt > 0 ? (rsi > m.rsiExtended ? m.rsiDirection / 2 : m.rsiDirection) : 0;
    items.push(scored("rsiDirection", "RSI direction", m.rsiDirection, pts, round2(dlt), dlt > 0 ? (rsi > m.rsiExtended ? "Rising but already extended" : "Improving") : Math.abs(dlt) < m.rsiFlat ? "Flat" : "Falling"));
  }
  // MACD above signal is the same fact as a positive histogram, so the histogram item scores only whether it is rising.
  if (!num(d?.macd) || !num(d?.macdSignal)) items.push(missing("macdOverSignal", "MACD above signal", m.macdOverSignal, "No MACD"));
  else items.push(scored("macdOverSignal", "MACD above signal", m.macdOverSignal, d.macd > d.macdSignal ? m.macdOverSignal : 0, round2(d.macd - d.macdSignal), d.macd > d.macdSignal ? "Bullish crossover state" : "Below signal"));
  if (!num(d?.macd)) items.push(missing("macdOverZero", "MACD above zero", m.macdOverZero, "No MACD"));
  else items.push(scored("macdOverZero", "MACD above zero", m.macdOverZero, d.macd > 0 ? m.macdOverZero : 0, round2(d.macd), d.macd > 0 ? "Positive" : "Not positive"));
  const prev = last(days, 1);
  if (!num(d?.macdHist) || !num(prev?.macdHist)) items.push(missing("histRising", "MACD histogram rising", m.histRising, "Needs two sessions of MACD"));
  else {
    const up = d.macdHist > prev.macdHist;
    items.push(scored("histRising", "MACD histogram rising", m.histRising, up ? (d.macdHist > 0 ? m.histRising : m.histRising / 2) : 0, round2(d.macdHist - prev.macdHist),
      up ? (d.macdHist > 0 ? "Positive and increasing" : "Negative but improving") : "Not increasing"));
  }
  return category("momentum", "Momentum", items);
}

function volumeCategory(days: TechDay[]): ScoreCategory {
  const v = C.volume, d = last(days), p = last(days, 1);
  const items: ScoreItem[] = [];
  if (!d || !p || !num(d.volume) || d.volume === 0 || !num(d.volAvg20) || d.volAvg20 === 0 || !num(d.close) || !num(p.close)) {
    items.push(missing("confirmation", "Price-volume confirmation", v.confirmation, "Needs volume, 20-day average and previous close"));
  } else {
    const rvol = d.volume / d.volAvg20;
    const up = d.close > p.close, down = d.close < p.close;
    const share = up ? tier(rvol, v.upTiers) : down ? tier(rvol, v.downTiers) : v.flatShare;
    const note = up ? (rvol >= 1 ? "Rising price on above-average volume" : "Rising price on light volume: weaker confirmation")
      : down ? (rvol >= 1.2 ? "Falling price on heavy volume: selling pressure" : rvol >= 1 ? "Falling price on above-average volume" : "Falling on light volume: selling may be fading")
      : "Unchanged close";
    items.push(scored("confirmation", "Price-volume confirmation", v.confirmation, share * v.confirmation, `RVOL ${round2(rvol)}`, note));
  }
  const w = days.slice(-v.accumulationSessions);
  const base = days[days.length - w.length - 1];
  const ok = w.length === v.accumulationSessions && !!base && num(base.close) && w.every((x) => num(x.volume) && num(x.close));
  if (!ok) items.push(missing("accumulation", "Up-day volume share", v.accumulation, `Needs ${v.accumulationSessions} sessions of volume`));
  else {
    let upV = 0, tot = 0;
    w.forEach((x, i) => {
      const prevClose = (i === 0 ? base!.close : w[i - 1]!.close) as number;
      tot += x.volume as number;
      if ((x.close as number) > prevClose) upV += x.volume as number;
    });
    if (tot === 0) items.push(missing("accumulation", "Up-day volume share", v.accumulation, "No volume traded"));
    else items.push(scored("accumulation", "Up-day volume share", v.accumulation, tier(upV / tot, v.accumulationTiers) * v.accumulation, pct(upV / tot), `Share of last ${v.accumulationSessions} sessions' volume on up days`));
  }
  return category("volume", "Volume", items);
}

const near = (price: number, level: number | null, tol: number) => num(level) && Math.abs(price - level) / price <= tol;

function patternCategory(days: TechDay[], support: number | null, resistance: number | null): ScoreCategory {
  const p = C.pattern, d = last(days);
  const items: ScoreItem[] = [];
  const window = days.slice(-p.windowSessions);
  if (!d || !num(d.close) || window.length < p.windowSessions || window.some((x) => x.patterns === null)) {
    items.push(missing("candle", "Candlestick patterns", p.candle, `Needs ${p.windowSessions} sessions of OHLC`));
  } else {
    // One event counts once: distinct pattern names across the window.
    const seen = new Set<string>();
    let pts = p.candleNeutral;
    const names: string[] = [];
    for (const day of window) {
      for (const h of day.patterns ?? []) {
        if (seen.has(h.name)) continue;
        seen.add(h.name);
        const atSupport = near(d.close, support, p.nearLevelTol), atResistance = near(d.close, resistance, p.nearLevelTol);
        let step = 0;
        if (h.bias === "bullish") step = p.hitStep * (atSupport ? p.contextMultiplier : 1);
        else if (h.bias === "bearish") step = -p.hitStep * (atResistance ? p.contextMultiplier : 1);
        else if (h.name === "doji") step = atSupport ? p.hitStep : atResistance ? -p.hitStep : 0;
        if (step !== 0) { pts += step; names.push(`${h.name} ${step > 0 ? "+" : ""}${round2(step)}`); }
      }
    }
    items.push(scored("candle", "Candlestick patterns", p.candle, pts, names.length ? names.join(", ") : "none", names.length ? "Patterns near support/resistance count 1.5x" : "No pattern: neutral midpoint"));
  }
  const prior = days.slice(-1 - p.breakoutSessions, -1);
  if (!d || prior.length < p.breakoutSessions || prior.some((x) => !num(x.high)) || !num(d.close)) {
    items.push(missing("breakout", "20-session breakout", p.breakout, `Needs ${p.breakoutSessions} prior sessions with highs`));
  } else {
    const hi = Math.max(...prior.map((x) => x.high as number));
    const rvol = num(d.volume) && num(d.volAvg20) && d.volAvg20 > 0 ? d.volume / d.volAvg20 : null;
    if (d.close > hi) {
      if (rvol === null) items.push(missing("breakout", "20-session breakout", p.breakout, "Breakout seen but volume unavailable to confirm it"));
      else items.push(scored("breakout", "20-session breakout", p.breakout, (rvol >= p.breakoutRvol ? 1 : p.breakoutNoVolShare) * p.breakout, `close ${round2(d.close)} > ${round2(hi)}`, rvol >= p.breakoutRvol ? `Breakout confirmed by RVOL ${round2(rvol)}` : `Breakout on light volume (RVOL ${round2(rvol)})`));
    } else if ((hi - d.close) / d.close <= p.breakoutNearTol) {
      items.push(scored("breakout", "20-session breakout", p.breakout, p.breakoutNearShare * p.breakout, `${round2(hi)} is ${pct((hi - d.close) / d.close)} away`, "Pressing the 20-session high, not through it"));
    } else items.push(scored("breakout", "20-session breakout", p.breakout, 0, `20-session high ${round2(hi)}`, "No breakout"));
  }
  return category("pattern", "Price action & patterns", items);
}

/** Trend of an index from its own stored EMAs: same facts for Nifty and the sector index. */
function indexTrend(key: string, label: string, max: number, idx: TechDay[] | null, missingWhy: string): ScoreItem {
  const t = C.indexTrend, d = idx ? last(idx) : undefined;
  if (!idx || !d || !num(d.close)) return missing(key, label, max, missingWhy);
  const s20 = slope(idx, (x) => x.ema20);
  const parts: [number, boolean | null][] = [
    [t.aboveEma20, num(d.ema20) ? d.close > d.ema20 : null],
    [t.aboveEma50, num(d.ema50) ? d.close > d.ema50 : null],
    [t.aboveEma200, num(d.ema200) ? d.close > d.ema200 : null],
    [t.ema20Slope, s20 === null ? null : s20 > 0],
  ];
  if (parts.some(([, ok]) => ok === null)) return missing(key, label, max, "Index lacks enough history for its EMAs");
  const pts = parts.reduce((s, [w, ok]) => s + (ok ? w : 0), 0);
  return scored(key, label, max, pts, `${parts.filter(([, ok]) => ok).length}/${parts.length} bullish checks`, "Close vs EMA20/50/200 and EMA20 slope");
}

function marketCategory(i: TechInput): ScoreCategory {
  const m = C.market;
  const breadth = num(i.breadthAboveEma200)
    ? scored("breadth", "Market breadth", m.breadth, tier(i.breadthAboveEma200, m.breadthTiers) * m.breadth, pct(i.breadthAboveEma200), "Share of stocks above their EMA200")
    : missing("breadth", "Market breadth", m.breadth, "Breadth not available");
  const grouped = (group: string, item: ScoreItem): ScoreItem => ({ ...item, group });
  return category("market", "Market & sector conditions", [
    grouped("Market conditions", indexTrend("niftyTrend", "Nifty 50 trend", m.niftyTrend, i.nifty, "No Nifty data")),
    grouped("Market conditions", breadth),
    grouped("Sector conditions", indexTrend("sectorTrend", "Sector index trend", m.sectorTrend, i.sector, i.sector ? "Sector index has too little history for its EMAs" : "Stock has no mapped sector index")),
  ]);
}

function relativeCategory(i: TechInput): ScoreCategory {
  const r = C.relativeStrength;
  const cal: SessionCalendar = sessionCalendar(i.nifty.map((d) => d.date));
  const closeOf = (days: TechDay[]) => new Map(days.flatMap((d) => (num(d.close) ? [[d.date, d.close] as [string, number]] : [])));
  const own = closeOf(i.days), nf = closeOf(i.nifty), sec = i.sector ? closeOf(i.sector) : null;
  const date = last(i.days)?.date;
  const excess = (bench: Map<string, number> | null, bars: number, on = date): number | null => {
    if (!bench || !on) return null;
    const a = calendarReturn(own, cal, on, bars), b = calendarReturn(bench, cal, on, bars);
    return a === null || b === null ? null : a - b;
  };
  const item = (key: string, label: string, max: number, bench: Map<string, number> | null, bars: number, why: string) => {
    const e = excess(bench, bars);
    if (e === null) return missing(key, label, max, why);
    const scale = bars >= 60 ? r.scale60 : 1;
    const share = tier(e / scale, r.tiers20);
    return scored(key, label, max, share * max, pct(e), `${bars}-session return minus benchmark's`);
  };
  const gapDate = date ? cal.dates[(cal.index.get(date) ?? -1) - r.improvingGap] : undefined;
  const then = excess(nf, 20, gapDate), now = excess(nf, 20);
  const improving = now === null || then === null
    ? missing("improving", "Relative strength trend", r.improving, "Needs 30 sessions of Nifty and stock history")
    : scored("improving", "Relative strength trend", r.improving, now - then > r.improvingMin ? r.improving : now - then >= -r.improvingMin ? r.improving / 2 : 0, pct(now - then), `20-session excess vs Nifty now vs ${r.improvingGap} sessions ago`);
  return category("relativeStrength", "Relative strength", [
    item("vsNifty20", "vs Nifty, 20 sessions", r.vsNifty20, nf, 20, "Needs 21 sessions aligned with Nifty"),
    item("vsNifty60", "vs Nifty, 60 sessions", r.vsNifty60, nf, 60, "Needs 61 sessions aligned with Nifty"),
    item("vsSector20", "vs sector, 20 sessions", r.vsSector20, sec, 20, i.sector ? "Needs 21 sessions of sector index" : "Stock has no mapped sector index"),
    item("vsSector60", "vs sector, 60 sessions", r.vsSector60, sec, 60, i.sector ? "Needs 61 sessions of sector index" : "Stock has no mapped sector index"),
    improving,
  ]);
}

function flowsCategory(i: TechInput): ScoreCategory {
  const f = C.flows;
  const stake = (key: string, label: string, max: number, d: number | null) =>
    num(d) ? scored(key, label, max, stakePoints(d, max), `${d > 0 ? "+" : ""}${d} pp`, "Change in stake vs the previous quarterly disclosure") : missing(key, label, max, "No two consecutive quarterly disclosures");
  let delivery: ScoreItem;
  const dv = i.delivery.filter(num);
  if (dv.length < f.deliveryMinReadings) delivery = missing("delivery", "Delivery trend", f.delivery, "Delivery % is published for the busiest ~100 stocks only");
  else {
    const avg = dv.reduce((s, x) => s + x, 0) / dv.length;
    const closes = i.days.slice(-dv.length - 1).map((d) => d.close);
    const first = closes[0], end = last(closes);
    const up = num(first) && num(end) ? end >= first : null;
    const share = avg >= f.deliveryHigh ? (up === false ? 0.33 : 1) : avg >= f.deliveryMid ? 0.5 : 0.17;
    delivery = scored("delivery", "Delivery trend", f.delivery, share * f.delivery, `${round2(avg)}% avg of ${dv.length}`, up === false ? "High delivery while price fell: possible distribution" : "Multi-session average delivery %");
  }
  return category("flows", "Institutional flows", [stake("fii", "FII stake change", f.fii, i.fiiDelta), stake("dii", "DII stake change", f.dii, i.diiDelta), delivery]);
}

export function scoreTechnicalV2(i: TechInput): TechnicalResult {
  const categories = [
    trendCategory(i.days), momentumCategory(i.days), volumeCategory(i.days),
    patternCategory(i.days, i.support, i.resistance), marketCategory(i), relativeCategory(i), flowsCategory(i),
  ];
  const earned = round2(categories.reduce((s, c) => s + c.earned, 0));
  const available = round2(categories.reduce((s, c) => s + c.available, 0));
  const coverage = round2(available / 100);
  return {
    version: SCORING_VERSION,
    categories, earned, available, coverage,
    score: available === 0 ? null : round2((earned / available) * 100),
    status: available === 0 ? "NOT_AVAILABLE" : coverage < 1 ? "PROVISIONAL" : "COMPLETE",
    missing: categories.flatMap((c) => c.items.filter((x) => x.status === "missing").map((x) => `${c.label}: ${x.label}: ${x.note}`)),
  };
}
