import { effectiveLevel } from "@/lib/calc/levels";
import type { HoldingInput } from "@/lib/calc/portfolio";
import { previousQuarterEnd, quarterLabel } from "@/lib/calc/shareholding";
import { levelStrength } from "@/lib/calc/levelsDetail";
import type { PatternBias } from "@/lib/calc/patterns";
import type { ScoreComponents, ScoreLabel } from "@/lib/calc/score";
import { parseReportContent } from "@/lib/content/claude";
import type { Instrument, InstrumentType, Levels, ReportRow, ShareholdingRow, StoredDay } from "@/lib/db/types";
import { fmtPct, fmtPrice } from "./dashboard";

export interface PopupData {
  instrument: { key: string; name: string; type: InstrumentType; yahooTicker: string; sectorKey: string | null; sectorName: string | null };
  /** Full stored history, ascending. */
  days: StoredDay[];
  latest: StoredDay | null;
  score: {
    value: number; label: ScoreLabel; confidence: string; signal: string;
    components: ScoreComponents; partial: boolean;
  } | null;
  levels: {
    support: number | null; resistance: number | null;
    supportManual: boolean; resistanceManual: boolean;
    supportStrength: "Strong" | "Weak" | null; resistanceStrength: "Strong" | "Weak" | null;
  };
  range52: { high: number | null; low: number | null; fromHigh: number | null; fromLow: number | null };
  tailwinds: { niftyLabel: ScoreLabel | null; niftyLine: string; sectorRs: number | null; sectorLine: string | null };
  /** Last 10 sessions, newest first. */
  patterns: { date: string; name: string; bias: PatternBias; effect: number }[];
  indicatorTable: { label: string; value: string }[];
  onWatchlist: boolean;
  /** The owner's position in this stock, or null when not held. */
  holding: HoldingInput | null;
  reports: {
    id: number; status: string; requestedAt: string; completedAt: string | null; content: unknown; error: string | null; parsed: ReturnType<typeof parseReportContent>;
  }[];
}

export interface PopupInput {
  instrument: Instrument;
  sector: Instrument | null;
  days: StoredDay[];
  levels: Levels;
  niftyLatest: StoredDay | null;
  onWatchlist: boolean;
  holding: HoldingInput | null;
  reports: ReportRow[];
  /** This stock's rows for the latest and previous reported quarters. */
  shareholding: ShareholdingRow[];
}

const PATTERN_SESSIONS = 10;
const DASH = "—";

/** "49.6% (+1.5 pts vs Apr–Jun)"; just the percent when the previous quarter is missing. */
function holdingLine(rows: ShareholdingRow[], pick: (r: ShareholdingRow) => number | null): string {
  const latest = rows.reduce<ShareholdingRow | null>((m, r) => (m === null || r.quarterEnd > m.quarterEnd ? r : m), null);
  const to = latest ? pick(latest) : null;
  if (!latest || to === null) return DASH;
  const prevEnd = previousQuarterEnd(latest.quarterEnd);
  const prev = rows.find((r) => r.quarterEnd === prevEnd);
  const from = prev ? pick(prev) : null;
  if (from === null) return `${to}%`;
  const diff = Math.round((to - from) * 10) / 10;
  return `${to}% (${diff > 0 ? "+" : ""}${diff} pts vs ${quarterLabel(prevEnd).replace(/ \d{4}$/, "")})`;
}

function niftyLine(label: ScoreLabel | null): string {
  if (label === "Strong Bullish" || label === "Bullish") return "Broad market trend supports longs";
  if (label === "Neutral") return "Market is range-bound";
  if (label === "Bearish" || label === "Strong Bearish") return "Broad market weakness";
  return "Market score not available";
}

const near = (close: number, level: number | null) => level !== null && Math.abs(close - level) / close <= 0.01;

export function buildPopupData(input: PopupInput): PopupData {
  const { instrument, sector, levels } = input;
  const days = [...input.days].sort((a, b) => a.date.localeCompare(b.date));
  const priced = days.filter((d) => d.close !== null);
  const latest = priced[priced.length - 1] ?? null;
  const close = latest?.close ?? null;

  const support = effectiveLevel(levels.autoSupport, levels.manualSupport);
  const resistance = effectiveLevel(levels.autoResistance, levels.manualResistance);
  const bars = priced.map((d) => ({ high: d.high ?? (d.close as number), low: d.low ?? (d.close as number) }));

  const high = latest?.high52w ?? null;
  const low = latest?.low52w ?? null;

  const rsVsSector = latest?.rsVsSector ?? null;
  const niftyLabel = input.niftyLatest?.scoreLabel ?? null;

  const patterns = priced
    .slice(-PATTERN_SESSIONS)
    .reverse()
    .flatMap((d) =>
      (d.patterns ?? []).map((p) => {
        let effect = 0;
        if (p.bias === "bullish") effect = 3.75;
        else if (p.bias === "bearish") effect = -3.75;
        else if (p.name === "doji" && d.close !== null) {
          if (near(d.close, support)) effect = 3.75;
          else if (near(d.close, resistance)) effect = -3.75;
        }
        return { date: d.date, name: p.name, bias: p.bias, effect };
      }),
    );

  const ema = (label: string, v: number | null | undefined) => ({
    label,
    value: v == null || close === null ? DASH : `${fmtPrice(v)} (${fmtPct((close - v) / v)})`,
  });
  const price = (label: string, v: number | null | undefined) => ({ label, value: fmtPrice(v ?? null) });
  const volRatio = latest?.volume && latest.volAvg20 ? `${(latest.volume / latest.volAvg20).toFixed(2)}×` : DASH;

  return {
    instrument: {
      key: instrument.key, name: instrument.name, type: instrument.type, yahooTicker: instrument.yahooTicker,
      sectorKey: sector?.key ?? null, sectorName: sector?.name ?? null,
    },
    days,
    latest,
    score:
      latest && latest.score !== null && latest.scoreLabel && latest.scoreComponents
        ? {
            value: latest.score,
            label: latest.scoreLabel,
            confidence: latest.scoreConfidence ?? "Low",
            signal: latest.scoreSignal ?? "",
            components: latest.scoreComponents,
            partial: latest.scoreComponents.partial,
          }
        : null,
    levels: {
      support, resistance,
      supportManual: levels.manualSupport !== null,
      resistanceManual: levels.manualResistance !== null,
      supportStrength: levelStrength(bars, support).strength,
      resistanceStrength: levelStrength(bars, resistance).strength,
    },
    range52: {
      high, low,
      fromHigh: close !== null && high ? (close - high) / high : null,
      fromLow: close !== null && low ? (close - low) / low : null,
    },
    tailwinds: {
      niftyLabel,
      niftyLine: niftyLine(niftyLabel),
      sectorRs: rsVsSector,
      sectorLine:
        instrument.type === "stock" && rsVsSector !== null
          ? `${rsVsSector >= 0 ? "Outperforming" : "Underperforming"} its sector by ${(Math.abs(rsVsSector) * 100).toFixed(1)}%`
          : null,
    },
    patterns,
    indicatorTable: [
      price("CMP", close),
      ema("EMA 20", latest?.ema20),
      ema("EMA 50", latest?.ema50),
      ema("EMA 200", latest?.ema200),
      { label: "RSI 14", value: latest?.rsi14 == null ? DASH : latest.rsi14.toFixed(1) },
      price("MACD", latest?.macd),
      price("MACD signal", latest?.macdSignal),
      price("MACD histogram", latest?.macdHist),
      price("BB upper", latest?.bbUpper),
      price("BB middle", latest?.bbMiddle),
      price("BB lower", latest?.bbLower),
      { label: "Volume vs 20-day avg", value: volRatio },
      price("52W high", high),
      price("52W low", low),
      { label: "RS vs Nifty (4W)", value: fmtPct(latest?.rsVsNifty ?? null) },
      { label: "RS vs sector (4W)", value: fmtPct(rsVsSector) },
      { label: "FII holding", value: holdingLine(input.shareholding, (r) => r.fiiPct) },
      { label: "DII holding", value: holdingLine(input.shareholding, (r) => r.diiPct) },
    ],
    onWatchlist: input.onWatchlist,
    holding: input.holding,
    reports: input.reports.map((r) => ({
      id: r.id, status: r.status, requestedAt: r.requestedAt, completedAt: r.completedAt,
      content: r.content, error: r.error, parsed: parseReportContent(r.content),
    })),
  };
}
