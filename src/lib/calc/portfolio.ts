import { z } from "zod";

export interface HoldingInput {
  qty: number;
  avgPrice: number;
  buyDate: string;
  stopLoss: number | null;
  target1: number | null;
  target2: number | null;
}

export type HoldingStatus = "OK" | "NEAR_SL" | "SL_HIT" | "NEAR_TARGET" | "TARGET_HIT";

export interface HoldingMetrics {
  invested: number;
  value: number | null;
  pnl: number | null;
  pnlPct: number | null;
  dayPnl: number | null;
  status: HoldingStatus | null;
}

const NEAR = 0.02;

/** SL_HIT > TARGET_HIT > NEAR_SL > NEAR_TARGET > OK; only SL and Target 1 drive status. */
export function holdingStatus(cmp: number, stopLoss: number | null, target1: number | null): HoldingStatus {
  if (stopLoss !== null && cmp <= stopLoss) return "SL_HIT";
  if (target1 !== null && cmp >= target1) return "TARGET_HIT";
  if (stopLoss !== null && (cmp - stopLoss) / cmp <= NEAR) return "NEAR_SL";
  if (target1 !== null && (target1 - cmp) / cmp <= NEAR) return "NEAR_TARGET";
  return "OK";
}

/** Per-holding money figures. Day P/L is measured from avgPrice when bought today, else from the previous close. */
export function holdingMetrics(h: HoldingInput, cmp: number | null, dayPct: number | null, today: string): HoldingMetrics {
  const invested = h.qty * h.avgPrice;
  if (cmp === null) return { invested, value: null, pnl: null, pnlPct: null, dayPnl: null, status: null };
  const value = h.qty * cmp;
  const pnl = value - invested;
  let dayPnl: number | null = null;
  if (h.buyDate === today) dayPnl = h.qty * (cmp - h.avgPrice);
  else if (dayPct !== null) dayPnl = h.qty * (cmp - cmp / (1 + dayPct));
  return {
    invested,
    value,
    pnl,
    pnlPct: invested === 0 ? null : pnl / invested,
    dayPnl,
    status: holdingStatus(cmp, h.stopLoss, h.target1),
  };
}

/** Totals over holdings that have a CMP; unpriced ones are only counted. */
export function portfolioTotals(rows: (HoldingMetrics & { hasPrice: boolean })[]) {
  let invested = 0, value = 0, pnl = 0, todayPnl = 0, unpriced = 0;
  for (const r of rows) {
    if (!r.hasPrice || r.value === null || r.pnl === null) { unpriced++; continue; }
    invested += r.invested;
    value += r.value;
    pnl += r.pnl;
    if (r.dayPnl !== null) todayPnl += r.dayPnl;
  }
  return { invested, value, pnl, pnlPct: invested === 0 ? null : pnl / invested, todayPnl, count: rows.length, unpriced };
}

/** Adding to an existing holding: weighted average, earlier date, new SL/targets win when given. */
export function mergeHolding(existing: HoldingInput, incoming: HoldingInput): HoldingInput {
  const qty = existing.qty + incoming.qty;
  return {
    qty,
    avgPrice: (existing.qty * existing.avgPrice + incoming.qty * incoming.avgPrice) / qty,
    buyDate: existing.buyDate <= incoming.buyDate ? existing.buyDate : incoming.buyDate,
    stopLoss: incoming.stopLoss ?? existing.stopLoss,
    target1: incoming.target1 ?? existing.target1,
    target2: incoming.target2 ?? existing.target2,
  };
}

const MSG = {
  qty: "Enter a whole number above 0",
  price: "Enter a price above 0",
  future: "Buy date can't be in the future",
  old: "Enter a date from 2000 onwards",
  date: "Enter a valid buy date",
  optional: "Enter a price above 0, or leave empty",
};
const MIN_DATE = "2000-01-01";

// Form values may be numeric strings; blank strings count as missing.
const toNum = (v: unknown) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v)) : v);
const toOpt = (v: unknown) => (v === undefined || v === null || (typeof v === "string" && v.trim() === "") ? null : toNum(v));

const required = (msg: string) => z.preprocess(toNum, z.number({ error: msg }).positive(msg));
const optional = z.preprocess(toOpt, z.number({ error: MSG.optional }).positive(MSG.optional).nullable());

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(+d) && d.toISOString().slice(0, 10) === s;
};

export function validateHoldingInput(
  input: unknown,
  ctx: { today: string; cmp: number | null },
): { ok: true; value: HoldingInput; warnings: string[] } | { ok: false; errors: Record<string, string> } {
  const schema = z.object({
    qty: required(MSG.qty).pipe(z.number().int(MSG.qty)),
    avgPrice: required(MSG.price),
    buyDate: z
      .string({ error: MSG.date })
      .refine(isRealDate, MSG.date)
      .refine((d) => !isRealDate(d) || d <= ctx.today, MSG.future)
      .refine((d) => !isRealDate(d) || d >= MIN_DATE, MSG.old),
    stopLoss: optional,
    target1: optional,
    target2: optional,
  });
  const parsed = schema.safeParse(input ?? {});
  if (!parsed.success) {
    const errors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = String(issue.path[0] ?? "form");
      if (!(key in errors)) errors[key] = issue.message;
    }
    return { ok: false, errors };
  }
  const v = parsed.data as HoldingInput;
  const warnings: string[] = [];
  if (v.stopLoss !== null && v.stopLoss >= v.avgPrice) warnings.push("Stop loss is at or above your buy price");
  if (v.target1 !== null && ctx.cmp !== null && v.target1 <= ctx.cmp) warnings.push("Target 1 is already below the current price");
  if (v.target2 !== null && v.target1 !== null && v.target2 <= v.target1) warnings.push("Target 2 should be above Target 1");
  return { ok: true, value: v, warnings };
}
