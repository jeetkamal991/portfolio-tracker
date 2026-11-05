/**
 * Foundation for validating enhanced_v2 against what happened AFTER each snapshot. Architecture only: there is not yet
 * enough prospective snapshot history to say anything, and nothing here may be presented as a performance claim.
 *
 * Point in time: a snapshot is computed after the close of its evaluation date, so the earliest realistic entry is the
 * NEXT session's open (plus slippage). Nothing on or before the evaluation date is used except to compare with it, and
 * no price after the snapshot feeds back into it.
 *
 * Known gaps (documented, not hidden): the universe is today's, so delisted or removed stocks are absent (survivorship
 * bias); prices are the provider's adjusted history; costs are a flat basis-point assumption, not a broker's schedule;
 * stop and target use daily bars, and when both lie inside one bar the stop is assumed hit first (conservative).
 */
export const BACKTEST_CONFIG = {
  horizons: [5, 10, 20] as readonly number[],
  /** Round-trip costs charged on the entry price, in basis points (brokerage, taxes, charges). A placeholder to configure. */
  roundTripCostBps: 25,
  /** Adverse slippage applied to both the entry and the exit, in basis points. */
  slippageBps: 10,
  thresholds: [0.03, 0.05, 0.1] as readonly number[],
  /** Fewer outcomes than this and the summary says INSUFFICIENT SAMPLE instead of reporting rates. */
  minSample: 100,
} as const;

export interface Bar { date: string; open: number | null; high: number | null; low: number | null; close: number | null }

export interface Outcome {
  evaluationDate: string;
  entryDate: string | null;
  entryPrice: number | null;
  /** Net return after slippage and costs at each horizon; null when the future bars do not exist yet. */
  returns: Record<number, number | null>;
  /** Same horizons for the benchmark over the same sessions (close to close), for relative performance. */
  benchmark: Record<number, number | null>;
  /** Over the longest horizon with data: best and worst excursion from the entry, as fractions. */
  mfe: number | null;
  mae: number | null;
  reached: Record<string, boolean>;
  stopFirst: boolean | null;
  targetFirst: boolean | null;
  /** Sessions observed after entry. */
  sessions: number;
}

const bps = (x: number) => x / 10_000;

export function forwardOutcome(
  bars: Bar[],
  evaluationDate: string,
  opts: { stop?: number | null; target?: number | null; benchmark?: Bar[]; config?: typeof BACKTEST_CONFIG } = {},
): Outcome {
  const c = opts.config ?? BACKTEST_CONFIG;
  const horizons = c.horizons;
  const empty: Outcome = {
    evaluationDate, entryDate: null, entryPrice: null, returns: Object.fromEntries(horizons.map((h) => [h, null])),
    benchmark: Object.fromEntries(horizons.map((h) => [h, null])), mfe: null, mae: null, reached: Object.fromEntries(c.thresholds.map((t) => [String(t), false])),
    stopFirst: null, targetFirst: null, sessions: 0,
  };
  const i = bars.findIndex((b) => b.date > evaluationDate); // first session AFTER the evaluation date
  const entryBar = bars[i];
  if (i < 0 || !entryBar || entryBar.open === null || !(entryBar.open > 0)) return empty;
  const entry = entryBar.open * (1 + bps(c.slippageBps));
  const future = bars.slice(i).filter((b) => b.close !== null && b.high !== null && b.low !== null);
  const exitAt = (h: number) => {
    const b = future[h - 1]; // h-th session counting the entry session as 1: held through that session's close
    return b ? b.close! * (1 - bps(c.slippageBps)) : null;
  };
  const returns: Record<number, number | null> = {};
  for (const h of horizons) {
    const x = exitAt(h);
    returns[h] = x === null ? null : x / entry - 1 - bps(c.roundTripCostBps);
  }
  const bm: Record<number, number | null> = {};
  const bi = opts.benchmark?.findIndex((b) => b.date > evaluationDate) ?? -1;
  for (const h of horizons) {
    const start = bi > 0 ? opts.benchmark![bi - 1]?.close : null; // benchmark close on the evaluation date
    const end = bi >= 0 ? opts.benchmark![bi + h - 1]?.close : null;
    bm[h] = start != null && end != null ? end / start - 1 : null;
  }
  const maxH = Math.max(...horizons);
  const window = future.slice(0, maxH);
  let mfe: number | null = null, mae: number | null = null;
  for (const b of window) {
    mfe = Math.max(mfe ?? -Infinity, b.high! / entry - 1);
    mae = Math.min(mae ?? Infinity, b.low! / entry - 1);
  }
  const reached = Object.fromEntries(c.thresholds.map((t) => [String(t), mfe !== null && mfe >= t]));
  let stopFirst: boolean | null = null, targetFirst: boolean | null = null;
  if (opts.stop != null && opts.target != null && window.length) {
    for (const b of window) {
      const hitStop = b.low! <= opts.stop, hitTarget = b.high! >= opts.target;
      if (hitStop || hitTarget) {
        stopFirst = hitStop; // both in one bar: the stop is assumed to come first
        targetFirst = !hitStop && hitTarget;
        break;
      }
    }
    if (stopFirst === null) { stopFirst = false; targetFirst = false; }
  }
  return { evaluationDate, entryDate: entryBar.date, entryPrice: entry, returns, benchmark: bm, mfe, mae, reached, stopFirst, targetFirst, sessions: future.length };
}

export interface Summary {
  status: "INSUFFICIENT SAMPLE" | "DESCRIPTIVE ONLY";
  note: string;
  n: number;
  byHorizon: Record<number, { n: number; winRate: number; avgReturn: number; avgExcessVsBenchmark: number | null } | null>;
  reachedShare: Record<string, number> | null;
  stopFirstShare: number | null;
  avgMfe: number | null;
  avgMae: number | null;
}

/** Descriptive statistics only. Below the minimum sample no rate is reported at all. */
export function summarize(outcomes: Outcome[], config: typeof BACKTEST_CONFIG = BACKTEST_CONFIG): Summary {
  const done = outcomes.filter((o) => o.entryPrice !== null);
  const note = done.length < config.minSample
    ? `Only ${done.length} outcomes (minimum ${config.minSample}): no rates are reported. This is not evidence of profitability.`
    : "Descriptive statistics over in-sample snapshots from today's universe (survivorship bias). Not evidence of profitability until validated on out-of-sample data.";
  const empty: Summary = { status: "INSUFFICIENT SAMPLE", note, n: done.length, byHorizon: Object.fromEntries(config.horizons.map((h) => [h, null])), reachedShare: null, stopFirstShare: null, avgMfe: null, avgMae: null };
  if (done.length < config.minSample) return empty;
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const byHorizon: Summary["byHorizon"] = {};
  for (const h of config.horizons) {
    const r = done.filter((o) => o.returns[h] !== null);
    if (!r.length) { byHorizon[h] = null; continue; }
    const ex = r.filter((o) => o.benchmark[h] !== null).map((o) => o.returns[h]! - o.benchmark[h]!);
    byHorizon[h] = { n: r.length, winRate: r.filter((o) => o.returns[h]! > 0).length / r.length, avgReturn: mean(r.map((o) => o.returns[h]!)), avgExcessVsBenchmark: ex.length ? mean(ex) : null };
  }
  const withStops = done.filter((o) => o.stopFirst !== null);
  return {
    status: "DESCRIPTIVE ONLY", note, n: done.length, byHorizon,
    reachedShare: Object.fromEntries(config.thresholds.map((t) => [String(t), done.filter((o) => o.reached[String(t)]).length / done.length])),
    stopFirstShare: withStops.length ? withStops.filter((o) => o.stopFirst).length / withStops.length : null,
    avgMfe: mean(done.filter((o) => o.mfe !== null).map((o) => o.mfe!)),
    avgMae: mean(done.filter((o) => o.mae !== null).map((o) => o.mae!)),
  };
}
