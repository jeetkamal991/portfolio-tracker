"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { fetchCached, historyUrl, TTL_MS } from "@/lib/client/cache";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  LineStyle,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type SeriesType,
} from "lightweight-charts";
import { keyLevels, type KeyLevels } from "@/lib/calc/chartLevels";
import { chartSignals, type SignalKind } from "@/lib/calc/chartSignals";
import type { StoredDay } from "@/lib/db/types";
import type { BreadthResponse } from "@/app/api/breadth/route";
import { buildChartData, emaStretch, hoverInfo, type HoverInfo, RANGE_BARS, RANGES, type ChartData, type ChartRange } from "@/lib/view/chart";
import { fmtPrice } from "@/lib/view/dashboard";
import { Chip, Panel } from "../ui";

type Ema = "ema20" | "ema50" | "ema200";
type Lower = "VOLUME" | "RSI" | "MACD" | "BREADTH";

/** A marker pinned on a candle date; `color` is a CSS variable name such as "--down". */
export interface ChartMarker { time: string; text: string; color: string; up: boolean; size: number }

const SIGNAL_LOOK: Record<SignalKind, { text: string; size: number }> = {
  golden: { text: "Golden cross", size: 1.5 },
  death: { text: "Death cross", size: 1.5 },
  above200: { text: "Above 200", size: 1 },
  below200: { text: "Below 200", size: 1 },
  up2050: { text: "20/50 ↑", size: 0.7 },
  down2050: { text: "20/50 ↓", size: 0.7 },
};
const BULLISH = new Set<SignalKind>(["golden", "above200", "up2050"]);
const LOWERS: Lower[] = ["VOLUME", "RSI", "MACD"];

/** Breadth line (% of Nifty 200 above EMA 200) and India VIX, as `/api/breadth` sends them. */
type BreadthData = { pct: { time: string; value: number }[]; vix: { time: string; value: number }[] };

const EMAS: { id: Ema; label: string; cssVar: string }[] = [
  { id: "ema20", label: "EMA 20", cssVar: "--ema20" },
  { id: "ema50", label: "EMA 50", cssVar: "--ema50" },
  { id: "ema200", label: "EMA 200", cssVar: "--ema200" },
];
const GRID = "rgba(148,163,184,.08)";

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const fmtVol = (v: number | undefined) =>
  v === undefined ? "—" : v >= 1e7 ? `${(v / 1e7).toFixed(2)}Cr` : v >= 1e5 ? `${(v / 1e5).toFixed(2)}L` : v.toLocaleString("en-IN");

function OhlcStrip({ data, time }: { data: ChartData; time: string | null }) {
  const c = (time ? data.candles.find((x) => x.time === time) : undefined) ?? data.candles[data.candles.length - 1]!;
  const at = (pts: { time: string; value: number }[]) => pts.find((p) => p.time === c.time)?.value ?? null;
  const tone = c.close >= c.open ? "text-[var(--up)]" : "text-[var(--down)]";
  const item = (label: string, value: string, cls = "text-[var(--text)]") => (
    <span key={label} className="whitespace-nowrap">
      {label && <span className="text-[var(--muted)]">{label} </span>}
      <span className={cls}>{value}</span>
    </span>
  );
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums">
      {item("", c.time, "text-[var(--muted)]")}
      {item("O", fmtPrice(c.open))}
      {item("H", fmtPrice(c.high))}
      {item("L", fmtPrice(c.low))}
      {item("C", fmtPrice(c.close), tone)}
      {item("Vol", fmtVol(data.volume.find((v) => v.time === c.time)?.value))}
      {item("EMA20", fmtPrice(at(data.ema20)), "text-[var(--ema20)]")}
      {item("EMA50", fmtPrice(at(data.ema50)), "text-[var(--ema50)]")}
      {item("EMA200", fmtPrice(at(data.ema200)), "text-[var(--ema200)]")}
    </div>
  );
}

const STRETCH_TONE = { normal: "text-[var(--text)]", amber: "text-[var(--warn)]", red: "text-[var(--down)]" };

/** Latest close's distance from each EMA, e.g. "vs EMA20 +7.0% · vs EMA50 +7.2%". */
function StretchStrip({ data }: { data: ChartData }) {
  const last = (pts: { value: number }[]) => pts[pts.length - 1]?.value ?? null;
  const close = data.candles[data.candles.length - 1]!.close;
  const items = emaStretch(close, { ema20: last(data.ema20), ema50: last(data.ema50), ema200: last(data.ema200) });
  if (items.length === 0) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-x-2 font-mono text-[11px] tabular-nums text-[var(--muted)]">
      {items.map((x, i) => (
        <span key={x.label} className="whitespace-nowrap">
          {i > 0 && "· "}vs {x.label} <span className={STRETCH_TONE[x.tone]}>{x.pct > 0 ? "+" : ""}{x.pct.toFixed(1)}%</span>
        </span>
      ))}
    </div>
  );
}

const dash = "—";
const num = (v: number | null, d = 1, sign = false) => (v === null ? dash : `${sign && v > 0 ? "+" : ""}${v.toFixed(d)}`);

function Tooltip({ info, side }: { info: HoverInfo; side: "left" | "right" }) {
  const row = (label: string, value: string, cls = "") => (
    <div className="flex justify-between gap-4"><span className="text-[var(--muted)]">{label}</span><span className={cls}>{value}</span></div>
  );
  const tone = info.dayPct === null ? "" : info.dayPct >= 0 ? "text-[var(--up)]" : "text-[var(--down)]";
  return (
    <div
      className={`pointer-events-none absolute top-2 z-10 w-52 rounded-md border border-[var(--border)] bg-[var(--panel)]/95 p-2 font-mono text-[11px] tabular-nums ${side === "right" ? "right-16" : "left-2"}`}
    >
      <div className="mb-1 text-[var(--muted)]">{info.date}</div>
      {row("Close", fmtPrice(info.close))}
      {row("Day", info.dayPct === null ? dash : `${num(info.dayPct, 2, true)}%`, tone)}
      {row("RSI 14", num(info.rsi))}
      {row("Score", info.score === null ? dash : `${Math.round(info.score)}${info.scoreLabel ? ` ${info.scoreLabel}` : ""}`)}
      {row("Breadth", info.breadth === null ? dash : `${info.breadth.toFixed(1)}%`)}
      {row("vs EMA20", info.ema20Pct === null ? dash : `${num(info.ema20Pct, 1, true)}%`)}
    </div>
  );
}

function ChartCanvas({
  data,
  emas,
  bollinger,
  lower,
  height,
  markers,
  breadth,
  levels,
  shade,
  onHover,
}: {
  data: ChartData;
  emas: Record<Ema, boolean>;
  bollinger: boolean;
  lower: Lower;
  height: number;
  markers: ChartMarker[];
  breadth: BreadthData | null;
  levels: KeyLevels | null;
  shade: boolean;
  /** `side` is the half of the chart the pointer is NOT in, where a tooltip can sit without covering the candle. */
  onHover: (h: { time: string; side: "left" | "right" } | null) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const hoverRef = useRef(onHover);
  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true, // lightweight-charts follows the container with its own ResizeObserver
      layout: {
        background: { type: ColorType.Solid, color: cssVar("--panel-2") },
        textColor: cssVar("--muted"),
        fontFamily: `${cssVar("--font-jbmono")}, monospace`,
        fontSize: 11,
        attributionLogo: false,
        panes: { separatorColor: cssVar("--border") },
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: cssVar("--border") },
      timeScale: { borderColor: cssVar("--border") },
    });
    const onMove = (p: MouseEventParams) =>
      hoverRef.current(typeof p.time === "string" ? { time: p.time, side: (p.point?.x ?? 0) < el.clientWidth / 2 ? "right" : "left" } : null);
    chart.subscribeCrosshairMove(onMove);
    chartRef.current = chart;
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
    };
  }, []);

  // Rebuild every series when the range, overlays or lower pane change.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    const up = cssVar("--up");
    const down = cssVar("--down");
    const added: ISeriesApi<SeriesType>[] = [];

    if (shade && data.regime.length > 0) {
      // Added first so it sits behind the candles: full-height bars on a hidden 0-1 scale, 8% opacity ("14" in hex).
      const tint = chart.addSeries(HistogramSeries, {
        priceScaleId: "regime", priceLineVisible: false, lastValueVisible: false,
        autoscaleInfoProvider: () => ({ priceRange: { minValue: 0, maxValue: 1 } }),
      });
      chart.priceScale("regime").applyOptions({ visible: false, scaleMargins: { top: 0, bottom: 0 } });
      tint.setData(data.regime.map((r) => ({ time: r.time, value: 1, color: `${r.bull ? up : down}14` })));
      added.push(tint);
    }
    const candles = chart.addSeries(CandlestickSeries, {
      upColor: up, downColor: down, borderUpColor: up, borderDownColor: down, wickUpColor: up, wickDownColor: down,
    });
    candles.setData(data.candles);
    added.push(candles);
    // Only events that fall inside the visible range; the library rejects a marker on a time it has no bar for.
    const inRange = new Set(data.candles.map((c) => c.time));
    const pins = markers.filter((m) => inRange.has(m.time));
    if (pins.length > 0) {
      createSeriesMarkers(
        candles,
        pins.map((m) => ({
          time: m.time, position: m.up ? ("belowBar" as const) : ("aboveBar" as const), shape: m.up ? ("arrowUp" as const) : ("arrowDown" as const),
          color: cssVar(m.color), text: m.text, size: m.size,
        })),
      );
    }
    if (levels) {
      // Faint dashed lines with a right-axis label; the colours carry a low alpha so the candles stay readable.
      const faint = (price: number | null, name: string, color: string) => {
        if (price === null) return;
        candles.createPriceLine({ price, color: `${cssVar(color)}88`, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: name });
      };
      faint(levels.pdh, "PDH", "--muted");
      faint(levels.pdl, "PDL", "--muted");
      faint(levels.high52, "52W H", "--warn");
      faint(levels.support, "S", "--up");
      faint(levels.resistance, "R", "--down");
    }
    for (const e of EMAS) {
      if (!emas[e.id]) continue;
      const s = chart.addSeries(LineSeries, {
        color: cssVar(e.cssVar), lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      });
      s.setData(data[e.id]);
      added.push(s);
    }
    if (bollinger) {
      const muted = cssVar("--muted");
      const band = (pts: ChartData["bbUpper"], dashed: boolean) => {
        const s = chart.addSeries(LineSeries, {
          color: muted, lineWidth: 1, lineStyle: dashed ? LineStyle.Dashed : LineStyle.Solid,
          priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
        });
        s.setData(pts);
        added.push(s);
      };
      band(data.bbUpper, false);
      band(data.bbMiddle, true);
      band(data.bbLower, false);
    }

    if (lower === "VOLUME") {
      const vol = chart.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false }, 1);
      vol.setData(data.volume.map((v) => ({ time: v.time, value: v.value, color: v.up ? `${up}99` : `${down}99` })));
      const avg = chart.addSeries(
        LineSeries,
        { color: cssVar("--warn"), lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
        1,
      );
      avg.setData(data.volSma20);
      added.push(vol, avg);
    } else if (lower === "BREADTH") {
      // VIX has its own (left) scale so its level does not flatten the 0-100 breadth line.
      const seen = (pts: BreadthData["pct"]) => pts.filter((p) => inRange.has(p.time));
      const line = (color: string, pts: BreadthData["pct"], scale: string) => {
        const s = chart.addSeries(LineSeries, { color, lineWidth: 2, priceLineVisible: false, crosshairMarkerVisible: false, priceScaleId: scale }, 1);
        s.setData(seen(pts));
        return s;
      };
      const b = line(cssVar("--ema20"), breadth?.pct ?? [], "right");
      b.createPriceLine({ price: 50, color: cssVar("--muted"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: false, title: "" });
      added.push(b, line(cssVar("--warn"), breadth?.vix ?? [], "left"));
    } else if (lower === "MACD") {
      const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 1);
      hist.setData(data.macdHist.map((p) => ({ time: p.time, value: p.value, color: p.value >= 0 ? `${up}99` : `${down}99` })));
      const line = (color: string, pts: ChartData["macd"]) => {
        const s = chart.addSeries(
          LineSeries,
          { color, lineWidth: 2, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false },
          1,
        );
        s.setData(pts);
        return s;
      };
      added.push(hist, line(cssVar("--ema20"), data.macd), line(cssVar("--ema50"), data.macdSignal));
    } else {
      const rsi = chart.addSeries(LineSeries, { color: cssVar("--ema20"), lineWidth: 2, priceLineVisible: false }, 1);
      rsi.setData(data.rsi);
      for (const price of [70, 30]) {
        rsi.createPriceLine({ price, color: cssVar("--muted"), lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: "" });
      }
      added.push(rsi);
    }

    chart.priceScale("left").applyOptions({ visible: lower === "BREADTH", borderColor: cssVar("--border") });
    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);
    chart.timeScale().fitContent();
    return () => {
      // On unmount React runs the create effect's cleanup first; chart.remove() already disposed these.
      if (chartRef.current !== chart) return;
      for (const s of added) chart.removeSeries(s);
    };
  }, [data, emas, bollinger, lower, markers, breadth, levels, shade]);

  return <div ref={box} style={{ height }} className="w-full overflow-hidden rounded-lg" />;
}

const NO_MARKERS: ChartMarker[] = [];

export function PriceChart({
  days, title, height = 420, signals = false, historyKey, moreHistory = false,
}: {
  days: StoredDay[]; title: string; height?: number;
  /** Mark EMA crosses on the candles (Dashboard only). */
  signals?: boolean;
  /** Instrument key whose full history can be fetched when a range needs more than `days` holds. */
  historyKey?: string;
  /** True when older history exists beyond `days` (the server only sent the latest year). */
  moreHistory?: boolean;
}) {
  const [range, setRange] = useState<ChartRange>("6M");
  const [emas, setEmas] = useState<Record<Ema, boolean>>({ ema20: true, ema50: true, ema200: true });
  const [bollinger, setBollinger] = useState(false);
  const [lower, setLower] = useState<Lower>("VOLUME");
  const [hover, setHover] = useState<{ time: string; side: "left" | "right" } | null>(null);
  const [full, setFull] = useState<{ key: string; days: StoredDay[] } | null>(null);
  const [fullState, setFullState] = useState<"idle" | "loading" | "error">("idle");
  const pricedHere = useMemo(() => days.filter((d) => d.close !== null).length, [days]);
  const wanted = RANGE_BARS[range];
  // Longer than what is loaded (ALL, or a window beyond the sent year): fetch the rest while the chart keeps showing what it has.
  const needFull = !!historyKey && moreHistory && (wanted === null || wanted > pricedHere) && full?.key !== historyKey;
  useEffect(() => {
    if (!needFull || !historyKey) return;
    const ctrl = new AbortController();
    setFullState("loading");
    fetchCached<{ days: StoredDay[] }>(historyUrl(historyKey), { ttlMs: TTL_MS.history, signal: ctrl.signal })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.ok && r.data) { setFull({ key: historyKey, days: r.data.days }); setFullState("idle"); } else setFullState("error");
      })
      .catch(() => { if (!ctrl.signal.aborted) setFullState("error"); });
    return () => ctrl.abort();
  }, [needFull, historyKey]);
  const shown = full && full.key === historyKey ? full.days : days;
  const data = useMemo(() => buildChartData(shown, range), [shown, range]);

  // Breadth is fetched only once its pane is opened, for as many sessions as the chart shows.
  const [breadthRes, setBreadthRes] = useState<BreadthResponse | null>(null);
  const [breadthState, setBreadthState] = useState<"idle" | "loading" | "error">("idle");
  const breadthN = data.candles.length;
  useEffect(() => {
    if (!signals || lower !== "BREADTH") return;
    const ctrl = new AbortController();
    setBreadthState("loading");
    fetchCached<BreadthResponse>(`/api/breadth?n=${breadthN}`, { ttlMs: TTL_MS.history, signal: ctrl.signal })
      .then((r) => {
        if (ctrl.signal.aborted) return;
        if (r.ok && r.data) { setBreadthRes(r.data); setBreadthState("idle"); } else setBreadthState("error");
      })
      .catch(() => { if (!ctrl.signal.aborted) setBreadthState("error"); });
    return () => ctrl.abort();
  }, [signals, lower, breadthN]);
  // Computed over all loaded days so the first visible bar still has its previous day to compare with.
  const markers = useMemo<ChartMarker[]>(
    () => signals ? chartSignals(shown).map((x) => ({ time: x.time, ...SIGNAL_LOOK[x.kind], color: BULLISH.has(x.kind) ? "--up" : "--down", up: BULLISH.has(x.kind) })) : NO_MARKERS,
    [shown, signals],
  );

  const priced = useMemo(
    () =>
      shown
        .filter((d): d is StoredDay & { close: number } => d.close !== null)
        .sort((a, b) => a.date.localeCompare(b.date)),
    [shown],
  );
  const breadthByDate = useMemo(() => new Map((breadthRes?.state === "ok" ? breadthRes.points : []).map((p) => [p.time, p.pct])), [breadthRes]);
  const tip = signals && hover ? hoverInfo(priced, hover.time, breadthByDate.get(hover.time) ?? null) : null;
  const levels = useMemo(() => (signals ? keyLevels(shown) : null), [shown, signals]);
  const breadthOk = breadthRes?.state === "ok";
  const breadth = useMemo<BreadthData | null>(
    () => (breadthRes?.state === "ok" ? { pct: breadthRes.points.map((p) => ({ time: p.time, value: p.pct })), vix: breadthRes.vix } : null),
    [breadthRes],
  );

  if (data.candles.length < 2) {
    return (
      <Panel title={title}>
        <p className="text-sm text-[var(--muted)]">Not enough price history to chart</p>
      </Panel>
    );
  }
  const lastClose = data.candles[data.candles.length - 1]!.close;
  const btn = (on: boolean) =>
    `rounded-md border px-2 py-1 font-mono text-[11px] font-medium transition-colors ${
      on
        ? "border-[var(--border)] bg-slate-800 text-[var(--up)]"
        : "border-transparent text-[var(--muted)] hover:bg-slate-800/50 hover:text-[var(--text)]"
    }`;

  return (
    <Panel
      title={
        <span className="flex items-center gap-2">
          {title} <Chip tone="neutral">{fmtPrice(lastClose)}</Chip>
        </span>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => setRange(r)} aria-pressed={r === range} className={btn(r === range)}>
              {r}
            </button>
          ))}
          {fullState === "loading" && <span role="status" className="ml-2 self-center font-mono text-[11px] text-[var(--muted)]">Loading full history…</span>}
          {fullState === "error" && <span role="alert" className="ml-2 self-center font-mono text-[11px] text-[var(--down)]">Could not load the full history</span>}
        </div>
        <div className="flex flex-wrap gap-1" role="group" aria-label="Overlays">
          {EMAS.map((e) => (
            <button
              key={e.id}
              type="button"
              aria-pressed={emas[e.id]}
              onClick={() => setEmas((s) => ({ ...s, [e.id]: !s[e.id] }))}
              className={`rounded-md border px-2 py-1 font-mono text-[11px] font-medium ${emas[e.id] ? "" : "opacity-40"}`}
              style={{
                color: `var(${e.cssVar})`,
                borderColor: `color-mix(in srgb, var(${e.cssVar}) 40%, transparent)`,
                background: `color-mix(in srgb, var(${e.cssVar}) 15%, transparent)`,
              }}
            >
              {e.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={bollinger}
            onClick={() => setBollinger((b) => !b)}
            className={`rounded-md border border-[color-mix(in_srgb,var(--muted)_40%,transparent)] bg-[color-mix(in_srgb,var(--muted)_15%,transparent)] px-2 py-1 font-mono text-[11px] font-medium text-[var(--muted)] ${bollinger ? "" : "opacity-40"}`}
          >
            Bollinger
          </button>
        </div>
        <div className="flex gap-1" role="group" aria-label="Lower pane">
          {(signals ? [...LOWERS, "BREADTH" as const] : LOWERS).map((l) => (
            <button key={l} type="button" onClick={() => setLower(l)} aria-pressed={l === lower} className={btn(l === lower)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2">
        <OhlcStrip data={data} time={hover?.time ?? null} />
        {signals && <StretchStrip data={data} />}
      </div>
      {lower === "BREADTH" && (
        <p role="status" className="mb-2 font-mono text-[11px] text-[var(--muted)]">
          {breadthState === "loading" ? "Loading breadth…"
            : breadthState === "error" ? "Could not load breadth"
            : breadthRes?.state === "no_universe" ? "Breadth appears after the Nifty 200 import."
            : breadthRes?.state === "no_data" ? "No breadth data yet."
            : breadthOk && breadthRes.points[0]!.time > data.candles[0]!.time ? "Breadth covers the last year only."
            : breadthOk ? <><span className="text-[var(--ema20)]">% of Nifty 200 above EMA 200</span> · <span className="text-[var(--warn)]">India VIX (left axis)</span></> : null}
        </p>
      )}
      <div className="relative">
      {tip && hover && <Tooltip info={tip} side={hover.side} />}
      <ChartCanvas data={data} emas={emas} bollinger={bollinger} lower={lower} height={height} markers={markers} breadth={breadth} levels={levels} shade={signals} onHover={setHover} />
      </div>
    </Panel>
  );
}
