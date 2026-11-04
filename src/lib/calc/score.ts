import type { PatternHit } from "./patterns";

export type ScoreLabel = "Strong Bullish" | "Bullish" | "Neutral" | "Bearish" | "Strong Bearish";
export type InstrumentKind = "nifty" | "index" | "sector" | "stock";

export interface ScoreInput {
  kind: InstrumentKind;
  close: number;
  prevClose: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHist: number | null;
  prevMacdHist: number | null;
  volume: number | null;
  volAvg20: number | null;
  recentPatterns: PatternHit[]; // all hits on the last 3 sessions, flattened
  niftyLabel: ScoreLabel | null; // ignored for kind "nifty"
  sectorLabel: ScoreLabel | null; // stocks: their sector's label; index/sector: pass niftyLabel
  rs20: number | null; // rsVsNifty of the latest row
  support: number | null;
  resistance: number | null; // effective levels (null for non-stocks)
  /** Percentage-point change in FII holding vs the previous quarter; null/absent = no data. Stocks only. */
  fiiDelta?: number | null;
  diiDelta?: number | null;
  /** Latest session's delivery % when the stock is in the stored top-100-by-value list; null/absent = not listed. */
  deliveryPer?: number | null;
}

export interface ScoreComponents {
  trend: number;
  momentum: number;
  volume: number;
  pattern: number;
  market: number;
  risk: number;
  flows: number;
}

export interface ScoreResult {
  score: number;
  components: ScoreComponents;
  partial: boolean;
  label: ScoreLabel;
  confidence: "High" | "Medium" | "Low";
  signal: string;
}

/** The six price-and-market parts are scaled to 80 points, Flows (institutional stake and delivery) adds 20. */
export const COMPONENT_MAX: ScoreComponents = { trend: 16, momentum: 16, volume: 12, pattern: 12, market: 16, risk: 8, flows: 20 };
const SCALE = 0.8;

const KEYS = ["trend", "momentum", "volume", "pattern", "market", "risk", "flows"] as const;
// Brief says one decimal but also pins 3.75 / 11.25; every sub-rule is a multiple of 0.25, so
// two decimals is exact and only strips float noise.
const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tracks whether any sub-rule fell back to half points because an input was missing. */
class Tally {
  partial = false;
  /** Points if `ok`, otherwise half of `max` and the score is partial. */
  guard(ok: boolean, max: number, pts: () => number): number {
    if (ok) return pts();
    this.partial = true;
    return max / 2;
  }
}

function trend(i: ScoreInput, t: Tally): number {
  const above = (e: number | null) => t.guard(e !== null, 4, () => (i.close > (e as number) ? 4 : 0));
  const stack = t.guard(i.ema20 !== null && i.ema50 !== null && i.ema200 !== null, 8, () => {
    const [a, b, c] = [i.ema20 as number, i.ema50 as number, i.ema200 as number];
    const n = Number(a > b) + Number(b > c) + Number(a > c);
    return n === 3 ? 8 : n === 2 ? 4 : 0;
  });
  return above(i.ema20) + above(i.ema50) + above(i.ema200) + stack;
}

function rsiPoints(r: number): number {
  if (r >= 55 && r <= 70) return 12;
  if (r >= 45 && r < 55) return 8;
  if (r > 70 && r <= 80) return 6;
  if (r >= 40 && r < 45) return 4;
  if (r > 80) return 2;
  return 0;
}

function momentum(i: ScoreInput, t: Tally): number {
  const rsi = t.guard(i.rsi14 !== null, 12, () => rsiPoints(i.rsi14 as number));
  const cross = t.guard(i.macd !== null && i.macdSignal !== null, 4, () =>
    (i.macd as number) > (i.macdSignal as number) ? 4 : 0,
  );
  const pos = t.guard(i.macd !== null, 2, () => ((i.macd as number) > 0 ? 2 : 0));
  const hist = t.guard(i.macdHist !== null && i.prevMacdHist !== null, 2, () =>
    (i.macdHist as number) > (i.prevMacdHist as number) ? 2 : 0,
  );
  return rsi + cross + pos + hist;
}

function volume(i: ScoreInput, t: Tally): number {
  const missing =
    i.volume === null || i.volume === 0 || i.volAvg20 === null || i.volAvg20 === 0 || i.prevClose === null;
  if (missing) {
    if (i.kind === "stock") t.partial = true;
    return 7.5;
  }
  const ratio = (i.volume as number) / (i.volAvg20 as number);
  const prev = i.prevClose as number;
  if (i.close > prev) return ratio >= 2 ? 15 : ratio >= 1.5 ? 12 : ratio >= 1 ? 9 : 7;
  if (i.close < prev) return ratio >= 2 ? 0 : ratio >= 1.5 ? 3 : ratio >= 1 ? 5 : 7;
  return 7;
}

function pattern(i: ScoreInput): number {
  const near = (level: number | null) => level !== null && Math.abs(i.close - level) / i.close <= 0.01;
  let pts = 7.5;
  for (const h of i.recentPatterns) {
    if (h.bias === "bullish") pts += 3.75;
    else if (h.bias === "bearish") pts -= 3.75;
    else if (h.name === "doji") {
      if (near(i.support)) pts += 3.75;
      else if (near(i.resistance)) pts -= 3.75;
    }
  }
  return Math.min(15, Math.max(0, pts));
}

const LABEL_STEPS: ScoreLabel[] = ["Strong Bearish", "Bearish", "Neutral", "Bullish", "Strong Bullish"];
/** Points for a label on a scale whose top is `max` (8 for Nifty, 6 for sector). */
const labelPoints = (l: ScoreLabel, max: number) => (LABEL_STEPS.indexOf(l) * max) / 4;

function market(i: ScoreInput, t: Tally): number {
  if (i.kind === "nifty") return 10;
  const nifty = t.guard(i.niftyLabel !== null, 8, () => labelPoints(i.niftyLabel as ScoreLabel, 8));
  const sector = t.guard(i.sectorLabel !== null, 6, () => labelPoints(i.sectorLabel as ScoreLabel, 6));
  const rs = t.guard(i.rs20 !== null, 6, () => {
    const r = i.rs20 as number;
    return r >= 0.05 ? 6 : r >= 0.02 ? 4.5 : r >= -0.02 ? 3 : r >= -0.05 ? 1.5 : 0;
  });
  return nifty + sector + rs;
}

function risk(i: ScoreInput): number {
  if (i.kind !== "stock") return 5;
  const up = i.resistance === null ? null : (i.resistance - i.close) / i.close;
  const down = i.support === null ? null : (i.close - i.support) / i.close;
  if (up === null && down === null) return 5;
  if (up === null) return (down as number) <= 0.03 ? 7 : 5;
  if (down === null) return up <= 0.02 ? 3 : 5;
  // (R - C) / (C - S) equals up/down but avoids float noise at the thresholds.
  const ratio = down === 0 ? (up > 0 ? Infinity : 0) : (i.resistance! - i.close) / (i.close - i.support!);
  return ratio >= 3 ? 10 : ratio >= 2 ? 8 : ratio >= 1 ? 6 : ratio >= 0.5 ? 3 : 0;
}

/** FII / DII stake change in percentage points -> points out of `max`: +1 or more all, +0.25 three quarters, within -0.25 half, down to -1 a quarter, below that none. */
function stakePoints(delta: number, max: number): number {
  const d = Math.round(delta * 100) / 100;
  return d >= 1 ? max : d >= 0.25 ? max * 0.75 : d >= -0.25 ? max * 0.5 : d > -1 ? max * 0.25 : 0;
}

/**
 * Institutional flows, 20 points, stocks only (everything else is a neutral 10). FII stake 8, DII stake 6 (half
 * points and partial when there is no data), delivery 6: 60%+ on a rising day scores 6, on a falling day 0,
 * otherwise (including no delivery row, which only means "not among the busiest") a neutral 3.
 */
function flows(i: ScoreInput, t: Tally): number {
  if (i.kind !== "stock") return 10;
  const fii = t.guard(i.fiiDelta != null, 8, () => stakePoints(i.fiiDelta as number, 8));
  const dii = t.guard(i.diiDelta != null, 6, () => stakePoints(i.diiDelta as number, 6));
  const per = i.deliveryPer ?? null;
  let delivery = 3;
  if (per !== null && per >= 60 && i.prevClose !== null) delivery = i.close > i.prevClose ? 6 : i.close < i.prevClose ? 0 : 3;
  return fii + dii + delivery;
}

export function labelFor(score: number): ScoreLabel {
  if (score >= 75) return "Strong Bullish";
  if (score >= 60) return "Bullish";
  if (score >= 45) return "Neutral";
  if (score >= 30) return "Bearish";
  return "Strong Bearish";
}

const share = (c: ScoreComponents, k: keyof ScoreComponents) => c[k] / COMPONENT_MAX[k];

/** Confidence from how many components oppose the label (spec 5.3). */
export function confidenceFor(components: ScoreComponents, label: ScoreLabel): "High" | "Medium" | "Low" {
  const shares = KEYS.map((k) => share(components, k));
  const bull = shares.filter((s) => s >= 0.6).length;
  const bear = shares.filter((s) => s <= 0.4).length;
  if (label === "Neutral") return bull >= 5 || bear >= 5 ? "Medium" : "Low";
  const opposing = label.endsWith("Bullish") ? bear : bull;
  return opposing <= 1 ? "High" : opposing === 2 ? "Medium" : "Low";
}

const LABEL_WORDS: Record<ScoreLabel, string> = {
  "Strong Bullish": "Strong bullish momentum",
  Bullish: "Bullish setup",
  Neutral: "Range-bound",
  Bearish: "Bearish weakness",
  "Strong Bearish": "Strong bearish pressure",
};

const PHRASES: Record<keyof ScoreComponents, [high: string, low: string]> = {
  trend: ["price above key EMAs", "below key EMAs"],
  momentum: ["strong RSI & MACD", "fading momentum"],
  volume: ["accumulation on high volume", "supply pressure"],
  pattern: ["bullish reversal pattern", "bearish reversal pattern"],
  market: ["market & sector tailwinds", "market & sector headwinds"],
  risk: ["near support with room to run", "pressing against resistance"],
  flows: ["institutions adding", "institutions reducing"],
};

/** Below this distance from 0.5 no component leans enough to explain a Neutral label. */
const NEUTRAL_LEAN = 0.1;

/**
 * "<label words> · <phrase>" from the component that best explains the label. A Neutral label
 * says "limited data" when every input fell back to half points, and "mixed signals" when no
 * component leans clearly either way.
 */
export function signalLine(components: ScoreComponents, label: ScoreLabel, partial = false): string {
  if (label === "Neutral") {
    const leans = KEYS.map((k) => Math.abs(share(components, k) - 0.5));
    if (partial && leans.every((l) => l === 0)) return `${LABEL_WORDS[label]} · limited data`;
    if (Math.max(...leans) < NEUTRAL_LEAN) return `${LABEL_WORDS[label]} · mixed signals`;
  }
  const bullish = label === "Strong Bullish" || label === "Bullish";
  // Strictly-better comparison keeps the first key on ties (trend, momentum, ...).
  const metric = (k: keyof ScoreComponents) =>
    label === "Neutral" ? Math.abs(share(components, k) - 0.5) : bullish ? share(components, k) : -share(components, k);
  let key: keyof ScoreComponents = KEYS[0];
  for (const k of KEYS) if (metric(k) > metric(key)) key = k;
  const [high, low] = PHRASES[key];
  return `${LABEL_WORDS[label]} · ${share(components, key) >= 0.5 ? high : low}`;
}

/** The six price-and-market parts on their original scale (max 20/20/15/15/20/10); `partial` covers only these. */
export function rawParts(input: ScoreInput): { components: Omit<ScoreComponents, "flows">; partial: boolean } {
  const t = new Tally();
  const components = {
    trend: round2(trend(input, t)),
    momentum: round2(momentum(input, t)),
    volume: round2(volume(input, t)),
    pattern: round2(pattern(input)),
    market: round2(market(input, t)),
    risk: round2(risk(input)),
  };
  return { components, partial: t.partial };
}

export function scoreInstrument(input: ScoreInput): ScoreResult {
  const { components: raw, partial: rawPartial } = rawParts(input);
  const ft = new Tally();
  const components: ScoreComponents = {
    trend: round2(raw.trend * SCALE),
    momentum: round2(raw.momentum * SCALE),
    volume: round2(raw.volume * SCALE),
    pattern: round2(raw.pattern * SCALE),
    market: round2(raw.market * SCALE),
    risk: round2(raw.risk * SCALE),
    flows: round2(flows(input, ft)),
  };
  const partial = rawPartial || ft.partial;
  const score = Math.round(KEYS.reduce((s, k) => s + components[k], 0));
  const label = labelFor(score);
  return {
    score,
    components,
    partial,
    label,
    confidence: confidenceFor(components, label),
    signal: signalLine(components, label, partial),
  };
}
