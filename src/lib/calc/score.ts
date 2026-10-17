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
}

export interface ScoreComponents {
  trend: number;
  momentum: number;
  volume: number;
  pattern: number;
  market: number;
  risk: number;
}

export interface ScoreResult {
  score: number;
  components: ScoreComponents;
  partial: boolean;
  label: ScoreLabel;
  confidence: "High" | "Medium" | "Low";
  signal: string;
}

export const COMPONENT_MAX: ScoreComponents = { trend: 20, momentum: 20, volume: 15, pattern: 15, market: 20, risk: 10 };

const KEYS = ["trend", "momentum", "volume", "pattern", "market", "risk"] as const;
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
  if (label === "Neutral") return bull >= 4 || bear >= 4 ? "Medium" : "Low";
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
};

/** "<label words> · <phrase>" from the component that best explains the label. */
export function signalLine(components: ScoreComponents, label: ScoreLabel): string {
  const bullish = label === "Strong Bullish" || label === "Bullish";
  // Strictly-better comparison keeps the first key on ties (trend, momentum, ...).
  const metric = (k: keyof ScoreComponents) =>
    label === "Neutral" ? Math.abs(share(components, k) - 0.5) : bullish ? share(components, k) : -share(components, k);
  let key: keyof ScoreComponents = KEYS[0];
  for (const k of KEYS) if (metric(k) > metric(key)) key = k;
  const [high, low] = PHRASES[key];
  return `${LABEL_WORDS[label]} · ${share(components, key) >= 0.5 ? high : low}`;
}

export function scoreInstrument(input: ScoreInput): ScoreResult {
  const t = new Tally();
  const components: ScoreComponents = {
    trend: round2(trend(input, t)),
    momentum: round2(momentum(input, t)),
    volume: round2(volume(input, t)),
    pattern: round2(pattern(input)),
    market: round2(market(input, t)),
    risk: round2(risk(input)),
  };
  const score = Math.round(KEYS.reduce((s, k) => s + components[k], 0));
  const label = labelFor(score);
  return {
    score,
    components,
    partial: t.partial,
    label,
    confidence: confidenceFor(components, label),
    signal: signalLine(components, label),
  };
}
