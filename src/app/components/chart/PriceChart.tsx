"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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
import type { StoredDay } from "@/lib/db/types";
import { buildChartData, RANGES, type ChartData, type ChartRange } from "@/lib/view/chart";
import { fmtPrice } from "@/lib/view/dashboard";
import { Chip, Panel } from "../ui";

type Ema = "ema20" | "ema50" | "ema200";
type Lower = "VOLUME" | "RSI" | "MACD";

/** An event pinned on a candle date; `color` is a CSS variable name such as "--down". */
export interface ChartMarker { time: string; text: string; color: string }
const LOWERS: Lower[] = ["VOLUME", "RSI", "MACD"];

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

function ChartCanvas({
  data,
  emas,
  bollinger,
  lower,
  height,
  markers,
  onHover,
}: {
  data: ChartData;
  emas: Record<Ema, boolean>;
  bollinger: boolean;
  lower: Lower;
  height: number;
  markers: ChartMarker[];
  onHover: (time: string | null) => void;
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
    const onMove = (p: MouseEventParams) => hoverRef.current(typeof p.time === "string" ? p.time : null);
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
        pins.map((m) => ({ time: m.time, position: "aboveBar" as const, shape: "circle" as const, color: cssVar(m.color), text: m.text, size: 1 })),
      );
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

    const panes = chart.panes();
    panes[0]?.setStretchFactor(3);
    panes[1]?.setStretchFactor(1);
    chart.timeScale().fitContent();
    return () => {
      // On unmount React runs the create effect's cleanup first; chart.remove() already disposed these.
      if (chartRef.current !== chart) return;
      for (const s of added) chart.removeSeries(s);
    };
  }, [data, emas, bollinger, lower, markers]);

  return <div ref={box} style={{ height }} className="w-full overflow-hidden rounded-lg" />;
}

const NO_MARKERS: ChartMarker[] = [];

export function PriceChart({ days, title, height = 420, markers = NO_MARKERS }: { days: StoredDay[]; title: string; height?: number; markers?: ChartMarker[] }) {
  const [range, setRange] = useState<ChartRange>("6M");
  const [emas, setEmas] = useState<Record<Ema, boolean>>({ ema20: true, ema50: true, ema200: true });
  const [bollinger, setBollinger] = useState(false);
  const [lower, setLower] = useState<Lower>("VOLUME");
  const [hover, setHover] = useState<string | null>(null);
  const data = useMemo(() => buildChartData(days, range), [days, range]);

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
          {LOWERS.map((l) => (
            <button key={l} type="button" onClick={() => setLower(l)} aria-pressed={l === lower} className={btn(l === lower)}>
              {l}
            </button>
          ))}
        </div>
      </div>
      <div className="mb-2">
        <OhlcStrip data={data} time={hover} />
      </div>
      <ChartCanvas data={data} emas={emas} bollinger={bollinger} lower={lower} height={height} markers={markers} onHover={setHover} />
    </Panel>
  );
}
