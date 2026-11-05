import { atrSeries, type AtrResult } from "../atr";
import { tradedValue, type TradedValue } from "../tradedValue";
import { SCORING_VERSION } from "./config";
import { MIN_TRADE_COVERAGE_FOR_RANKING, TRADE_CONFIG as C, TRADE_MIN_CANDLES_ATR, TRADE_WEIGHTS, type TradeCategoryKey } from "./tradeConfig";
import { last, missing, num, pct, round2, scored, tier, type ScoreCategory, type ScoreItem, type TechDay } from "./technical";

export interface TradeInput {
  /** Ascending priced sessions with OHLCV and EMAs, newest last (300 recommended: ATR warm-up). */
  days: TechDay[];
  support: number | null;
  resistance: number | null;
  /** The holder's own levels; used in preference to the suggested ones when valid for a long trade. */
  manualStop?: number | null;
  manualTarget1?: number | null;
  /** Technical Strength v2 score, only used for the "Weak technical setup" observation. */
  technicalScore?: number | null;
}

export type EntryObservation =
  | "Favourable setup"
  | "Wait for pullback"
  | "Overextended"
  | "Poor risk/reward"
  | "Weak technical setup"
  | "No valid target (breakout territory)"
  | "Insufficient data";

export interface TradeLevels {
  entry: number | null;
  stop: number | null;
  stopSource: "manual" | "support" | "atr" | "lower of support and ATR" | null;
  target: number | null;
  targetSource: "manual" | "resistance" | null;
  rewardRisk: number | null;
}

export interface TradeResult {
  version: typeof SCORING_VERSION;
  levels: TradeLevels;
  categories: ScoreCategory[];
  earned: number;
  available: number;
  /** earned / available * 100; null when nothing could be scored. */
  normalised: number | null;
  /** available / 100 */
  coverage: number;
  status: "COMPLETE" | "PROVISIONAL" | "NOT_AVAILABLE";
  /** Coverage >= 80% and a computable reward-to-risk. Never rank when false. */
  rankable: boolean;
  observation: EntryObservation;
  flags: string[];
  missing: string[];
  atr: { value: number | null; pct: number | null; candles: number; status: AtrResult["status"]; jumps: string[] };
  liquidity: TradedValue;
}

function category(key: TradeCategoryKey, label: string, items: ScoreItem[]): ScoreCategory {
  const max = TRADE_WEIGHTS[key];
  const earned = round2(items.reduce((s, i) => s + i.points, 0));
  const available = round2(items.filter((i) => i.status === "scored").reduce((s, i) => s + i.max, 0));
  return { key, label, max, items, earned: Math.min(earned, max), available, coverage: round2(available / max) };
}

export function scoreTradeQuality(i: TradeInput): TradeResult {
  const flags: string[] = [];
  const days = i.days;
  const d = last(days);
  const entry = d && num(d.close) && d.close > 0 ? d.close : null;
  const a = atrSeries(days, 14, 0.3, TRADE_MIN_CANDLES_ATR);
  const atr = a.atr;
  const tv = tradedValue(days, { window: C.liquidity.window, minReadings: C.liquidity.minReadings });
  if (a.jumps.length) flags.push(`Close-to-close move over 30% on ${a.jumps.map((j) => days[j]!.date).join(", ")} (unadjusted corporate action or extreme move): ATR restarted after it`);

  // --- Levels: suggestions, never guarantees ---
  const lv: TradeLevels = { entry, stop: null, stopSource: null, target: null, targetSource: null, rewardRisk: null };
  if (entry !== null) {
    if (num(i.manualStop)) {
      if (i.manualStop > 0 && i.manualStop < entry) { lv.stop = i.manualStop; lv.stopSource = "manual"; }
      else flags.push("Your stop-loss is at or above the current price: ignored, suggested stop used");
    }
    if (lv.stop === null) {
      const sup = num(i.support) && i.support > 0 && i.support < entry ? i.support : null;
      const atrStop = atr !== null ? entry - C.levels.atrStopMultiple * atr : null;
      const cands = [sup, atrStop].filter((x): x is number => x !== null && x > 0 && x < entry);
      if (cands.length) {
        lv.stop = Math.min(...cands);
        lv.stopSource = sup !== null && atrStop !== null ? "lower of support and ATR" : sup !== null ? "support" : "atr";
      }
    }
    if (num(i.manualTarget1)) {
      if (i.manualTarget1 > entry) { lv.target = i.manualTarget1; lv.targetSource = "manual"; }
      else flags.push("Your Target 1 is at or below the current price: ignored, suggested target used");
    }
    if (lv.target === null && num(i.resistance) && i.resistance > entry) { lv.target = i.resistance; lv.targetSource = "resistance"; }
    if (lv.stop !== null && lv.target !== null && lv.target > entry && lv.stop < entry) lv.rewardRisk = round2((lv.target - entry) / (entry - lv.stop));
    if (lv.target === null) flags.push("No valid target: no resistance above the price (breakout territory)");
  }

  // --- 1. Reward-to-risk (30) ---
  const rrMax = TRADE_WEIGHTS.rewardRisk;
  const rr: ScoreItem =
    lv.rewardRisk !== null
      ? scored("rewardRisk", "Reward-to-risk", rrMax, tier(lv.rewardRisk, C.rewardRiskTiers) * rrMax, lv.rewardRisk, `(target ${round2(lv.target!)} - entry ${round2(entry!)}) / (entry - stop ${round2(lv.stop!)}); stop from ${lv.stopSource}, target from ${lv.targetSource}`)
      : missing("rewardRisk", "Reward-to-risk", rrMax, entry === null ? "No price" : lv.target === null ? "No valid target above the price" : "No valid stop (needs support below the price or ATR)");

  // --- 2. Entry location (25) ---
  const e = C.entry;
  const ema = (key: string, label: string, max: number, level: number | null | undefined, tiers: readonly (readonly [number, number])[], belowShare: number): ScoreItem => {
    if (entry === null || !num(level)) return missing(key, label, max, `No ${label.split(" ")[0]}`);
    if (atr === null) return missing(key, label, max, "ATR unavailable (needs 34 contiguous candles)");
    const ext = (entry - level) / atr;
    if (ext < 0) return scored(key, label, max, belowShare * max, `${round2(ext)} ATR`, "Below the average: nothing shows support is holding");
    return scored(key, label, max, tier(ext, tiers) * max, `${round2(ext)} ATR`, ext >= e.extendedAtr ? "Extended above the average" : "Distance above the average in ATRs");
  };
  const supportValid = entry !== null && num(i.support) && i.support > 0 && i.support < entry ? i.support : null;
  const resistanceValid = entry !== null && num(i.resistance) && i.resistance > entry ? i.resistance : null;
  const room: ScoreItem =
    entry === null ? missing("resistanceRoom", "Room to resistance", e.resistanceRoom, "No price")
    : resistanceValid === null ? missing("resistanceRoom", "Room to resistance", e.resistanceRoom, "No resistance above: breakout territory")
    : atr === null ? missing("resistanceRoom", "Room to resistance", e.resistanceRoom, "ATR unavailable (needs 34 contiguous candles)")
    : scored("resistanceRoom", "Room to resistance", e.resistanceRoom, tier((resistanceValid - entry) / atr, e.resistanceTiers) * e.resistanceRoom, `${round2((resistanceValid - entry) / atr)} ATR`, "Distance up to the nearest resistance");
  let holding: ScoreItem;
  if (entry === null || supportValid === null) holding = missing("supportHolding", "Support holding", e.supportHolding, "No support below the price");
  else if (atr === null) holding = missing("supportHolding", "Support holding", e.supportHolding, "ATR unavailable (needs 34 contiguous candles)");
  else {
    const dist = (entry - supportValid) / atr;
    if (dist > e.supportNearAtr) holding = scored("supportHolding", "Support holding", e.supportHolding, e.supportNeutral * e.supportHolding, `${round2(dist)} ATR above`, "Not at support: neither rewarded nor penalised");
    else {
      const recent = days.slice(-e.heldSessions);
      const held = recent.length === e.heldSessions && recent.every((x) => num(x.low) && x.low >= supportValid * (1 - e.supportHeldTol));
      const prev = last(days, 1);
      const bounced = num(prev?.close) && entry > prev.close;
      holding = scored("supportHolding", "Support holding", e.supportHolding, held && bounced ? e.supportHolding : 0, `${round2(dist)} ATR above`, held && bounced ? "Near support, held for 3 sessions and closing up" : held ? "Near support but no bounce yet" : "Near support but it was breached recently");
    }
  }
  const entryCat = category("entry", "Entry location", [
    ema("ema20", "EMA20 distance", e.ema20, d?.ema20, e.ema20Tiers, e.ema20Below),
    ema("ema50", "EMA50 distance", e.ema50, d?.ema50, e.ema50Tiers, e.ema50Below),
    room, holding,
  ]);

  // --- 3. ATR & volatility (25) ---
  const v = C.volatility;
  const atrPctItem: ScoreItem = a.atrPct === null
    ? missing("atrPct", "ATR % of price", v.atrPct, `Needs ${TRADE_MIN_CANDLES_ATR} contiguous candles (have ${a.candles})`)
    : scored("atrPct", "ATR % of price", v.atrPct, tier(a.atrPct, v.atrPctTiers) * v.atrPct, `${round2(a.atrPct)}%`, "Daily range relative to price; high is not penalised by itself");
  const now = a.series[a.series.length - 1] ?? null, then = a.series[a.series.length - 1 - v.expansionSessions] ?? null;
  const expansion: ScoreItem = a.atr === null || now === null || then === null
    ? missing("expansion", "Volatility expansion", v.expansion, `Needs ATR ${v.expansionSessions} sessions ago`)
    : scored("expansion", "Volatility expansion", v.expansion, tier(now / then, v.expansionBands) * v.expansion, `x${round2(now / then)}`, now / then >= 1.15 ? "ATR expanding versus 20 sessions ago" : now / then < 0.9 ? "ATR contracting" : "ATR stable");
  let stopItem: ScoreItem;
  if (lv.stop === null || atr === null || entry === null) stopItem = missing("stopDistance", "Stop distance vs ATR", v.stopDistance, "Needs a valid stop and ATR");
  else {
    const dist = (entry - lv.stop) / atr, t = v.stopTiers, s = v.stopShares;
    const share = dist < t.tooTight ? s.tooTight : dist < t.tight ? s.tight : dist <= t.good ? s.good : dist <= t.wide ? s.wide : s.tooWide;
    stopItem = scored("stopDistance", "Stop distance vs ATR", v.stopDistance, share * v.stopDistance, `${round2(dist)} ATR`, dist < t.tooTight ? "Stop sits inside normal daily noise" : dist <= t.good ? "Room for normal volatility" : "Wide stop: large risk per share");
  }
  let gap: ScoreItem;
  const gw = days.slice(-v.gapSessions - 1);
  const jumpDates = new Set(a.jumps.map((j) => days[j]!.date));
  const gaps: number[] = [];
  for (let k = 1; k < gw.length; k++) {
    const o = gw[k]!.open, pc = gw[k - 1]!.close;
    if (num(o) && num(pc) && pc > 0 && !jumpDates.has(gw[k]!.date)) gaps.push(Math.abs(o / pc - 1));
  }
  if (a.atrPct === null || gaps.length < v.gapSessions / 2) gap = missing("gapRisk", "Overnight gap risk", v.gapRisk, "Needs open prices and ATR");
  else {
    const worst = Math.max(...gaps), inAtr = worst / (a.atrPct / 100);
    gap = scored("gapRisk", "Overnight gap risk", v.gapRisk, tier(inAtr, v.gapTiers) * v.gapRisk, `${pct(worst)} = ${round2(inAtr)} ATR`, `Largest open-vs-prior-close gap in ${gaps.length} sessions`);
  }
  const volCat = category("volatility", "ATR & volatility", [atrPctItem, expansion, stopItem, gap]);

  // --- 4. Liquidity (20) ---
  const l = C.liquidity;
  const cr = tv.median === null ? null : tv.median / 1e7;
  const valueItem: ScoreItem = cr === null
    ? missing("tradedValue", "Median traded value", l.value, `Needs ${l.minReadings} sessions with volume (have ${tv.readings})`)
    : scored("tradedValue", "Median traded value", l.value, tier(cr, l.valueTiersCr) * l.value, `₹${round2(cr)} cr/day (estimate; avg ₹${round2(tv.avg! / 1e7)} cr)`, "Estimated as close x volume, not exchange turnover");
  const steadyItem: ScoreItem = tv.steadyShare === null
    ? missing("steady", "Trading consistency", l.steady, "Not enough volume data")
    : scored("steady", "Trading consistency", l.steady, tier(tv.steadyShare, l.steadyTiers) * l.steady, pct(tv.steadyShare), "Share of sessions trading at least half the median value");
  let positionItem: ScoreItem;
  if (tv.median === null) positionItem = missing("position", "Execution suitability", l.position, "Not enough volume data");
  else {
    const f = l.referencePositionInr / tv.median;
    const band = l.positionBands.find(([upper]) => f <= upper);
    positionItem = scored("position", "Execution suitability", l.position, (band ? band[1] : 0) * l.position, pct(f), `₹${(l.referencePositionInr / 1e5).toFixed(0)}L position as a share of the median daily value`);
  }
  if (cr !== null && cr < l.minValueCr) flags.push(`Serious liquidity problem: median traded value below ₹${l.minValueCr} crore/day`);
  if (tv.spikes.length) flags.push(`Traded-value spike(s) on ${tv.spikes.join(", ")}: scored on the median, not the average`);
  if (tv.missingVolume > 0) flags.push(`${tv.missingVolume} of the last ${tv.window} sessions have no usable volume and were left out`);
  const liqCat = category("liquidity", "Liquidity", [valueItem, steadyItem, positionItem]);

  const categories = [category("rewardRisk", "Reward-to-risk", [rr]), entryCat, volCat, liqCat];
  const earned = round2(categories.reduce((s, c) => s + c.earned, 0));
  const available = round2(categories.reduce((s, c) => s + c.available, 0));
  const coverage = round2(available / 100);

  // --- Observation: descriptive, not a recommendation ---
  const ext20 = entry !== null && atr !== null && num(d?.ema20) ? (entry - d.ema20) / atr : null;
  let observation: EntryObservation;
  if (entry === null || atr === null) observation = "Insufficient data";
  else if (num(i.technicalScore) && i.technicalScore < e.weakTechnical) observation = "Weak technical setup";
  else if (ext20 !== null && ext20 >= e.extendedAtr) observation = "Overextended";
  else if (ext20 !== null && ext20 >= e.pullbackAtr) observation = "Wait for pullback";
  else if (lv.rewardRisk === null) observation = lv.target === null ? "No valid target (breakout territory)" : "Insufficient data";
  else if (lv.rewardRisk < e.poorRewardRisk) observation = "Poor risk/reward";
  else observation = "Favourable setup";

  return {
    version: SCORING_VERSION,
    levels: lv, categories, earned, available,
    normalised: available === 0 ? null : round2((earned / available) * 100),
    coverage,
    status: available === 0 ? "NOT_AVAILABLE" : coverage < 1 ? "PROVISIONAL" : "COMPLETE",
    rankable: coverage >= MIN_TRADE_COVERAGE_FOR_RANKING && lv.rewardRisk !== null,
    observation, flags,
    missing: categories.flatMap((c) => c.items.filter((x) => x.status === "missing").map((x) => `${c.label}: ${x.label}: ${x.note}`)),
    atr: { value: a.atr, pct: a.atrPct, candles: a.candles, status: a.status, jumps: a.jumps.map((j) => days[j]!.date) },
    liquidity: tv,
  };
}
