import type { ScoreLabel } from "@/lib/calc/score";

export type AlertCondition =
  | "price_above" | "price_below" | "cross_ema20" | "cross_ema50" | "cross_ema200"
  | "rsi_above_70" | "rsi_below_30" | "score_turns_bullish" | "score_turns_bearish"
  | "holding_sl" | "holding_target";
export type HoldingLevel = "none" | "near" | "hit";

export const CONDITIONS: { id: AlertCondition; label: string; needsValue: boolean; intraday: boolean; userCreatable: boolean }[] = [
  { id: "price_above", label: "Price goes above", needsValue: true, intraday: true, userCreatable: true },
  { id: "price_below", label: "Price goes below", needsValue: true, intraday: true, userCreatable: true },
  { id: "cross_ema20", label: "Crosses EMA 20", needsValue: false, intraday: false, userCreatable: true },
  { id: "cross_ema50", label: "Crosses EMA 50", needsValue: false, intraday: false, userCreatable: true },
  { id: "cross_ema200", label: "Crosses EMA 200", needsValue: false, intraday: false, userCreatable: true },
  { id: "rsi_above_70", label: "RSI goes above 70", needsValue: false, intraday: false, userCreatable: true },
  { id: "rsi_below_30", label: "RSI goes below 30", needsValue: false, intraday: false, userCreatable: true },
  { id: "score_turns_bullish", label: "Score turns Bullish", needsValue: false, intraday: false, userCreatable: true },
  { id: "score_turns_bearish", label: "Score turns Bearish", needsValue: false, intraday: false, userCreatable: true },
  { id: "holding_sl", label: "Near / hit stop loss", needsValue: true, intraday: true, userCreatable: false },
  { id: "holding_target", label: "Near / hit target", needsValue: true, intraday: true, userCreatable: false },
];
const BY_ID = new Map(CONDITIONS.map((c) => [c.id, c]));

export interface Snapshot {
  key: string;
  price: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  score: number | null;
  scoreLabel: ScoreLabel | null;
  at: Date;
  /** From a live quote: only intraday conditions are evaluated. */
  live: boolean;
}

export interface RuleState {
  condition: AlertCondition;
  value: number | null;
  mode: "once" | "repeat";
  lastState: boolean | null;
  lastLevel: HoldingLevel | null;
  lastFiredAt: Date | null;
}

export interface Evaluation {
  known: boolean;
  state: boolean | null;
  level: HoldingLevel | null;
  fire: boolean;
  direction: "above" | "below" | null;
}

const THROTTLE_MS = 15 * 60_000;
const NEAR = 0.02;
const RANK: Record<HoldingLevel, number> = { none: 0, near: 1, hit: 2 };
const BULLISH: ScoreLabel[] = ["Bullish", "Strong Bullish"];
const BEARISH: ScoreLabel[] = ["Bearish", "Strong Bearish"];

const isHolding = (c: AlertCondition) => c === "holding_sl" || c === "holding_target";

function emaOf(c: AlertCondition, s: Snapshot): number | null {
  return c === "cross_ema20" ? s.ema20 : c === "cross_ema50" ? s.ema50 : s.ema200;
}

/** The boolean state now, or null when the data needed is missing. */
function stateNow(c: AlertCondition, value: number | null, s: Snapshot): boolean | null {
  switch (c) {
    case "price_above":
      return s.price === null || value === null ? null : s.price > value;
    case "price_below":
      return s.price === null || value === null ? null : s.price < value;
    case "cross_ema20":
    case "cross_ema50":
    case "cross_ema200": {
      const ema = emaOf(c, s);
      return s.price === null || ema === null ? null : s.price > ema;
    }
    case "rsi_above_70":
      return s.rsi14 === null ? null : s.rsi14 > 70;
    case "rsi_below_30":
      return s.rsi14 === null ? null : s.rsi14 < 30;
    case "score_turns_bullish":
      return s.scoreLabel === null ? null : BULLISH.includes(s.scoreLabel);
    case "score_turns_bearish":
      return s.scoreLabel === null ? null : BEARISH.includes(s.scoreLabel);
    default:
      return null;
  }
}

function levelNow(c: AlertCondition, value: number | null, s: Snapshot): HoldingLevel | null {
  if (s.price === null || value === null || s.price <= 0) return null;
  const p = s.price;
  if (c === "holding_sl") return p <= value ? "hit" : (p - value) / p <= NEAR ? "near" : "none";
  return p >= value ? "hit" : (value - p) / p <= NEAR ? "near" : "none";
}

export function initialState(condition: AlertCondition, value: number | null, snap: Snapshot): { state: boolean | null; level: HoldingLevel | null } {
  return isHolding(condition)
    ? { state: null, level: levelNow(condition, value, snap) }
    : { state: stateNow(condition, value, snap), level: null };
}

export function evaluateRule(rule: RuleState, snap: Snapshot, opts: { throttleMs?: number }): Evaluation {
  const { condition: c, value } = rule;
  const unknown: Evaluation = { known: false, state: rule.lastState, level: rule.lastLevel, fire: false, direction: null };
  if (snap.live && !BY_ID.get(c)?.intraday) return unknown;

  let ev: Evaluation;
  if (isHolding(c)) {
    const level = levelNow(c, value, snap);
    if (level === null) return unknown;
    const rises = rule.lastLevel !== null && RANK[level] > RANK[rule.lastLevel];
    ev = { known: true, state: null, level, fire: rises, direction: null };
  } else {
    const state = stateNow(c, value, snap);
    if (state === null) return unknown;
    const isCross = c === "cross_ema20" || c === "cross_ema50" || c === "cross_ema200";
    const fire = rule.lastState !== null && (isCross ? state !== rule.lastState : !rule.lastState && state);
    let direction: Evaluation["direction"] = null;
    if (isCross) direction = state ? "above" : "below";
    else if (c === "price_above" || c === "rsi_above_70") direction = "above";
    else if (c === "price_below" || c === "rsi_below_30") direction = "below";
    ev = { known: true, state, level: null, fire, direction };
  }

  const throttle = opts.throttleMs ?? THROTTLE_MS;
  if (ev.fire && rule.lastFiredAt && snap.at.getTime() - rule.lastFiredAt.getTime() < throttle) ev.fire = false;
  return ev;
}

const inr = (v: number | null) =>
  v === null ? "—" : `₹${new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(v)}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const IST_OFFSET_MS = 330 * 60_000;

/** "17 Oct 15:30" in IST. */
export function fmtAlertTime(d: Date): string {
  const t = new Date(d.getTime() + IST_OFFSET_MS);
  const hh = String(t.getUTCHours()).padStart(2, "0");
  const mm = String(t.getUTCMinutes()).padStart(2, "0");
  return `${t.getUTCDate()} ${MONTHS[t.getUTCMonth()]} ${hh}:${mm}`;
}

export function alertMessage(key: string, condition: AlertCondition, ev: Evaluation, snap: Snapshot, value: number | null): string {
  const tail = `${inr(snap.price)} · ${fmtAlertTime(snap.at)}`;
  switch (condition) {
    case "price_above":
      return `🔔 ${key} crossed above ${inr(value)} · ${tail}`;
    case "price_below":
      return `🔔 ${key} fell below ${inr(value)} · ${tail}`;
    case "cross_ema20":
    case "cross_ema50":
    case "cross_ema200":
      return `🔔 ${key} crossed ${ev.direction === "below" ? "below" : "above"} EMA ${condition.slice("cross_ema".length)} · ${tail}`;
    case "rsi_above_70":
      return `🔔 ${key} RSI above 70 (${snap.rsi14?.toFixed(1)}) · ${tail}`;
    case "rsi_below_30":
      return `🔔 ${key} RSI below 30 (${snap.rsi14?.toFixed(1)}) · ${tail}`;
    case "score_turns_bullish":
    case "score_turns_bearish":
      return `🔔 ${key} score turned ${snap.scoreLabel} (${snap.score === null ? "—" : Math.round(snap.score)}) · ${tail}`;
    case "holding_sl":
      return ev.level === "hit" ? `🛑 ${key} stop loss hit ${inr(value)} · ${tail}` : `⚠️ ${key} near stop loss ${inr(value)} · ${tail}`;
    case "holding_target":
      return ev.level === "hit" ? `🎯 ${key} target hit ${inr(value)} · ${tail}` : `🎯 ${key} near target ${inr(value)} · ${tail}`;
  }
}
