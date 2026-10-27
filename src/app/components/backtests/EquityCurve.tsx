"use client";

import { useEffect, useRef } from "react";
import { ColorType, createChart, LineSeries } from "lightweight-charts";
import { rebase100 } from "@/lib/view/backtests";

const GRID = "rgba(148,163,184,.08)";
const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/** Strategy and Nifty 50 equity, both rebased to 100. */
export function EquityCurve({ equity }: { equity: [string, number, number][] }) {
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const chart = createChart(el, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: cssVar("--panel-2") },
        textColor: cssVar("--muted"),
        fontFamily: `${cssVar("--font-jbmono")}, monospace`,
        fontSize: 11,
        attributionLogo: false,
      },
      grid: { vertLines: { color: GRID }, horzLines: { color: GRID } },
      rightPriceScale: { borderColor: cssVar("--border") },
      // 1,700 sessions on a phone is far under the default minimum bar spacing, which would otherwise clip the history
      timeScale: { borderColor: cssVar("--border"), minBarSpacing: 0.01 },
    });
    const points = rebase100(equity);
    const bench = chart.addSeries(LineSeries, { color: cssVar("--muted"), lineWidth: 2, priceLineVisible: false });
    bench.setData(points.map((p) => ({ time: p.time, value: p.benchmark })));
    const strat = chart.addSeries(LineSeries, { color: cssVar("--up"), lineWidth: 2, priceLineVisible: false });
    strat.setData(points.map((p) => ({ time: p.time, value: p.strategy })));
    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [equity]);

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-xs text-[var(--muted)]">
        <span><span className="text-[var(--up)]">●</span> Strategy</span>
        <span><span className="text-[var(--muted)]">●</span> Nifty 50 buy and hold</span>
        <span>rebased to 100</span>
      </div>
      <div ref={box} className="h-[320px] w-full" />
    </div>
  );
}
