import { ALPHAS, type AlphaId } from "@/lib/calc/alpha/alphas";
import { ALPHA_WINDOW, runAlphas } from "@/lib/calc/alpha/run";
import { runScreeners, SCREENERS, type ScreenerId } from "@/lib/calc/screeners";
import type { OhlcvDay, StoredDay } from "@/lib/db/types";

export interface StockSeries<D extends OhlcvDay = OhlcvDay> {
  key: string;
  name: string;
  days: D[];
}

export interface Strategy<D extends OhlcvDay = OhlcvDay> {
  id: string;
  label: string;
  params: Record<string, string | number>;
  /** Rows of history `pick` can read per stock; the engine never shows it more. */
  lookback: number;
  /**
   * Stocks to buy after the close of `date`, highest priority first, at most `limit`.
   * `window` holds each stock that has a row on `date`, with only its last `lookback` rows ending on `date`.
   */
  pick(window: StockSeries<D>[], date: string, limit: number): string[];
}

/** The top `top` stocks by one alpha on the call date. */
export function alphaStrategy(alpha: AlphaId, top: number): Strategy {
  const def = ALPHAS.find((a) => a.id === alpha)!;
  return {
    id: `alpha:${alpha}`,
    label: `Alpha #${def.paperNo} ${def.title}, top ${top}`,
    params: { alpha, top },
    lookback: ALPHA_WINDOW,
    // runAlphas scores all six alphas per call; fine for ~1,900 calls, narrow it if runs get slow
    pick: (window, date, limit) => runAlphas(window, date, top).find((r) => r.id === alpha)!.top.map((h) => h.key).slice(0, limit),
  };
}

/** Screener rules that make sense on history. The score rules are left out: the stored score may not reach back. */
export const RULE_IDS = ["vol_up", "vol_down", "breakout", "breakdown", "golden", "death", "rsi_high", "rsi_low"] as const;
export type RuleId = (typeof RULE_IDS)[number] & ScreenerId;

/** Every stock the screener rule fires on, in the screener's own order. Needs the stored indicators. */
export function ruleStrategy(rule: RuleId): Strategy<StoredDay> {
  return {
    id: `rule:${rule}`,
    label: SCREENERS.find((x) => x.id === rule)!.title,
    params: { rule },
    lookback: 6,
    pick: (window, date, limit) => runScreeners(window, date, 1000).find((r) => r.id === rule)!.hits.map((h) => h.key).slice(0, limit),
  };
}

/** Always wants one stock: a control that, on an index, reproduces buy and hold. */
export function holdStrategy(key: string): Strategy {
  return {
    id: `hold:${key}`,
    label: `Hold ${key}`,
    params: { key },
    lookback: 1,
    pick: (window) => (window.some((s) => s.key === key) ? [key] : []),
  };
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A seeded shuffle per date: a control that should land near the benchmark minus costs. */
export function randomStrategy(seed: number): Strategy {
  return {
    id: "random",
    label: `Random picks (seed ${seed})`,
    params: { seed },
    lookback: 1,
    pick: (window, date, limit) => {
      let h = 2166136261; // FNV-1a over "seed:date", so each date shuffles differently
      for (const ch of `${seed}:${date}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
      const rng = mulberry32(h);
      const keys = window.map((s) => s.key).sort();
      for (let i = keys.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [keys[i], keys[j]] = [keys[j], keys[i]];
      }
      return keys.slice(0, limit);
    },
  };
}
