import { z } from "zod";
import type { DailySummary } from "@/lib/db/types";

export interface MarketEvent { title: string; explanation: string; sourceUrl: string | null }
export interface WatchNews extends MarketEvent { key: string }
export interface ParsedSummary { date: string; summary: string; events: MarketEvent[]; news: WatchNews[] }

export interface ReportContent {
  summary: string | null;
  fundamentals: Record<string, string>;
  technicals: { trend?: string; momentum?: string; volume?: string; support: number[]; resistance: number[]; notes?: string };
  scenarios: {
    bullish: { case: string; confirmAbove: number | null } | null;
    bearish: { case: string; invalidateBelow: number | null } | null;
  };
  risks: string[];
  sources: { title: string; url: string }[];
  disclaimer: string;
}

const MAX_EVENTS = 3;
const MAX_NEWS = 5;
export const DEFAULT_DISCLAIMER = "Analysis to inform your own decision, not investment advice.";

function isHttpUrl(v: string): boolean {
  try {
    const p = new URL(v).protocol;
    return p === "http:" || p === "https:";
  } catch {
    return false;
  }
}

const httpUrl = z.string().refine(isHttpUrl);
const finite = z.number().finite();

const eventSchema = z.object({
  title: z.string(),
  explanation: z.string(),
  source_url: z.unknown().optional(),
});
const newsSchema = eventSchema.extend({ key: z.string() });

const sourceUrl = (v: unknown): string | null => {
  const r = httpUrl.safeParse(v);
  return r.success ? r.data : null;
};

/** Claude may have stored the array as text; parse it once, and treat anything that is not an array as empty. */
function asArray(v: unknown): unknown[] {
  let value = v;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(value) ? value : [];
}

function collect<T>(items: unknown[], schema: z.ZodType<T>, cap: number): T[] {
  const out: T[] = [];
  for (const item of items) {
    const r = schema.safeParse(item);
    if (r.success) out.push(r.data);
    if (out.length === cap) break;
  }
  return out;
}

export function parseDailySummary(row: DailySummary): ParsedSummary {
  const events = collect(asArray(row.marketEvents), eventSchema, MAX_EVENTS).map((e) => ({
    title: e.title, explanation: e.explanation, sourceUrl: sourceUrl(e.source_url),
  }));
  const news = collect(asArray(row.watchlistNews), newsSchema, MAX_NEWS).map((e) => ({
    key: e.key, title: e.title, explanation: e.explanation, sourceUrl: sourceUrl(e.source_url),
  }));
  return { date: row.date, summary: typeof row.summary === "string" ? row.summary : "", events, news };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);
const num = (v: unknown): number | null => {
  const r = finite.safeParse(v);
  return r.success ? r.data : null;
};
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const numbers = (v: unknown): number[] =>
  Array.isArray(v) ? v.flatMap((x) => { const n = num(x); return n === null ? [] : [n]; }) : [];

const sourceSchema = z.object({ title: z.string(), url: httpUrl });

const FUNDAMENTALS_ORDER = ["valuation", "growth", "balance_sheet", "recent_results", "news"];

/** jsonb does not keep key order, so impose the spec order; unknown keys follow alphabetically. */
function orderFundamentals(f: Record<string, string>): Record<string, string> {
  const known = FUNDAMENTALS_ORDER.filter((k) => k in f);
  const rest = Object.keys(f).filter((k) => !FUNDAMENTALS_ORDER.includes(k)).sort();
  return Object.fromEntries([...known, ...rest].map((k) => [k, f[k]]));
}

/** ok:false when nothing renderable parsed, so callers show the raw content instead of a bare disclaimer. */
export function parseReportContent(raw: unknown): { ok: true; value: ReportContent } | { ok: false; raw: unknown } {
  if (!isRecord(raw)) return { ok: false, raw };

  const fundamentals: Record<string, string> = {};
  if (isRecord(raw.fundamentals)) {
    for (const [k, v] of Object.entries(raw.fundamentals)) if (typeof v === "string") fundamentals[k] = v;
  }

  const t = isRecord(raw.technicals) ? raw.technicals : {};
  const technicals: ReportContent["technicals"] = { support: numbers(t.support), resistance: numbers(t.resistance) };
  for (const k of ["trend", "momentum", "volume", "notes"] as const) {
    const s = str(t[k]);
    if (s !== undefined) technicals[k] = s;
  }

  const sc = isRecord(raw.scenarios) ? raw.scenarios : {};
  const bull = isRecord(sc.bullish) ? sc.bullish : null;
  const bear = isRecord(sc.bearish) ? sc.bearish : null;

  const value: ReportContent = {
    summary: str(raw.summary) ?? null,
    fundamentals: orderFundamentals(fundamentals),
    technicals,
    scenarios: {
      bullish: bull && typeof bull.case === "string" ? { case: bull.case, confirmAbove: num(bull.confirm_above) } : null,
      bearish: bear && typeof bear.case === "string" ? { case: bear.case, invalidateBelow: num(bear.invalidate_below) } : null,
    },
    risks: strings(raw.risks),
    sources: collect(Array.isArray(raw.sources) ? raw.sources : [], sourceSchema, Infinity),
    disclaimer: str(raw.disclaimer) ?? DEFAULT_DISCLAIMER,
  };

  const renderable =
    value.summary !== null ||
    Object.keys(value.fundamentals).length > 0 ||
    technicals.support.length > 0 || technicals.resistance.length > 0 ||
    (["trend", "momentum", "volume", "notes"] as const).some((k) => technicals[k] !== undefined) ||
    value.scenarios.bullish !== null || value.scenarios.bearish !== null ||
    value.risks.length > 0 || value.sources.length > 0;
  return renderable ? { ok: true, value } : { ok: false, raw };
}
